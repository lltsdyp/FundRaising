import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  parseEther,
  type Address,
  type EIP1193Provider,
} from "viem";
import { crowdfundingAbi, projectAbi } from "./abi";
import {
  FundingModel,
  type CreateProjectInput,
  type FundingProject,
  type ProjectMilestone,
  type WalletSession,
} from "./types";
import { ProjectState, withOperationTimeout } from "./utils";

export const DEFAULT_CROWDFUNDING_ADDRESS: Address =
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";

export const DEFAULT_RPC_URL = "http://127.0.0.1:8545";

export function getRpcUrl(): string {
  const configured = import.meta.env.VITE_RPC_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }

  // 默认走同源的 /rpc(由 Vite dev server 代理到节点),绕开浏览器 CORS。
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/rpc`;
  }

  return DEFAULT_RPC_URL;
}

export const GANACHE_TRANSACTION_GAS_CAP = 16_777_216n;
export const READ_OPERATION_TIMEOUT_MS = 20_000;
export const WALLET_REQUEST_TIMEOUT_MS = 60_000;
export const TRANSACTION_CONFIRMATION_TIMEOUT_MS = 120_000;

export const WRITE_GAS_LIMITS = {
  createProject: 2_500_000n,
  // 首次进入前三名的捐赠会额外 mint 一枚 ERC721Enumerable 徽章
  // (Crowdfunding.contribute -> donationBadge.mint)，单是 mint 就要 ~150k-200k，
  // 叠加首次捐赠的多个 SSTORE 会超过旧的 300k 上限导致 out-of-gas，故上调。
  contribute: 600_000n,
  submitMilestone: 200_000n,
  approveMilestone: 200_000n,
  releaseMilestoneFunds: 250_000n,
  withdrawContribution: 200_000n,
  withdrawRaisedFunds: 200_000n,
} as const;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function getEthereumProvider() {
  if (!window.ethereum) {
    throw new Error("请先安装并启用 MetaMask 钱包");
  }

  return window.ethereum;
}

export function getPublicClient() {
  // 只读请求直连节点,避免经 MetaMask 转发导致其区块轮询被并发读打爆
  // (-32002 "RPC endpoint returned too many errors")。签名/发交易仍走钱包 provider。
  return createPublicClient({
    transport: http(getRpcUrl()),
  });
}

function withReadTimeout<T>(operation: Promise<T>, label: string) {
  return withOperationTimeout(
    operation,
    READ_OPERATION_TIMEOUT_MS,
    `${label}超时，请检查钱包网络后重试`,
  );
}

function withWalletRequestTimeout<T>(operation: Promise<T>, label: string) {
  return withOperationTimeout(
    operation,
    WALLET_REQUEST_TIMEOUT_MS,
    `${label}超时，请确认钱包弹窗或稍后重试`,
  );
}

function withTransactionConfirmationTimeout<T>(operation: Promise<T>) {
  return withOperationTimeout(
    operation,
    TRANSACTION_CONFIRMATION_TIMEOUT_MS,
    "交易确认超时，交易可能仍在链上处理中，请稍后刷新项目状态",
  );
}

async function getWalletClient() {
  const provider = getEthereumProvider();
  const walletClient = createWalletClient({
    transport: custom(provider),
  });
  const [account] = await withWalletRequestTimeout(
    walletClient.getAddresses(),
    "读取钱包账户",
  );

  if (!account) {
    throw new Error("请先连接钱包");
  }

  return { walletClient, account };
}

export function getInitialCrowdfundingAddress(): Address {
  return getConfiguredCrowdfundingAddress(
    import.meta.env.VITE_CROWDFUNDING_ADDRESS,
  );
}

export function getConfiguredCrowdfundingAddress(
  configuredAddress: string | undefined,
): Address {
  return configuredAddress && isAddress(configuredAddress)
    ? configuredAddress
    : DEFAULT_CROWDFUNDING_ADDRESS;
}

export async function connectWallet(): Promise<WalletSession> {
  const provider = getEthereumProvider();
  const accounts = (await withWalletRequestTimeout(
    provider.request({
      method: "eth_requestAccounts",
    }),
    "连接钱包",
  )) as Address[];
  const chainIdHex = (await withWalletRequestTimeout(
    provider.request({
      method: "eth_chainId",
    }),
    "读取钱包网络",
  )) as string;

  if (!accounts[0]) {
    throw new Error("未获取到钱包账户");
  }

  return {
    address: accounts[0],
    chainId: Number.parseInt(chainIdHex, 16),
  };
}

export async function requestAccountSelection(): Promise<WalletSession> {
  const provider = getEthereumProvider();
  // 让 MetaMask 弹出账户选择框，重新授权站点可访问的账户。
  // 仅靠 accountsChanged 无法切到未授权的账户，必须重新请求权限。
  await withWalletRequestTimeout(
    provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    }),
    "切换钱包账户",
  );

  return connectWallet();
}

export async function loadAccountBalance(address: Address): Promise<bigint> {
  const publicClient = getPublicClient();

  return withReadTimeout(
    publicClient.getBalance({ address }),
    "读取账户余额",
  );
}

export async function loadProjects(
  crowdfundingAddress: Address,
  account?: Address,
): Promise<FundingProject[]> {
  const publicClient = getPublicClient();
  const projectAddresses = await withReadTimeout(
    publicClient.readContract({
      address: crowdfundingAddress,
      abi: crowdfundingAbi,
      functionName: "returnAllProjects",
    }),
    "读取项目列表",
  );

  const projects = await withReadTimeout(
    Promise.all(
      projectAddresses.map((projectAddress) =>
        loadProject(projectAddress, account),
      ),
    ),
    "读取项目详情",
  );

  return projects.sort((left, right) => {
    if (left.state !== right.state) {
      return left.state - right.state;
    }

    return Number(right.deadline - left.deadline);
  });
}

export async function loadProject(
  projectAddress: Address,
  account?: Address,
): Promise<FundingProject> {
  const publicClient = getPublicClient();
  const [
    details,
    remainingTime,
    contributors,
    creatorWithdrawn,
    fundingModel,
    nextMilestoneIndex,
    totalReleasedAmount,
    milestoneCount,
  ] = await withReadTimeout(
    Promise.all([
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "getProjectDetails",
      }),
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "getRemainingTime",
      }),
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "getContributors",
      }),
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "creatorWithdrawn",
      }),
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "fundingModel",
      }),
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "nextMilestoneIndex",
      }),
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "totalReleasedAmount",
      }),
      publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "getMilestoneCount",
      }),
    ]),
    "读取项目详情",
  );

  const contributionRows = await withReadTimeout(
    Promise.all(
      contributors.map(async (contributor) => ({
        contributor,
        amount: await publicClient.readContract({
          address: projectAddress,
          abi: projectAbi,
          functionName: "contributions",
          args: [contributor],
        }),
      })),
    ),
    "读取捐赠记录",
  );

  const userContribution = account
    ? await withReadTimeout(
        publicClient.readContract({
          address: projectAddress,
          abi: projectAbi,
          functionName: "contributions",
          args: [account],
        }),
        "读取用户捐赠记录",
      )
    : 0n;

  const milestoneIndexes = Array.from(
    { length: Number(milestoneCount) },
    (_, index) => BigInt(index),
  );

  const milestones: ProjectMilestone[] = await withReadTimeout(
    Promise.all(
      milestoneIndexes.map(async (milestoneIndex) => {
        const [milestone, approved] = await Promise.all([
          publicClient.readContract({
            address: projectAddress,
            abi: projectAbi,
            functionName: "getMilestone",
            args: [milestoneIndex],
          }),
          account
            ? publicClient.readContract({
                address: projectAddress,
                abi: projectAbi,
                functionName: "milestoneApprovals",
                args: [milestoneIndex, account],
              })
            : Promise.resolve(false),
        ]);

        return {
          index: Number(milestoneIndex),
          title: milestone[0],
          evidenceUri: milestone[1],
          releaseBps: Number(milestone[2]),
          approvalWeight: milestone[3],
          submitted: milestone[4],
          released: milestone[5],
          releasedAmount: milestone[6],
          approved,
        };
      }),
    ),
    "读取里程碑",
  );

  return {
    address: projectAddress,
    creator: details[0],
    minimumContribution: details[1],
    deadline: details[2],
    targetContribution: details[3],
    raisedAmount: details[4],
    contributorCount: details[5],
    title: details[6],
    description: details[7],
    state: details[8] as ProjectState,
    balance: details[9],
    remainingTime,
    contributors: contributionRows,
    userContribution,
    creatorWithdrawn,
    fundingModel: Number(fundingModel) as FundingModel,
    nextMilestoneIndex,
    totalReleasedAmount,
    milestones,
  };
}

export async function createProject(
  crowdfundingAddress: Address,
  input: CreateProjectInput,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const baseArgs = [
    parseEther(input.minimumEth),
    BigInt(input.deadlineUnixSeconds),
    parseEther(input.goalEth),
    input.title,
    input.description,
  ] as const;

  const hash =
    input.fundingModel === FundingModel.Milestone
      ? await withWalletRequestTimeout(
          walletClient.writeContract({
            address: crowdfundingAddress,
            abi: crowdfundingAbi,
            functionName: "createMilestoneProject",
            account,
            chain: null,
            gas: WRITE_GAS_LIMITS.createProject,
            args: [
              ...baseArgs,
              input.milestones.map((milestone) => milestone.title),
              input.milestones.map((milestone) => milestone.releaseBps),
            ],
          }),
          "提交创建项目交易",
        )
      : await withWalletRequestTimeout(
          walletClient.writeContract({
            address: crowdfundingAddress,
            abi: crowdfundingAbi,
            functionName: "createProject",
            account,
            chain: null,
            gas: WRITE_GAS_LIMITS.createProject,
            args: baseArgs,
          }),
          "提交创建项目交易",
        );

  await withTransactionConfirmationTimeout(
    publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

export async function contributeToProject(
  crowdfundingAddress: Address,
  projectAddress: Address,
  amountEth: string,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await withWalletRequestTimeout(
    walletClient.writeContract({
      address: crowdfundingAddress,
      abi: crowdfundingAbi,
      functionName: "contribute",
      account,
      chain: null,
      gas: WRITE_GAS_LIMITS.contribute,
      args: [projectAddress],
      value: parseEther(amountEth),
    }),
    "提交捐赠交易",
  );

  await withTransactionConfirmationTimeout(
    publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

export async function withdrawRaisedFunds(projectAddress: Address) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await withWalletRequestTimeout(
    walletClient.writeContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "withdrawRaisedFunds",
      account,
      chain: null,
      gas: WRITE_GAS_LIMITS.withdrawRaisedFunds,
    }),
    "提交发起人提款交易",
  );

  await withTransactionConfirmationTimeout(
    publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

export async function withdrawContribution(projectAddress: Address) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await withWalletRequestTimeout(
    walletClient.writeContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "withdrawContribution",
      account,
      chain: null,
      gas: WRITE_GAS_LIMITS.withdrawContribution,
    }),
    "提交退款交易",
  );

  await withTransactionConfirmationTimeout(
    publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

export async function submitMilestone(
  projectAddress: Address,
  milestoneIndex: number,
  evidenceUri: string,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await withWalletRequestTimeout(
    walletClient.writeContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "submitMilestone",
      account,
      chain: null,
      gas: WRITE_GAS_LIMITS.submitMilestone,
      args: [BigInt(milestoneIndex), evidenceUri],
    }),
    "提交里程碑成果交易",
  );

  await withTransactionConfirmationTimeout(
    publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

export async function approveMilestone(
  projectAddress: Address,
  milestoneIndex: number,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await withWalletRequestTimeout(
    walletClient.writeContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "approveMilestone",
      account,
      chain: null,
      gas: WRITE_GAS_LIMITS.approveMilestone,
      args: [BigInt(milestoneIndex)],
    }),
    "提交里程碑验证交易",
  );

  await withTransactionConfirmationTimeout(
    publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

export async function releaseMilestoneFunds(
  projectAddress: Address,
  milestoneIndex: number,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await withWalletRequestTimeout(
    walletClient.writeContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "releaseMilestoneFunds",
      account,
      chain: null,
      gas: WRITE_GAS_LIMITS.releaseMilestoneFunds,
      args: [BigInt(milestoneIndex)],
    }),
    "提交里程碑资金释放交易",
  );

  await withTransactionConfirmationTimeout(
    publicClient.waitForTransactionReceipt({ hash }),
  );
  return hash;
}

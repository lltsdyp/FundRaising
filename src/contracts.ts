import {
  createPublicClient,
  createWalletClient,
  custom,
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
import { ProjectState } from "./utils";

export const DEFAULT_CROWDFUNDING_ADDRESS: Address =
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";

export const GANACHE_TRANSACTION_GAS_CAP = 16_777_216n;

export const WRITE_GAS_LIMITS = {
  createProject: 2_500_000n,
  contribute: 300_000n,
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

function getPublicClient() {
  return createPublicClient({
    transport: custom(getEthereumProvider()),
  });
}

async function getWalletClient() {
  const provider = getEthereumProvider();
  const walletClient = createWalletClient({
    transport: custom(provider),
  });
  const [account] = await walletClient.getAddresses();

  if (!account) {
    throw new Error("请先连接钱包");
  }

  return { walletClient, account };
}

export function getInitialCrowdfundingAddress(): Address {
  return DEFAULT_CROWDFUNDING_ADDRESS;
}

export async function connectWallet(): Promise<WalletSession> {
  const provider = getEthereumProvider();
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];
  const chainIdHex = (await provider.request({
    method: "eth_chainId",
  })) as string;

  if (!accounts[0]) {
    throw new Error("未获取到钱包账户");
  }

  return {
    address: accounts[0],
    chainId: Number.parseInt(chainIdHex, 16),
  };
}

export async function loadProjects(
  crowdfundingAddress: Address,
  account?: Address,
): Promise<FundingProject[]> {
  const publicClient = getPublicClient();
  const projectAddresses = await publicClient.readContract({
    address: crowdfundingAddress,
    abi: crowdfundingAbi,
    functionName: "returnAllProjects",
  });

  const projects = await Promise.all(
    projectAddresses.map((projectAddress) => loadProject(projectAddress, account)),
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
  ] = await Promise.all([
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
  ]);

  const contributionRows = await Promise.all(
    contributors.map(async (contributor) => ({
      contributor,
      amount: await publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "contributions",
        args: [contributor],
      }),
    })),
  );

  const userContribution = account
    ? await publicClient.readContract({
        address: projectAddress,
        abi: projectAbi,
        functionName: "contributions",
        args: [account],
      })
    : 0n;

  const milestoneIndexes = Array.from(
    { length: Number(milestoneCount) },
    (_, index) => BigInt(index),
  );

  const milestones: ProjectMilestone[] = await Promise.all(
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
      ? await walletClient.writeContract({
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
        })
      : await walletClient.writeContract({
          address: crowdfundingAddress,
          abi: crowdfundingAbi,
          functionName: "createProject",
          account,
          chain: null,
          gas: WRITE_GAS_LIMITS.createProject,
          args: baseArgs,
        });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function contributeToProject(
  crowdfundingAddress: Address,
  projectAddress: Address,
  amountEth: string,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: crowdfundingAddress,
    abi: crowdfundingAbi,
    functionName: "contribute",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.contribute,
    args: [projectAddress],
    value: parseEther(amountEth),
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function withdrawRaisedFunds(projectAddress: Address) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "withdrawRaisedFunds",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.withdrawRaisedFunds,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function withdrawContribution(projectAddress: Address) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "withdrawContribution",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.withdrawContribution,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function submitMilestone(
  projectAddress: Address,
  milestoneIndex: number,
  evidenceUri: string,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "submitMilestone",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.submitMilestone,
    args: [BigInt(milestoneIndex), evidenceUri],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function approveMilestone(
  projectAddress: Address,
  milestoneIndex: number,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "approveMilestone",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.approveMilestone,
    args: [BigInt(milestoneIndex)],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function releaseMilestoneFunds(
  projectAddress: Address,
  milestoneIndex: number,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "releaseMilestoneFunds",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.releaseMilestoneFunds,
    args: [BigInt(milestoneIndex)],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

import { formatEther } from "viem";

export enum ProjectState {
  Fundraising = 0,
  Expired = 1,
  Successful = 2,
}

export function formatEth(value: bigint): string {
  const ether = Number(formatEther(value));
  const maximumFractionDigits = ether >= 1 ? 4 : 6;
  const formatted = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits,
  }).format(ether);

  return `${formatted} ETH`;
}

export function getFundingProgress(raisedAmount: bigint, targetAmount: bigint) {
  if (targetAmount <= 0n) {
    return 0;
  }

  const basisPoints = Number((raisedAmount * 10_000n) / targetAmount);
  return Math.min(100, Math.round(basisPoints) / 100);
}

export function getFundingModelLabel(model: number) {
  return model === 1 ? "里程碑释放" : "All or nothing";
}

export function getMilestoneApprovalProgress(
  approvalWeight: bigint,
  raisedAmount: bigint,
) {
  if (raisedAmount <= 0n) {
    return 0;
  }

  const requiredWeight = (raisedAmount * 5_000n) / 10_000n;

  if (requiredWeight <= 0n) {
    return 0;
  }

  const basisPoints = Number((approvalWeight * 10_000n) / requiredWeight);
  return Math.min(100, Math.round(basisPoints) / 100);
}

export function getMilestoneFormError(
  milestones: Array<{ title: string; releaseBps: number }>,
) {
  if (milestones.length === 0) {
    return "请至少设置一个里程碑";
  }

  if (milestones.some((milestone) => milestone.title.trim().length === 0)) {
    return "里程碑名称不能为空";
  }

  if (milestones.some((milestone) => milestone.releaseBps <= 0)) {
    return "每个里程碑释放比例必须大于 0";
  }

  const totalBps = milestones.reduce(
    (sum, milestone) => sum + milestone.releaseBps,
    0,
  );

  if (totalBps !== 10_000) {
    return "里程碑释放比例合计必须等于 100%";
  }

  return "";
}

export function getProjectPhase(state: ProjectState, remainingTime: bigint) {
  if (state === ProjectState.Successful) {
    return "已成功";
  }

  if (state === ProjectState.Expired || remainingTime <= 0n) {
    return "未达标";
  }

  return "进行中";
}

export function getLiveRemainingTime(deadline: bigint, nowSeconds: number) {
  const now = BigInt(nowSeconds);

  if (now >= deadline) {
    return 0n;
  }

  return deadline - now;
}

export function getLiveProjectState({
  state,
  deadline,
  raisedAmount,
  targetContribution,
  nowSeconds,
}: {
  state: ProjectState;
  deadline: bigint;
  raisedAmount: bigint;
  targetContribution: bigint;
  nowSeconds: number;
}) {
  if (state !== ProjectState.Fundraising) {
    return state;
  }

  if (getLiveRemainingTime(deadline, nowSeconds) > 0n) {
    return ProjectState.Fundraising;
  }

  return raisedAmount >= targetContribution
    ? ProjectState.Successful
    : ProjectState.Expired;
}

export function formatDeadline(remainingSeconds: bigint) {
  if (remainingSeconds <= 0n) {
    return "已到期";
  }

  const totalSeconds = Number(remainingSeconds);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}天 ${hours}小时` : `${days}天`;
  }

  if (hours > 0) {
    return `${hours}小时`;
  }

  return minutes > 0 ? `${minutes}分钟` : "少于1分钟";
}

export function parseDeadlineToUnixSeconds(value: string) {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    throw new Error("请选择有效截止日期");
  }

  return Math.floor(timestamp / 1000);
}

export function formatAddress(address: string) {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function normalizeAddress(address: string) {
  return address.toLowerCase();
}

export function getReadableErrorMessage(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : String(caught);

  if (message.includes("Contribution amount is too low")) {
    return "捐赠金额低于项目最低要求";
  }

  if (message.includes("Creator cannot contribute to own project")) {
    return "项目发起者不能给自己的项目捐赠";
  }

  if (message.includes("Project is not ongoing")) {
    return "项目当前不能接收捐赠";
  }

  if (message.includes("User rejected") || message.includes("user rejected")) {
    return "钱包已取消本次操作";
  }

  if (message.includes("Contract Call:") || message.includes("Details:")) {
    const reason = message.match(/reverted with reason string '([^']+)'/)?.[1];
    return reason ? `合约拒绝了这次操作：${reason}` : fallback;
  }

  return caught instanceof Error ? caught.message : fallback;
}

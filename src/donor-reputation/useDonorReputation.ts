import { calculateDonorScore } from "./calculateDonorScore";
import { getDonorLevel } from "./getDonorLevel";
import { getMockDonorReputationInput } from "./mockDonorReputation";
import type { DonorReputation } from "./types";

// MVP: 同步使用 mock 数据计算分数与等级。
// 未来接入真实数据时改为通过 loadDonorReputationInput 异步读取，
// 评分与等级计算逻辑（calculateDonorScore / getDonorLevel）保持不变。
export function useDonorReputation(address?: `0x${string}`): {
  reputation: DonorReputation | null;
  isLoading: boolean;
  error: Error | null;
} {
  if (!address) {
    return {
      reputation: null,
      isLoading: false,
      error: null,
    };
  }

  const input = getMockDonorReputationInput(address);
  const score = calculateDonorScore(input);
  const level = getDonorLevel(score);

  return {
    reputation: {
      ...input,
      score,
      level,
    },
    isLoading: false,
    error: null,
  };
}

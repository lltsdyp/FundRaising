import { getMockDonorReputationInput } from "./mockDonorReputation";
import type { DonorReputationInput } from "./types";

// 初版返回 mock 数据。未来替换为真实链上 / indexer 读取时，
// 只需改这一个函数：
//   - 读取 donation 事件 -> supportedProjects / totalDonatedEth
//   - 读取 voting 记录   -> votesParticipated / votesAlignedWithFinalResult
//   - 读取 challenge 结果 -> maliciousChallenges
//   - 读取早期支持者 NFT  -> hasEarlySupporterNFT
export async function loadDonorReputationInput(
  address: `0x${string}`,
): Promise<DonorReputationInput> {
  return getMockDonorReputationInput(address);
}

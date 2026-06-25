import type { DonorReputationInput } from "./types";

export function getMockDonorReputationInput(
  address: `0x${string}`,
): DonorReputationInput {
  return {
    address,
    supportedProjects: 12,
    totalDonatedEth: 8.4,
    votesParticipated: 21,
    votesAlignedWithFinalResult: 15,
    maliciousChallenges: 0,
    hasEarlySupporterNFT: true,
  };
}

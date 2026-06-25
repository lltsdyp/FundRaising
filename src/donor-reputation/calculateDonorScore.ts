import type { DonorReputationInput } from "./types";

export function calculateDonorScore(input: DonorReputationInput): number {
  const score =
    input.supportedProjects * 10 +
    input.totalDonatedEth * 20 +
    input.votesParticipated * 5 +
    input.votesAlignedWithFinalResult * 8 -
    input.maliciousChallenges * 50 +
    (input.hasEarlySupporterNFT ? 100 : 0);

  return Math.max(0, Math.floor(score));
}

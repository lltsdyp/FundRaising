export type DonorLevel = "Bronze" | "Silver" | "Gold" | "Genesis";

export type DonorReputationInput = {
  address: `0x${string}`;
  supportedProjects: number;
  totalDonatedEth: number;
  votesParticipated: number;
  votesAlignedWithFinalResult: number;
  maliciousChallenges: number;
  hasEarlySupporterNFT: boolean;
};

export type DonorReputation = DonorReputationInput & {
  score: number;
  level: DonorLevel;
};

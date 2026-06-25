import { describe, expect, it } from "vitest";
import { calculateDonorScore } from "./calculateDonorScore";
import type { DonorReputationInput } from "./types";

const baseInput: DonorReputationInput = {
  address: "0x0000000000000000000000000000000000000001",
  supportedProjects: 0,
  totalDonatedEth: 0,
  votesParticipated: 0,
  votesAlignedWithFinalResult: 0,
  maliciousChallenges: 0,
  hasEarlySupporterNFT: false,
};

describe("calculateDonorScore", () => {
  it("calculates a positive score from donor activity", () => {
    expect(
      calculateDonorScore({
        ...baseInput,
        supportedProjects: 3,
        totalDonatedEth: 2,
        votesParticipated: 4,
        votesAlignedWithFinalResult: 2,
      }),
    ).toBe(106);
  });

  it("adds 100 points for early supporter NFT", () => {
    expect(
      calculateDonorScore({
        ...baseInput,
        hasEarlySupporterNFT: true,
      }),
    ).toBe(100);
  });

  it("subtracts points for malicious challenges", () => {
    expect(
      calculateDonorScore({
        ...baseInput,
        supportedProjects: 10,
        maliciousChallenges: 1,
      }),
    ).toBe(50);
  });

  it("never returns a negative score", () => {
    expect(
      calculateDonorScore({
        ...baseInput,
        maliciousChallenges: 10,
      }),
    ).toBe(0);
  });

  it("floors decimal scores", () => {
    expect(
      calculateDonorScore({
        ...baseInput,
        totalDonatedEth: 0.123,
      }),
    ).toBe(2);
  });
});

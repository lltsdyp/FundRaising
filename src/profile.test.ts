import { describe, expect, it } from "vitest";
import { deriveProfileSummary } from "./profile";
import { FundingModel, type FundingProject } from "./types";
import { ProjectState } from "./utils";

const ADDR_A = "0xAAaAAaAAaAaaAaaAaaaaAaAaaAAAaAaaAAaaAAa1";
const ADDR_B = "0xBbbbBBbbBbbBbBBbBbBbBBbbbbBbBbBBBbBbBbB2";
const CREATOR = "0xccCCccccCCCCcCCCCCCcCcCcCcCCCCcCcccccCCc3";

function makeProject(overrides: Partial<FundingProject>): FundingProject {
  return {
    address: "0x0000000000000000000000000000000000000001",
    creator: CREATOR,
    minimumContribution: 0n,
    deadline: 1_000n,
    targetContribution: 10n,
    raisedAmount: 0n,
    contributorCount: 0n,
    title: "P",
    description: "",
    state: ProjectState.Fundraising,
    balance: 0n,
    remainingTime: 0n,
    contributors: [],
    userContribution: 0n,
    creatorWithdrawn: false,
    fundingModel: FundingModel.AllOrNothing,
    nextMilestoneIndex: 0n,
    totalReleasedAmount: 0n,
    milestones: [],
    ...overrides,
  };
}

describe("deriveProfileSummary", () => {
  it("sums current on-chain contributions for the address across projects", () => {
    const projects = [
      makeProject({
        address: "0x0000000000000000000000000000000000000010",
        contributors: [
          { contributor: ADDR_A, amount: 3n },
          { contributor: ADDR_B, amount: 7n },
        ],
      }),
      makeProject({
        address: "0x0000000000000000000000000000000000000011",
        contributors: [{ contributor: ADDR_A, amount: 5n }],
      }),
    ];

    const summary = deriveProfileSummary(projects, ADDR_A, 0);

    expect(summary.cumulativeDonation).toBe(8n);
    expect(summary.supportedCount).toBe(2);
    expect(summary.supportedProjects.map((row) => row.amount)).toEqual([3n, 5n]);
  });

  it("matches addresses case-insensitively and ignores zero contributions", () => {
    const projects = [
      makeProject({
        contributors: [
          { contributor: ADDR_A.toLowerCase() as `0x${string}`, amount: 4n },
          { contributor: ADDR_B, amount: 0n },
        ],
      }),
    ];

    const summaryA = deriveProfileSummary(projects, ADDR_A.toUpperCase(), 0);
    const summaryB = deriveProfileSummary(projects, ADDR_B, 0);

    expect(summaryA.supportedCount).toBe(1);
    expect(summaryA.cumulativeDonation).toBe(4n);
    expect(summaryB.supportedCount).toBe(0);
  });

  it("counts successful supported projects including live met-goal projects", () => {
    const projects = [
      makeProject({
        // 已结算成功
        state: ProjectState.Successful,
        contributors: [{ contributor: ADDR_A, amount: 10n }],
      }),
      makeProject({
        // 进行中但到期且已达标 -> live 状态 Successful
        state: ProjectState.Fundraising,
        deadline: 100n,
        raisedAmount: 10n,
        targetContribution: 10n,
        contributors: [{ contributor: ADDR_A, amount: 10n }],
      }),
      makeProject({
        // 进行中未达标 -> 不计成功
        state: ProjectState.Fundraising,
        deadline: 100n,
        raisedAmount: 1n,
        targetContribution: 10n,
        contributors: [{ contributor: ADDR_A, amount: 1n }],
      }),
    ];

    const summary = deriveProfileSummary(projects, ADDR_A, 200); // now=200 > deadline 100

    expect(summary.supportedCount).toBe(3);
    expect(summary.successfulCount).toBe(2);
  });

  it("lists projects created by the address", () => {
    const projects = [
      makeProject({ creator: ADDR_A, address: "0x00000000000000000000000000000000000000a1" }),
      makeProject({ creator: CREATOR, address: "0x00000000000000000000000000000000000000a2" }),
    ];

    const summary = deriveProfileSummary(projects, ADDR_A, 0);

    expect(summary.createdProjects).toHaveLength(1);
    expect(summary.createdProjects[0].address).toBe(
      "0x00000000000000000000000000000000000000a1",
    );
  });
});

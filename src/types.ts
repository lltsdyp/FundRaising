import type { Address } from "viem";
import type { ProjectState } from "./utils";

export enum FundingModel {
  AllOrNothing = 0,
  Milestone = 1,
}

export type WalletSession = {
  address: Address;
  chainId: number;
};

export type ProjectContribution = {
  contributor: Address;
  amount: bigint;
};

export type ProjectMilestone = {
  index: number;
  title: string;
  evidenceUri: string;
  releaseBps: number;
  approvalWeight: bigint;
  submitted: boolean;
  released: boolean;
  releasedAmount: bigint;
  approved: boolean;
};

export type FundingProject = {
  address: Address;
  creator: Address;
  minimumContribution: bigint;
  deadline: bigint;
  targetContribution: bigint;
  raisedAmount: bigint;
  contributorCount: bigint;
  title: string;
  description: string;
  state: ProjectState;
  balance: bigint;
  remainingTime: bigint;
  contributors: ProjectContribution[];
  userContribution: bigint;
  creatorWithdrawn: boolean;
  fundingModel: FundingModel;
  nextMilestoneIndex: bigint;
  totalReleasedAmount: bigint;
  milestones: ProjectMilestone[];
};

export type CreateProjectInput = {
  title: string;
  description: string;
  goalEth: string;
  minimumEth: string;
  deadlineUnixSeconds: number;
  fundingModel: FundingModel;
  milestones: Array<{
    title: string;
    releaseBps: number;
  }>;
};

import type { Address } from "viem";
import type { ProjectState } from "./utils";

export type WalletSession = {
  address: Address;
  chainId: number;
};

export type ProjectContribution = {
  contributor: Address;
  amount: bigint;
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
};

export type CreateProjectInput = {
  title: string;
  description: string;
  goalEth: string;
  minimumEth: string;
  deadlineUnixSeconds: number;
};

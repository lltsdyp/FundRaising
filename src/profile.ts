import type { FundingProject } from "./types";
import { ProjectState, getLiveProjectState, normalizeAddress } from "./utils";

export type SupportedProject = {
  project: FundingProject;
  amount: bigint;
};

export type ProfileSummary = {
  cumulativeDonation: bigint;
  supportedProjects: SupportedProject[];
  supportedCount: number;
  successfulCount: number;
  createdProjects: FundingProject[];
};

function getContributionFor(project: FundingProject, target: string): bigint {
  return project.contributors.reduce((sum, row) => {
    return normalizeAddress(row.contributor) === target ? sum + row.amount : sum;
  }, 0n);
}

export function deriveProfileSummary(
  projects: FundingProject[],
  address: string,
  nowSeconds: number,
): ProfileSummary {
  const target = normalizeAddress(address);

  const supportedProjects: SupportedProject[] = [];
  let cumulativeDonation = 0n;
  let successfulCount = 0;

  for (const project of projects) {
    const amount = getContributionFor(project, target);

    if (amount > 0n) {
      supportedProjects.push({ project, amount });
      cumulativeDonation += amount;

      const liveState = getLiveProjectState({
        state: project.state,
        deadline: project.deadline,
        raisedAmount: project.raisedAmount,
        targetContribution: project.targetContribution,
        nowSeconds,
      });

      if (liveState === ProjectState.Successful) {
        successfulCount += 1;
      }
    }
  }

  const createdProjects = projects.filter(
    (project) => normalizeAddress(project.creator) === target,
  );

  return {
    cumulativeDonation,
    supportedProjects,
    supportedCount: supportedProjects.length,
    successfulCount,
    createdProjects,
  };
}

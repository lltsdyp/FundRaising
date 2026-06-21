import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Profile, ProjectDetail, ProjectList, ToastStack } from "./App";
import {
  DEFAULT_CROWDFUNDING_ADDRESS,
  getInitialCrowdfundingAddress,
} from "./contracts";
import { deriveProfileSummary } from "./profile";
import { FundingModel, type FundingProject } from "./types";
import { ProjectState } from "./utils";

const sampleProject: FundingProject = {
  address: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  minimumContribution: 10_000_000_000_000_000n,
  deadline: 2_000n,
  targetContribution: 10_000_000_000_000_000_000n,
  raisedAmount: 4_000_000_000_000_000_000n,
  contributorCount: 2n,
  title: "Education fund",
  description: "Books and equipment",
  state: ProjectState.Fundraising,
  balance: 4_000_000_000_000_000_000n,
  remainingTime: 1_000n,
  contributors: [],
  userContribution: 0n,
  creatorWithdrawn: false,
  fundingModel: FundingModel.AllOrNothing,
  nextMilestoneIndex: 0n,
  totalReleasedAmount: 0n,
  milestones: [],
};

describe("App presentation components", () => {
  it("uses the fixed Crowdfunding contract address", () => {
    window.localStorage.setItem(
      "myfundings.crowdfundingAddress",
      "0x1111111111111111111111111111111111111111",
    );

    expect(getInitialCrowdfundingAddress()).toBe(DEFAULT_CROWDFUNDING_ADDRESS);
  });

  it("renders success messages in a top toast stack", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(<ToastStack loading={false} message="项目列表已刷新" error="" />);
    });

    const stack = host.querySelector(".toast-stack");
    expect(stack?.textContent).toContain("项目列表已刷新");
    expect(stack?.querySelector(".toast.success")).not.toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("keeps loading messages while work is still pending", () => {
    vi.useFakeTimers();

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(<ToastStack loading message="" error="" />);
    });

    expect(host.textContent).toContain("交易或读取处理中");

    act(() => {
      vi.advanceTimersByTime(2_800);
    });

    expect(host.textContent).toContain("交易或读取处理中");

    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("renders projects as list rows instead of cards", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectList
          projects={[sampleProject]}
          canLoad
          nowSeconds={1_000}
          onRefresh={() => undefined}
          onCreate={() => undefined}
          onOpen={() => undefined}
        />,
      );
    });

    expect(host.querySelector(".project-list")).not.toBeNull();
    expect(host.querySelector(".project-row")).not.toBeNull();
    expect(host.querySelector(".project-grid")).toBeNull();
    expect(host.querySelector(".project-card")).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("labels milestone projects in the project list", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectList
          projects={[
            {
              ...sampleProject,
              fundingModel: FundingModel.Milestone,
              milestones: [
                {
                  index: 0,
                  title: "Prototype",
                  evidenceUri: "",
                  releaseBps: 2_500,
                  approvalWeight: 0n,
                  submitted: false,
                  released: false,
                  releasedAmount: 0n,
                  approved: false,
                },
              ],
            },
          ]}
          canLoad
          nowSeconds={1_000}
          onRefresh={() => undefined}
          onCreate={() => undefined}
          onOpen={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain("里程碑释放");

    act(() => root.unmount());
    host.remove();
  });

  it("disables contribution when the amount is below the project minimum", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectDetail
          account="0x3333333333333333333333333333333333333333"
          contributionAmount="0.001"
          loading={false}
          nowSeconds={1_000}
          project={sampleProject}
          onBack={() => undefined}
          onContributionAmountChange={() => undefined}
          onContribute={() => undefined}
          onWithdrawCreator={() => undefined}
          onWithdrawContribution={() => undefined}
          onSubmitMilestone={() => undefined}
          onApproveMilestone={() => undefined}
          onReleaseMilestone={() => undefined}
        />,
      );
    });

    const donateButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "捐赠",
    );

    expect(donateButton?.disabled).toBe(true);
    expect(host.textContent).toContain("最低捐赠金额为 0.01 ETH");

    act(() => root.unmount());
    host.remove();
  });

  it("enables contribution when the amount reaches the project minimum", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectDetail
          account="0x3333333333333333333333333333333333333333"
          contributionAmount="0.01"
          loading={false}
          nowSeconds={1_000}
          project={sampleProject}
          onBack={() => undefined}
          onContributionAmountChange={() => undefined}
          onContribute={() => undefined}
          onWithdrawCreator={() => undefined}
          onWithdrawContribution={() => undefined}
          onSubmitMilestone={() => undefined}
          onApproveMilestone={() => undefined}
          onReleaseMilestone={() => undefined}
        />,
      );
    });

    const donateButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "捐赠",
    );

    expect(donateButton?.disabled).toBe(false);

    act(() => root.unmount());
    host.remove();
  });

  it("shows submit form for second milestone after first is released", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectDetail
          account="0x2222222222222222222222222222222222222222"
          contributionAmount="0.01"
          loading={false}
          nowSeconds={3_000}
          project={{
            ...sampleProject,
            creator: "0x2222222222222222222222222222222222222222",
            state: ProjectState.Successful,
            deadline: 1_000n,
            fundingModel: FundingModel.Milestone,
            raisedAmount: 10_000_000_000_000_000_000n,
            targetContribution: 10_000_000_000_000_000_000n,
            balance: 7_500_000_000_000_000_000n,
            totalReleasedAmount: 2_500_000_000_000_000_000n,
            nextMilestoneIndex: 1n,
            milestones: [
              {
                index: 0,
                title: "Prototype",
                evidenceUri: "ipfs://prototype",
                releaseBps: 2_500,
                approvalWeight: 10_000_000_000_000_000_000n,
                submitted: true,
                released: true,
                releasedAmount: 2_500_000_000_000_000_000n,
                approved: false,
              },
              {
                index: 1,
                title: "Launch",
                evidenceUri: "",
                releaseBps: 7_500,
                approvalWeight: 0n,
                submitted: false,
                released: false,
                releasedAmount: 0n,
                approved: false,
              },
            ],
          }}
          onBack={() => undefined}
          onContributionAmountChange={() => undefined}
          onContribute={() => undefined}
          onWithdrawCreator={() => undefined}
          onWithdrawContribution={() => undefined}
          onSubmitMilestone={() => undefined}
          onApproveMilestone={() => undefined}
          onReleaseMilestone={() => undefined}
        />,
      );
    });

    const submitButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "提交成果",
    );
    expect(submitButton).not.toBeUndefined();
    expect(submitButton?.disabled).toBe(false);

    act(() => root.unmount());
    host.remove();
  });

  it("renders milestone verification actions for successful milestone projects", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectDetail
          account="0x3333333333333333333333333333333333333333"
          contributionAmount="0.01"
          loading={false}
          nowSeconds={2_000}
          project={{
            ...sampleProject,
            state: ProjectState.Successful,
            deadline: 1_000n,
            fundingModel: FundingModel.Milestone,
            userContribution: 1_000_000_000_000_000_000n,
            nextMilestoneIndex: 0n,
            milestones: [
              {
                index: 0,
                title: "Prototype",
                evidenceUri: "ipfs://prototype",
                releaseBps: 2_500,
                approvalWeight: 0n,
                submitted: true,
                released: false,
                releasedAmount: 0n,
                approved: false,
              },
            ],
          }}
          onBack={() => undefined}
          onContributionAmountChange={() => undefined}
          onContribute={() => undefined}
          onWithdrawCreator={() => undefined}
          onWithdrawContribution={() => undefined}
          onSubmitMilestone={() => undefined}
          onApproveMilestone={() => undefined}
          onReleaseMilestone={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain("里程碑释放");
    expect(host.textContent).toContain("Prototype");
    expect(host.textContent).toContain("验证进度 0%");

    const approveButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "验证",
    );
    expect(approveButton?.disabled).toBe(false);

    act(() => root.unmount());
    host.remove();
  });

  it("renders profile stats and supported/created project lists", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    const supporter = "0x3333333333333333333333333333333333333333";
    const projects: FundingProject[] = [
      {
        ...sampleProject,
        address: "0x4444444444444444444444444444444444444444",
        contributors: [{ contributor: supporter, amount: 2_000_000_000_000_000_000n }],
      },
      {
        ...sampleProject,
        address: "0x5555555555555555555555555555555555555555",
        creator: supporter,
      },
    ];
    const summary = deriveProfileSummary(projects, supporter, 1_000);

    act(() => {
      root.render(
        <Profile
          address={supporter}
          isSelf
          summary={summary}
          nowSeconds={1_000}
          onBack={() => undefined}
          onOpenProject={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain("累计捐赠");
    expect(host.textContent).toContain("支持项目数");
    expect(host.textContent).toContain("成功支持项目");
    expect(host.textContent).toContain("我的资料");
    expect(host.querySelectorAll(".project-row").length).toBe(2); // 1 supported + 1 created

    act(() => root.unmount());
    host.remove();
  });
});

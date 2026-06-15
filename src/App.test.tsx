import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ProjectDetail, ProjectList, ToastStack } from "./App";
import {
  DEFAULT_CROWDFUNDING_ADDRESS,
  getInitialCrowdfundingAddress,
} from "./contracts";
import type { FundingProject } from "./types";
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
});

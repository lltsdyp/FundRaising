import { describe, expect, it, vi } from "vitest";
import {
  ProjectState,
  formatAddress,
  formatDeadline,
  formatEth,
  getFundingModelLabel,
  getFundingProgress,
  getLiveProjectState,
  getLiveRemainingTime,
  getMilestoneApprovalProgress,
  getMilestoneFormError,
  getProjectPhase,
  getReadableErrorMessage,
  parseDeadlineToUnixSeconds,
  withOperationTimeout,
} from "./utils";

describe("frontend utility behavior", () => {
  it("formats wei values into compact ETH labels", () => {
    expect(formatEth(1_000_000_000_000_000_000n)).toBe("1 ETH");
    expect(formatEth(1_250_000_000_000_000_000n)).toBe("1.25 ETH");
    expect(formatEth(123_456_789_000_000n)).toBe("0.000123 ETH");
  });

  it("caps funding progress at 100 percent", () => {
    expect(getFundingProgress(4n, 10n)).toBe(40);
    expect(getFundingProgress(12n, 10n)).toBe(100);
    expect(getFundingProgress(1n, 0n)).toBe(0);
  });

  it("formats funding models for project rows", () => {
    expect(getFundingModelLabel(0)).toBe("All or nothing");
    expect(getFundingModelLabel(1)).toBe("里程碑释放");
  });

  it("calculates milestone approval progress", () => {
    expect(getMilestoneApprovalProgress(5n, 10n)).toBe(100);
    expect(getMilestoneApprovalProgress(2n, 10n)).toBe(40);
    expect(getMilestoneApprovalProgress(1n, 0n)).toBe(0);
  });

  it("validates milestone percentages sum to one hundred percent", () => {
    expect(
      getMilestoneFormError([
        { title: "Prototype", releaseBps: 2_500 },
        { title: "Launch", releaseBps: 7_500 },
      ]),
    ).toBe("");

    expect(
      getMilestoneFormError([
        { title: "Prototype", releaseBps: 2_500 },
        { title: "Launch", releaseBps: 5_000 },
      ]),
    ).toBe("里程碑释放比例合计必须等于 100%");
  });

  it("derives project phase from contract state and deadline", () => {
    expect(getProjectPhase(ProjectState.Fundraising, 120n)).toBe("进行中");
    expect(getProjectPhase(ProjectState.Successful, 0n)).toBe("已成功");
    expect(getProjectPhase(ProjectState.Expired, 0n)).toBe("未达标");
  });

  it("derives live remaining time from the project deadline", () => {
    expect(getLiveRemainingTime(1_100n, 1_000)).toBe(100n);
    expect(getLiveRemainingTime(1_100n, 1_100)).toBe(0n);
    expect(getLiveRemainingTime(1_100n, 1_200)).toBe(0n);
  });

  it("derives live failed state after deadline when target is not reached", () => {
    expect(
      getLiveProjectState({
        state: ProjectState.Fundraising,
        deadline: 1_100n,
        raisedAmount: 4n,
        targetContribution: 10n,
        nowSeconds: 1_100,
      }),
    ).toBe(ProjectState.Expired);
  });

  it("derives live successful state after deadline when target is reached", () => {
    expect(
      getLiveProjectState({
        state: ProjectState.Fundraising,
        deadline: 1_100n,
        raisedAmount: 10n,
        targetContribution: 10n,
        nowSeconds: 1_100,
      }),
    ).toBe(ProjectState.Successful);
  });

  it("keeps projects fundraising before deadline even when target is reached", () => {
    expect(
      getLiveProjectState({
        state: ProjectState.Fundraising,
        deadline: 1_100n,
        raisedAmount: 10n,
        targetContribution: 10n,
        nowSeconds: 1_099,
      }),
    ).toBe(ProjectState.Fundraising);
  });

  it("formats relative deadlines for active and ended projects", () => {
    expect(formatDeadline(0n)).toBe("已到期");
    expect(formatDeadline(59n)).toBe("少于1分钟");
    expect(formatDeadline(3_600n)).toBe("1小时");
    expect(formatDeadline(176_400n)).toBe("2天 1小时");
  });

  it("turns datetime-local values into unix seconds", () => {
    expect(parseDeadlineToUnixSeconds("2026-06-15T12:30")).toBe(
      Math.floor(new Date("2026-06-15T12:30").getTime() / 1000),
    );
  });

  it("shortens wallet addresses for dense project views", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(
      "0x1234...5678",
    );
  });

  it("turns low contribution contract reverts into a readable message", () => {
    const error = new Error(
      'The contract function "contribute" reverted with the following reason: RPC submit: VM Exception while processing transaction: reverted with reason string \'Contribution amount is too low !\' Contract Call: address: 0x5FbDB2315678afecb367f032d93F642f64180aa3',
    );

    expect(getReadableErrorMessage(error, "操作失败，请重试")).toBe(
      "捐赠金额低于项目最低要求",
    );
  });

  it("rejects operations that do not settle before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const result = withOperationTimeout(
        new Promise<string>(() => undefined),
        100,
        "读取链上数据超时",
      );
      const rejection = expect(result).rejects.toThrow("读取链上数据超时");

      await vi.advanceTimersByTimeAsync(100);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CROWDFUNDING_ADDRESS,
  WALLET_REQUEST_TIMEOUT_MS,
  contributeToProject,
  getConfiguredCrowdfundingAddress,
} from "./contracts";

const viemMocks = vi.hoisted(() => ({
  getAddresses: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    waitForTransactionReceipt: viemMocks.waitForTransactionReceipt,
  })),
  createWalletClient: vi.fn(() => ({
    getAddresses: viemMocks.getAddresses,
    writeContract: viemMocks.writeContract,
  })),
  custom: vi.fn((provider) => provider),
  isAddress: vi.fn((value) => /^0x[a-fA-F0-9]{40}$/.test(value)),
  parseEther: vi.fn(() => 1n),
}));

describe("contract client behavior", () => {
  it("uses a configured Crowdfunding address when it is valid", () => {
    expect(
      getConfiguredCrowdfundingAddress(
        "0x3333333333333333333333333333333333333333",
      ),
    ).toBe("0x3333333333333333333333333333333333333333");
  });

  it("falls back to the default Crowdfunding address when configuration is invalid", () => {
    expect(getConfiguredCrowdfundingAddress("not-an-address")).toBe(
      DEFAULT_CROWDFUNDING_ADDRESS,
    );
    expect(getConfiguredCrowdfundingAddress(undefined)).toBe(
      DEFAULT_CROWDFUNDING_ADDRESS,
    );
  });

  it("times out when wallet account lookup does not settle", async () => {
    vi.useFakeTimers();
    viemMocks.getAddresses.mockReturnValue(new Promise(() => undefined));
    window.ethereum = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };

    try {
      const outcome = Promise.race([
        contributeToProject(
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
          "0.1",
        ).then(
          () => "resolved",
          (caught) => (caught instanceof Error ? caught.message : String(caught)),
        ),
        new Promise<string>((resolve) => {
          setTimeout(
            () => resolve("still pending"),
            WALLET_REQUEST_TIMEOUT_MS + 1,
          );
        }),
      ]);

      await vi.advanceTimersByTimeAsync(WALLET_REQUEST_TIMEOUT_MS + 1);

      await expect(outcome).resolves.toBe(
        "读取钱包账户超时，请确认钱包弹窗或稍后重试",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

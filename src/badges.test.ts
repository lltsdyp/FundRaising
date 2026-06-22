import type { Address } from "viem";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { crowdfundingAbi, donationBadgeAbi, projectAbi } from "./abi";
import { loadDonationBadges, type BadgeReadClient } from "./badges";
import { READ_OPERATION_TIMEOUT_MS } from "./contracts";
import type { DonationBadge } from "./types";

const crowdfundingAddress =
  "0x1111111111111111111111111111111111111111" as Address;
const badgeAddress =
  "0x2222222222222222222222222222222222222222" as Address;
const owner = "0x3333333333333333333333333333333333333333" as Address;
const firstProject =
  "0x4444444444444444444444444444444444444444" as Address;
const secondProject =
  "0x5555555555555555555555555555555555555555" as Address;

describe("badge-related ABI", () => {
  it("matches Project.contribute's payable input and return values", () => {
    expect(projectAbi.find((entry) => entry.name === "contribute")).toEqual({
      type: "function",
      name: "contribute",
      stateMutability: "payable",
      inputs: [{ name: "_contributor", type: "address" }],
      outputs: [
        { name: "isNewContributor", type: "bool" },
        { name: "rank", type: "uint256" },
      ],
    });
  });

  it("matches DonationBadge.badges' generated public getter", () => {
    expect(
      donationBadgeAbi.find((entry) => entry.name === "badges"),
    ).toEqual({
      type: "function",
      name: "badges",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [
        { name: "project", type: "address" },
        { name: "rank", type: "uint256" },
      ],
    });
  });
});

function fakeClient(
  implementation: BadgeReadClient["readContract"],
): BadgeReadClient & { readContract: ReturnType<typeof vi.fn> } {
  return { readContract: vi.fn(implementation) };
}

describe("loadDonationBadges", () => {
  it("exposes only valid donation ranks in its result type", () => {
    expectTypeOf<DonationBadge["rank"]>().toEqualTypeOf<1 | 2 | 3>();
  });

  it("discovers the badge contract from Crowdfunding and returns early for a zero balance", async () => {
    const client = fakeClient(async (request) => {
      if (request.functionName === "donationBadge") return badgeAddress;
      if (request.functionName === "balanceOf") return 0n;
      throw new Error(`unexpected call: ${request.functionName}`);
    });

    await expect(
      loadDonationBadges(crowdfundingAddress, owner, client),
    ).resolves.toEqual([]);
    expect(client.readContract).toHaveBeenCalledTimes(2);
    expect(client.readContract).toHaveBeenNthCalledWith(1, {
      address: crowdfundingAddress,
      abi: crowdfundingAbi,
      functionName: "donationBadge",
    });
    expect(client.readContract).toHaveBeenNthCalledWith(2, {
      address: badgeAddress,
      abi: donationBadgeAbi,
      functionName: "balanceOf",
      args: [owner],
    });
  });

  it("enumerates badges in parallel and normalizes ranks to tiers", async () => {
    let releaseFirstTokenId: ((tokenId: bigint) => void) | undefined;
    const firstTokenId = new Promise<bigint>((resolve) => {
      releaseFirstTokenId = resolve;
    });
    const client = fakeClient(async (request) => {
      if (request.functionName === "donationBadge") return badgeAddress;
      if (request.functionName === "balanceOf") return 2n;
      if (request.functionName === "tokenOfOwnerByIndex") {
        if (request.args[1] === 0n) return firstTokenId;
        releaseFirstTokenId?.(10n);
        return 20n;
      }
      if (request.functionName === "badges") {
        return request.args[0] === 10n
          ? ([firstProject, 1n] as const)
          : ([secondProject, 2n] as const);
      }
      if (request.functionName === "tokenURI") {
        return `ipfs://badge-${request.args[0]}`;
      }
      throw new Error(`unexpected call: ${request.functionName}`);
    });

    await expect(
      loadDonationBadges(crowdfundingAddress, owner, client),
    ).resolves.toEqual([
      {
        tokenId: 10n,
        project: firstProject,
        rank: 1,
        tier: "gold",
        tokenUri: "ipfs://badge-10",
      },
      {
        tokenId: 20n,
        project: secondProject,
        rank: 2,
        tier: "silver",
        tokenUri: "ipfs://badge-20",
      },
    ]);

    expect(client.readContract).toHaveBeenCalledWith({
      address: badgeAddress,
      abi: donationBadgeAbi,
      functionName: "tokenOfOwnerByIndex",
      args: [owner, 0n],
    });
    expect(client.readContract).toHaveBeenCalledWith({
      address: badgeAddress,
      abi: donationBadgeAbi,
      functionName: "tokenOfOwnerByIndex",
      args: [owner, 1n],
    });
    for (const tokenId of [10n, 20n]) {
      expect(client.readContract).toHaveBeenCalledWith({
        address: badgeAddress,
        abi: donationBadgeAbi,
        functionName: "badges",
        args: [tokenId],
      });
      expect(client.readContract).toHaveBeenCalledWith({
        address: badgeAddress,
        abi: donationBadgeAbi,
        functionName: "tokenURI",
        args: [tokenId],
      });
    }
  });

  it.each([
    [1n, "gold"],
    [2n, "silver"],
    [3n, "bronze"],
  ] as const)("normalizes rank %s to %s", async (rank, tier) => {
    const client = fakeClient(async (request) => {
      if (request.functionName === "donationBadge") return badgeAddress;
      if (request.functionName === "balanceOf") return 1n;
      if (request.functionName === "tokenOfOwnerByIndex") return 7n;
      if (request.functionName === "badges") {
        return [firstProject, rank] as const;
      }
      if (request.functionName === "tokenURI") return "ipfs://badge-7";
      throw new Error(`unexpected call: ${request.functionName}`);
    });

    const [badge] = await loadDonationBadges(
      crowdfundingAddress,
      owner,
      client,
    );

    expect(badge?.tier).toBe(tier);
  });

  it("rejects an invalid on-chain rank with a Chinese error", async () => {
    const client = fakeClient(async (request) => {
      if (request.functionName === "donationBadge") return badgeAddress;
      if (request.functionName === "balanceOf") return 1n;
      if (request.functionName === "tokenOfOwnerByIndex") return 9n;
      if (request.functionName === "badges") {
        return [firstProject, 4n] as const;
      }
      if (request.functionName === "tokenURI") return "ipfs://badge-9";
      throw new Error(`unexpected call: ${request.functionName}`);
    });

    await expect(
      loadDonationBadges(crowdfundingAddress, owner, client),
    ).rejects.toThrow("无效的捐赠徽章排名：4");
  });

  it("limits enumeration and detail reads to batches of 20 RPC calls", async () => {
    let activeEnumerationReads = 0;
    let activeDetailReads = 0;
    let maximumEnumerationReads = 0;
    let maximumDetailReads = 0;
    const client = fakeClient(async (request) => {
      if (request.functionName === "donationBadge") return badgeAddress;
      if (request.functionName === "balanceOf") return 41n;
      if (request.functionName === "tokenOfOwnerByIndex") {
        activeEnumerationReads += 1;
        maximumEnumerationReads = Math.max(
          maximumEnumerationReads,
          activeEnumerationReads,
        );
        await Promise.resolve();
        activeEnumerationReads -= 1;
        return request.args[1] + 1n;
      }

      activeDetailReads += 1;
      maximumDetailReads = Math.max(maximumDetailReads, activeDetailReads);
      await Promise.resolve();
      activeDetailReads -= 1;
      if (request.functionName === "badges") {
        return [firstProject, 1n] as const;
      }
      if (request.functionName === "tokenURI") {
        return `ipfs://badge-${request.args[0]}`;
      }
      throw new Error(`unexpected call: ${request.functionName}`);
    });

    const badges = await loadDonationBadges(
      crowdfundingAddress,
      owner,
      client,
    );

    expect(badges).toHaveLength(41);
    expect(maximumEnumerationReads).toBeLessThanOrEqual(20);
    expect(maximumDetailReads).toBeLessThanOrEqual(20);
  });

  it("rejects more than 500 badges before starting enumeration", async () => {
    const client = fakeClient(async (request) => {
      if (request.functionName === "donationBadge") return badgeAddress;
      if (request.functionName === "balanceOf") return 501n;
      throw new Error(`unexpected call: ${request.functionName}`);
    });

    await expect(
      loadDonationBadges(crowdfundingAddress, owner, client),
    ).rejects.toThrow("徽章数量超过单次读取上限: 500");
    expect(client.readContract).toHaveBeenCalledTimes(2);
  });

  it("times out the overall badge read after the shared read timeout", async () => {
    vi.useFakeTimers();
    const client = fakeClient(() => new Promise(() => undefined));

    try {
      let outcome: string | undefined;
      void loadDonationBadges(crowdfundingAddress, owner, client).then(
        () => {
          outcome = "resolved";
        },
        (caught: unknown) => {
          outcome = caught instanceof Error ? caught.message : String(caught);
        },
      );

      await vi.advanceTimersByTimeAsync(READ_OPERATION_TIMEOUT_MS);

      expect(outcome).toBe("读取徽章超时，请检查钱包网络后重试");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start another batch after the overall timeout", async () => {
    vi.useFakeTimers();
    const tokenResolvers: Array<(tokenId: bigint) => void> = [];
    const client = fakeClient(async (request) => {
      if (request.functionName === "donationBadge") return badgeAddress;
      if (request.functionName === "balanceOf") return 21n;
      if (request.functionName === "tokenOfOwnerByIndex") {
        return new Promise<bigint>((resolve) => {
          tokenResolvers.push(resolve);
        });
      }
      if (request.functionName === "badges") {
        return [firstProject, 1n] as const;
      }
      if (request.functionName === "tokenURI") return "ipfs://badge";
      throw new Error(`unexpected call: ${request.functionName}`);
    });

    try {
      const result = loadDonationBadges(crowdfundingAddress, owner, client);
      const rejection = expect(result).rejects.toThrow(
        "读取徽章超时，请检查钱包网络后重试",
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(tokenResolvers).toHaveLength(20);

      await vi.advanceTimersByTimeAsync(READ_OPERATION_TIMEOUT_MS);
      await rejection;
      for (const [index, resolve] of tokenResolvers.entries()) {
        resolve(BigInt(index + 1));
      }
      await vi.advanceTimersByTimeAsync(0);

      const enumerationCalls = client.readContract.mock.calls.filter(
        ([request]) => request.functionName === "tokenOfOwnerByIndex",
      );
      const detailCalls = client.readContract.mock.calls.filter(
        ([request]) =>
          request.functionName === "badges" ||
          request.functionName === "tokenURI",
      );
      expect(enumerationCalls).toHaveLength(20);
      expect(detailCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

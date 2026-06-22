import { isAddress, type Address } from "viem";
import { crowdfundingAbi, donationBadgeAbi } from "./abi";
import { getPublicClient, READ_OPERATION_TIMEOUT_MS } from "./contracts";
import type { DonationBadge } from "./types";
import { withOperationTimeout } from "./utils";

export const BADGE_READ_BATCH_SIZE = 20;
export const MAX_PROFILE_BADGES = 500;

const BADGE_READ_TIMEOUT_MESSAGE = "读取徽章超时，请检查钱包网络后重试";

type BadgeReadContext = {
  expired: boolean;
};

type CrowdfundingBadgeRequest = {
  address: Address;
  abi: typeof crowdfundingAbi;
  functionName: "donationBadge";
};

type BadgeContractRequest =
  | {
      address: Address;
      abi: typeof donationBadgeAbi;
      functionName: "balanceOf";
      args: readonly [Address];
    }
  | {
      address: Address;
      abi: typeof donationBadgeAbi;
      functionName: "tokenOfOwnerByIndex";
      args: readonly [Address, bigint];
    }
  | {
      address: Address;
      abi: typeof donationBadgeAbi;
      functionName: "badges" | "tokenURI";
      args: readonly [bigint];
    };

export type BadgeReadClient = {
  readContract(
    request: CrowdfundingBadgeRequest | BadgeContractRequest,
  ): Promise<unknown>;
};

function sharedReadClient(): BadgeReadClient {
  const client = getPublicClient();
  return {
    readContract: (request) => {
      switch (request.functionName) {
        case "donationBadge":
          return client.readContract(request);
        case "balanceOf":
          return client.readContract(request);
        case "tokenOfOwnerByIndex":
          return client.readContract(request);
        case "badges":
          return client.readContract(request);
        case "tokenURI":
          return client.readContract(request);
      }
    },
  };
}

function parseRank(
  rank: bigint,
): Pick<DonationBadge, "rank" | "tier"> {
  if (rank === 1n) return { rank: 1, tier: "gold" };
  if (rank === 2n) return { rank: 2, tier: "silver" };
  if (rank === 3n) return { rank: 3, tier: "bronze" };
  throw new Error(`无效的捐赠徽章排名：${rank}`);
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label}地址无效`);
  }
  return value;
}

function requireBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${label}无效`);
  return value;
}

export async function loadDonationBadges(
  crowdfundingAddress: Address,
  owner: Address,
  client: BadgeReadClient = sharedReadClient(),
): Promise<DonationBadge[]> {
  const context: BadgeReadContext = { expired: false };
  const expirationTimer = setTimeout(() => {
    context.expired = true;
  }, READ_OPERATION_TIMEOUT_MS);

  return withOperationTimeout(
    loadDonationBadgesWithoutTimeout(
      crowdfundingAddress,
      owner,
      client,
      context,
    ),
    READ_OPERATION_TIMEOUT_MS,
    BADGE_READ_TIMEOUT_MESSAGE,
  ).finally(() => clearTimeout(expirationTimer));
}

async function loadDonationBadgesWithoutTimeout(
  crowdfundingAddress: Address,
  owner: Address,
  client: BadgeReadClient,
  context: BadgeReadContext,
): Promise<DonationBadge[]> {
  const badgeAddress = requireAddress(
    await client.readContract({
      address: crowdfundingAddress,
      abi: crowdfundingAbi,
      functionName: "donationBadge",
    }),
    "捐赠徽章合约",
  );
  throwIfBadgeReadExpired(context);
  const balance = requireBigInt(
    await client.readContract({
      address: badgeAddress,
      abi: donationBadgeAbi,
      functionName: "balanceOf",
      args: [owner],
    }),
    "捐赠徽章余额",
  );
  throwIfBadgeReadExpired(context);
  if (balance > BigInt(MAX_PROFILE_BADGES)) {
    throw new Error(
      `徽章数量超过单次读取上限: ${MAX_PROFILE_BADGES}`,
    );
  }

  const badges: DonationBadge[] = [];
  const batchSize = BigInt(BADGE_READ_BATCH_SIZE);
  for (let batchStart = 0n; batchStart < balance; batchStart += batchSize) {
    throwIfBadgeReadExpired(context);
    const batchEnd =
      batchStart + batchSize < balance ? batchStart + batchSize : balance;
    const tokenIdReads: Array<Promise<bigint>> = [];
    for (let index = batchStart; index < batchEnd; index += 1n) {
      tokenIdReads.push(
        client.readContract({
          address: badgeAddress,
          abi: donationBadgeAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [owner, index],
        }).then((tokenId) => requireBigInt(tokenId, "捐赠徽章编号")),
      );
    }
    const tokenIds = await Promise.all(tokenIdReads);
    throwIfBadgeReadExpired(context);

    const badgeRows = await Promise.all(
      tokenIds.map((tokenId) =>
        client.readContract({
          address: badgeAddress,
          abi: donationBadgeAbi,
          functionName: "badges",
          args: [tokenId],
        }),
      ),
    );
    throwIfBadgeReadExpired(context);
    const tokenUris = await Promise.all(
      tokenIds.map((tokenId) =>
        client.readContract({
          address: badgeAddress,
          abi: donationBadgeAbi,
          functionName: "tokenURI",
          args: [tokenId],
        }),
      ),
    );
    throwIfBadgeReadExpired(context);

    for (let index = 0; index < tokenIds.length; index += 1) {
      const tokenId = tokenIds[index];
      const badge = badgeRows[index];
      const tokenUri = tokenUris[index];
      if (tokenId === undefined) throw new Error("捐赠徽章编号无效");
      if (!Array.isArray(badge) || badge.length < 2) {
        throw new Error("捐赠徽章数据无效");
      }
      if (typeof tokenUri !== "string") {
        throw new Error("捐赠徽章元数据地址无效");
      }

      const rank = requireBigInt(badge[1], "捐赠徽章排名");
      badges.push({
        tokenId,
        project: requireAddress(badge[0], "捐赠徽章项目"),
        ...parseRank(rank),
        tokenUri,
      });
    }
  }

  return badges;
}

function throwIfBadgeReadExpired(context: BadgeReadContext) {
  if (context.expired) throw new Error(BADGE_READ_TIMEOUT_MESSAGE);
}

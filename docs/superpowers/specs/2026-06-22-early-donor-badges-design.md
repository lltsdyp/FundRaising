# Early Donor Badges Design

## Goal

Reward the first three unique contributors to each crowdfunding project with permanent, non-transferable NFTs. The first, second, and third contributors receive gold, silver, and bronze badges respectively, and those badges appear on their wallet profile.

## Scope

The first version includes automatic badge minting for ranks 1–3, fully on-chain NFT metadata, and profile display. Contributors ranked fourth or later receive no ranking NFT.

The first version does not include configurable reward counts, transferable badges, badge burning, manual claims, historical backfills, project leaderboards, or promises of future financial benefits.

## Reward Rules

- Rank is assigned when an address makes its first successful contribution to a project.
- Rank follows transaction execution order and is therefore an on-chain early-contributor record.
- Additional contributions from the same address do not change its rank and do not mint another badge.
- Rank 1 receives gold, rank 2 receives silver, and rank 3 receives bronze.
- Badge minting happens in the same transaction as the qualifying contribution.
- A badge remains owned by its original recipient if the project later fails or the contribution is refunded.
- Existing deployments and historical contributions are not backfilled. The feature starts with a newly deployed `Crowdfunding` contract.

## Contract Architecture

Add one `DonationBadge` ERC-721 contract for the entire `Crowdfunding` deployment. `Crowdfunding` deploys it in its constructor, remains its only authorized minter, and exposes its address through a public getter. A separate badge contract per project is intentionally avoided because it would increase deployment cost and make profile aggregation more complex.

`DonationBadge` builds on OpenZeppelin `ERC721Enumerable`. Enumeration lets the frontend query a wallet with `balanceOf` and `tokenOfOwnerByIndex` without scanning all historical logs. The contract disables approvals and transfers, making each badge soulbound. It has no public burn function.

Each `Project` adds a public `contributorRank` mapping. On an address's first contribution, the project appends the address to its existing contributor list, increments `noOfContributors`, and stores that number as the contributor's permanent rank. `Project.contribute` returns whether the contribution was the address's first contribution and the assigned rank.

After `Project.contribute` returns, `Crowdfunding.contribute` mints only when the contribution is new and the returned rank is between 1 and 3. Only `Crowdfunding` can call the badge mint function.

Each badge record contains:

- A unique token ID assigned sequentially by `DonationBadge`.
- The project contract address.
- The contributor rank, constrained to 1, 2, or 3.
- The medal tier derived from rank rather than stored independently.

## Contribution Data Flow

1. A contributor calls `Crowdfunding.contribute` with a project address and ETH.
2. `Crowdfunding` validates that the project belongs to this crowdfunding deployment, remains open, and accepts the submitted amount.
3. `Crowdfunding` forwards the contribution and contributor address to `Project.contribute`.
4. `Project` updates contribution totals and, for a new contributor, assigns the next unique-contributor rank.
5. `Project` returns the new-contributor flag and rank.
6. For ranks 1–3, `Crowdfunding` calls `DonationBadge.mint` for the contributor and project.
7. The contracts emit contribution and badge-minted events.

Contribution accounting and badge minting are atomic. If badge minting fails, the entire transaction, including the contribution, reverts. `DonationBadge` uses direct minting rather than a safe-mint receiver callback because badges cannot subsequently be transferred and a contract contributor must not be prevented from donating solely because it lacks an ERC-721 receiver implementation.

## On-Chain Metadata

`DonationBadge.tokenURI` returns a Base64-encoded JSON data URI. The JSON contains:

- A name identifying a gold, silver, or bronze project donor badge.
- A description stating that the owner was the project's first, second, or third unique contributor.
- Attributes for the project address, contributor rank, and medal tier.
- A Base64-encoded SVG image data URI.

The SVG shows the medal color, `#1`, `#2`, or `#3`, and an abbreviated project address. It does not embed the user-supplied project title. Avoiding arbitrary project text keeps JSON and SVG generation deterministic and removes an escaping and injection boundary. The frontend associates the immutable project address with the project's title when rendering the profile.

## Soulbound Behavior

Minting from the zero address to the recipient is allowed. Every owner-to-owner transfer path reverts, including both forms of `safeTransferFrom` and `transferFrom`. `approve` and `setApprovalForAll` also revert so the contract does not advertise unusable transfer permissions. Standard read-only ERC-721 and enumeration interfaces remain available to wallets and indexers.

## Frontend Architecture

Add a focused `src/badges.ts` data module and badge types in `src/types.ts`. The data module:

1. Reads the `DonationBadge` address from `Crowdfunding`.
2. Reads the requested profile wallet's badge balance.
3. Enumerates token IDs owned by that wallet.
4. Reads badge data for those token IDs in parallel.
5. Returns normalized badge objects containing token ID, project address, rank, tier, and token URI.

The `/profile/:address` route loads badge data independently from the existing project/profile summary. A badge-read failure affects only the badge section; donation totals, supported projects, and created projects continue to render.

The profile adds an “Early Supporter Badges” section. Each card uses a distinct gold, silver, or bronze treatment and displays the exact rank, project title, and abbreviated project address. Selecting a card navigates to the corresponding project detail page. A wallet with no badges sees an explicit empty state.

The project detail page does not gain a leaderboard in this version.

## Contract Events and Errors

`DonationBadge` emits the standard ERC-721 `Transfer` event on mint and a domain event containing token ID, recipient, project address, and rank. Unauthorized mint attempts, invalid ranks, approval attempts, and transfer attempts use explicit custom errors. Existing contribution validation continues to revert the complete transaction for invalid project, deadline, amount, creator contribution, or contributor address conditions.

## Testing Strategy

Solidity tests cover:

- Sequential unique contributors receiving gold, silver, and bronze badges.
- Correct token ownership, token uniqueness, project address, rank, and medal tier.
- Repeated donations preserving the original rank and minting no second badge.
- The fourth contributor receiving no NFT.
- Unauthorized minting reverting.
- `approve`, `setApprovalForAll`, `transferFrom`, and both `safeTransferFrom` forms reverting.
- Badges remaining after a failed project's contribution refund.
- Identical behavior for all-or-nothing and milestone projects.
- Valid Base64 JSON metadata containing the rank, tier, project address, and SVG image URI.

Vitest tests cover:

- Enumerating and normalizing one or more owned badges.
- Parallel badge reads and project-address association.
- Gold, silver, and bronze rendering.
- The no-badge empty state.
- Navigation from a badge to its project.
- Badge query failure remaining isolated from existing profile content.

Verification runs in this order:

```bash
npx hardhat test solidity
npx hardhat build
npx tsc --noEmit
npm test
npm run lint
npm run build
```

## Deployment and Compatibility

Add `@openzeppelin/contracts` as a production dependency. The existing Ignition module still deploys `Crowdfunding`; its constructor creates `DonationBadge`, so no externally supplied constructor argument is required. Deployment output and frontend configuration continue to use the `Crowdfunding` address, while the frontend discovers the badge address through the new getter.

The ABI files must be updated for the changed `Project.contribute` return values, the new rank getter, the `Crowdfunding` badge getter, and the `DonationBadge` read interface. A fresh deployment is mandatory because existing contracts cannot be upgraded or retroactively assigned badges.

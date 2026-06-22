# Early Donor Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mint permanent gold, silver, and bronze soulbound NFTs to each project's first three unique contributors and display them on wallet profiles.

**Architecture:** `Project` assigns permanent contributor ranks; `Crowdfunding` atomically mints qualifying rewards through one enumerable `DonationBadge` ERC-721. The React profile queries badge ownership independently so badge failures never hide existing profile data.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin Contracts 5.x, Hardhat 3, forge-std, React 19, TypeScript 6, viem 2, Vitest 4.

---

## File map

- Create `contracts/DonationBadge.sol` and `contracts/DonationBadge.t.sol`: soulbound NFT, enumeration, metadata, unit tests.
- Modify `contracts/Project.sol`, `contracts/Crowdfunding.sol`, and `contracts/Crowdfunding.t.sol`: rank and mint integration.
- Modify `package.json` and `package-lock.json`: OpenZeppelin dependency.
- Modify `src/abi.ts`, `src/types.ts`, and `src/contracts.ts`: typed badge interfaces and shared read client.
- Create `src/badges.ts` and `src/badges.test.ts`: profile badge queries.
- Create `src/BadgeGallery.tsx` and `src/BadgeGallery.test.tsx`: isolated display states.
- Modify `src/App.tsx`, `src/App.test.tsx`, `src/styles.css`, and `README.md`: route integration, styling, and deployment docs.

### Task 1: Contributor rank model

**Files:**
- Modify: `contracts/Project.sol:45-50,138-158`
- Test: `contracts/Crowdfunding.t.sol`

- [ ] **Step 1: Write failing tests**

Add tests which donate twice from `contributor`, then once from `contributorTwo`, and assert ranks `1` and `2`, a contributor count of `2`, and no rank change on the repeated donation:

```solidity
assertEq(project.contributorRank(contributor), 1);
assertEq(project.contributorRank(contributorTwo), 2);
assertEq(project.noOfContributors(), 2);
```

- [ ] **Step 2: Verify failure**

Run `npx hardhat test solidity`. Expected: compile failure because `contributorRank` is absent.

- [ ] **Step 3: Implement rank assignment**

Add:

```solidity
mapping(address contributor => uint256 rank) public contributorRank;
```

Change the function signature and unique-contributor block to:

```solidity
function contribute(address _contributor)
  external payable returns (bool isNewContributor, uint256 rank)
{
  require(msg.sender == crowdfundingContract, "Only crowdfunding contract");
  refreshState();
  require(state == State.Fundraising, "Project is not ongoing");
  require(_contributor != address(0), "Invalid contributor");
  require(_contributor != creator, "Creator cannot contribute to own project");
  require(msg.value >= minimumContribution, "Contribution amount is too low !");

  rank = contributorRank[_contributor];
  if (rank == 0) {
    contributors.push(_contributor);
    noOfContributors++;
    rank = noOfContributors;
    contributorRank[_contributor] = rank;
    isNewContributor = true;
  }
  contributions[_contributor] += msg.value;
  raisedAmount += msg.value;
  refreshState();
  emit FundingReceived(_contributor, msg.value, raisedAmount);
}
```

- [ ] **Step 4: Verify and commit**

Run `npx hardhat test solidity`; expected PASS. Commit:

```bash
git add contracts/Project.sol contracts/Crowdfunding.t.sol
git commit -m "feat: assign permanent contributor ranks"
```

### Task 2: Soulbound DonationBadge

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `contracts/DonationBadge.sol`
- Create: `contracts/DonationBadge.t.sol`

- [ ] **Step 1: Install dependency**

Run `npm install @openzeppelin/contracts@^5.4.0`. Expected: installed 5.x dependency and updated lockfile.

- [ ] **Step 2: Write failing contract tests**

Test `mint` ownership/enumeration and stored `(project, rank)`; invalid rank `4`; unauthorized mint; `approve`, `setApprovalForAll`, `transferFrom`, and `safeTransferFrom` reverting with `Soulbound`; and `tokenURI` beginning `data:application/json;base64,`.

```solidity
uint256 tokenId = badge.mint(donor, project, 1);
assertEq(badge.ownerOf(tokenId), donor);
assertEq(badge.tokenOfOwnerByIndex(donor, 0), tokenId);
(address storedProject, uint8 rank) = badge.badges(tokenId);
assertEq(storedProject, project);
assertEq(rank, 1);
```

Run `npx hardhat test solidity --grep DonationBadge`; expected failure because the contract is absent.

- [ ] **Step 3: Implement the contract**

Create `DonationBadge` inheriting `ERC721Enumerable`, with:

```solidity
struct Badge { address project; uint8 rank; }
error InvalidMinter();
error UnauthorizedMinter();
error InvalidRecipient();
error InvalidProject();
error InvalidRank();
error Soulbound();
address public immutable minter;
uint256 private nextTokenId = 1;
mapping(uint256 tokenId => Badge badge) public badges;
```

Implement `mint` exactly as:

```solidity
function mint(address recipient, address project, uint8 rank)
  external returns (uint256 tokenId)
{
  if (msg.sender != minter) revert UnauthorizedMinter();
  if (recipient == address(0)) revert InvalidRecipient();
  if (project == address(0)) revert InvalidProject();
  if (rank == 0 || rank > 3) revert InvalidRank();
  tokenId = nextTokenId++;
  badges[tokenId] = Badge(project, rank);
  _mint(recipient, tokenId);
  emit DonationBadgeMinted(tokenId, recipient, project, rank);
}
```

Override approvals to revert. Override `_update` and reject only nonzero-to-nonzero ownership changes; include the required `ERC721Enumerable` `_increaseBalance` and `supportsInterface` overrides. Implement `tokenURI` using OpenZeppelin `Base64` and `Strings`: JSON attributes are project address, numeric rank, and `Gold`/`Silver`/`Bronze`; its Base64 SVG contains the tier color, `#rank`, and abbreviated project address. Call `_requireOwned(tokenId)` first.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx hardhat test solidity --grep DonationBadge
npx hardhat test solidity
```

Expected: PASS. Commit dependency, contract, and test.

### Task 3: Atomic reward integration

**Files:**
- Modify: `contracts/Crowdfunding.sol:4-6,27-28,110-120`
- Modify: `contracts/Crowdfunding.t.sol`

- [ ] **Step 1: Write failing integration tests**

Donate from four unique addresses and assert badge balances `1,1,1,0` and ranks `1,2,3`. Repeat the first donor and assert its balance stays `1`. After a failed project refund, assert contribution `0`, rank `1`, and badge balance `1`. Repeat rank-1 coverage for a milestone project.

- [ ] **Step 2: Verify failure**

Run `npx hardhat test solidity --grep Badge`; expected failure because `donationBadge()` is absent.

- [ ] **Step 3: Deploy and mint**

Add:

```solidity
DonationBadge public immutable donationBadge;

constructor() {
  donationBadge = new DonationBadge(address(this));
}
```

Replace the forward call with:

```solidity
(bool isNewContributor, uint256 rank) =
  project.contribute{value: msg.value}(msg.sender);
if (isNewContributor && rank <= 3) {
  donationBadge.mint(msg.sender, projectAddress, uint8(rank));
}
```

- [ ] **Step 4: Verify and commit**

Run `npx hardhat test solidity && npx hardhat build`; expected PASS. Commit both contracts/tests.

### Task 4: Badge query data layer

**Files:**
- Modify: `src/abi.ts`, `src/types.ts`, `src/contracts.ts`
- Create: `src/badges.ts`, `src/badges.test.ts`

- [ ] **Step 1: Write a failing loader test**

Mock one `donationBadge` address, balance `2n`, token IDs `7n/8n`, tuples `[PROJECT_A,1]` and `[PROJECT_B,3]`, and two token URIs. Assert normalized results:

```ts
[
  { tokenId: 7n, projectAddress: PROJECT_A, rank: 1, tier: "gold", tokenUri: "data:one" },
  { tokenId: 8n, projectAddress: PROJECT_B, rank: 3, tier: "bronze", tokenUri: "data:two" },
]
```

Run `npx vitest run src/badges.test.ts`; expected module-not-found failure.

- [ ] **Step 2: Add exact ABI/type surfaces**

Add `donationBadge()` to `crowdfundingAbi`, `contributorRank(address)` to `projectAbi`, and `donationBadgeAbi` functions `balanceOf`, `tokenOfOwnerByIndex`, `badges`, `tokenURI`. Add:

```ts
export type DonationBadgeTier = "gold" | "silver" | "bronze";
export type DonationBadge = {
  tokenId: bigint;
  projectAddress: Address;
  rank: 1 | 2 | 3;
  tier: DonationBadgeTier;
  tokenUri: string;
};
```

Export `getPublicClient` from `src/contracts.ts`.

- [ ] **Step 3: Implement enumeration**

In `loadDonationBadges(crowdfundingAddress, owner, client = getPublicClient())`, read the badge address, read `balanceOf`, build indexes with `Array.from`, query token IDs via `Promise.all`, then query each token's `badges` tuple and `tokenURI` via `Promise.all`. Convert ranks through a function that returns gold/silver/bronze and throws `徽章排名无效: N` otherwise.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run src/badges.test.ts
npx hardhat build && npx tsc --noEmit
```

Expected: PASS. Commit the five frontend data files.

### Task 5: Profile badge gallery

**Files:**
- Create: `src/BadgeGallery.tsx`, `src/BadgeGallery.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing presentation tests**

Render gold/silver/bronze fixtures and assert tier classes, `#1/#2/#3`, titles, addresses, and navigation callback. Separately assert loading text `徽章读取中…`, error text, and empty text `尚未获得早期支持者徽章。`.

- [ ] **Step 2: Verify failure**

Run `npx vitest run src/BadgeGallery.test.tsx`; expected module-not-found failure.

- [ ] **Step 3: Implement the gallery**

Export `DisplayBadge = DonationBadge & { projectTitle: string }`. Render a `content-section` with heading `早期支持者徽章`, badge count, isolated loading/error/empty states, and buttons:

```tsx
<button
  className={`donation-badge ${badge.tier}`}
  key={badge.tokenId.toString()}
  type="button"
  onClick={() => onOpenProject(badge.projectAddress)}
>
  <span className="medal-mark">#{badge.rank}</span>
  <strong>{badge.projectTitle}</strong>
  <span>{formatAddress(badge.projectAddress)}</span>
</button>
```

Add a responsive auto-fit `.badge-grid`, medal cards, and tier variables:

```css
.donation-badge.gold { --medal: #d4af37; --medal-soft: #f8edb7; }
.donation-badge.silver { --medal: #9ca3af; --medal-soft: #edf0f3; }
.donation-badge.bronze { --medal: #b86f37; --medal-soft: #f3d8c3; }
```

- [ ] **Step 4: Verify and commit**

Run `npx vitest run src/BadgeGallery.test.tsx`; expected PASS. Commit component, tests, CSS.

### Task 6: Route integration, documentation, final verification

**Files:**
- Modify: `src/App.tsx:19-38,458-480,1115-1212`
- Modify: `src/App.test.tsx:354-441`
- Modify: `README.md`

- [ ] **Step 1: Write failing profile isolation tests**

Pass `badges`, `badgeLoading`, and `badgeError` to `Profile`. With `badgeError="徽章读取失败"`, assert both the error and existing `累计捐赠`/project rows remain. With one badge, click it and assert `onOpenProject(projectAddress)`.

- [ ] **Step 2: Add route state and effect**

In `ProfileRoute`, maintain `DonationBadge[]`, loading, and error state. An effect keyed by crowdfunding/profile address resets state, calls `loadDonationBadges`, uses an `active` cleanup boolean to ignore stale results, and reports `徽章读取失败，请稍后重试` only in the badge section.

Derive titles exactly:

```ts
const displayBadges: DisplayBadge[] = useMemo(
  () => badges.map((badge) => ({
    ...badge,
    projectTitle: ctx.projects.find((project) =>
      normalizeAddress(project.address) === normalizeAddress(badge.projectAddress),
    )?.title ?? "未知项目",
  })),
  [badges, ctx.projects],
);
```

Render `BadgeGallery` immediately after the profile statistics and before supported projects. Update all direct `Profile` test renders with explicit badge props.

- [ ] **Step 3: Document behavior and redeployment**

Add a README section stating: only the first three unique addresses receive gold/silver/bronze; repeat donations do not rerank; badges survive refunds; metadata is on-chain; the Ignition command and frontend configuration remain centered on the Crowdfunding address; a fresh deployment is required and no history is backfilled.

- [ ] **Step 4: Run final verification**

```bash
npx hardhat test solidity
npx hardhat build
npx tsc --noEmit
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: every verification command exits 0. Status contains only planned changes plus the pre-existing user-owned `.env.example`, `design.md`, and `ignition/deployments/chain-31337/journal.jsonl` changes.

- [ ] **Step 5: Commit integration and docs**

```bash
git add src/App.tsx src/App.test.tsx README.md
git commit -m "feat: integrate early donor profile rewards"
```

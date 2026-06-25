# Donor Reputation Preview

A front-end-only preview of a donor's on-chain "public-good identity". After
connecting a wallet, a user can open **公益身份 / `/donor-reputation`** to see a
contribution score, level, activity metrics, and a preview of unlockable
privileges.

## Scope

This is a **display-only** feature. The current version:

- does **not** modify any smart contract (donation / voting / challenge);
- does **not** add on-chain reputation storage;
- does **not** change real voting weight or governance permissions;
- does **not** gate any contract call.

> 当前版本为 Donor Reputation Preview。贡献分数由前端根据可用数据计算，仅用于展示。
> 它不会改变链上投票权重、治理权限或项目准入权限。
> 未来如用于真实权限控制，需要合约层验证。

## Implementation

All code lives in `src/donor-reputation/`:

| File | Responsibility |
| --- | --- |
| `types.ts` | `DonorLevel`, `DonorReputationInput`, `DonorReputation` |
| `calculateDonorScore.ts` | Pure scoring function (floored, min 0) |
| `getDonorLevel.ts` | Score → level thresholds |
| `mockDonorReputation.ts` | Mock input for the MVP |
| `loadDonorReputationInput.ts` | Async seam for future real data |
| `useDonorReputation.ts` | Combines load + score + level |
| `DonorReputationCard.tsx` / `DonorReputationMetrics.tsx` / `DonorPrivilegesPreview.tsx` | UI |
| `ConnectedDonorReputation.tsx` | Wallet-aware wrapper + disclaimer |

The page route and topbar link are wired in `src/App.tsx`.

### Scoring rules

```text
score = supportedProjects * 10
      + totalDonatedEth * 20
      + votesParticipated * 5
      + votesAlignedWithFinalResult * 8
      - maliciousChallenges * 50
      + (hasEarlySupporterNFT ? 100 : 0)
```

Score is floored to an integer and clamped to a minimum of 0.

### Level thresholds

| Score | Level |
| --- | --- |
| 0 – 99 | Bronze |
| 100 – 249 | Silver |
| 250 – 499 | Gold |
| 500+ | Genesis |

## Replacing mock data with real data

Only `loadDonorReputationInput` needs to change; the scoring and level logic stay
the same. Suggested phases:

1. **Donations** — read donation events / indexer → `supportedProjects`, `totalDonatedEth`.
2. **Voting** — read voting records → `votesParticipated`, `votesAlignedWithFinalResult`.
3. **Challenges** — read challenge/dispute results → `maliciousChallenges`.
4. **NFT** — `balanceOf(address)` on the early-supporter NFT → `hasEarlySupporterNFT`.

If this score is ever used for **real** permission control, it must be verified at
the contract layer — the front-end value cannot be trusted on its own.

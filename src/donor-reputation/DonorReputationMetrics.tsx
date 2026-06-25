import type { DonorReputation } from "./types";

type Props = {
  reputation: DonorReputation;
};

export function DonorReputationMetrics({ reputation }: Props) {
  const metrics = [
    {
      label: "累计支持项目",
      value: `${reputation.supportedProjects} 个`,
    },
    {
      label: "累计捐赠金额",
      value: `${reputation.totalDonatedEth} ETH`,
    },
    {
      label: "参与投票",
      value: `${reputation.votesParticipated} 次`,
    },
    {
      label: "投票与最终结果一致",
      value: `${reputation.votesAlignedWithFinalResult} 次`,
    },
    {
      label: "恶意挑战",
      value: `${reputation.maliciousChallenges} 次`,
    },
    {
      label: "早期支持者 NFT",
      value: reputation.hasEarlySupporterNFT ? "已持有" : "未持有",
    },
  ];

  return (
    <dl className="stats-grid">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

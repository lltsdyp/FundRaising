import { formatAddress } from "../utils";
import { DonorPrivilegesPreview } from "./DonorPrivilegesPreview";
import { DonorReputationMetrics } from "./DonorReputationMetrics";
import type { DonorReputation } from "./types";

type Props = {
  reputation: DonorReputation;
};

export function DonorReputationCard({ reputation }: Props) {
  return (
    <section className="detail-layout">
      <div className="section-heading">
        <div>
          <p className="eyebrow">链上公益身份</p>
          <h2>{formatAddress(reputation.address)}</h2>
        </div>
        <span className={`state-badge donor-level-${reputation.level.toLowerCase()}`}>
          {reputation.level}
        </span>
      </div>

      <dl className="stats-grid">
        <div>
          <dt>贡献值</dt>
          <dd>{reputation.score}</dd>
        </div>
        <div>
          <dt>等级</dt>
          <dd>{reputation.level}</dd>
        </div>
      </dl>

      <DonorReputationMetrics reputation={reputation} />

      <DonorPrivilegesPreview level={reputation.level} />
    </section>
  );
}

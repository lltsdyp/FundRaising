import type { Address } from "viem";
import type { DonationBadge } from "./types";
import { formatAddress } from "./utils";

export type DisplayBadge = DonationBadge & { projectTitle: string };

type BadgeGalleryProps = {
  badges: DisplayBadge[];
  loading: boolean;
  error: string;
  onOpenProject: (address: Address) => void;
};

export function BadgeGallery({
  badges,
  loading,
  error,
  onOpenProject,
}: BadgeGalleryProps) {
  return (
    <section className="content-section badge-gallery">
      <div className="section-heading compact">
        <h3>早期支持者徽章</h3>
        <span className="badge-count">{badges.length} 枚</span>
      </div>

      {loading ? (
        <div className="empty-state badge-state" role="status">
          正在加载徽章…
        </div>
      ) : error ? (
        <div className="empty-state badge-state badge-error" role="alert">
          {error}
        </div>
      ) : badges.length === 0 ? (
        <div className="empty-state badge-state">暂无早期支持者徽章。</div>
      ) : (
        <div className="badge-grid">
          {badges.map((badge) => (
            <button
              type="button"
              className={`badge-card ${badge.tier}`}
              key={badge.tokenId.toString()}
              onClick={() => onOpenProject(badge.project)}
              aria-label={`打开项目 ${badge.projectTitle}，早期支持者 #${badge.rank}`}
            >
              <span className="badge-medal" aria-hidden="true">
                #{badge.rank}
              </span>
              <span className="badge-project-title">{badge.projectTitle}</span>
              <span className="badge-project-address">
                {formatAddress(badge.project)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

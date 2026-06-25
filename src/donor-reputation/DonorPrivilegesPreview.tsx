import type { DonorLevel } from "./types";

type Props = {
  level: DonorLevel;
};

const privilegesByLevel: Record<DonorLevel, string[]> = {
  Bronze: ["展示公益身份", "记录基础贡献数据"],
  Silver: ["优先收到新项目提醒", "获得 Silver 捐赠者徽章"],
  Gold: ["优先参与新项目", "获得更高投票权重预览", "有资格获得治理 Token"],
  Genesis: [
    "优先参与新项目",
    "获得最高等级公益身份",
    "有资格参与平台参数治理",
    "有资格获得治理 Token",
  ],
};

export function DonorPrivilegesPreview({ level }: Props) {
  const privileges = privilegesByLevel[level];

  return (
    <section className="content-section">
      <div className="section-heading compact">
        <h3>可解锁特权预览</h3>
      </div>
      <ul className="privilege-list">
        {privileges.map((privilege) => (
          <li key={privilege}>✓ {privilege}</li>
        ))}
      </ul>
      <p className="muted">
        当前版本仅为前端展示，不代表合约已经强制执行这些权限。
      </p>
    </section>
  );
}

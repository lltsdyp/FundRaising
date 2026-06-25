import type { Address } from "viem";
import { DonorReputationCard } from "./DonorReputationCard";
import { useDonorReputation } from "./useDonorReputation";

type Props = {
  address?: Address;
};

export function ConnectedDonorReputation({ address }: Props) {
  const { reputation, isLoading, error } = useDonorReputation(address);

  if (!address) {
    return (
      <div className="empty-state">请先连接钱包以查看你的链上公益身份。</div>
    );
  }

  if (isLoading) {
    return <div className="empty-state">正在加载贡献数据…</div>;
  }

  if (error) {
    return <div className="empty-state">贡献数据加载失败。</div>;
  }

  if (!reputation) {
    return <div className="empty-state">暂无贡献数据。</div>;
  }

  return (
    <>
      <DonorReputationCard reputation={reputation} />
      <p className="disclaimer-note muted">
        当前版本为 Donor Reputation Preview。贡献分数由前端根据可用数据计算，仅用于展示。
        它不会改变链上投票权重、治理权限或项目准入权限。
        未来如用于真实权限控制，需要合约层验证。
      </p>
    </>
  );
}

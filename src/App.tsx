import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { isAddress, parseEther, type Address } from "viem";
import {
  connectWallet,
  contributeToProject,
  createProject,
  getInitialCrowdfundingAddress,
  loadProjects,
  withdrawContribution,
  withdrawRaisedFunds,
} from "./contracts";
import type { CreateProjectInput, FundingProject, WalletSession } from "./types";
import {
  ProjectState,
  formatAddress,
  formatDeadline,
  formatEth,
  getFundingProgress,
  getLiveProjectState,
  getLiveRemainingTime,
  getProjectPhase,
  getReadableErrorMessage,
  normalizeAddress,
  parseDeadlineToUnixSeconds,
} from "./utils";

type View = "list" | "create" | "detail";

const defaultCreateForm = {
  title: "",
  description: "",
  goalEth: "10",
  minimumEth: "0.01",
  deadline: "",
};

function App() {
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [projects, setProjects] = useState<FundingProject[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [view, setView] = useState<View>("list");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createForm, setCreateForm] = useState(defaultCreateForm);
  const [contributionAmount, setContributionAmount] = useState("0.1");
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1_000),
  );
  const autoRefreshedDeadlinesRef = useRef(new Set<string>());
  const isAutoRefreshingRef = useRef(false);
  const crowdfundingAddress = getInitialCrowdfundingAddress();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1_000));
    }, 1_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    autoRefreshedDeadlinesRef.current.clear();
  }, [crowdfundingAddress]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMessage("");
    }, 2_800);

    return () => window.clearTimeout(timer);
  }, [message]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.address === selectedAddress) ?? null,
    [projects, selectedAddress],
  );

  const connectedAddress = wallet?.address;
  const hasValidContract = isAddress(crowdfundingAddress);

  useEffect(() => {
    if (!hasValidContract || isAutoRefreshingRef.current) {
      return;
    }

    const expiredProjects = projects.filter((project) => {
      const refreshKey = `${project.address}:${project.deadline.toString()}`;

      return (
        project.state === ProjectState.Fundraising &&
        project.deadline <= BigInt(nowSeconds) &&
        !autoRefreshedDeadlinesRef.current.has(refreshKey)
      );
    });

    if (expiredProjects.length === 0) {
      return;
    }

    for (const project of expiredProjects) {
      autoRefreshedDeadlinesRef.current.add(
        `${project.address}:${project.deadline.toString()}`,
      );
    }

    isAutoRefreshingRef.current = true;
    void refreshProjects(crowdfundingAddress as Address)
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "项目状态刷新失败");
      })
      .finally(() => {
        isAutoRefreshingRef.current = false;
      });
  }, [crowdfundingAddress, hasValidContract, nowSeconds, projects]);

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      await action();
      setMessage(successMessage);
      if (hasValidContract) {
        await refreshProjects(crowdfundingAddress as Address);
      }
    } catch (caught) {
      const actionErrorMessage = getReadableErrorMessage(
        caught,
        "操作失败，请重试",
      );
      setError(actionErrorMessage);
      if (hasValidContract) {
        try {
          await refreshProjects(crowdfundingAddress as Address);
        } catch (refreshCaught) {
          const refreshErrorMessage =
            refreshCaught instanceof Error
              ? refreshCaught.message
              : "项目状态刷新失败";
          setError(`${actionErrorMessage}；${refreshErrorMessage}`);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshProjects(address = crowdfundingAddress) {
    if (!isAddress(address)) {
      setProjects([]);
      return;
    }

    const loadedProjects = await loadProjects(address, connectedAddress);
    setProjects(loadedProjects);
  }

  async function handleConnect() {
    setLoading(true);
    setError("");

    try {
      const session = await connectWallet();
      setWallet(session);
      setMessage("钱包已连接");
      if (hasValidContract) {
        const loadedProjects = await loadProjects(
          crowdfundingAddress as Address,
          session.address,
        );
        setProjects(loadedProjects);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "连接钱包失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isAddress(crowdfundingAddress)) {
      setError("固定的 Crowdfunding 合约地址无效");
      return;
    }

    const input: CreateProjectInput = {
      title: createForm.title.trim(),
      description: createForm.description.trim(),
      goalEth: createForm.goalEth,
      minimumEth: createForm.minimumEth,
      deadlineUnixSeconds: parseDeadlineToUnixSeconds(createForm.deadline),
    };

    await runAction(async () => {
      await createProject(crowdfundingAddress as Address, input);
      setCreateForm(defaultCreateForm);
      setView("list");
    }, "项目已创建");
  }

  async function handleContribute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject || !isAddress(crowdfundingAddress)) {
      return;
    }

    await runAction(async () => {
      await contributeToProject(
        crowdfundingAddress as Address,
        selectedProject.address,
        contributionAmount,
      );
    }, "捐赠已提交");
  }

  function openProject(projectAddress: Address) {
    setSelectedAddress(projectAddress);
    setView("detail");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setView("list")}>
          <span className="brand-mark">M</span>
          <span>MyFundings</span>
        </button>
        <div className="wallet-box">
          {wallet ? (
            <>
              <span className="network-pill">Chain {wallet.chainId}</span>
              <span className="address-pill">{formatAddress(wallet.address)}</span>
            </>
          ) : (
            <button className="primary-button" type="button" onClick={handleConnect}>
              连接钱包
            </button>
          )}
        </div>
      </header>

      <ToastStack loading={loading} message={message} error={error} />

      {!wallet ? (
        <section className="login-panel">
          <div>
            <p className="eyebrow">Web3 Crowdfunding</p>
            <h1>连接钱包后管理链上众筹项目</h1>
            <p className="muted">
              创建项目、查看筹款进度、捐赠 ETH，并在截止日期后按合约结果提款或退款。
            </p>
          </div>
          <button className="primary-button large" type="button" onClick={handleConnect}>
            使用 MetaMask 登录
          </button>
        </section>
      ) : (
        <>
          {view === "list" && (
            <ProjectList
              projects={projects}
              canLoad={hasValidContract}
              nowSeconds={nowSeconds}
              onRefresh={() => runAction(() => refreshProjects(), "项目列表已刷新")}
              onCreate={() => setView("create")}
              onOpen={openProject}
            />
          )}

          {view === "create" && (
            <CreateProjectView
              form={createForm}
              loading={loading}
              onBack={() => setView("list")}
              onSubmit={handleCreateProject}
              onChange={(nextForm) => setCreateForm(nextForm)}
            />
          )}

          {view === "detail" && selectedProject && (
            <ProjectDetail
              account={wallet.address}
              contributionAmount={contributionAmount}
              loading={loading}
              nowSeconds={nowSeconds}
              project={selectedProject}
              onBack={() => setView("list")}
              onContributionAmountChange={setContributionAmount}
              onContribute={handleContribute}
              onWithdrawCreator={() =>
                runAction(
                  async () => {
                    await withdrawRaisedFunds(selectedProject.address);
                  },
                  "项目发起人提款已完成",
                )
              }
              onWithdrawContribution={() =>
                runAction(
                  async () => {
                    await withdrawContribution(selectedProject.address);
                  },
                  "退款已回收",
                )
              }
            />
          )}
        </>
      )}
    </main>
  );
}

export function ToastStack({
  loading,
  message,
  error,
}: {
  loading: boolean;
  message: string;
  error: string;
}) {
  if (!loading && !message && !error) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {loading && <span className="toast">交易或读取处理中...</span>}
      {message && <span className="toast success">{message}</span>}
      {error && <span className="toast error">{error}</span>}
    </div>
  );
}

export function ProjectList({
  projects,
  canLoad,
  nowSeconds,
  onRefresh,
  onCreate,
  onOpen,
}: {
  projects: FundingProject[];
  canLoad: boolean;
  nowSeconds: number;
  onRefresh: () => void;
  onCreate: () => void;
  onOpen: (address: Address) => void;
}) {
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>众筹项目</h2>
        </div>
        <div className="button-row">
          <button type="button" onClick={onRefresh} disabled={!canLoad}>
            刷新
          </button>
          <button className="primary-button" type="button" onClick={onCreate}>
            创建 Project
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">配置合约地址后读取项目，或创建第一个众筹项目。</div>
      ) : (
        <ul className="project-list">
          {projects.map((project) => {
            const liveRemainingTime = getLiveRemainingTime(
              project.deadline,
              nowSeconds,
            );
            const liveState = getLiveProjectState({
              state: project.state,
              deadline: project.deadline,
              raisedAmount: project.raisedAmount,
              targetContribution: project.targetContribution,
              nowSeconds,
            });

            return (
              <li className="project-row" key={project.address}>
                <button
                  className="project-row-button"
                  type="button"
                  onClick={() => onOpen(project.address)}
                >
                  <div className="project-row-title">
                    <h3>{project.title}</h3>
                    <p>{project.description || "暂无描述"}</p>
                  </div>
                  <div className="project-row-status">
                    <span className={`state-badge state-${liveState}`}>
                      {getProjectPhase(liveState, liveRemainingTime)}
                    </span>
                    <span className="muted">{formatDeadline(liveRemainingTime)}</span>
                  </div>
                  <div className="project-row-progress">
                    <ProgressBar project={project} />
                  </div>
                  <div className="project-row-meta">
                    <strong>{formatEth(project.raisedAmount)}</strong>
                    <span>{project.contributorCount.toString()} 位捐赠者</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CreateProjectView({
  form,
  loading,
  onBack,
  onSubmit,
  onChange,
}: {
  form: typeof defaultCreateForm;
  loading: boolean;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (form: typeof defaultCreateForm) => void;
}) {
  return (
    <section className="editor-layout">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Create</p>
          <h2>创建 Project</h2>
        </div>
        <button type="button" onClick={onBack}>
          返回列表
        </button>
      </div>

      <form className="project-form" onSubmit={onSubmit}>
        <label>
          项目名称
          <input
            required
            value={form.title}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
            placeholder="Education fund"
          />
        </label>
        <label>
          项目描述
          <textarea
            value={form.description}
            onChange={(event) =>
              onChange({ ...form, description: event.target.value })
            }
            placeholder="项目背景、资金用途和交付计划"
            rows={5}
          />
        </label>
        <div className="two-column">
          <label>
            筹款目标 ETH
            <input
              required
              min="0"
              step="0.0001"
              type="number"
              value={form.goalEth}
              onChange={(event) => onChange({ ...form, goalEth: event.target.value })}
            />
          </label>
          <label>
            最低捐赠 ETH
            <input
              required
              min="0"
              step="0.0001"
              type="number"
              value={form.minimumEth}
              onChange={(event) =>
                onChange({ ...form, minimumEth: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          截止日期
          <input
            required
            type="datetime-local"
            value={form.deadline}
            onChange={(event) => onChange({ ...form, deadline: event.target.value })}
          />
        </label>
        <button className="primary-button" type="submit" disabled={loading}>
          提交到链上
        </button>
      </form>
    </section>
  );
}

export function ProjectDetail({
  account,
  contributionAmount,
  loading,
  nowSeconds,
  project,
  onBack,
  onContributionAmountChange,
  onContribute,
  onWithdrawCreator,
  onWithdrawContribution,
}: {
  account: Address;
  contributionAmount: string;
  loading: boolean;
  nowSeconds: number;
  project: FundingProject;
  onBack: () => void;
  onContributionAmountChange: (value: string) => void;
  onContribute: (event: FormEvent<HTMLFormElement>) => void;
  onWithdrawCreator: () => void;
  onWithdrawContribution: () => void;
}) {
  const isCreator = normalizeAddress(account) === normalizeAddress(project.creator);
  const liveRemainingTime = getLiveRemainingTime(project.deadline, nowSeconds);
  const liveState = getLiveProjectState({
    state: project.state,
    deadline: project.deadline,
    raisedAmount: project.raisedAmount,
    targetContribution: project.targetContribution,
    nowSeconds,
  });
  const isFundraising =
    liveState === ProjectState.Fundraising && liveRemainingTime > 0n;
  const canCreatorWithdraw =
    liveState === ProjectState.Successful &&
    isCreator &&
    !project.creatorWithdrawn &&
    project.balance > 0n;
  const canRefund =
    liveState === ProjectState.Expired && project.userContribution > 0n;
  const parsedContributionAmount = parseContributionAmount(contributionAmount);
  const contributionValidationMessage = getContributionValidationMessage({
    isCreator,
    minimumContribution: project.minimumContribution,
    parsedContributionAmount,
  });
  const canSubmitContribution = !loading && !contributionValidationMessage;

  function handleContributionSubmit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmitContribution) {
      event.preventDefault();
      return;
    }

    onContribute(event);
  }

  return (
    <section className="detail-layout">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Detail</p>
          <h2>{project.title}</h2>
        </div>
        <button type="button" onClick={onBack}>
          返回列表
        </button>
      </div>

      <div className="detail-grid">
        <article className="detail-main">
          <div className="card-topline">
            <span className={`state-badge state-${liveState}`}>
              {getProjectPhase(liveState, liveRemainingTime)}
            </span>
            <span>{formatDeadline(liveRemainingTime)}</span>
          </div>
          <p className="description">{project.description || "暂无描述"}</p>
          <ProgressBar project={project} />
          <dl className="stats-grid">
            <div>
              <dt>目标金额</dt>
              <dd>{formatEth(project.targetContribution)}</dd>
            </div>
            <div>
              <dt>已筹金额</dt>
              <dd>{formatEth(project.raisedAmount)}</dd>
            </div>
            <div>
              <dt>最低捐赠</dt>
              <dd>{formatEth(project.minimumContribution)}</dd>
            </div>
            <div>
              <dt>项目余额</dt>
              <dd>{formatEth(project.balance)}</dd>
            </div>
          </dl>
          <div className="address-list">
            <span>项目地址 {formatAddress(project.address)}</span>
            <span>发起人 {formatAddress(project.creator)}</span>
          </div>
        </article>

        <aside className="action-panel">
          {isFundraising ? (
            <form onSubmit={handleContributionSubmit}>
              <label>
                捐赠金额 ETH
                <input
                  min="0"
                  step="0.0001"
                  type="number"
                  value={contributionAmount}
                  onChange={(event) =>
                    onContributionAmountChange(event.target.value)
                  }
                />
              </label>
              {contributionValidationMessage && (
                <p className="form-hint error">{contributionValidationMessage}</p>
              )}
              <button
                className="primary-button"
                type="submit"
                disabled={!canSubmitContribution}
              >
                捐赠
              </button>
            </form>
          ) : (
            <div className="withdraw-box">
              <h3>筹款已结束</h3>
              {liveState === ProjectState.Successful && (
                <>
                  <p>项目已达成目标，发起人可提取合约余额。</p>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!canCreatorWithdraw || loading}
                    onClick={onWithdrawCreator}
                  >
                    发起人提款
                  </button>
                </>
              )}
              {liveState === ProjectState.Expired && (
                <>
                  <p>项目未达成目标，捐赠者可回收自己的捐赠。</p>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!canRefund || loading}
                    onClick={onWithdrawContribution}
                  >
                    回收捐赠
                  </button>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      <section className="contributors">
        <div className="section-heading compact">
          <h3>捐赠者列表</h3>
          <span>{project.contributors.length} 条记录</span>
        </div>
        {project.contributors.length === 0 ? (
          <div className="empty-state">暂无捐赠记录。</div>
        ) : (
          <div className="table-list">
            {project.contributors.map((row) => (
              <div className="table-row" key={row.contributor}>
                <span>{formatAddress(row.contributor)}</span>
                <strong>{formatEth(row.amount)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function parseContributionAmount(value: string) {
  try {
    return parseEther(value);
  } catch {
    return null;
  }
}

function getContributionValidationMessage({
  isCreator,
  minimumContribution,
  parsedContributionAmount,
}: {
  isCreator: boolean;
  minimumContribution: bigint;
  parsedContributionAmount: bigint | null;
}) {
  if (isCreator) {
    return "项目发起者不能给自己的项目捐赠";
  }

  if (parsedContributionAmount === null || parsedContributionAmount <= 0n) {
    return "请输入有效的捐赠金额";
  }

  if (parsedContributionAmount < minimumContribution) {
    return `最低捐赠金额为 ${formatEth(minimumContribution)}`;
  }

  return "";
}

function ProgressBar({ project }: { project: FundingProject }) {
  const progress = getFundingProgress(
    project.raisedAmount,
    project.targetContribution,
  );

  return (
    <div className="progress-wrap" aria-label={`筹款进度 ${progress}%`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span>{progress}%</span>
    </div>
  );
}

export default App;

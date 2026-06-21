import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { isAddress, parseEther, type Address } from "viem";
import {
  approveMilestone,
  connectWallet,
  contributeToProject,
  createProject,
  getInitialCrowdfundingAddress,
  loadAccountBalance,
  loadProjects,
  releaseMilestoneFunds,
  submitMilestone,
  withdrawContribution,
  withdrawRaisedFunds,
} from "./contracts";
import { deriveProfileSummary, type ProfileSummary } from "./profile";
import {
  FundingModel,
  type CreateProjectInput,
  type FundingProject,
  type WalletSession,
} from "./types";
import {
  ProjectState,
  formatAddress,
  formatDeadline,
  formatEth,
  getFundingModelLabel,
  getFundingProgress,
  getLiveProjectState,
  getLiveRemainingTime,
  getMilestoneApprovalProgress,
  getMilestoneFormError,
  getProjectPhase,
  getReadableErrorMessage,
  normalizeAddress,
  parseDeadlineToUnixSeconds,
} from "./utils";

const TOAST_AUTO_DISMISS_MS = 2_800;

const defaultCreateForm = {
  title: "",
  description: "",
  goalEth: "10",
  minimumEth: "0.01",
  deadline: "",
  fundingModel: FundingModel.AllOrNothing,
  milestones: [
    { title: "Prototype", percentage: "25" },
    { title: "Launch", percentage: "75" },
  ],
};

export type AppContext = {
  wallet: WalletSession;
  walletBalance: bigint | null;
  projects: FundingProject[];
  loading: boolean;
  nowSeconds: number;
  contributionAmount: string;
  setContributionAmount: (value: string) => void;
  createForm: typeof defaultCreateForm;
  setCreateForm: (form: typeof defaultCreateForm) => void;
  crowdfundingAddress: string;
  refreshProjects: (address?: string) => Promise<void>;
  runAction: (
    action: () => Promise<void>,
    successMessage: string,
  ) => Promise<void>;
  submitCreateProject: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  submitContribution: (
    event: FormEvent<HTMLFormElement>,
    project: FundingProject,
  ) => Promise<void>;
};

export function useAppContext(): AppContext {
  return useOutletContext<AppContext>();
}

function AppLayout() {
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [projects, setProjects] = useState<FundingProject[]>([]);
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
    }, TOAST_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timer);
  }, [message]);

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
    } catch (caught) {
      setError(getReadableErrorMessage(caught, "操作失败，请重试"));
    } finally {
      if (hasValidContract) {
        try {
          await refreshProjects(crowdfundingAddress as Address);
        } catch {
          // 刷新失败不覆盖操作结果
        }
      }
      setLoading(false);
    }
  }

  async function refreshProjects(address: string = crowdfundingAddress) {
    if (!isAddress(address)) {
      setProjects([]);
      return;
    }

    const loadedProjects = await loadProjects(address, connectedAddress);
    setProjects(loadedProjects);
    await refreshWalletBalance(connectedAddress);
  }

  async function refreshWalletBalance(account?: Address) {
    if (!account) {
      setWalletBalance(null);
      return;
    }

    try {
      setWalletBalance(await loadAccountBalance(account));
    } catch {
      // 余额读取失败不阻断主流程
    }
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
      await refreshWalletBalance(session.address);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "连接钱包失败");
    } finally {
      setLoading(false);
    }
  }

  async function submitCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isAddress(crowdfundingAddress)) {
      setError("固定的 Crowdfunding 合约地址无效");
      return;
    }

    const milestones = createForm.milestones.map((milestone) => ({
      title: milestone.title.trim(),
      releaseBps: Math.round(Number(milestone.percentage) * 100),
    }));

    if (createForm.fundingModel === FundingModel.Milestone) {
      const milestoneError = getMilestoneFormError(milestones);

      if (milestoneError) {
        setError(milestoneError);
        return;
      }
    }

    const input: CreateProjectInput = {
      title: createForm.title.trim(),
      description: createForm.description.trim(),
      goalEth: createForm.goalEth,
      minimumEth: createForm.minimumEth,
      deadlineUnixSeconds: parseDeadlineToUnixSeconds(createForm.deadline),
      fundingModel: createForm.fundingModel,
      milestones:
        createForm.fundingModel === FundingModel.Milestone ? milestones : [],
    };

    await runAction(async () => {
      await createProject(crowdfundingAddress as Address, input);
      setCreateForm(defaultCreateForm);
      navigate("/");
    }, "项目已创建");
  }

  async function submitContribution(
    event: FormEvent<HTMLFormElement>,
    project: FundingProject,
  ) {
    event.preventDefault();
    if (!isAddress(crowdfundingAddress)) {
      return;
    }
    await runAction(async () => {
      await contributeToProject(
        crowdfundingAddress as Address,
        project.address,
        contributionAmount,
      );
    }, "捐赠已提交");
  }

  const ctx: AppContext = {
    wallet: wallet as WalletSession,
    walletBalance,
    projects,
    loading,
    nowSeconds,
    contributionAmount,
    setContributionAmount,
    createForm,
    setCreateForm,
    crowdfundingAddress,
    refreshProjects,
    runAction,
    submitCreateProject,
    submitContribution,
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          <span className="brand-mark">M</span>
          <span>MyFundings</span>
        </button>
        <div className="wallet-box">
          {wallet ? (
            <>
              <span className="network-pill">Chain {wallet.chainId}</span>
              <Link className="address-pill" to={`/profile/${wallet.address}`}>
                {formatAddress(wallet.address)}
              </Link>
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
        <Outlet context={ctx} />
      )}
    </main>
  );
}

function ProjectListRoute() {
  const ctx = useAppContext();
  const navigate = useNavigate();

  return (
    <ProjectList
      projects={ctx.projects}
      canLoad={isAddress(ctx.crowdfundingAddress)}
      nowSeconds={ctx.nowSeconds}
      onRefresh={() => ctx.runAction(() => ctx.refreshProjects(), "项目列表已刷新")}
      onCreate={() => navigate("/create")}
      onOpen={(address) => navigate(`/project/${address}`)}
    />
  );
}

function CreateProjectRoute() {
  const ctx = useAppContext();
  const navigate = useNavigate();

  return (
    <CreateProjectView
      form={ctx.createForm}
      loading={ctx.loading}
      onBack={() => navigate("/")}
      onSubmit={ctx.submitCreateProject}
      onChange={ctx.setCreateForm}
    />
  );
}

function ProjectDetailRoute() {
  const ctx = useAppContext();
  const navigate = useNavigate();
  const { address } = useParams();
  const project = ctx.projects.find(
    (item) => normalizeAddress(item.address) === normalizeAddress(address ?? ""),
  );

  if (!project) {
    return (
      <section className="content-section">
        <div className="section-heading">
          <h2>未找到项目</h2>
          <button type="button" onClick={() => navigate("/")}>
            返回列表
          </button>
        </div>
        <div className="empty-state">未找到该项目，请返回列表刷新后重试。</div>
      </section>
    );
  }

  return (
    <ProjectDetail
      account={ctx.wallet.address}
      contributionAmount={ctx.contributionAmount}
      loading={ctx.loading}
      nowSeconds={ctx.nowSeconds}
      project={project}
      onBack={() => navigate("/")}
      onContributionAmountChange={ctx.setContributionAmount}
      onContribute={(event) => ctx.submitContribution(event, project)}
      onWithdrawCreator={() =>
        ctx.runAction(async () => {
          await withdrawRaisedFunds(project.address);
        }, "项目发起人提款已完成")
      }
      onWithdrawContribution={() =>
        ctx.runAction(async () => {
          await withdrawContribution(project.address);
        }, "退款已回收")
      }
      onSubmitMilestone={(milestoneIndex, evidenceUri) =>
        ctx.runAction(async () => {
          await submitMilestone(project.address, milestoneIndex, evidenceUri);
        }, "里程碑成果已提交")
      }
      onApproveMilestone={(milestoneIndex) =>
        ctx.runAction(async () => {
          await approveMilestone(project.address, milestoneIndex);
        }, "里程碑验证已提交")
      }
      onReleaseMilestone={(milestoneIndex) =>
        ctx.runAction(async () => {
          await releaseMilestoneFunds(project.address, milestoneIndex);
        }, "里程碑资金已释放")
      }
      onOpenProfile={(target) => navigate(`/profile/${target}`)}
    />
  );
}

function ProfileRoute() {
  const ctx = useAppContext();
  const navigate = useNavigate();
  const { address } = useParams();
  const profileAddress = (address ?? "") as Address;
  const summary = useMemo(
    () => deriveProfileSummary(ctx.projects, profileAddress, ctx.nowSeconds),
    [ctx.projects, profileAddress, ctx.nowSeconds],
  );
  const isSelf =
    normalizeAddress(ctx.wallet.address) === normalizeAddress(profileAddress);

  return (
    <Profile
      address={profileAddress}
      isSelf={isSelf}
      summary={summary}
      nowSeconds={ctx.nowSeconds}
      balance={isSelf ? ctx.walletBalance : null}
      onBack={() => navigate("/")}
      onOpenProject={(target) => navigate(`/project/${target}`)}
    />
  );
}

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ProjectListRoute />} />
        <Route path="create" element={<CreateProjectRoute />} />
        <Route path="project/:address" element={<ProjectDetailRoute />} />
        <Route path="profile/:address" element={<ProfileRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
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
                    <span className="muted">
                      {getFundingModelLabel(project.fundingModel)}
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
        <fieldset className="mode-fieldset">
          <legend>资金释放方式</legend>
          <label className="radio-row">
            <input
              checked={form.fundingModel === FundingModel.AllOrNothing}
              type="radio"
              name="fundingModel"
              onChange={() =>
                onChange({ ...form, fundingModel: FundingModel.AllOrNothing })
              }
            />
            <span>All or nothing，到期达标后一次性提款</span>
          </label>
          <label className="radio-row">
            <input
              checked={form.fundingModel === FundingModel.Milestone}
              type="radio"
              name="fundingModel"
              onChange={() =>
                onChange({ ...form, fundingModel: FundingModel.Milestone })
              }
            />
            <span>里程碑释放，捐赠者验证后分阶段提款</span>
          </label>
        </fieldset>

        {form.fundingModel === FundingModel.Milestone && (
          <div className="milestone-editor">
            <div className="section-heading compact">
              <h3>里程碑</h3>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...form,
                    milestones: [
                      ...form.milestones,
                      { title: "", percentage: "10" },
                    ],
                  })
                }
              >
                添加阶段
              </button>
            </div>
            {form.milestones.map((milestone, index) => (
              <div className="milestone-form-row" key={index}>
                <label>
                  阶段名称
                  <input
                    required
                    value={milestone.title}
                    onChange={(event) => {
                      const milestones = [...form.milestones];
                      milestones[index] = {
                        ...milestone,
                        title: event.target.value,
                      };
                      onChange({ ...form, milestones });
                    }}
                  />
                </label>
                <label>
                  释放比例 %
                  <input
                    required
                    min="0.01"
                    step="0.01"
                    type="number"
                    value={milestone.percentage}
                    onChange={(event) => {
                      const milestones = [...form.milestones];
                      milestones[index] = {
                        ...milestone,
                        percentage: event.target.value,
                      };
                      onChange({ ...form, milestones });
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={form.milestones.length === 1}
                  onClick={() =>
                    onChange({
                      ...form,
                      milestones: form.milestones.filter(
                        (_, milestoneIndex) => milestoneIndex !== index,
                      ),
                    })
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
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
  onSubmitMilestone,
  onApproveMilestone,
  onReleaseMilestone,
  onOpenProfile,
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
  onSubmitMilestone: (milestoneIndex: number, evidenceUri: string) => void;
  onApproveMilestone: (milestoneIndex: number) => void;
  onReleaseMilestone: (milestoneIndex: number) => void;
  onOpenProfile?: (address: Address) => void;
}) {
  const [evidenceUri, setEvidenceUri] = useState("");
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
    project.fundingModel === FundingModel.AllOrNothing &&
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
  const activeMilestone = project.milestones.find(
    (milestone) => BigInt(milestone.index) === project.nextMilestoneIndex,
  );
  const canUseMilestones =
    project.fundingModel === FundingModel.Milestone &&
    liveState === ProjectState.Successful;

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
            <button
              type="button"
              className="link-button"
              onClick={() => onOpenProfile?.(project.creator)}
            >
              发起人 {formatAddress(project.creator)}
            </button>
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
                  <p>
                    {project.fundingModel === FundingModel.Milestone
                      ? "项目已达成目标，资金将按里程碑验证结果释放。"
                      : "项目已达成目标，发起人可提取合约余额。"}
                  </p>
                  {project.fundingModel === FundingModel.AllOrNothing && (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!canCreatorWithdraw || loading}
                      onClick={onWithdrawCreator}
                    >
                      发起人提款
                    </button>
                  )}
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

      {project.fundingModel === FundingModel.Milestone && (
        <section className="contributors">
          <div className="section-heading compact">
            <h3>里程碑释放</h3>
            <span>
              已释放 {formatEth(project.totalReleasedAmount)} /{" "}
              {formatEth(project.raisedAmount)}
            </span>
          </div>

          {canUseMilestones &&
            activeMilestone &&
            isCreator &&
            !activeMilestone.submitted && (
              <form
                className="milestone-submit"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (evidenceUri.trim()) {
                    onSubmitMilestone(activeMilestone.index, evidenceUri.trim());
                    setEvidenceUri("");
                  }
                }}
              >
                <label>
                  当前阶段成果链接
                  <input
                    required
                    value={evidenceUri}
                    onChange={(event) => setEvidenceUri(event.target.value)}
                    placeholder="ipfs://... 或 https://..."
                  />
                </label>
                <button className="primary-button" type="submit" disabled={loading}>
                  提交成果
                </button>
              </form>
            )}

          <div className="milestone-list">
            {project.milestones.map((milestone) => {
              const approvalProgress = getMilestoneApprovalProgress(
                milestone.approvalWeight,
                project.raisedAmount,
              );
              const isActive =
                BigInt(milestone.index) === project.nextMilestoneIndex;
              const canApprove =
                canUseMilestones &&
                isActive &&
                milestone.submitted &&
                !milestone.released &&
                project.userContribution > 0n &&
                !milestone.approved;
              const canRelease =
                canUseMilestones &&
                isActive &&
                milestone.submitted &&
                !milestone.released &&
                approvalProgress >= 100;

              return (
                <article className="milestone-row" key={milestone.index}>
                  <div>
                    <strong>{milestone.title}</strong>
                    <span>{milestone.releaseBps / 100}%</span>
                  </div>
                  <p>
                    {milestone.released
                      ? `已释放 ${formatEth(milestone.releasedAmount)}`
                      : milestone.submitted
                        ? `验证进度 ${approvalProgress}%`
                        : "等待提交成果"}
                  </p>
                  {milestone.evidenceUri && (
                    <a href={milestone.evidenceUri} target="_blank" rel="noreferrer">
                      查看成果
                    </a>
                  )}
                  <div className="button-row">
                    <button
                      type="button"
                      disabled={!canApprove || loading}
                      onClick={() => onApproveMilestone(milestone.index)}
                    >
                      验证
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!canRelease || loading}
                      onClick={() => onReleaseMilestone(milestone.index)}
                    >
                      释放资金
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

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
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpenProfile?.(row.contributor)}
                >
                  {formatAddress(row.contributor)}
                </button>
                <strong>{formatEth(row.amount)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

export function Profile({
  address,
  isSelf,
  summary,
  nowSeconds,
  balance,
  onBack,
  onOpenProject,
}: {
  address: Address;
  isSelf: boolean;
  summary: ProfileSummary;
  nowSeconds: number;
  balance?: bigint | null;
  onBack: () => void;
  onOpenProject: (address: Address) => void;
}) {
  return (
    <section className="detail-layout">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Profile</p>
          <h2>
            {formatAddress(address)}
            {isSelf && <span className="self-badge">我的资料</span>}
          </h2>
        </div>
        <button type="button" onClick={onBack}>
          返回列表
        </button>
      </div>

      <dl className="stats-grid">
        {balance != null && (
          <div>
            <dt>钱包余额</dt>
            <dd>{formatEth(balance)}</dd>
          </div>
        )}
        <div>
          <dt>累计捐赠</dt>
          <dd>{formatEth(summary.cumulativeDonation)}</dd>
        </div>
        <div>
          <dt>支持项目数</dt>
          <dd>{summary.supportedCount}</dd>
        </div>
        <div>
          <dt>成功支持项目</dt>
          <dd>{summary.successfulCount}</dd>
        </div>
      </dl>

      <section className="content-section">
        <div className="section-heading compact">
          <h3>支持的项目</h3>
          <span>{summary.supportedProjects.length} 个</span>
        </div>
        {summary.supportedProjects.length === 0 ? (
          <div className="empty-state">暂无支持的项目。</div>
        ) : (
          <ul className="project-list">
            {summary.supportedProjects.map(({ project, amount }) => (
              <ProfileProjectRow
                key={`s-${project.address}`}
                project={project}
                nowSeconds={nowSeconds}
                trailing={`捐赠 ${formatEth(amount)}`}
                onOpen={onOpenProject}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="content-section">
        <div className="section-heading compact">
          <h3>发起的项目</h3>
          <span>{summary.createdProjects.length} 个</span>
        </div>
        {summary.createdProjects.length === 0 ? (
          <div className="empty-state">暂无发起的项目。</div>
        ) : (
          <ul className="project-list">
            {summary.createdProjects.map((project) => (
              <ProfileProjectRow
                key={`c-${project.address}`}
                project={project}
                nowSeconds={nowSeconds}
                trailing={`已筹 ${formatEth(project.raisedAmount)}`}
                onOpen={onOpenProject}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function ProfileProjectRow({
  project,
  nowSeconds,
  trailing,
  onOpen,
}: {
  project: FundingProject;
  nowSeconds: number;
  trailing: string;
  onOpen: (address: Address) => void;
}) {
  const liveRemainingTime = getLiveRemainingTime(project.deadline, nowSeconds);
  const liveState = getLiveProjectState({
    state: project.state,
    deadline: project.deadline,
    raisedAmount: project.raisedAmount,
    targetContribution: project.targetContribution,
    nowSeconds,
  });

  return (
    <li className="project-row">
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
          <span className="muted">{getFundingModelLabel(project.fundingModel)}</span>
        </div>
        <div className="project-row-meta">
          <strong>{trailing}</strong>
        </div>
      </button>
    </li>
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

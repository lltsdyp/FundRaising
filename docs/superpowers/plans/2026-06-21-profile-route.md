# Profile Route + Router Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `react-router-dom`,把现有 view 状态机改成真实路由,并新增 `/profile/:address` 个人资料页(累计捐赠、支持/成功支持项目数、支持项目列表、发起项目列表)。

**Architecture:** `AppLayout` 根布局组件持有共享状态(wallet/projects/loading/contributionAmount/createForm)、顶栏、Toast、到期自动刷新,并通过 React Router `useOutletContext` 把状态与动作下发给各路由页面。现有 `ProjectList`/`CreateProjectView`/`ProjectDetail` 保持为 prop 驱动的纯展示组件(不依赖 Router,导航走回调 prop),保证既有组件测试不破。新增纯函数 `src/profile.ts` 从已加载的 `FundingProject[]` 客户端派生个人资料数据,不新增任何合约读调用。

**Tech Stack:** React 19, react-router-dom v7, viem, Vite, Vitest + jsdom。

## Global Constraints

- 包管理:`npm`(仓库有 `package-lock.json`)。
- React 版本:19.x;新依赖 `react-router-dom` 用 `^7`(支持 React 19)。
- 验收命令必须全过:`npm run lint`、`npm run build`(= `tsc -p tsconfig.app.json --noEmit && vite build`)、`npm run test`(= `vitest run`)。
- 地址比较一律用 `normalizeAddress`(来自 `src/utils.ts`,小写化)。
- 金额展示用 `formatEth`,地址展示用 `formatAddress`(均来自 `src/utils.ts`)。
- 纯展示组件(`ProjectList`/`CreateProjectView`/`ProjectDetail`/`Profile`)**不得**直接引用 `Link`/`useNavigate`/`useParams`,导航一律通过回调 prop,以便在无 Router 的单测中渲染。
- 累计捐赠口径:从每个项目的 `contributors: {contributor, amount}[]` 中匹配地址求和(当前链上额,不含已退款)。
- 成功支持口径:`getLiveProjectState(...)` 结果为 `ProjectState.Successful`(已涵盖"已达标的进行中项目")。
- 所有路由受钱包登录保护:未连接钱包时 `AppLayout` 统一渲染登录引导页。

---

## File Structure

- `package.json` — 新增 `react-router-dom` 依赖。
- `src/main.tsx` — 用 `<BrowserRouter>` 包裹 `<App/>`。
- `src/App.tsx` — 默认导出改为 `<Routes>`;新增 `AppLayout`(根布局 + 共享状态)、`ProjectListRoute`/`CreateProjectRoute`/`ProjectDetailRoute`/`ProfileRoute`(路由包装器);导出 `AppContext` 类型与 `useAppContext` hook;保留 `ProjectList`/`CreateProjectView`/`ProjectDetail`/`ToastStack` 纯展示组件签名(`ProjectDetail` 新增可选 `onOpenProfile`);新增 `Profile` 纯展示组件。
- `src/profile.ts` — 新增 `deriveProfileSummary` 纯函数与相关类型。
- `src/profile.test.ts` — `deriveProfileSummary` 单测。
- `src/App.test.tsx` — 新增 `Profile` 渲染测试(既有用例不改)。
- `src/styles.css` — 按需补少量 profile 样式 class。

---

## Task 1: 安装 react-router-dom 并搭好 Router 外壳与既有页面路由

把现有 `view` 状态机重构为路由。完成后 `/`、`/create`、`/project/:address` 三个页面功能与现状一致,只是改由 URL 驱动。

**Files:**
- Modify: `package.json`(deps 增加 `react-router-dom`)
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`(既有用例必须继续通过,本任务不改它)

**Interfaces:**
- Produces:
  - `type AppContext`(`src/App.tsx` 导出):
    ```ts
    export type AppContext = {
      wallet: WalletSession;
      projects: FundingProject[];
      loading: boolean;
      nowSeconds: number;
      contributionAmount: string;
      setContributionAmount: (value: string) => void;
      createForm: typeof defaultCreateForm;
      setCreateForm: (form: typeof defaultCreateForm) => void;
      crowdfundingAddress: string;
      refreshProjects: (address?: string) => Promise<void>;
      runAction: (action: () => Promise<void>, successMessage: string) => Promise<void>;
      submitCreateProject: (event: FormEvent<HTMLFormElement>) => Promise<void>;
      submitContribution: (event: FormEvent<HTMLFormElement>, project: FundingProject) => Promise<void>;
    };
    export function useAppContext(): AppContext; // = useOutletContext<AppContext>()
    ```
  - `ProjectDetail` 新增可选 prop `onOpenProfile?: (address: Address) => void`(本任务先加进类型与签名,Task 3 接线)。
- Consumes: 既有 `src/contracts.ts`、`src/types.ts`、`src/utils.ts` 导出(不变)。

- [ ] **Step 1: 安装依赖**

Run:
```bash
npm install react-router-dom@^7
```
Expected: `package.json` 的 `dependencies` 出现 `react-router-dom`,`package-lock.json` 更新,无报错。

- [ ] **Step 2: 在 `src/main.tsx` 包裹 BrowserRouter**

把 `src/main.tsx` 改为:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: 重构 `src/App.tsx` —— 把状态机改成 AppLayout + 路由包装器**

在 `src/App.tsx` 顶部 import 增加 react-router 相关项,删除 `View` 类型与 `view`/`selectedAddress` 状态。整体改动如下,逐处替换:

3a. import 区(替换原 `import { useEffect, ... } from "react";` 与新增 router import):
```tsx
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
```
保留原有 `viem`、`./contracts`、`./types`、`./utils` 的 import 不变。(`Link` 在 Task 3 接线顶栏入口时再加入这个 import 列表——Task 1 不用它,提前 import 会触发 unused lint。)

3b. 在 `defaultCreateForm` 定义之后,新增导出的 context 类型与 hook:
```tsx
export type AppContext = {
  wallet: WalletSession;
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
```

3c. 删除原 `function App() { ... }`(整段,第 54 行到其 `return ... }` 结束),改为:把原 `App` 函数体几乎原样搬进新的 `AppLayout` 组件,但做以下修改:
- 删除 `view`、`selectedAddress` 两个 useState,以及 `selectedProject` useMemo、`openProject` 函数。
- 顶部新增 `const navigate = useNavigate();`
- `handleConnect`、`runAction`、`refreshProjects`、`handleCreateProject`、`handleContribute`、到期自动刷新 useEffect、计时器 useEffect、message 自动清除 useEffect 全部保留。
- `handleCreateProject` 内 `setView("list")` 改为 `navigate("/")`。
- `handleContribute` 改签名为 `submitContribution(event, project)`,内部用传入的 `project` 取代 `selectedProject`(因为 detail 页才知道当前项目):
  ```tsx
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
  ```
- `handleCreateProject` 改名为 `submitCreateProject`(签名不变)。
- return 部分:顶栏 + Toast + (登录页 或 `<Outlet context={ctx}/>`),其中 `ctx` 为满足 `AppContext` 的对象。顶栏钱包胶囊本任务先保持为纯文本(Task 3 再加 Link)。具体 return:
  ```tsx
  const ctx: AppContext = {
    wallet: wallet as WalletSession,
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
              创建项目、查看筹款进度、捐赠 ETH,并在截止日期后按合约结果提款或退款。
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
  ```
  注意:`runAction`/`refreshProjects` 内已有的 `crowdfundingAddress`/`connectedAddress` 引用保持不变。

3d. 在 `AppLayout` 之后,新增四个路由包装器组件:
```tsx
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
        <div className="empty-state">未找到该项目,请返回列表刷新后重试。</div>
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
    />
  );
}
```
(`ProfileRoute` 在 Task 3 新增。)

3e. 新增默认导出 `App`,定义路由表:
```tsx
function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ProjectListRoute />} />
        <Route path="create" element={<CreateProjectRoute />} />
        <Route path="project/:address" element={<ProjectDetailRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
```
保留文件末尾 `export default App;`。

3f. `ProjectDetail` 组件 props 类型新增一行可选项(Task 3 才真正传值与使用):
```tsx
  onOpenProfile?: (address: Address) => void;
```
加在 `ProjectDetail` 的 props 解构与类型定义里(解构处写 `onOpenProfile,`)。本任务不在 JSX 中使用它——为避免 lint 报"未使用",**本步先不解构**,只在类型里加可选字段;Task 3 再解构使用。即:仅修改类型定义,不动解构。

- [ ] **Step 4: 编译与类型检查**

Run:
```bash
npm run build
```
Expected: PASS(`tsc --noEmit` 无错误,`vite build` 成功)。若报 `ProjectList`/`CreateProjectView`/`ProjectDetail` 未定义,确认这些纯展示组件仍在文件内(本任务不应删除它们)。

- [ ] **Step 5: 跑既有测试,确认纯展示组件未被破坏**

Run:
```bash
npm run test
```
Expected: PASS(`src/App.test.tsx` 既有 8 个用例全过——它们直接渲染 `ProjectList`/`ProjectDetail`/`ToastStack`,不经过 Router)。

- [ ] **Step 6: Lint**

Run:
```bash
npm run lint
```
Expected: PASS(无 error)。

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/App.tsx
git commit -m "refactor: replace view state machine with react-router routes"
```

---

## Task 2: `deriveProfileSummary` 个人资料派生纯函数(TDD)

**Files:**
- Create: `src/profile.ts`
- Test: `src/profile.test.ts`

**Interfaces:**
- Consumes: `FundingProject`(`src/types.ts`)、`ProjectState`/`getLiveProjectState`/`normalizeAddress`(`src/utils.ts`)。
- Produces:
  ```ts
  export type SupportedProject = { project: FundingProject; amount: bigint };
  export type ProfileSummary = {
    cumulativeDonation: bigint;
    supportedProjects: SupportedProject[];
    supportedCount: number;
    successfulCount: number;
    createdProjects: FundingProject[];
  };
  export function deriveProfileSummary(
    projects: FundingProject[],
    address: string,
    nowSeconds: number,
  ): ProfileSummary;
  ```

- [ ] **Step 1: 写失败测试 `src/profile.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { deriveProfileSummary } from "./profile";
import { FundingModel, type FundingProject } from "./types";
import { ProjectState } from "./utils";

const ADDR_A = "0xAAaAAaAAaAaaAaaAaaaaAaAaaAAAaAaaAAaaAAa1";
const ADDR_B = "0xBbbbBBbbBbbBbBBbBbBbBBbbbbBbBbBBBbBbBbB2";
const CREATOR = "0xccCCccccCCCCcCCCCCCcCcCcCcCCCCcCcccccCCc3";

function makeProject(overrides: Partial<FundingProject>): FundingProject {
  return {
    address: "0x0000000000000000000000000000000000000001",
    creator: CREATOR,
    minimumContribution: 0n,
    deadline: 1_000n,
    targetContribution: 10n,
    raisedAmount: 0n,
    contributorCount: 0n,
    title: "P",
    description: "",
    state: ProjectState.Fundraising,
    balance: 0n,
    remainingTime: 0n,
    contributors: [],
    userContribution: 0n,
    creatorWithdrawn: false,
    fundingModel: FundingModel.AllOrNothing,
    nextMilestoneIndex: 0n,
    totalReleasedAmount: 0n,
    milestones: [],
    ...overrides,
  };
}

describe("deriveProfileSummary", () => {
  it("sums current on-chain contributions for the address across projects", () => {
    const projects = [
      makeProject({
        address: "0x0000000000000000000000000000000000000010",
        contributors: [
          { contributor: ADDR_A, amount: 3n },
          { contributor: ADDR_B, amount: 7n },
        ],
      }),
      makeProject({
        address: "0x0000000000000000000000000000000000000011",
        contributors: [{ contributor: ADDR_A, amount: 5n }],
      }),
    ];

    const summary = deriveProfileSummary(projects, ADDR_A, 0);

    expect(summary.cumulativeDonation).toBe(8n);
    expect(summary.supportedCount).toBe(2);
    expect(summary.supportedProjects.map((row) => row.amount)).toEqual([3n, 5n]);
  });

  it("matches addresses case-insensitively and ignores zero contributions", () => {
    const projects = [
      makeProject({
        contributors: [
          { contributor: ADDR_A.toLowerCase(), amount: 4n },
          { contributor: ADDR_B, amount: 0n },
        ],
      }),
    ];

    const summaryA = deriveProfileSummary(projects, ADDR_A.toUpperCase(), 0);
    const summaryB = deriveProfileSummary(projects, ADDR_B, 0);

    expect(summaryA.supportedCount).toBe(1);
    expect(summaryA.cumulativeDonation).toBe(4n);
    expect(summaryB.supportedCount).toBe(0);
  });

  it("counts successful supported projects including live met-goal projects", () => {
    const projects = [
      makeProject({
        // 已结算成功
        state: ProjectState.Successful,
        contributors: [{ contributor: ADDR_A, amount: 10n }],
      }),
      makeProject({
        // 进行中但到期且已达标 -> live 状态 Successful
        state: ProjectState.Fundraising,
        deadline: 100n,
        raisedAmount: 10n,
        targetContribution: 10n,
        contributors: [{ contributor: ADDR_A, amount: 10n }],
      }),
      makeProject({
        // 进行中未达标 -> 不计成功
        state: ProjectState.Fundraising,
        deadline: 100n,
        raisedAmount: 1n,
        targetContribution: 10n,
        contributors: [{ contributor: ADDR_A, amount: 1n }],
      }),
    ];

    const summary = deriveProfileSummary(projects, ADDR_A, 200); // now=200 > deadline 100

    expect(summary.supportedCount).toBe(3);
    expect(summary.successfulCount).toBe(2);
  });

  it("lists projects created by the address", () => {
    const projects = [
      makeProject({ creator: ADDR_A, address: "0x00000000000000000000000000000000000000a1" }),
      makeProject({ creator: CREATOR, address: "0x00000000000000000000000000000000000000a2" }),
    ];

    const summary = deriveProfileSummary(projects, ADDR_A, 0);

    expect(summary.createdProjects).toHaveLength(1);
    expect(summary.createdProjects[0].address).toBe(
      "0x00000000000000000000000000000000000000a1",
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npm run test -- profile
```
Expected: FAIL,报 `deriveProfileSummary` 无法从 `./profile` 解析(模块不存在)。

- [ ] **Step 3: 实现 `src/profile.ts`**

```ts
import type { FundingProject } from "./types";
import { ProjectState, getLiveProjectState, normalizeAddress } from "./utils";

export type SupportedProject = {
  project: FundingProject;
  amount: bigint;
};

export type ProfileSummary = {
  cumulativeDonation: bigint;
  supportedProjects: SupportedProject[];
  supportedCount: number;
  successfulCount: number;
  createdProjects: FundingProject[];
};

function getContributionFor(project: FundingProject, target: string): bigint {
  return project.contributors.reduce((sum, row) => {
    return normalizeAddress(row.contributor) === target ? sum + row.amount : sum;
  }, 0n);
}

export function deriveProfileSummary(
  projects: FundingProject[],
  address: string,
  nowSeconds: number,
): ProfileSummary {
  const target = normalizeAddress(address);

  const supportedProjects: SupportedProject[] = [];
  let cumulativeDonation = 0n;
  let successfulCount = 0;

  for (const project of projects) {
    const amount = getContributionFor(project, target);

    if (amount > 0n) {
      supportedProjects.push({ project, amount });
      cumulativeDonation += amount;

      const liveState = getLiveProjectState({
        state: project.state,
        deadline: project.deadline,
        raisedAmount: project.raisedAmount,
        targetContribution: project.targetContribution,
        nowSeconds,
      });

      if (liveState === ProjectState.Successful) {
        successfulCount += 1;
      }
    }
  }

  const createdProjects = projects.filter(
    (project) => normalizeAddress(project.creator) === target,
  );

  return {
    cumulativeDonation,
    supportedProjects,
    supportedCount: supportedProjects.length,
    successfulCount,
    createdProjects,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npm run test -- profile
```
Expected: PASS(4 个用例全过)。

- [ ] **Step 5: Lint**

Run:
```bash
npm run lint
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/profile.ts src/profile.test.ts
git commit -m "feat: add deriveProfileSummary for profile data"
```

---

## Task 3: Profile 展示组件 + `/profile/:address` 路由 + 三处入口

**Files:**
- Modify: `src/App.tsx`(新增 `Profile` 纯展示组件、`ProfileRoute`、路由注册;`ProjectDetail` 接线 `onOpenProfile`;顶栏钱包胶囊改 `Link`;`ProjectDetailRoute` 传 `onOpenProfile`)
- Modify: `src/styles.css`(profile 样式)
- Test: `src/App.test.tsx`(新增一个 `Profile` 渲染用例)

**Interfaces:**
- Consumes: `deriveProfileSummary`/`ProfileSummary`(`src/profile.ts`)、`AppContext`/`useAppContext`、`ProjectList` 行样式 class。
- Produces:
  - `export function Profile(props: {`
    `address: Address; isSelf: boolean; summary: ProfileSummary; nowSeconds: number;`
    `onBack: () => void; onOpenProject: (address: Address) => void;`
    `}): JSX.Element`

- [ ] **Step 1: 写失败测试(在 `src/App.test.tsx` 末尾 `describe` 内新增用例)**

先在文件顶部 import 增加:
```tsx
import { Profile } from "./App";
import { deriveProfileSummary } from "./profile";
```
然后在 `describe("App presentation components", ...)` 内新增:
```tsx
  it("renders profile stats and supported/created project lists", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    const supporter = "0x3333333333333333333333333333333333333333";
    const projects: FundingProject[] = [
      {
        ...sampleProject,
        address: "0x4444444444444444444444444444444444444444",
        contributors: [{ contributor: supporter, amount: 2_000_000_000_000_000_000n }],
      },
      {
        ...sampleProject,
        address: "0x5555555555555555555555555555555555555555",
        creator: supporter,
      },
    ];
    const summary = deriveProfileSummary(projects, supporter, 1_000);

    act(() => {
      root.render(
        <Profile
          address={supporter}
          isSelf
          summary={summary}
          nowSeconds={1_000}
          onBack={() => undefined}
          onOpenProject={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain("累计捐赠");
    expect(host.textContent).toContain("支持项目数");
    expect(host.textContent).toContain("成功支持项目");
    expect(host.textContent).toContain("我的资料");
    expect(host.querySelectorAll(".project-row").length).toBe(2); // 1 supported + 1 created

    act(() => root.unmount());
    host.remove();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npm run test -- App
```
Expected: FAIL —— `Profile` 未从 `./App` 导出。

- [ ] **Step 3: 在 `src/App.tsx` 新增 `Profile` 纯展示组件**

在文件中(`ProjectDetail` 之后、`ProgressBar` 之前的位置)新增。需要 import `deriveProfileSummary`/`ProfileSummary` 并不必要——`Profile` 接收已算好的 `summary`。新增 import:
```tsx
import type { ProfileSummary } from "./profile";
```
组件:
```tsx
export function Profile({
  address,
  isSelf,
  summary,
  nowSeconds,
  onBack,
  onOpenProject,
}: {
  address: Address;
  isSelf: boolean;
  summary: ProfileSummary;
  nowSeconds: number;
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
```
确认 `getLiveRemainingTime`、`getLiveProjectState`、`getProjectPhase`、`getFundingModelLabel`、`formatEth`、`formatAddress` 已在文件顶部从 `./utils` import(Task 1 之前就已 import,不需新增)。

- [ ] **Step 4: 新增 `ProfileRoute` 并注册路由**

在 `ProjectDetailRoute` 之后新增:
```tsx
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
      onBack={() => navigate("/")}
      onOpenProject={(target) => navigate(`/project/${target}`)}
    />
  );
}
```
在 `App` 的 `<Routes>` 中,`project/:address` 那行后面新增:
```tsx
        <Route path="profile/:address" element={<ProfileRoute />} />
```
并在文件顶部新增 import:
```tsx
import { deriveProfileSummary } from "./profile";
```
(可与 Step 3 的 `import type { ProfileSummary }` 合并为一行:`import { deriveProfileSummary, type ProfileSummary } from "./profile";`)

- [ ] **Step 5: 接线三处入口**

5a. 顶栏钱包地址胶囊改成可点 `Link`。先在 `src/App.tsx` 顶部 react-router-dom 的 import 列表里加入 `Link`。再在 `AppLayout` return 的 wallet-box 内,把 `address-pill` 的 `<span>` 换成:
```tsx
              <Link className="address-pill" to={`/profile/${wallet.address}`}>
                {formatAddress(wallet.address)}
              </Link>
```

5b. `ProjectDetail` 接收并使用 `onOpenProfile`:
- 在其 props 解构中加入 `onOpenProfile,`(Task 1 已在类型里加了可选字段)。
- 把发起人地址那处(`<span>发起人 {formatAddress(project.creator)}</span>`)改为可点按钮:
  ```tsx
            <button
              type="button"
              className="link-button"
              onClick={() => onOpenProfile?.(project.creator)}
            >
              发起人 {formatAddress(project.creator)}
            </button>
  ```
- 捐赠者列表行(`<span>{formatAddress(row.contributor)}</span>`)改为:
  ```tsx
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpenProfile?.(row.contributor)}
                >
                  {formatAddress(row.contributor)}
                </button>
  ```

5c. `ProjectDetailRoute` 中给 `<ProjectDetail>` 传:
```tsx
      onOpenProfile={(target) => navigate(`/profile/${target}`)}
```

- [ ] **Step 6: 新增 profile 相关样式到 `src/styles.css`**

在文件末尾追加(沿用卡其色扁平主题变量;如无变量则用与现有 `.muted`/`.address-pill` 一致的色值):
```css
.self-badge {
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border, #d8d0c0);
  color: var(--muted, #8a8170);
  vertical-align: middle;
}

.link-button {
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

a.address-pill {
  text-decoration: none;
}
```

- [ ] **Step 7: 跑测试确认通过**

Run:
```bash
npm run test
```
Expected: PASS(既有 8 + profile 派生 4 + 新 Profile 渲染 1)。

- [ ] **Step 8: 编译与 Lint**

Run:
```bash
npm run build && npm run lint
```
Expected: 均 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add /profile/:address page with entry points"
```

---

## Task 4: 全量验证

**Files:** 无改动(仅运行验收命令)。

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS,无 error。

- [ ] **Step 2: 类型检查 + 构建**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 3: 单元/集成测试**

Run: `npm run test`
Expected: PASS,全部用例通过。

- [ ] **Step 4: 手动冒烟(可选,需本地链与 MetaMask)**

Run: `npm run dev`
检查:连接钱包后,
1. 顶栏地址胶囊点击 → 跳 `/profile/<我>`,统计与列表正确;
2. 进某项目详情,点发起人地址 → `/profile/<creator>`;
3. 详情页捐赠者地址点击 → `/profile/<contributor>`;
4. 直接在地址栏刷新 `/project/...` 与 `/profile/...` 不白屏(SPA fallback 生效)。

- [ ] **Step 5: Commit(若手动验证有微调)**

```bash
git add -A
git commit -m "chore: verify profile route end-to-end"
```

---

## Self-Review notes

- **Spec coverage:** 累计捐赠 / 支持项目数 / 成功支持项目 → Task 2 `deriveProfileSummary` + Task 3 统计卡;支持项目列表 / 发起项目列表 → Task 3 `Profile`;三处入口 → Task 3 Step 5;路由化 → Task 1;访问需登录 → Task 1 `AppLayout` 登录门;验收命令 → Task 4。
- **类型一致性:** `AppContext`/`useAppContext`(Task 1)被 Task 3 路由包装器消费;`ProfileSummary`/`deriveProfileSummary`(Task 2)被 Task 3 消费;`Profile` props 与测试调用一致;`onOpenProfile` 在 Task 1 声明(可选)、Task 3 解构使用。
- **口径一致:** 成功判定统一走 `getLiveProjectState`,与 spec 一致。

# 设计:`/profile/:address` 个人资料页 + 路由化重构

日期:2026-06-21

## 背景

当前前端(`src/App.tsx`)是一个无路由库的 SPA,用 `view: "list" | "create" | "detail"`
状态切换页面。需求是新增 `/profile/:address` 个人资料路由,展示某地址的:

- 累计捐赠
- 支持项目数 / 成功支持项目
- 支持项目列表
- 发起项目列表

经讨论确定:**引入 `react-router-dom`,把现有 view 状态一并改成真实路由页面**,
让导航逻辑更清晰。个人资料所需数据可全部从现有 `loadProjects()` 返回的
`FundingProject[]` 客户端派生,**无需新增合约读调用**。

## 决策记录

- 路由方式:引入 `react-router-dom`,view 状态改为路由页面。
- URL 结构:语义化路径。
- 个人资料入口:详情页发起人地址、详情页捐赠者列表地址、顶部钱包地址胶囊。
- 累计捐赠口径:用当前链上 `contributions` 映射求和(无事件索引;已退款的捐赠因已清零而不计入)。
- 成功支持项目口径:`Successful` + 已达标的进行中项目(`Fundraising` 且 `raised >= target`)。
- 访问权限:需要先连接钱包(与现有 list/detail 一致)。
- 实施顺序:**先做完功能,页面组件暂不拆到 `src/pages/`**,全部留在 `App.tsx`
  做路由接线;`profile.ts` 纯函数模块单独新建。后续再拆。

## 一、架构与路由

引入 `react-router-dom`,路由表(语义化路径):

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | 项目列表 | 原 `list` view |
| `/create` | 创建项目 | 原 `create` view |
| `/project/:address` | 项目详情 | 原 `detail` view,从 URL 取地址 |
| `/profile/:address` | **个人资料(新)** | 从 URL 取地址 |

- `main.tsx` 用 `<BrowserRouter>` 包裹;路由表可定义在 `App.tsx` 中。
- 新建 **`AppLayout`** 根布局组件(留在 `App.tsx`):持有 `wallet` / `projects` /
  `loading` / `message` / `error` 等共享状态,渲染顶栏与 Toast,保留到期自动刷新逻辑,
  通过 React Router `useOutletContext` 把状态与动作(`refreshProjects`、捐赠、各类提款、
  里程碑操作等)下发给 `<Outlet/>` 的各页面。
- 访问权限:未连接钱包时 `AppLayout` 统一渲染登录引导页(与现有行为一致),
  所有路由都受此保护。
- 详情页/资料页从共享 `projects` 数组按 `:address` 参数查找实体;找不到时显示
  "未找到 / 请刷新" 空状态。
- 导航从 `setView`/`openProject` 改为 `<Link>` 与 `useNavigate()`;返回按钮用
  `navigate("/")`。

## 二、个人资料页:数据口径与内容

新建纯函数模块 **`src/profile.ts`**,导出 `deriveProfileSummary(projects, address)`:

```
deriveProfileSummary(projects: FundingProject[], address: Address) => {
  cumulativeDonation: bigint,          // 累计捐赠:各项目 contributors 中匹配该地址的 amount 求和
  supportedProjects: Array<{           // 支持项目列表
    project: FundingProject,
    amount: bigint,                    // 该地址在此项目的当前捐赠额
  }>,
  supportedCount: number,              // = supportedProjects.length
  successfulCount: number,             // supported 中 live 状态为 Successful 或(Fundraising 且 raised>=target)
  createdProjects: FundingProject[],   // creator === address
}
```

实现要点:

- 对任意地址**不能**用 `FundingProject.userContribution`(它只对当前连接账户填充),
  而是从每个项目的 `contributors: {contributor, amount}[]` 中匹配该地址取金额。
- 地址比较统一用 `normalizeAddress`(小写化)。
- 支持项目 = `contributors` 含该地址且 `amount > 0` 的项目。
- 成功判定复用 `getLiveProjectState`,涵盖"已达标的进行中项目"。

页面布局(沿用卡其色扁平主题现有 class):

- 顶部:`<h2>` 显示格式化地址(`formatAddress`),若 == 当前钱包地址则加"我的资料"标记;
  右侧"返回列表"按钮。
- 统计卡(复用 `stats-grid` / `dl`):**累计捐赠**(`formatEth`)/ **支持项目数** /
  **成功支持项目**。
- **支持项目列表**:复用 `project-list` 行样式,点击进 `/project/:address`,
  每行附该地址的捐赠额。
- **发起项目列表**:同样式。
- 三处列表均有空状态文案。

## 三、入口、文件改动与验证

**入口(三处都用 `<Link to={\`/profile/${addr}\`}>`):**

1. 顶栏钱包地址胶囊 → `/profile/<我的地址>`
2. 详情页发起人地址 → `/profile/<creator>`
3. 详情页捐赠者列表每行地址 → `/profile/<contributor>`

**文件改动:**

- `package.json` — 新增 `react-router-dom` 依赖
- `src/main.tsx` — 用 `<BrowserRouter>` 包裹应用
- `src/App.tsx` — 重构为 `AppLayout` + 路由表;现有 `ProjectList` / `CreateProjectView` /
  `ProjectDetail` 组件保留在本文件,改为通过 `useOutletContext` / `useParams` /
  `useNavigate` 接线;新增 `Profile` 页面组件
- `src/profile.ts` — 新增 `deriveProfileSummary` 纯函数
- `src/profile.test.ts` — 新增纯函数单测
- `src/styles.css` — 按需补少量 profile 专用样式
- 现有 `src/App.test.tsx` — 若依赖旧 view 切换,按路由化适配

**验证(对齐 `design.md` 验收标准):**

- `npm run lint` 通过
- `npm run build` 通过
- `npm run test` 通过
- 个人资料页功能符合上述要求

## 非目标(YAGNI)

- 不引入事件索引/历史累计(含已退款)统计。
- 不把页面组件拆到 `src/pages/`(后续再做)。
- 公开匿名访问个人资料(本期需先连接钱包)。

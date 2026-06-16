# Milestone Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second project type where funds are released milestone-by-milestone after contributors verify submitted results, while preserving the current all-or-nothing project flow.

**Architecture:** Extend `Project` with a `FundingModel` enum and milestone storage, approval, and release functions. Keep `Crowdfunding.createProject(...)` unchanged for all-or-nothing projects and add `createMilestoneProject(...)` for milestone projects. Update the React/viem layer to read the new contract data and expose milestone creation, submission, contributor approval, and staged release actions.

**Tech Stack:** Solidity 0.8.28, Hardhat 3 Solidity tests with `forge-std`, Vite React 19, viem, Vitest.

---

## Design Decisions

- All-or-nothing projects keep the current behavior: contributors fund until deadline, creator withdraws the full balance after success, contributors refund after failure.
- Milestone projects still use the current funding deadline and target. If the target is not reached by the deadline, contributors can refund. If the target is reached, the project becomes `Successful`, but the creator cannot withdraw all funds at once.
- Milestone releases are sequential. The creator submits evidence for milestone `0`, contributors approve it, funds are released, then milestone `1` can be submitted.
- Contributor verification is weighted by contribution amount. A milestone can be released when approval weight reaches 50% of the total raised amount.
- Milestone percentages are stored in basis points. The sum must equal `10_000`. The final milestone receives the remaining contract balance to avoid stuck wei from division rounding.
- Existing deployed local artifacts under `ignition/deployments/` are generated state and should not be edited by hand. Redeploy locally after contract changes.

## File Structure

- Modify `contracts/Project.sol`: add project mode, milestone storage, contributor approvals, staged release events, and all milestone business rules.
- Modify `contracts/Crowdfunding.sol`: keep `createProject(...)`; add `createMilestoneProject(...)` and include the funding model in `ProjectStarted`.
- Modify `contracts/Crowdfunding.t.sol`: add focused Solidity tests for all-or-nothing compatibility and milestone lifecycle behavior.
- Modify `src/abi.ts`: add ABI entries for the new factory and project functions/events used by the frontend.
- Modify `src/types.ts`: add `FundingModel`, `ProjectMilestone`, and milestone form types.
- Modify `src/contracts.ts`: load milestone data and add write helpers for milestone creation, submission, approval, and release.
- Modify `src/utils.ts`: add display helpers for funding model, milestone approval progress, and milestone form validation.
- Modify `src/utils.test.ts`: cover new helpers.
- Modify `src/App.tsx`: add project type selection, milestone input rows, milestone status UI, and action buttons.
- Modify `src/App.test.tsx`: cover milestone UI states and create-form rendering.
- Modify `src/styles.css`: add responsive milestone form and detail styles consistent with the current khaki theme.

---

### Task 1: Contract Model And Factory Entry Point

**Files:**
- Modify: `contracts/Project.sol`
- Modify: `contracts/Crowdfunding.sol`
- Test: `contracts/Crowdfunding.t.sol`

- [ ] **Step 1: Write failing Solidity tests for project modes and milestone plan storage**

Append these tests before `_createProject()` in `contracts/Crowdfunding.t.sol`:

```solidity
  function test_CreateAllOrNothingProjectKeepsExistingBehavior() public {
    Project project = _createProject();

    assertEq(uint256(project.fundingModel()), uint256(Project.FundingModel.AllOrNothing));
    assertEq(project.getMilestoneCount(), 0);
    assertEq(project.creatorWithdrawn(), false);
  }

  function test_CreateMilestoneProjectStoresMilestonePlan() public {
    string[] memory titles = new string[](3);
    titles[0] = "Prototype";
    titles[1] = "Beta";
    titles[2] = "Launch";

    uint16[] memory releaseBps = new uint16[](3);
    releaseBps[0] = 2_500;
    releaseBps[1] = 3_500;
    releaseBps[2] = 4_000;

    vm.prank(creator);
    crowdfunding.createMilestoneProject(
      minimumContribution,
      deadline,
      targetContribution,
      "Milestone fund",
      "Stage based release",
      titles,
      releaseBps
    );

    Project[] memory projects = crowdfunding.returnAllProjects();
    Project project = projects[0];

    assertEq(uint256(project.fundingModel()), uint256(Project.FundingModel.Milestone));
    assertEq(project.getMilestoneCount(), 3);

    (
      string memory title,
      string memory evidenceUri,
      uint16 bps,
      uint256 approvalWeight,
      bool submitted,
      bool released,
      uint256 milestoneReleasedAmount
    ) = project.getMilestone(1);

    assertEq(title, "Beta");
    assertEq(evidenceUri, "");
    assertEq(bps, 3_500);
    assertEq(approvalWeight, 0);
    assertFalse(submitted);
    assertFalse(released);
    assertEq(milestoneReleasedAmount, 0);
  }

  function test_CreateMilestoneProjectRequiresPercentagesToSumToOneHundredPercent()
    public
  {
    string[] memory titles = new string[](2);
    titles[0] = "Prototype";
    titles[1] = "Launch";

    uint16[] memory releaseBps = new uint16[](2);
    releaseBps[0] = 4_000;
    releaseBps[1] = 4_000;

    vm.prank(creator);
    vm.expectRevert(bytes("Milestone percentages must total 100%"));
    crowdfunding.createMilestoneProject(
      minimumContribution,
      deadline,
      targetContribution,
      "Milestone fund",
      "Stage based release",
      titles,
      releaseBps
    );
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx hardhat test solidity
```

Expected: FAIL because `Project.FundingModel`, `fundingModel()`, `getMilestoneCount()`, `getMilestone(...)`, and `Crowdfunding.createMilestoneProject(...)` do not exist.

- [ ] **Step 3: Add milestone model to `Project.sol`**

Apply these edits to `contracts/Project.sol`:

```solidity
  enum FundingModel {
    AllOrNothing,
    Milestone
  }

  struct Milestone {
    string title;
    string evidenceUri;
    uint16 releaseBps;
    uint256 approvalWeight;
    bool submitted;
    bool released;
    uint256 releasedAmount;
  }

  uint16 public constant BASIS_POINTS = 10_000;
  uint16 public constant MILESTONE_APPROVAL_THRESHOLD_BPS = 5_000;
```

Add these state variables after `bool public creatorWithdrawn;`:

```solidity
  FundingModel public fundingModel;
  uint256 public nextMilestoneIndex;
  uint256 public totalReleasedAmount;

  Milestone[] private milestones;
  mapping(uint256 milestoneIndex => mapping(address contributor => bool approved))
    public milestoneApprovals;
```

Change the constructor signature to:

```solidity
  constructor(
    address _creator,
    uint256 _minimumContribution,
    uint256 _deadline,
    uint256 _targetContribution,
    string memory _projectTitle,
    string memory _projectDesc,
    FundingModel _fundingModel,
    string[] memory _milestoneTitles,
    uint16[] memory _milestoneReleaseBps
  ) {
```

Add this constructor body after the existing project metadata assignments:

```solidity
    fundingModel = _fundingModel;

    if (_fundingModel == FundingModel.AllOrNothing) {
      require(_milestoneTitles.length == 0, "All-or-nothing has no milestones");
      require(_milestoneReleaseBps.length == 0, "All-or-nothing has no milestones");
      return;
    }

    require(_milestoneTitles.length > 0, "Milestone project needs milestones");
    require(
      _milestoneTitles.length == _milestoneReleaseBps.length,
      "Milestone input length mismatch"
    );

    uint256 totalBps;

    for (uint256 i = 0; i < _milestoneTitles.length; i++) {
      require(bytes(_milestoneTitles[i]).length > 0, "Milestone title is empty");
      require(_milestoneReleaseBps[i] > 0, "Milestone percentage is zero");

      totalBps += _milestoneReleaseBps[i];
      milestones.push(
        Milestone({
          title: _milestoneTitles[i],
          evidenceUri: "",
          releaseBps: _milestoneReleaseBps[i],
          approvalWeight: 0,
          submitted: false,
          released: false,
          releasedAmount: 0
        })
      );
    }

    require(totalBps == BASIS_POINTS, "Milestone percentages must total 100%");
```

Add these read functions before `getProjectDetails()`:

```solidity
  function getMilestoneCount() external view returns (uint256) {
    return milestones.length;
  }

  function getMilestone(uint256 milestoneIndex)
    external
    view
    returns (
      string memory title,
      string memory evidenceUri,
      uint16 releaseBps,
      uint256 approvalWeight,
      bool submitted,
      bool released,
      uint256 releasedAmount
    )
  {
    require(milestoneIndex < milestones.length, "Invalid milestone");

    Milestone storage milestone = milestones[milestoneIndex];

    return (
      milestone.title,
      milestone.evidenceUri,
      milestone.releaseBps,
      milestone.approvalWeight,
      milestone.submitted,
      milestone.released,
      milestone.releasedAmount
    );
  }
```

- [ ] **Step 4: Add milestone factory function to `Crowdfunding.sol`**

Change the `ProjectStarted` event to include the funding model:

```solidity
  event ProjectStarted(
    address projectContractAddress,
    address indexed creator,
    uint256 minContribution,
    uint256 projectDeadline,
    uint256 goalAmount,
    uint256 currentAmount,
    uint256 noOfContributors,
    string title,
    string desc,
    uint256 currentState,
    uint256 fundingModel
  );
```

Update the existing `createProject(...)` deployment call:

```solidity
    string[] memory milestoneTitles = new string[](0);
    uint16[] memory milestoneReleaseBps = new uint16[](0);

    Project newProject = new Project(
      msg.sender,
      minimumContribution,
      deadline,
      targetContribution,
      projectTitle,
      projectDesc,
      Project.FundingModel.AllOrNothing,
      milestoneTitles,
      milestoneReleaseBps
    );
```

Update the existing `ProjectStarted` emit call by appending:

```solidity
      uint256(Project.State.Fundraising),
      uint256(Project.FundingModel.AllOrNothing)
```

Add this new factory function after `createProject(...)`:

```solidity
  function createMilestoneProject(
    uint256 minimumContribution,
    uint256 deadline,
    uint256 targetContribution,
    string memory projectTitle,
    string memory projectDesc,
    string[] memory milestoneTitles,
    uint16[] memory milestoneReleaseBps
  ) external {
    Project newProject = new Project(
      msg.sender,
      minimumContribution,
      deadline,
      targetContribution,
      projectTitle,
      projectDesc,
      Project.FundingModel.Milestone,
      milestoneTitles,
      milestoneReleaseBps
    );

    projects.push(newProject);

    emit ProjectStarted(
      address(newProject),
      msg.sender,
      minimumContribution,
      deadline,
      targetContribution,
      0,
      0,
      projectTitle,
      projectDesc,
      uint256(Project.State.Fundraising),
      uint256(Project.FundingModel.Milestone)
    );
  }
```

- [ ] **Step 5: Run tests to verify the model passes**

Run:

```bash
npx hardhat test solidity
```

Expected: PASS for the newly added creation tests and all existing tests.

- [ ] **Step 6: Commit**

```bash
git add contracts/Project.sol contracts/Crowdfunding.sol contracts/Crowdfunding.t.sol
git commit -m "feat: add milestone project model"
```

---

### Task 2: Milestone Submission, Approval, And Release

**Files:**
- Modify: `contracts/Project.sol`
- Test: `contracts/Crowdfunding.t.sol`

- [ ] **Step 1: Write failing Solidity tests for the milestone lifecycle**

Append these tests before `_createProject()` in `contracts/Crowdfunding.t.sol`:

```solidity
  function test_MilestoneProjectReleasesApprovedMilestonesSequentially() public {
    Project project = _createSuccessfulMilestoneProject();

    vm.prank(creator);
    project.submitMilestone(0, "ipfs://prototype");

    vm.prank(contributor);
    project.approveMilestone(0);

    assertTrue(project.isMilestoneApproved(0));

    uint256 creatorBalanceBefore = creator.balance;

    vm.prank(contributorTwo);
    project.releaseMilestoneFunds(0);

    assertEq(creator.balance - creatorBalanceBefore, 2.5 ether);
    assertEq(project.getContractBalance(), 7.5 ether);
    assertEq(project.nextMilestoneIndex(), 1);
    assertEq(project.totalReleasedAmount(), 2.5 ether);

    (, , , , , bool released, uint256 milestoneReleasedAmount) = project
      .getMilestone(0);

    assertTrue(released);
    assertEq(milestoneReleasedAmount, 2.5 ether);
  }

  function test_MilestoneReleaseRequiresContributorApprovalThreshold() public {
    Project project = _createSuccessfulMilestoneProject();

    vm.prank(creator);
    project.submitMilestone(0, "ipfs://prototype");

    vm.prank(contributorTwo);
    project.approveMilestone(0);

    vm.expectRevert(bytes("Milestone lacks contributor approval"));
    project.releaseMilestoneFunds(0);

    vm.prank(contributor);
    project.approveMilestone(0);

    project.releaseMilestoneFunds(0);

    assertEq(project.getContractBalance(), 7.5 ether);
  }

  function test_FinalMilestoneReleasesRemainingBalance() public {
    Project project = _createSuccessfulMilestoneProject();

    _submitApproveAndRelease(project, 0, "ipfs://prototype");
    _submitApproveAndRelease(project, 1, "ipfs://beta");
    _submitApproveAndRelease(project, 2, "ipfs://launch");

    assertEq(project.getContractBalance(), 0);
    assertEq(project.totalReleasedAmount(), 10 ether);
    assertEq(project.nextMilestoneIndex(), 3);
  }
```

Add these helper functions before `_createProject()`:

```solidity
  function _createSuccessfulMilestoneProject() internal returns (Project) {
    string[] memory titles = new string[](3);
    titles[0] = "Prototype";
    titles[1] = "Beta";
    titles[2] = "Launch";

    uint16[] memory releaseBps = new uint16[](3);
    releaseBps[0] = 2_500;
    releaseBps[1] = 3_500;
    releaseBps[2] = 4_000;

    vm.prank(creator);
    crowdfunding.createMilestoneProject(
      minimumContribution,
      deadline,
      targetContribution,
      "Milestone fund",
      "Stage based release",
      titles,
      releaseBps
    );

    Project[] memory projects = crowdfunding.returnAllProjects();
    Project project = projects[0];

    vm.deal(contributor, 10 ether);
    vm.deal(contributorTwo, 1 ether);

    vm.prank(contributor);
    crowdfunding.contribute{value: 9 ether}(address(project));

    vm.prank(contributorTwo);
    crowdfunding.contribute{value: 1 ether}(address(project));

    vm.warp(deadline);
    project.endProject();

    return project;
  }

  function _submitApproveAndRelease(
    Project project,
    uint256 milestoneIndex,
    string memory evidenceUri
  ) internal {
    vm.prank(creator);
    project.submitMilestone(milestoneIndex, evidenceUri);

    vm.prank(contributor);
    project.approveMilestone(milestoneIndex);

    project.releaseMilestoneFunds(milestoneIndex);
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx hardhat test solidity
```

Expected: FAIL because `submitMilestone(...)`, `approveMilestone(...)`, `isMilestoneApproved(...)`, and `releaseMilestoneFunds(...)` do not exist.

- [ ] **Step 3: Add milestone events and functions to `Project.sol`**

Add these events after `ContributionRefunded`:

```solidity
  event MilestoneSubmitted(uint256 indexed milestoneIndex, string evidenceUri);
  event MilestoneApproved(
    uint256 indexed milestoneIndex,
    address indexed contributor,
    uint256 approvalWeight
  );
  event MilestoneFundsReleased(
    uint256 indexed milestoneIndex,
    address indexed creator,
    uint256 amount
  );
```

Change `withdrawRaisedFunds()` by adding this requirement immediately after the creator check:

```solidity
    require(
      fundingModel == FundingModel.AllOrNothing,
      "Milestone funds release by milestone"
    );
```

Add these functions before `withdrawContribution()`:

```solidity
  function submitMilestone(uint256 milestoneIndex, string memory evidenceUri)
    external
  {
    require(msg.sender == creator, "Only creator");
    require(fundingModel == FundingModel.Milestone, "Project has no milestones");
    require(milestoneIndex < milestones.length, "Invalid milestone");
    require(milestoneIndex == nextMilestoneIndex, "Milestones must be sequential");
    require(bytes(evidenceUri).length > 0, "Evidence URI is empty");

    State currentState = _finalizeProject();
    require(currentState == State.Successful, "Project is not successful");

    Milestone storage milestone = milestones[milestoneIndex];
    require(!milestone.submitted, "Milestone already submitted");
    require(!milestone.released, "Milestone already released");

    milestone.submitted = true;
    milestone.evidenceUri = evidenceUri;

    emit MilestoneSubmitted(milestoneIndex, evidenceUri);
  }

  function approveMilestone(uint256 milestoneIndex) external {
    require(fundingModel == FundingModel.Milestone, "Project has no milestones");
    require(milestoneIndex < milestones.length, "Invalid milestone");
    require(contributions[msg.sender] > 0, "Only contributors can approve");
    require(
      !milestoneApprovals[milestoneIndex][msg.sender],
      "Milestone already approved"
    );

    Milestone storage milestone = milestones[milestoneIndex];
    require(milestone.submitted, "Milestone not submitted");
    require(!milestone.released, "Milestone already released");

    milestoneApprovals[milestoneIndex][msg.sender] = true;
    milestone.approvalWeight += contributions[msg.sender];

    emit MilestoneApproved(
      milestoneIndex,
      msg.sender,
      milestone.approvalWeight
    );
  }

  function releaseMilestoneFunds(uint256 milestoneIndex) external {
    require(fundingModel == FundingModel.Milestone, "Project has no milestones");
    require(milestoneIndex < milestones.length, "Invalid milestone");
    require(milestoneIndex == nextMilestoneIndex, "Milestones must be sequential");

    Milestone storage milestone = milestones[milestoneIndex];
    require(milestone.submitted, "Milestone not submitted");
    require(!milestone.released, "Milestone already released");
    require(
      _hasMilestoneApproval(milestone.approvalWeight),
      "Milestone lacks contributor approval"
    );

    uint256 amount;

    if (milestoneIndex == milestones.length - 1) {
      amount = address(this).balance;
    } else {
      amount = (raisedAmount * milestone.releaseBps) / BASIS_POINTS;
    }

    require(amount > 0, "No funds to release");

    milestone.released = true;
    milestone.releasedAmount = amount;
    totalReleasedAmount += amount;
    nextMilestoneIndex++;

    (bool success, ) = creator.call{value: amount}("");
    require(success, "Milestone withdrawal failed");

    emit MilestoneFundsReleased(milestoneIndex, creator, amount);
  }

  function isMilestoneApproved(uint256 milestoneIndex)
    external
    view
    returns (bool)
  {
    require(milestoneIndex < milestones.length, "Invalid milestone");

    return _hasMilestoneApproval(milestones[milestoneIndex].approvalWeight);
  }
```

Add this internal helper before `_finalizeProject()`:

```solidity
  function _hasMilestoneApproval(uint256 approvalWeight)
    internal
    view
    returns (bool)
  {
    return approvalWeight * BASIS_POINTS >= raisedAmount * MILESTONE_APPROVAL_THRESHOLD_BPS;
  }
```

- [ ] **Step 4: Run Solidity tests**

Run:

```bash
npx hardhat test solidity
```

Expected: PASS for milestone lifecycle tests and existing all-or-nothing tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/Project.sol contracts/Crowdfunding.t.sol
git commit -m "feat: release milestone funds after contributor approval"
```

---

### Task 3: Contract Edge Cases And Compatibility

**Files:**
- Modify: `contracts/Crowdfunding.t.sol`

- [ ] **Step 1: Add failing tests for access control, refunds, and legacy withdrawal protection**

Append these tests before `_createProject()` in `contracts/Crowdfunding.t.sol`:

```solidity
  function test_MilestoneCreatorCannotWithdrawAllFundsAtOnce() public {
    Project project = _createSuccessfulMilestoneProject();

    vm.prank(creator);
    vm.expectRevert(bytes("Milestone funds release by milestone"));
    project.withdrawRaisedFunds();
  }

  function test_OnlyCreatorCanSubmitMilestone() public {
    Project project = _createSuccessfulMilestoneProject();

    vm.prank(contributor);
    vm.expectRevert(bytes("Only creator"));
    project.submitMilestone(0, "ipfs://prototype");
  }

  function test_NonContributorCannotApproveMilestone() public {
    Project project = _createSuccessfulMilestoneProject();

    vm.prank(creator);
    project.submitMilestone(0, "ipfs://prototype");

    vm.prank(address(0xBAD));
    vm.expectRevert(bytes("Only contributors can approve"));
    project.approveMilestone(0);
  }

  function test_MilestoneProjectRefundsWhenTargetNotReached() public {
    string[] memory titles = new string[](1);
    titles[0] = "Launch";

    uint16[] memory releaseBps = new uint16[](1);
    releaseBps[0] = 10_000;

    vm.prank(creator);
    crowdfunding.createMilestoneProject(
      minimumContribution,
      deadline,
      targetContribution,
      "Milestone fund",
      "Stage based release",
      titles,
      releaseBps
    );

    Project[] memory projects = crowdfunding.returnAllProjects();
    Project project = projects[0];

    vm.deal(contributor, 5 ether);
    vm.prank(contributor);
    crowdfunding.contribute{value: 2 ether}(address(project));

    vm.warp(deadline);
    project.endProject();

    vm.prank(contributor);
    project.withdrawContribution();

    assertEq(contributor.balance, 5 ether);
    assertEq(project.getContractBalance(), 0);
  }
```

- [ ] **Step 2: Run Solidity tests to verify protection**

Run:

```bash
npx hardhat test solidity
```

Expected: PASS. The first test passes only after Task 2 changed `withdrawRaisedFunds()` for milestone projects.

- [ ] **Step 3: Build contracts**

Run:

```bash
npx hardhat build
```

Expected: PASS and regenerated Hardhat artifacts under the build cache.

- [ ] **Step 4: Commit**

```bash
git add contracts/Crowdfunding.t.sol contracts/Project.sol
git commit -m "test: cover milestone project edge cases"
```

---

### Task 4: Frontend Contract API And Types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/abi.ts`
- Modify: `src/contracts.ts`
- Test: `src/utils.test.ts`

- [ ] **Step 1: Add frontend types**

Replace `src/types.ts` with:

```ts
import type { Address } from "viem";
import type { ProjectState } from "./utils";

export enum FundingModel {
  AllOrNothing = 0,
  Milestone = 1,
}

export type WalletSession = {
  address: Address;
  chainId: number;
};

export type ProjectContribution = {
  contributor: Address;
  amount: bigint;
};

export type ProjectMilestone = {
  index: number;
  title: string;
  evidenceUri: string;
  releaseBps: number;
  approvalWeight: bigint;
  submitted: boolean;
  released: boolean;
  releasedAmount: bigint;
  approved: boolean;
};

export type FundingProject = {
  address: Address;
  creator: Address;
  minimumContribution: bigint;
  deadline: bigint;
  targetContribution: bigint;
  raisedAmount: bigint;
  contributorCount: bigint;
  title: string;
  description: string;
  state: ProjectState;
  balance: bigint;
  remainingTime: bigint;
  contributors: ProjectContribution[];
  userContribution: bigint;
  creatorWithdrawn: boolean;
  fundingModel: FundingModel;
  nextMilestoneIndex: bigint;
  totalReleasedAmount: bigint;
  milestones: ProjectMilestone[];
};

export type CreateProjectInput = {
  title: string;
  description: string;
  goalEth: string;
  minimumEth: string;
  deadlineUnixSeconds: number;
  fundingModel: FundingModel;
  milestones: Array<{
    title: string;
    releaseBps: number;
  }>;
};
```

- [ ] **Step 2: Update ABI entries**

Add this function to `crowdfundingAbi` after `createProject`:

```ts
  {
    type: "function",
    name: "createMilestoneProject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "minimumContribution", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "targetContribution", type: "uint256" },
      { name: "projectTitle", type: "string" },
      { name: "projectDesc", type: "string" },
      { name: "milestoneTitles", type: "string[]" },
      { name: "milestoneReleaseBps", type: "uint16[]" },
    ],
    outputs: [],
  },
```

Add these functions to `projectAbi` before `withdrawContribution`:

```ts
  {
    type: "function",
    name: "fundingModel",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "nextMilestoneIndex",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalReleasedAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getMilestoneCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getMilestone",
    stateMutability: "view",
    inputs: [{ name: "milestoneIndex", type: "uint256" }],
    outputs: [
      { name: "title", type: "string" },
      { name: "evidenceUri", type: "string" },
      { name: "releaseBps", type: "uint16" },
      { name: "approvalWeight", type: "uint256" },
      { name: "submitted", type: "bool" },
      { name: "released", type: "bool" },
      { name: "releasedAmount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "milestoneApprovals",
    stateMutability: "view",
    inputs: [
      { name: "milestoneIndex", type: "uint256" },
      { name: "contributor", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "submitMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "milestoneIndex", type: "uint256" },
      { name: "evidenceUri", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveMilestone",
    stateMutability: "nonpayable",
    inputs: [{ name: "milestoneIndex", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "releaseMilestoneFunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "milestoneIndex", type: "uint256" }],
    outputs: [],
  },
```

- [ ] **Step 3: Update `src/contracts.ts` reads and writes**

Change the type import:

```ts
import type {
  CreateProjectInput,
  FundingProject,
  ProjectMilestone,
  WalletSession,
} from "./types";
import { FundingModel } from "./types";
```

Add gas limits:

```ts
  submitMilestone: 200_000n,
  approveMilestone: 200_000n,
  releaseMilestoneFunds: 250_000n,
```

In `loadProject(...)`, read the new fields:

```ts
  const [
    details,
    remainingTime,
    contributors,
    creatorWithdrawn,
    fundingModel,
    nextMilestoneIndex,
    totalReleasedAmount,
    milestoneCount,
  ] = await Promise.all([
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "getProjectDetails",
    }),
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "getRemainingTime",
    }),
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "getContributors",
    }),
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "creatorWithdrawn",
    }),
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "fundingModel",
    }),
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "nextMilestoneIndex",
    }),
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "totalReleasedAmount",
    }),
    publicClient.readContract({
      address: projectAddress,
      abi: projectAbi,
      functionName: "getMilestoneCount",
    }),
  ]);
```

Add this milestone loader inside `loadProject(...)` after `userContribution`:

```ts
  const milestoneIndexes = Array.from(
    { length: Number(milestoneCount) },
    (_, index) => BigInt(index),
  );

  const milestones: ProjectMilestone[] = await Promise.all(
    milestoneIndexes.map(async (milestoneIndex) => {
      const [milestone, approved] = await Promise.all([
        publicClient.readContract({
          address: projectAddress,
          abi: projectAbi,
          functionName: "getMilestone",
          args: [milestoneIndex],
        }),
        account
          ? publicClient.readContract({
              address: projectAddress,
              abi: projectAbi,
              functionName: "milestoneApprovals",
              args: [milestoneIndex, account],
            })
          : Promise.resolve(false),
      ]);

      return {
        index: Number(milestoneIndex),
        title: milestone[0],
        evidenceUri: milestone[1],
        releaseBps: milestone[2],
        approvalWeight: milestone[3],
        submitted: milestone[4],
        released: milestone[5],
        releasedAmount: milestone[6],
        approved,
      };
    }),
  );
```

Add these fields to the returned project object:

```ts
    fundingModel: fundingModel as FundingModel,
    nextMilestoneIndex,
    totalReleasedAmount,
    milestones,
```

Replace `createProject(...)` with:

```ts
export async function createProject(
  crowdfundingAddress: Address,
  input: CreateProjectInput,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const baseArgs = [
    parseEther(input.minimumEth),
    BigInt(input.deadlineUnixSeconds),
    parseEther(input.goalEth),
    input.title,
    input.description,
  ] as const;

  const hash =
    input.fundingModel === FundingModel.Milestone
      ? await walletClient.writeContract({
          address: crowdfundingAddress,
          abi: crowdfundingAbi,
          functionName: "createMilestoneProject",
          account,
          chain: null,
          gas: WRITE_GAS_LIMITS.createProject,
          args: [
            ...baseArgs,
            input.milestones.map((milestone) => milestone.title),
            input.milestones.map((milestone) => milestone.releaseBps),
          ],
        })
      : await walletClient.writeContract({
          address: crowdfundingAddress,
          abi: crowdfundingAbi,
          functionName: "createProject",
          account,
          chain: null,
          gas: WRITE_GAS_LIMITS.createProject,
          args: baseArgs,
        });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
```

Add these write helpers after `withdrawContribution(...)`:

```ts
export async function submitMilestone(
  projectAddress: Address,
  milestoneIndex: number,
  evidenceUri: string,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "submitMilestone",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.submitMilestone,
    args: [BigInt(milestoneIndex), evidenceUri],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function approveMilestone(
  projectAddress: Address,
  milestoneIndex: number,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "approveMilestone",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.approveMilestone,
    args: [BigInt(milestoneIndex)],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function releaseMilestoneFunds(
  projectAddress: Address,
  milestoneIndex: number,
) {
  const { walletClient, account } = await getWalletClient();
  const publicClient = getPublicClient();
  const hash = await walletClient.writeContract({
    address: projectAddress,
    abi: projectAbi,
    functionName: "releaseMilestoneFunds",
    account,
    chain: null,
    gas: WRITE_GAS_LIMITS.releaseMilestoneFunds,
    args: [BigInt(milestoneIndex)],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
```

- [ ] **Step 4: Run frontend tests and expect type failures before UI updates**

Run:

```bash
npm run build
```

Expected: FAIL because `CreateProjectInput` now requires `fundingModel` and `milestones`, and `sampleProject` in tests lacks the new fields.

- [ ] **Step 5: Commit after Task 5 fixes compile errors**

Do not commit this task alone if the working tree cannot build. Commit it together with Task 5:

```bash
git add src/types.ts src/abi.ts src/contracts.ts src/utils.ts src/utils.test.ts src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: connect frontend to milestone contracts"
```

---

### Task 5: Frontend Utilities And Creation Flow

**Files:**
- Modify: `src/utils.ts`
- Modify: `src/utils.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add utility tests**

Append these tests to `src/utils.test.ts`:

```ts
  it("formats funding models for project rows", () => {
    expect(getFundingModelLabel(0)).toBe("All or nothing");
    expect(getFundingModelLabel(1)).toBe("里程碑释放");
  });

  it("calculates milestone approval progress", () => {
    expect(getMilestoneApprovalProgress(5n, 10n)).toBe(100);
    expect(getMilestoneApprovalProgress(2n, 10n)).toBe(40);
    expect(getMilestoneApprovalProgress(1n, 0n)).toBe(0);
  });

  it("validates milestone percentages sum to one hundred percent", () => {
    expect(
      getMilestoneFormError([
        { title: "Prototype", releaseBps: 2_500 },
        { title: "Launch", releaseBps: 7_500 },
      ]),
    ).toBe("");

    expect(
      getMilestoneFormError([
        { title: "Prototype", releaseBps: 2_500 },
        { title: "Launch", releaseBps: 5_000 },
      ]),
    ).toBe("里程碑释放比例合计必须等于 100%");
  });
```

Update the import list in `src/utils.test.ts`:

```ts
  getFundingModelLabel,
  getMilestoneApprovalProgress,
  getMilestoneFormError,
```

- [ ] **Step 2: Implement utility helpers**

Add these functions to `src/utils.ts`:

```ts
export function getFundingModelLabel(model: number) {
  return model === 1 ? "里程碑释放" : "All or nothing";
}

export function getMilestoneApprovalProgress(
  approvalWeight: bigint,
  raisedAmount: bigint,
) {
  if (raisedAmount <= 0n) {
    return 0;
  }

  const requiredWeight = (raisedAmount * 5_000n) / 10_000n;

  if (requiredWeight <= 0n) {
    return 0;
  }

  const basisPoints = Number((approvalWeight * 10_000n) / requiredWeight);
  return Math.min(100, Math.round(basisPoints) / 100);
}

export function getMilestoneFormError(
  milestones: Array<{ title: string; releaseBps: number }>,
) {
  if (milestones.length === 0) {
    return "请至少设置一个里程碑";
  }

  if (milestones.some((milestone) => milestone.title.trim().length === 0)) {
    return "里程碑名称不能为空";
  }

  if (milestones.some((milestone) => milestone.releaseBps <= 0)) {
    return "每个里程碑释放比例必须大于 0";
  }

  const totalBps = milestones.reduce(
    (sum, milestone) => sum + milestone.releaseBps,
    0,
  );

  if (totalBps !== 10_000) {
    return "里程碑释放比例合计必须等于 100%";
  }

  return "";
}
```

- [ ] **Step 3: Update create form state in `App.tsx`**

Change imports:

```ts
  approveMilestone,
  releaseMilestoneFunds,
  submitMilestone,
```

Change type imports:

```ts
import {
  FundingModel,
  type CreateProjectInput,
  type FundingProject,
  type WalletSession,
} from "./types";
```

Add utility imports:

```ts
  getFundingModelLabel,
  getMilestoneApprovalProgress,
  getMilestoneFormError,
```

Replace `defaultCreateForm` with:

```ts
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
```

In `handleCreateProject(...)`, add:

```ts
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
```

Build `input` as:

```ts
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
```

- [ ] **Step 4: Render milestone controls in `CreateProjectView`**

Inside the form, place this block after the deadline label:

```tsx
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
```

- [ ] **Step 5: Update frontend test fixtures**

Add these fields to `sampleProject` in `src/App.test.tsx`:

```ts
  fundingModel: FundingModel.AllOrNothing,
  nextMilestoneIndex: 0n,
  totalReleasedAmount: 0n,
  milestones: [],
```

Import `FundingModel`:

```ts
import { FundingModel, type FundingProject } from "./types";
```

Add this test:

```ts
  it("labels milestone projects in the project list", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectList
          projects={[
            {
              ...sampleProject,
              fundingModel: FundingModel.Milestone,
              milestones: [
                {
                  index: 0,
                  title: "Prototype",
                  evidenceUri: "",
                  releaseBps: 2_500,
                  approvalWeight: 0n,
                  submitted: false,
                  released: false,
                  releasedAmount: 0n,
                  approved: false,
                },
              ],
            },
          ]}
          canLoad
          nowSeconds={1_000}
          onRefresh={() => undefined}
          onCreate={() => undefined}
          onOpen={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain("里程碑释放");

    act(() => root.unmount());
    host.remove();
  });
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
npm run test
```

Expected: PASS for utilities and presentation tests.

---

### Task 6: Milestone Detail Actions

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add action handlers to `ProjectDetail` usage**

In the `ProjectDetail` call in `App.tsx`, pass these props:

```tsx
              onSubmitMilestone={(milestoneIndex, evidenceUri) =>
                runAction(
                  async () => {
                    await submitMilestone(
                      selectedProject.address,
                      milestoneIndex,
                      evidenceUri,
                    );
                  },
                  "里程碑成果已提交",
                )
              }
              onApproveMilestone={(milestoneIndex) =>
                runAction(
                  async () => {
                    await approveMilestone(selectedProject.address, milestoneIndex);
                  },
                  "里程碑验证已提交",
                )
              }
              onReleaseMilestone={(milestoneIndex) =>
                runAction(
                  async () => {
                    await releaseMilestoneFunds(
                      selectedProject.address,
                      milestoneIndex,
                    );
                  },
                  "里程碑资金已释放",
                )
              }
```

- [ ] **Step 2: Extend `ProjectDetail` props and local state**

Add props:

```ts
  onSubmitMilestone: (milestoneIndex: number, evidenceUri: string) => void;
  onApproveMilestone: (milestoneIndex: number) => void;
  onReleaseMilestone: (milestoneIndex: number) => void;
```

Add local state at the top of `ProjectDetail`:

```ts
  const [evidenceUri, setEvidenceUri] = useState("");
```

Add computed values:

```ts
  const activeMilestone = project.milestones.find(
    (milestone) => BigInt(milestone.index) === project.nextMilestoneIndex,
  );
  const canUseMilestones =
    project.fundingModel === FundingModel.Milestone &&
    liveState === ProjectState.Successful;
```

- [ ] **Step 3: Render milestone panel**

Place this section before the contributors section in `ProjectDetail`:

```tsx
      {project.fundingModel === FundingModel.Milestone && (
        <section className="contributors">
          <div className="section-heading compact">
            <h3>里程碑释放</h3>
            <span>
              已释放 {formatEth(project.totalReleasedAmount)} /{" "}
              {formatEth(project.raisedAmount)}
            </span>
          </div>

          {canUseMilestones && activeMilestone && isCreator && !activeMilestone.submitted && (
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
```

- [ ] **Step 4: Hide one-shot creator withdrawal for milestone projects**

Change `canCreatorWithdraw` to:

```ts
  const canCreatorWithdraw =
    project.fundingModel === FundingModel.AllOrNothing &&
    liveState === ProjectState.Successful &&
    isCreator &&
    !project.creatorWithdrawn &&
    project.balance > 0n;
```

Change the success withdrawal text in the ended box:

```tsx
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
```

- [ ] **Step 5: Add presentation tests for milestone actions**

Add this test to `src/App.test.tsx`:

```ts
  it("renders milestone verification actions for successful milestone projects", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ProjectDetail
          account="0x3333333333333333333333333333333333333333"
          contributionAmount="0.01"
          loading={false}
          nowSeconds={2_000}
          project={{
            ...sampleProject,
            state: ProjectState.Successful,
            deadline: 1_000n,
            fundingModel: FundingModel.Milestone,
            userContribution: 1_000_000_000_000_000_000n,
            nextMilestoneIndex: 0n,
            milestones: [
              {
                index: 0,
                title: "Prototype",
                evidenceUri: "ipfs://prototype",
                releaseBps: 2_500,
                approvalWeight: 0n,
                submitted: true,
                released: false,
                releasedAmount: 0n,
                approved: false,
              },
            ],
          }}
          onBack={() => undefined}
          onContributionAmountChange={() => undefined}
          onContribute={() => undefined}
          onWithdrawCreator={() => undefined}
          onWithdrawContribution={() => undefined}
          onSubmitMilestone={() => undefined}
          onApproveMilestone={() => undefined}
          onReleaseMilestone={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain("里程碑释放");
    expect(host.textContent).toContain("Prototype");
    expect(host.textContent).toContain("验证进度 0%");

    const approveButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "验证",
    );
    expect(approveButton?.disabled).toBe(false);

    act(() => root.unmount());
    host.remove();
  });
```

Update all existing `ProjectDetail` test renders with:

```tsx
          onSubmitMilestone={() => undefined}
          onApproveMilestone={() => undefined}
          onReleaseMilestone={() => undefined}
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: add milestone project UI actions"
```

---

### Task 7: Styling And Final Verification

**Files:**
- Modify: `src/styles.css`
- Modify: `README.md`

- [ ] **Step 1: Add milestone styles**

Append to `src/styles.css`:

```css
.mode-fieldset {
  display: grid;
  gap: 10px;
  border: 1px solid #d5c8aa;
  border-radius: 8px;
  padding: 14px;
}

.mode-fieldset legend {
  padding: 0 6px;
  color: #5a513f;
  font-size: 14px;
  font-weight: 700;
}

.radio-row {
  grid-template-columns: auto 1fr;
  align-items: center;
  font-weight: 500;
}

.radio-row input {
  width: auto;
}

.milestone-editor,
.milestone-list {
  display: grid;
  gap: 10px;
}

.milestone-form-row,
.milestone-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(120px, 180px) auto;
  align-items: end;
  gap: 12px;
  border: 1px solid #d5c8aa;
  border-radius: 8px;
  background: #fffaf0;
  padding: 12px;
}

.milestone-submit {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 12px;
  margin-bottom: 12px;
}

.milestone-row {
  grid-template-columns: minmax(180px, 1fr) minmax(140px, 0.7fr) minmax(120px, auto) auto;
  align-items: center;
}

.milestone-row div:first-child {
  display: grid;
  gap: 4px;
}

.milestone-row p {
  margin: 0;
  color: #685f4d;
}

.milestone-row a {
  color: #6e5b2c;
  font-weight: 700;
  text-decoration: none;
}

.milestone-row a:hover {
  text-decoration: underline;
}

@media (max-width: 760px) {
  .milestone-form-row,
  .milestone-submit,
  .milestone-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Document the two project types**

Add this section to `README.md`:

```markdown
## Project Types

MyFundings supports two funding models:

- **All or nothing:** contributors fund until the deadline. If the project reaches the target, the creator withdraws the full balance. If it misses the target, contributors refund their own contribution.
- **Milestone release:** contributors fund until the deadline. If the project reaches the target, the creator submits each milestone result, contributors verify it, and the contract releases that milestone's percentage of the raised funds. Milestone approval is weighted by contribution amount and requires 50% of the raised amount.
```

- [ ] **Step 3: Run Solidity verification**

Run:

```bash
npx hardhat test solidity
```

Expected: PASS.

- [ ] **Step 4: Run frontend tests**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/styles.css README.md
git commit -m "docs: describe milestone project flow"
```

---

## Manual QA

- Deploy a fresh local `Crowdfunding` contract with Ignition:

```bash
npx hardhat ignition deploy ignition/modules/Crowdfunding.ts --network hardhatMainnet
```

- Start the frontend:

```bash
npm run dev
```

- In the browser, connect MetaMask to the local Hardhat network.
- Create an all-or-nothing project and confirm the project detail page still shows the existing contribution, creator withdrawal, and refund controls.
- Create a milestone project with two milestones adding to 100%.
- Contribute from two accounts, advance the local chain past the deadline, submit milestone evidence as the creator, approve as a contributor, and release funds.
- Confirm the first milestone releases its configured percentage and the final milestone drains the remaining balance.

## Self-Review

- Spec coverage: project creator can choose all-or-nothing or milestone; milestone projects store multiple milestones; supporters deposit into the project; creator submits milestone evidence; contributors verify; contract releases the milestone percentage after weighted approval.
- Placeholder scan: no placeholder steps remain; all code steps include concrete snippets and exact commands.
- Type consistency: Solidity uses `FundingModel`, `Milestone`, `submitMilestone`, `approveMilestone`, and `releaseMilestoneFunds`; frontend ABI, types, and calls use the same names and argument order.

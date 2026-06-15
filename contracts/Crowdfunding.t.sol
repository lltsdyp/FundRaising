// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Crowdfunding} from "./Crowdfunding.sol";
import {Project} from "./Project.sol";
import {Test} from "forge-std/Test.sol";

contract CrowdfundingTest is Test {
  Crowdfunding crowdfunding;

  address creator = address(0xA11CE);
  address contributor = address(0xB0B);
  address contributorTwo = address(0xCAFE);

  uint256 minimumContribution = 1 ether;
  uint256 targetContribution = 10 ether;
  uint256 deadline;

  function setUp() public {
    crowdfunding = new Crowdfunding();
    deadline = block.timestamp + 30 days;
  }

  function test_CreateProject() public {
    vm.prank(creator);
    crowdfunding.createProject(
      minimumContribution,
      deadline,
      targetContribution,
      "Education fund",
      "Books and equipment"
    );

    Project[] memory projects = crowdfunding.returnAllProjects();
    Project project = projects[0];

    assertEq(projects.length, 1);
    assertEq(project.creator(), creator);
    assertEq(project.minimumContribution(), minimumContribution);
    assertEq(project.deadline(), deadline);
    assertEq(project.targetContribution(), targetContribution);
    assertEq(project.raisedAmount(), 0);
    assertEq(project.noOfContributors(), 0);
    assertEq(project.projectTitle(), "Education fund");
    assertEq(project.projectDesc(), "Books and equipment");
    assertEq(uint256(project.state()), uint256(Project.State.Fundraising));
  }

  function test_ContributeThroughCrowdfunding() public {
    Project project = _createProject();

    vm.deal(contributor, 5 ether);
    vm.prank(contributor);
    crowdfunding.contribute{value: 2 ether}(address(project));

    assertEq(project.contributions(contributor), 2 ether);
    assertEq(project.raisedAmount(), 2 ether);
    assertEq(project.noOfContributors(), 1);
    assertEq(project.getContractBalance(), 2 ether);
  }

  function test_ContributorCountedOnce() public {
    Project project = _createProject();

    vm.deal(contributor, 5 ether);

    vm.prank(contributor);
    crowdfunding.contribute{value: 2 ether}(address(project));

    vm.prank(contributor);
    crowdfunding.contribute{value: 3 ether}(address(project));

    assertEq(project.contributions(contributor), 5 ether);
    assertEq(project.raisedAmount(), 5 ether);
    assertEq(project.noOfContributors(), 1);
  }

  function test_GetContributorsReturnsUniqueContributorList() public {
    Project project = _createProject();

    vm.deal(contributor, 5 ether);
    vm.deal(contributorTwo, 5 ether);

    vm.prank(contributor);
    crowdfunding.contribute{value: 2 ether}(address(project));

    vm.prank(contributor);
    crowdfunding.contribute{value: 1 ether}(address(project));

    vm.prank(contributorTwo);
    crowdfunding.contribute{value: 3 ether}(address(project));

    address[] memory contributors = project.getContributors();

    assertEq(contributors.length, 2);
    assertEq(contributors[0], contributor);
    assertEq(contributors[1], contributorTwo);
  }

  function test_OngoingAndRemainingTime() public {
    Project project = _createProject();

    assertTrue(project.isOngoing());
    assertEq(project.getRemainingTime(), 30 days);

    vm.warp(block.timestamp + 10 days);

    assertTrue(project.isOngoing());
    assertEq(project.getRemainingTime(), 20 days);
  }

  function test_ContributionAfterDeadlineReverts() public {
    Project project = _createProject();

    vm.warp(deadline);

    assertFalse(project.isOngoing());
    assertEq(project.getRemainingTime(), 0);

    vm.deal(contributor, 1 ether);
    vm.prank(contributor);
    vm.expectRevert(bytes("Project is not ongoing"));
    crowdfunding.contribute{value: 1 ether}(address(project));
  }

  function test_RefreshStateMarksProjectExpiredAfterDeadline() public {
    Project project = _createProject();

    vm.warp(deadline);

    project.refreshState();

    assertEq(uint256(project.state()), uint256(Project.State.Expired));
  }

  function test_GetProjectDetailsReturnsExpiredAfterDeadline() public {
    Project project = _createProject();

    vm.warp(deadline);

    (, , , , , , , , Project.State currentState, ) = project
      .getProjectDetails();

    assertEq(uint256(currentState), uint256(Project.State.Expired));
  }

  function test_ReachingTargetBeforeDeadlineKeepsFundraisingAndAllowsMoreContributions()
    public
  {
    Project project = _createProject();

    vm.deal(contributor, targetContribution);
    vm.deal(contributorTwo, minimumContribution);

    vm.prank(contributor);
    crowdfunding.contribute{value: targetContribution}(address(project));

    assertEq(uint256(project.state()), uint256(Project.State.Fundraising));
    assertTrue(project.isOngoing());

    vm.prank(contributorTwo);
    crowdfunding.contribute{value: minimumContribution}(address(project));

    assertEq(project.raisedAmount(), targetContribution + minimumContribution);
  }

  function test_EndProjectBeforeDeadlineReverts() public {
    Project project = _createProject();

    vm.expectRevert(bytes("Deadline has not passed"));
    project.endProject();
  }

  function test_EndProjectAfterDeadlineMarksSuccessfulWhenTargetReached()
    public
  {
    Project project = _createProject();

    vm.deal(contributor, targetContribution);
    vm.prank(contributor);
    crowdfunding.contribute{value: targetContribution}(address(project));

    vm.warp(deadline);

    vm.prank(contributorTwo);
    project.endProject();

    assertEq(uint256(project.state()), uint256(Project.State.Successful));
    assertFalse(project.isOngoing());
  }

  function test_ContributionAfterSuccessfulEndReverts() public {
    Project project = _createSuccessfulEndedProject();

    vm.deal(contributorTwo, minimumContribution);
    vm.prank(contributorTwo);
    vm.expectRevert(bytes("Project is not ongoing"));
    crowdfunding.contribute{value: minimumContribution}(address(project));
  }

  function test_CreatorWithdrawsFundsAfterSuccessfulEnd() public {
    Project project = _createSuccessfulEndedProject();

    assertEq(project.getContractBalance(), targetContribution);

    vm.prank(creator);
    project.withdrawRaisedFunds();

    assertEq(creator.balance, targetContribution);
    assertEq(project.getContractBalance(), 0);

    vm.prank(creator);
    vm.expectRevert(bytes("Funds already withdrawn"));
    project.withdrawRaisedFunds();
  }

  function test_OnlyCreatorCanWithdrawSuccessfulFunds() public {
    Project project = _createSuccessfulEndedProject();

    vm.prank(contributor);
    vm.expectRevert(bytes("Only creator"));
    project.withdrawRaisedFunds();
  }

  function test_ContributorWithdrawsContributionAfterFailedEnd() public {
    Project project = _createProject();

    vm.deal(contributor, 5 ether);
    vm.prank(contributor);
    crowdfunding.contribute{value: 2 ether}(address(project));

    vm.warp(deadline);
    project.endProject();

    assertEq(uint256(project.state()), uint256(Project.State.Expired));

    vm.prank(contributor);
    project.withdrawContribution();

    assertEq(contributor.balance, 5 ether);
    assertEq(project.contributions(contributor), 0);
    assertEq(project.getContractBalance(), 0);

    vm.prank(contributor);
    vm.expectRevert(bytes("No contribution to withdraw"));
    project.withdrawContribution();
  }

  function test_CreatorCannotWithdrawFromFailedProject() public {
    Project project = _createProject();

    vm.deal(contributor, 5 ether);
    vm.prank(contributor);
    crowdfunding.contribute{value: 2 ether}(address(project));

    vm.warp(deadline);
    project.endProject();

    vm.prank(creator);
    vm.expectRevert(bytes("Project is not successful"));
    project.withdrawRaisedFunds();
  }

  function test_ContributorCannotWithdrawFromSuccessfulProject() public {
    Project project = _createSuccessfulEndedProject();

    vm.prank(contributor);
    vm.expectRevert(bytes("Project did not fail"));
    project.withdrawContribution();
  }

  function test_ContributionBelowMinimumReverts() public {
    Project project = _createProject();

    vm.deal(contributor, 1 ether);
    vm.prank(contributor);
    vm.expectRevert(bytes("Contribution amount is too low !"));
    crowdfunding.contribute{value: 0.5 ether}(address(project));
  }

  function test_CreatorCannotContributeToOwnProject() public {
    Project project = _createProject();

    vm.deal(creator, 2 ether);
    vm.prank(creator);
    vm.expectRevert(bytes("Creator cannot contribute to own project"));
    crowdfunding.contribute{value: 1 ether}(address(project));
  }

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

  function test_CreatorCannotWithdrawMilestoneFundsThroughAllOrNothingPath()
    public
  {
    Project project = _createMilestoneProject();

    vm.deal(contributor, targetContribution);
    vm.prank(contributor);
    crowdfunding.contribute{value: targetContribution}(address(project));

    vm.warp(deadline);
    project.endProject();

    vm.prank(creator);
    vm.expectRevert(bytes("Milestone funds release by milestone"));
    project.withdrawRaisedFunds();
  }

  function _createProject() internal returns (Project) {
    vm.prank(creator);
    crowdfunding.createProject(
      minimumContribution,
      deadline,
      targetContribution,
      "Education fund",
      "Books and equipment"
    );

    Project[] memory projects = crowdfunding.returnAllProjects();
    return projects[0];
  }

  function _createMilestoneProject() internal returns (Project) {
    string[] memory titles = new string[](2);
    titles[0] = "Prototype";
    titles[1] = "Launch";

    uint16[] memory releaseBps = new uint16[](2);
    releaseBps[0] = 5_000;
    releaseBps[1] = 5_000;

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
    return projects[0];
  }

  function _createSuccessfulEndedProject() internal returns (Project) {
    Project project = _createProject();

    vm.deal(contributor, targetContribution);
    vm.prank(contributor);
    crowdfunding.contribute{value: targetContribution}(address(project));

    vm.warp(deadline);
    project.endProject();

    return project;
  }
}

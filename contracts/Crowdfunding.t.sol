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

  function test_ContributionMarksProjectSuccessfulWhenTargetReached() public {
    Project project = _createProject();

    vm.deal(contributor, targetContribution);
    vm.prank(contributor);
    crowdfunding.contribute{value: targetContribution}(address(project));

    assertEq(uint256(project.state()), uint256(Project.State.Successful));
    assertFalse(project.isOngoing());
  }

  function test_ContributionAfterSuccessReverts() public {
    Project project = _createProject();

    vm.deal(contributor, targetContribution);
    vm.prank(contributor);
    crowdfunding.contribute{value: targetContribution}(address(project));

    vm.deal(contributorTwo, minimumContribution);
    vm.prank(contributorTwo);
    vm.expectRevert(bytes("Project is not ongoing"));
    crowdfunding.contribute{value: minimumContribution}(address(project));
  }

  function test_ContributionBelowMinimumReverts() public {
    Project project = _createProject();

    vm.deal(contributor, 1 ether);
    vm.prank(contributor);
    vm.expectRevert(bytes("Contribution amount is too low !"));
    crowdfunding.contribute{value: 0.5 ether}(address(project));
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
}

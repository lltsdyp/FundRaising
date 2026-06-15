// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Project} from "./Project.sol";

contract Crowdfunding {
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

  event ContributionReceived(
    address indexed projectAddress,
    uint256 contributedAmount,
    address indexed contributor
  );

  Project[] private projects;

  function createProject(
    uint256 minimumContribution,
    uint256 deadline,
    uint256 targetContribution,
    string memory projectTitle,
    string memory projectDesc
  ) external {
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
      uint256(Project.FundingModel.AllOrNothing)
    );
  }

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

  function returnAllProjects() external view returns (Project[] memory) {
    return projects;
  }

  function contribute(address projectAddress) external payable {
    Project project = Project(projectAddress);

    uint256 minContributionAmount = project.minimumContribution();
    require(project.isOngoing(), "Project is not ongoing");
    require(msg.value >= minContributionAmount, "Contribution amount is too low !");

    project.contribute{value: msg.value}(msg.sender);

    emit ContributionReceived(projectAddress, msg.value, msg.sender);
  }
}

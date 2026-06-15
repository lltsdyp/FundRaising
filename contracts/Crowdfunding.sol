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
    uint256 currentState
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
    Project newProject = new Project(
      msg.sender,
      minimumContribution,
      deadline,
      targetContribution,
      projectTitle,
      projectDesc
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
      uint256(Project.State.Fundraising)
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

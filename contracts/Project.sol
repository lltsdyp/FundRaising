// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract Project {
  enum State {
    Fundraising,
    Expired,
    Successful
  }

  address payable public creator;
  uint256 public minimumContribution;
  uint256 public deadline;
  uint256 public targetContribution;
  uint256 public raisedAmount;
  uint256 public noOfContributors;
  string public projectTitle;
  string public projectDesc;
  State public state = State.Fundraising;

  mapping(address contributor => uint256 amount) public contributions;

  event FundingReceived(
    address indexed contributor,
    uint256 amount,
    uint256 currentTotal
  );

  constructor(
    address _creator,
    uint256 _minimumContribution,
    uint256 _deadline,
    uint256 _targetContribution,
    string memory _projectTitle,
    string memory _projectDesc
  ) {
    require(_creator != address(0), "Invalid creator");
    require(_minimumContribution > 0, "Minimum contribution is zero");
    require(_targetContribution > 0, "Target contribution is zero");
    require(_deadline > block.timestamp, "Deadline must be in the future");
    require(bytes(_projectTitle).length > 0, "Project title is empty");

    creator = payable(_creator);
    minimumContribution = _minimumContribution;
    deadline = _deadline;
    targetContribution = _targetContribution;
    projectTitle = _projectTitle;
    projectDesc = _projectDesc;
  }

  function contribute(address _contributor) external payable {
    require(state == State.Fundraising, "Invalid state");
    require(_contributor != address(0), "Invalid contributor");
    require(msg.value >= minimumContribution, "Contribution amount is too low !");

    if (contributions[_contributor] == 0) {
      noOfContributors++;
    }

    contributions[_contributor] += msg.value;
    raisedAmount += msg.value;

    emit FundingReceived(_contributor, msg.value, raisedAmount);
  }

  function getContractBalance() external view returns (uint256) {
    return address(this).balance;
  }

  function getProjectDetails()
    external
    view
    returns (
      address payable projectStarter,
      uint256 minContribution,
      uint256 projectDeadline,
      uint256 goalAmount,
      uint256 currentAmount,
      uint256 contributorCount,
      string memory title,
      string memory desc,
      State currentState,
      uint256 balance
    )
  {
    projectStarter = creator;
    minContribution = minimumContribution;
    projectDeadline = deadline;
    goalAmount = targetContribution;
    currentAmount = raisedAmount;
    contributorCount = noOfContributors;
    title = projectTitle;
    desc = projectDesc;
    currentState = state;
    balance = address(this).balance;
  }
}

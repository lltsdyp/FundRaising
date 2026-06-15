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
  address[] private contributors;

  event FundingReceived(
    address indexed contributor,
    uint256 amount,
    uint256 currentTotal
  );

  event StateChanged(State previousState, State newState);

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
    refreshState();

    require(state == State.Fundraising, "Project is not ongoing");
    require(_contributor != address(0), "Invalid contributor");
    require(msg.value >= minimumContribution, "Contribution amount is too low !");

    if (contributions[_contributor] == 0) {
      contributors.push(_contributor);
      noOfContributors++;
    }

    contributions[_contributor] += msg.value;
    raisedAmount += msg.value;
    refreshState();

    emit FundingReceived(_contributor, msg.value, raisedAmount);
  }

  function getContractBalance() external view returns (uint256) {
    return address(this).balance;
  }

  function getContributors() external view returns (address[] memory) {
    return contributors;
  }

  function getCurrentState() public view returns (State) {
    if (raisedAmount >= targetContribution) {
      return State.Successful;
    }

    if (block.timestamp >= deadline) {
      return State.Expired;
    }

    return State.Fundraising;
  }

  function refreshState() public returns (State) {
    State currentState = getCurrentState();

    if (currentState != state) {
      State previousState = state;
      state = currentState;
      emit StateChanged(previousState, currentState);
    }

    return state;
  }

  function isOngoing() public view returns (bool) {
    return getCurrentState() == State.Fundraising;
  }

  function getRemainingTime() public view returns (uint256) {
    if (block.timestamp >= deadline) {
      return 0;
    }

    return deadline - block.timestamp;
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
    currentState = getCurrentState();
    balance = address(this).balance;
  }
}

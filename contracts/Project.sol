// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract Project {
  enum State {
    Fundraising,
    Expired,
    Successful
  }

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

  address payable public creator;
  uint256 public minimumContribution;
  uint256 public deadline;
  uint256 public targetContribution;
  uint256 public raisedAmount;
  uint256 public noOfContributors;
  string public projectTitle;
  string public projectDesc;
  State public state = State.Fundraising;
  bool public projectEnded;
  bool public creatorWithdrawn;
  FundingModel public fundingModel;
  uint256 public nextMilestoneIndex;
  uint256 public totalReleasedAmount;

  mapping(address contributor => uint256 amount) public contributions;
  Milestone[] private milestones;
  mapping(uint256 milestoneIndex => mapping(address contributor => bool approved))
    public milestoneApprovals;
  address[] private contributors;

  event FundingReceived(
    address indexed contributor,
    uint256 amount,
    uint256 currentTotal
  );

  event StateChanged(State previousState, State newState);
  event ProjectEnded(
    State finalState,
    uint256 raisedAmount,
    uint256 targetContribution
  );
  event CreatorWithdrawal(address indexed creator, uint256 amount);
  event ContributionRefunded(address indexed contributor, uint256 amount);

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
  }

  function contribute(address _contributor) external payable {
    refreshState();

    require(state == State.Fundraising, "Project is not ongoing");
    require(_contributor != address(0), "Invalid contributor");
    require(_contributor != creator, "Creator cannot contribute to own project");
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
    if (block.timestamp < deadline) {
      return State.Fundraising;
    }

    if (raisedAmount >= targetContribution) {
      return State.Successful;
    }

    return State.Expired;
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

  function endProject() external returns (State) {
    return _finalizeProject();
  }

  function withdrawRaisedFunds() external {
    require(msg.sender == creator, "Only creator");

    State currentState = _finalizeProject();

    require(currentState == State.Successful, "Project is not successful");
    require(!creatorWithdrawn, "Funds already withdrawn");

    uint256 amount = address(this).balance;
    require(amount > 0, "No funds to withdraw");

    creatorWithdrawn = true;

    (bool success, ) = creator.call{value: amount}("");
    require(success, "Creator withdrawal failed");

    emit CreatorWithdrawal(creator, amount);
  }

  function withdrawContribution() external {
    State currentState = _finalizeProject();

    require(currentState == State.Expired, "Project did not fail");

    uint256 amount = contributions[msg.sender];
    require(amount > 0, "No contribution to withdraw");

    contributions[msg.sender] = 0;

    (bool success, ) = payable(msg.sender).call{value: amount}("");
    require(success, "Contribution refund failed");

    emit ContributionRefunded(msg.sender, amount);
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

  function _finalizeProject() internal returns (State) {
    require(block.timestamp >= deadline, "Deadline has not passed");

    State finalState = refreshState();

    if (!projectEnded) {
      projectEnded = true;
      emit ProjectEnded(finalState, raisedAmount, targetContribution);
    }

    return finalState;
  }
}

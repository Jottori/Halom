// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LPStaking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant REWARDER_ROLE = keccak256("REWARDER_ROLE");

    IERC20 public immutable lpToken;
    IERC20 public immutable halomToken;

    uint256 public totalStaked;
    mapping(address => uint256) public stakedBalance;

    uint256 public rewardsPerShare;
    mapping(address => uint256) public rewardDebt;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardAdded(address indexed rewarder, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor(
        address _lpToken,
        address _halomToken,
        address _governor,
        address _rewarder
    ) {
        require(_lpToken != address(0), "LP token is zero address");
        require(_halomToken != address(0), "Halom token is zero address");

        lpToken = IERC20(_lpToken);
        halomToken = IERC20(_halomToken);

        _grantRole(DEFAULT_ADMIN_ROLE, _governor);
        _grantRole(GOVERNOR_ROLE, _governor);
        _grantRole(REWARDER_ROLE, _rewarder);
    }

    modifier updateRewards(address _account) {
        uint256 pending = (stakedBalance[_account] * rewardsPerShare) / 1e18 - rewardDebt[_account];
        if (pending > 0) {
            halomToken.safeTransfer(_account, pending);
            emit RewardClaimed(_account, pending);
        }
        _;
        rewardDebt[_account] = (stakedBalance[_account] * rewardsPerShare) / 1e18;
    }

    function stake(uint256 _amount) external nonReentrant updateRewards(msg.sender) {
        require(_amount > 0, "Cannot stake 0");
        totalStaked += _amount;
        stakedBalance[msg.sender] += _amount;
        lpToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount);
    }

    function unstake(uint256 _amount) external nonReentrant updateRewards(msg.sender) {
        require(_amount > 0, "Cannot unstake 0");
        require(stakedBalance[msg.sender] >= _amount, "Insufficient staked balance");
        totalStaked -= _amount;
        stakedBalance[msg.sender] -= _amount;
        lpToken.safeTransfer(msg.sender, _amount);
        emit Unstaked(msg.sender, _amount);
    }
    
    function claimRewards() external nonReentrant updateRewards(msg.sender) {
        // The updateRewards modifier handles the logic
    }

    function addRewards(uint256 _amount) external onlyRole(REWARDER_ROLE) {
        require(_amount > 0, "Cannot add 0 rewards");
        if (totalStaked == 0) {
            // If no one is staked, the rewards are lost. This is a design choice.
            // Alternatively, they could be held for the first staker.
            return;
        }
        
        halomToken.safeTransferFrom(msg.sender, address(this), _amount);
        rewardsPerShare += (_amount * 1e18) / totalStaked;
        emit RewardAdded(msg.sender, _amount);
    }

    function pendingRewards(address _account) external view returns (uint256) {
        return (stakedBalance[_account] * rewardsPerShare) / 1e18 - rewardDebt[_account];
    }
} 

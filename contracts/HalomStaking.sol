// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract HalomStaking is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant REWARDER_ROLE = keccak256("REWARDER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable halomToken;

    uint256 public totalStaked;
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public lastClaimTime;

    // Fourth root based reward system
    uint256 public totalFourthRootStake; // Sum of fourth roots of all stakes
    mapping(address => uint256) public fourthRootStake; // Fourth root of user's stake
    uint256 public rewardsPerFourthRoot; // Rewards per fourth root unit
    mapping(address => uint256) public rewardDebt;

    // Emergency recovery
    uint256 public pendingRewards; // Rewards waiting for first staker

    // Staking parameters
    uint256 public minStakeAmount = 100e18; // 100 HLM minimum
    uint256 public maxStakeAmount = 1000000e18; // 1M HLM maximum
    uint256 public lockPeriod = 30 days; // 30 day lock period
    mapping(address => uint256) public stakeTime;

    event Staked(address indexed user, uint256 amount, uint256 lockTime);
    event Unstaked(address indexed user, uint256 amount);
    event RewardAdded(address indexed rewarder, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event EmergencyRecovery(address indexed token, address indexed to, uint256 amount);
    event PendingRewardsClaimed(address indexed user, uint256 amount);
    event StakingParametersUpdated(uint256 minStake, uint256 maxStake, uint256 lockPeriod);

    constructor(
        address _halomToken,
        address _governor,
        address _rewarder,
        address _pauser
    ) {
        require(_halomToken != address(0), "Halom token is zero address");

        halomToken = IERC20(_halomToken);

        _grantRole(DEFAULT_ADMIN_ROLE, _governor);
        _grantRole(GOVERNOR_ROLE, _governor);
        _grantRole(REWARDER_ROLE, _rewarder);
        _grantRole(PAUSER_ROLE, _pauser);
    }

    /**
     * @dev Calculate fourth root using Babylonian method
     */
    function fourthRoot(uint256 x) public pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = x;
        uint256 y = (z + 3) / 4;
        
        while (y < z) {
            z = y;
            y = (3 * z + x / (z * z * z)) / 4;
        }
        return z;
    }

    /**
     * @dev Get governance power (fourth root of stake)
     */
    function getGovernancePower(address user) public view returns (uint256) {
        return fourthRoot(stakedBalance[user]);
    }

    modifier updateRewards(address _account) {
        uint256 pending = (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_account];
        if (pending > 0) {
            halomToken.safeTransfer(_account, pending);
            emit RewardClaimed(_account, pending);
        }
        _;
        rewardDebt[_account] = (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18;
    }

    function stake(uint256 _amount) external nonReentrant whenNotPaused updateRewards(msg.sender) {
        require(_amount >= minStakeAmount, "Below minimum stake amount");
        require(_amount <= maxStakeAmount, "Above maximum stake amount");
        require(stakedBalance[msg.sender] + _amount <= maxStakeAmount, "Would exceed maximum stake");
        
        // If this is the first staker and there are pending rewards, distribute them
        if (totalStaked == 0 && pendingRewards > 0) {
            rewardsPerFourthRoot = (pendingRewards * 1e18) / fourthRoot(_amount);
            pendingRewards = 0;
            emit PendingRewardsClaimed(msg.sender, pendingRewards);
        }
        
        // Calculate old and new fourth root values
        uint256 oldFourthRoot = fourthRootStake[msg.sender];
        uint256 newStake = stakedBalance[msg.sender] + _amount;
        uint256 newFourthRoot = fourthRoot(newStake);
        
        // Update totals
        totalStaked += _amount;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        // Update user state
        stakedBalance[msg.sender] = newStake;
        fourthRootStake[msg.sender] = newFourthRoot;
        stakeTime[msg.sender] = block.timestamp;
        lastClaimTime[msg.sender] = block.timestamp;
        
        halomToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount, block.timestamp);
    }

    function unstake(uint256 _amount) external nonReentrant whenNotPaused updateRewards(msg.sender) {
        require(_amount > 0, "Cannot unstake 0");
        require(stakedBalance[msg.sender] >= _amount, "Insufficient staked balance");
        require(block.timestamp >= stakeTime[msg.sender] + lockPeriod, "Lock period not expired");
        
        // Calculate old and new fourth root values
        uint256 oldFourthRoot = fourthRootStake[msg.sender];
        uint256 newStake = stakedBalance[msg.sender] - _amount;
        uint256 newFourthRoot = fourthRoot(newStake);
        
        // Update totals
        totalStaked -= _amount;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        // Update user state
        stakedBalance[msg.sender] = newStake;
        fourthRootStake[msg.sender] = newFourthRoot;
        
        halomToken.safeTransfer(msg.sender, _amount);
        emit Unstaked(msg.sender, _amount);
    }
    
    function claimRewards() external nonReentrant whenNotPaused updateRewards(msg.sender) {
        // The updateRewards modifier handles the logic
    }

    function addRewards(uint256 _amount) external onlyRole(REWARDER_ROLE) {
        require(_amount > 0, "Cannot add 0 rewards");
        
        halomToken.safeTransferFrom(msg.sender, address(this), _amount);
        
        if (totalFourthRootStake == 0) {
            // Store rewards for the first staker instead of losing them
            pendingRewards += _amount;
            emit RewardAdded(msg.sender, _amount);
        } else {
            rewardsPerFourthRoot += (_amount * 1e18) / totalFourthRootStake;
            emit RewardAdded(msg.sender, _amount);
        }
    }

    function getPendingRewardsForUser(address _account) external view returns (uint256) {
        return (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_account];
    }

    /**
     * @dev Update staking parameters (only governor)
     */
    function updateStakingParameters(
        uint256 _minStakeAmount,
        uint256 _maxStakeAmount,
        uint256 _lockPeriod
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_minStakeAmount <= _maxStakeAmount, "Min stake cannot exceed max stake");
        require(_lockPeriod <= 365 days, "Lock period too long");
        
        minStakeAmount = _minStakeAmount;
        maxStakeAmount = _maxStakeAmount;
        lockPeriod = _lockPeriod;
        
        emit StakingParametersUpdated(_minStakeAmount, _maxStakeAmount, _lockPeriod);
    }

    /**
     * @dev Emergency recovery function to withdraw tokens sent by mistake
     * @param _token Token address to recover
     * @param _to Address to send tokens to
     * @param _amount Amount to recover
     */
    function emergencyRecovery(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_to != address(0), "Cannot recover to zero address");
        require(_amount > 0, "Cannot recover 0 amount");
        
        // Prevent recovery of staked tokens
        require(_token != address(halomToken), "Cannot recover staked tokens");
        
        IERC20(_token).safeTransfer(_to, _amount);
        emit EmergencyRecovery(_token, _to, _amount);
    }

    /**
     * @dev Pause staking (only pauser)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause staking (only governor)
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Get pending rewards for first staker
     */
    function getPendingRewards() external view returns (uint256) {
        return pendingRewards;
    }

    /**
     * @dev Get total contract balances
     */
    function getContractBalances() external view returns (
        uint256 halomTokenBalance,
        uint256 pendingRewardsBalance
    ) {
        halomTokenBalance = halomToken.balanceOf(address(this));
        pendingRewardsBalance = pendingRewards;
    }

    /**
     * @dev Get total fourth root stake
     */
    function getTotalFourthRootStake() external view returns (uint256) {
        return totalFourthRootStake;
    }

    /**
     * @dev Get user's lock status
     */
    function getUserLockStatus(address _user) external view returns (
        uint256 stakedAmount,
        uint256 stakeTimestamp,
        uint256 lockEndTime,
        bool isLocked
    ) {
        stakedAmount = stakedBalance[_user];
        stakeTimestamp = stakeTime[_user];
        lockEndTime = stakeTimestamp + lockPeriod;
        isLocked = block.timestamp < lockEndTime;
    }
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./libraries/GovernanceMath.sol";
import "./libraries/GovernanceErrors.sol";

contract HalomStaking is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using GovernanceMath for uint256;

    bytes32 public constant STAKING_ADMIN_ROLE = keccak256("STAKING_ADMIN_ROLE");
    bytes32 public constant REWARD_MANAGER_ROLE = keccak256("REWARD_MANAGER_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    struct StakerInfo {
        uint256 stakedAmount;
        uint256 rewardDebt;
        uint256 lastClaimTime;
        uint256 lockEndTime;
        uint256 lockBoost;
        bool isActive;
    }
    
    struct PoolInfo {
        uint256 totalStaked;
        uint256 rewardPerSecond;
        uint256 lastRewardTime;
        uint256 accRewardPerShare;
        uint256 totalRewardDistributed;
        bool isActive;
    }
    
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    
    PoolInfo public poolInfo;
    mapping(address => StakerInfo) public stakerInfo;
    
    uint256 public constant MIN_STAKE_AMOUNT = 1e16;
    uint256 public constant MAX_LOCK_DURATION = 365 days;
    uint256 public constant MIN_LOCK_DURATION = 1 days;
    uint256 public constant MAX_LOCK_BOOST = 300; // 3x boost
    uint256 public constant BOOST_PRECISION = 100;
    
    event Staked(address indexed user, uint256 amount, uint256 lockDuration);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardCompounded(address indexed user, uint256 amount);
    event Slashed(address indexed user, uint256 amount, string reason);
    event PoolUpdated(uint256 rewardPerSecond, uint256 totalStaked);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);
    
    error InvalidAmount();
    error InvalidLockDuration();
    error InsufficientStake();
    error NoRewardsToClaim();
    error LockNotExpired();
    error PoolNotActive();
    error InvalidPool();
    error Unauthorized();
    error ContractPaused();
    
    constructor(
        address _stakingToken, 
        address _roleManager, 
        uint256 _rewardRate
    ) {
        if (_stakingToken == address(0) || _roleManager == address(0)) revert InvalidPool();
        
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_stakingToken); // Same token for staking and rewards
        
        _grantRole(DEFAULT_ADMIN_ROLE, _roleManager);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(STAKING_ADMIN_ROLE, _roleManager);
        _grantRole(REWARD_MANAGER_ROLE, _roleManager);
        _grantRole(SLASHER_ROLE, _roleManager);
        _grantRole(EMERGENCY_ROLE, _roleManager);
        
        poolInfo = PoolInfo({
            totalStaked: 0,
            rewardPerSecond: _rewardRate,
            lastRewardTime: block.timestamp,
            accRewardPerShare: 0,
            totalRewardDistributed: 0,
            isActive: true
        });
    }
    
    modifier onlyStakingAdmin() {
        if (!hasRole(STAKING_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyRewardManager() {
        if (!hasRole(REWARD_MANAGER_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlySlasher() {
        if (!hasRole(SLASHER_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier whenNotPausedStaking() {
        if (paused()) revert ContractPaused();
        _;
    }
    
    modifier whenPoolActive() {
        if (!poolInfo.isActive) revert PoolNotActive();
        _;
    }
    
    function stake(uint256 amount, uint256 lockDuration) external whenNotPausedStaking whenPoolActive nonReentrant {
        if (amount < MIN_STAKE_AMOUNT) revert InvalidAmount();
        if (lockDuration < MIN_LOCK_DURATION || lockDuration > MAX_LOCK_DURATION) revert InvalidLockDuration();
        
        _updatePool();
        
        StakerInfo storage staker = stakerInfo[msg.sender];
        uint256 pendingReward = _calculatePendingReward(msg.sender);
        
        if (pendingReward > 0) {
            staker.rewardDebt = staker.rewardDebt + pendingReward;
        }
        
        uint256 lockBoost = GovernanceMath.calculateLockBoost(lockDuration, MAX_LOCK_DURATION, MAX_LOCK_BOOST);
        uint256 effectiveAmount = amount * lockBoost / BOOST_PRECISION;
        
        staker.stakedAmount = staker.stakedAmount + effectiveAmount;
        staker.lastClaimTime = block.timestamp;
        staker.lockEndTime = block.timestamp + lockDuration;
        staker.lockBoost = lockBoost;
        staker.isActive = true;
        
        poolInfo.totalStaked = poolInfo.totalStaked + effectiveAmount;
        
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        
        emit Staked(msg.sender, amount, lockDuration);
    }
    
    function unstake(uint256 amount) external whenNotPausedStaking nonReentrant {
        if (amount == 0) revert InvalidAmount();
        
        StakerInfo storage staker = stakerInfo[msg.sender];
        if (staker.stakedAmount < amount) revert InsufficientStake();
        if (block.timestamp < staker.lockEndTime) revert LockNotExpired();
        
        _updatePool();
        
        uint256 pendingReward = _calculatePendingReward(msg.sender);
        if (pendingReward > 0) {
            staker.rewardDebt = staker.rewardDebt + pendingReward;
        }
        
        uint256 actualAmount = amount * BOOST_PRECISION / staker.lockBoost;
        staker.stakedAmount = staker.stakedAmount - amount;
        
        if (staker.stakedAmount == 0) {
            staker.isActive = false;
            staker.lockBoost = 0;
        }
        
        poolInfo.totalStaked = poolInfo.totalStaked - amount;
        
        stakingToken.safeTransfer(msg.sender, actualAmount);
        
        emit Unstaked(msg.sender, actualAmount);
    }
    
    function claimReward() external whenNotPausedStaking nonReentrant {
        _updatePool();
        
        uint256 pendingReward = _calculatePendingReward(msg.sender);
        if (pendingReward == 0) revert NoRewardsToClaim();
        
        StakerInfo storage staker = stakerInfo[msg.sender];
        staker.rewardDebt = staker.rewardDebt + pendingReward;
        staker.lastClaimTime = block.timestamp;
        
        poolInfo.totalRewardDistributed = poolInfo.totalRewardDistributed + pendingReward;
        
        rewardToken.safeTransfer(msg.sender, pendingReward);
        
        emit RewardClaimed(msg.sender, pendingReward);
    }
    
    function compound() external whenNotPausedStaking whenPoolActive nonReentrant {
        _updatePool();
        
        uint256 pendingReward = _calculatePendingReward(msg.sender);
        if (pendingReward == 0) revert NoRewardsToClaim();
        
        StakerInfo storage staker = stakerInfo[msg.sender];
        staker.rewardDebt = staker.rewardDebt + pendingReward;
        staker.stakedAmount = staker.stakedAmount + pendingReward;
        staker.lastClaimTime = block.timestamp;
        
        poolInfo.totalStaked = poolInfo.totalStaked + pendingReward;
        poolInfo.totalRewardDistributed = poolInfo.totalRewardDistributed + pendingReward;
        
        emit RewardCompounded(msg.sender, pendingReward);
    }
    
    function slash(address user, uint256 amount, string calldata reason) external onlySlasher {
        if (amount == 0) revert InvalidAmount();
        
        StakerInfo storage staker = stakerInfo[user];
        if (staker.stakedAmount < amount) {
            amount = staker.stakedAmount;
        }
        
        if (amount > 0) {
            uint256 actualAmount = amount * BOOST_PRECISION / staker.lockBoost;
            staker.stakedAmount = staker.stakedAmount - amount;
            
            if (staker.stakedAmount == 0) {
                staker.isActive = false;
                staker.lockBoost = 0;
            }
            
            poolInfo.totalStaked = poolInfo.totalStaked - amount;
            
            stakingToken.safeTransfer(address(this), actualAmount);
            
            emit Slashed(user, actualAmount, reason);
        }
    }
    
    function setRewardRate(uint256 rewardPerSecond) external onlyRewardManager {
        _updatePool();
        poolInfo.rewardPerSecond = rewardPerSecond;
        emit PoolUpdated(rewardPerSecond, poolInfo.totalStaked);
    }
    
    function setPoolActive(bool isActive) external onlyStakingAdmin {
        poolInfo.isActive = isActive;
    }
    
    function emergencyPause() external onlyEmergency {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
    
    function emergencyUnpause() external onlyEmergency {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
    
    function _updatePool() internal {
        PoolInfo storage pool = poolInfo;
        if (block.timestamp <= pool.lastRewardTime) return;
        
        if (pool.totalStaked > 0 && pool.rewardPerSecond > 0) {
            uint256 timeElapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward = timeElapsed * pool.rewardPerSecond;
            pool.accRewardPerShare = pool.accRewardPerShare + (reward * 1e18 / pool.totalStaked);
        }
        
        pool.lastRewardTime = block.timestamp;
    }
    
    function _calculatePendingReward(address user) internal view returns (uint256) {
        StakerInfo memory staker = stakerInfo[user];
        if (staker.stakedAmount == 0) return 0;
        
        PoolInfo memory pool = poolInfo;
        uint256 accRewardPerShare = pool.accRewardPerShare;
        
        if (block.timestamp > pool.lastRewardTime && pool.totalStaked > 0 && pool.rewardPerSecond > 0) {
            uint256 timeElapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward = timeElapsed * pool.rewardPerSecond;
            accRewardPerShare = accRewardPerShare + (reward * 1e18 / pool.totalStaked);
        }
        
        return (staker.stakedAmount * accRewardPerShare / 1e18) - staker.rewardDebt;
    }
    
    function getPendingReward(address user) external view returns (uint256) {
        return _calculatePendingReward(user);
    }
    
    function getStakerInfo(address user) external view returns (StakerInfo memory) {
        return stakerInfo[user];
    }
    
    function getPoolInfo() external view returns (PoolInfo memory) {
        return poolInfo;
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
    
    function addRewards(uint256 amount) external onlyRewardManager {
        if (amount == 0) revert InvalidAmount();
        
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        poolInfo.totalRewardDistributed = poolInfo.totalRewardDistributed + amount;
        
        emit PoolUpdated(poolInfo.rewardPerSecond, poolInfo.totalStaked);
    }
    
    function stakedBalance(address user) external view returns (uint256) {
        return stakerInfo[user].stakedAmount;
    }
    
    function oracle() external pure returns (address) {
        return address(0);
    }
    
    function treasury() external pure returns (address) {
        return address(0);
    }
} 
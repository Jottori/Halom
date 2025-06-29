// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./libraries/GovernanceMath.sol";
import "./libraries/GovernanceErrors.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract HalomLPStaking is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using GovernanceMath for uint256;
    
    bytes32 public constant LP_ADMIN_ROLE = keccak256("LP_ADMIN_ROLE");
    bytes32 public constant REWARD_MANAGER_ROLE = keccak256("REWARD_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    struct LPStakerInfo {
        uint256 lpAmount;
        uint256 rewardDebt;
        uint256 lastClaimTime;
        uint256 lockEndTime;
        uint256 lockBoost;
        bool isActive;
    }
    
    struct LPPoolInfo {
        uint256 totalLPStaked;
        uint256 rewardPerSecond;
        uint256 lastRewardTime;
        uint256 accRewardPerShare;
        uint256 totalRewardDistributed;
        bool isActive;
    }

    IERC20 public immutable lpToken;
    IERC20 public immutable rewardToken;
    
    LPPoolInfo public lpPoolInfo;
    mapping(address => LPStakerInfo) public lpStakerInfo;
    
    uint256 public constant MIN_LP_STAKE_AMOUNT = 1e18;
    uint256 public constant MAX_LP_LOCK_DURATION = 365 days;
    uint256 public constant MIN_LP_LOCK_DURATION = 1 days;
    uint256 public constant MAX_LP_LOCK_BOOST = 250; // 2.5x boost
    uint256 public constant LP_BOOST_PRECISION = 100;
    
    event LPStaked(address indexed user, uint256 amount, uint256 lockDuration);
    event LPUnstaked(address indexed user, uint256 amount);
    event LPRewardClaimed(address indexed user, uint256 amount);
    event LPRewardCompounded(address indexed user, uint256 amount);
    event LPPoolUpdated(uint256 rewardPerSecond, uint256 totalLPStaked);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);
    
    error InvalidLPAmount();
    error InvalidLPLockDuration();
    error InsufficientLPStake();
    error NoLPRewardsToClaim();
    error LPLockNotExpired();
    error LPPoolNotActive();
    error InvalidLPPool();
    error Unauthorized();
    error ContractPaused();
    
    constructor(address _lpToken, address _rewardToken, address _roleManager, uint256 _rewardRate) {
        if (_lpToken == address(0) || _rewardToken == address(0) || _roleManager == address(0)) revert InvalidLPPool();

        lpToken = IERC20(_lpToken);
        rewardToken = IERC20(_rewardToken);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _roleManager);
        _grantRole(LP_ADMIN_ROLE, _roleManager);
        _grantRole(REWARD_MANAGER_ROLE, _roleManager);
        _grantRole(EMERGENCY_ROLE, _roleManager);
        
        lpPoolInfo = LPPoolInfo({
            totalLPStaked: 0,
            rewardPerSecond: _rewardRate,
            lastRewardTime: block.timestamp,
            accRewardPerShare: 0,
            totalRewardDistributed: 0,
            isActive: true
        });
    }
    
    modifier onlyLPAdmin() {
        if (!hasRole(LP_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyRewardManager() {
        if (!hasRole(REWARD_MANAGER_ROLE, msg.sender)) revert Unauthorized();
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
    
    modifier whenLPPoolActive() {
        if (!lpPoolInfo.isActive) revert LPPoolNotActive();
        _;
    }
    
    function stakeLP(uint256 amount, uint256 lockDuration) external whenNotPausedStaking whenLPPoolActive nonReentrant {
        if (amount < MIN_LP_STAKE_AMOUNT) revert InvalidLPAmount();
        if (lockDuration < MIN_LP_LOCK_DURATION || lockDuration > MAX_LP_LOCK_DURATION) revert InvalidLPLockDuration();
        
        _updateLPPool();
        
        LPStakerInfo storage staker = lpStakerInfo[msg.sender];
        uint256 pendingReward = _calculatePendingLPReward(msg.sender);
        
        if (pendingReward > 0) {
            staker.rewardDebt = staker.rewardDebt + pendingReward;
        }
        
        uint256 lockBoost = GovernanceMath.calculateLockBoost(lockDuration, MAX_LP_LOCK_DURATION, MAX_LP_LOCK_BOOST);
        uint256 effectiveAmount = amount * lockBoost / LP_BOOST_PRECISION;
        
        staker.lpAmount = staker.lpAmount + effectiveAmount;
        staker.lastClaimTime = block.timestamp;
        staker.lockEndTime = block.timestamp + lockDuration;
        staker.lockBoost = lockBoost;
        staker.isActive = true;
        
        lpPoolInfo.totalLPStaked = lpPoolInfo.totalLPStaked + effectiveAmount;
        
        lpToken.safeTransferFrom(msg.sender, address(this), amount);
        
        emit LPStaked(msg.sender, amount, lockDuration);
    }
    
    function unstakeLP(uint256 amount) external whenNotPausedStaking nonReentrant {
        if (amount == 0) revert InvalidLPAmount();
        
        LPStakerInfo storage staker = lpStakerInfo[msg.sender];
        if (staker.lpAmount < amount) revert InsufficientLPStake();
        if (block.timestamp < staker.lockEndTime) revert LPLockNotExpired();
        
        _updateLPPool();
        
        uint256 pendingReward = _calculatePendingLPReward(msg.sender);
        if (pendingReward > 0) {
            staker.rewardDebt = staker.rewardDebt + pendingReward;
        }
        
        uint256 actualAmount = amount * LP_BOOST_PRECISION / staker.lockBoost;
        staker.lpAmount = staker.lpAmount - amount;
        
        if (staker.lpAmount == 0) {
            staker.isActive = false;
            staker.lockBoost = 0;
        }
        
        lpPoolInfo.totalLPStaked = lpPoolInfo.totalLPStaked - amount;
        
        lpToken.safeTransfer(msg.sender, actualAmount);
        
        emit LPUnstaked(msg.sender, actualAmount);
    }
    
    function claimLPReward() external whenNotPausedStaking nonReentrant {
        _updateLPPool();
        
        uint256 pendingReward = _calculatePendingLPReward(msg.sender);
        if (pendingReward == 0) revert NoLPRewardsToClaim();
        
        LPStakerInfo storage staker = lpStakerInfo[msg.sender];
        staker.rewardDebt = staker.rewardDebt + pendingReward;
        staker.lastClaimTime = block.timestamp;
        
        lpPoolInfo.totalRewardDistributed = lpPoolInfo.totalRewardDistributed + pendingReward;
        
        rewardToken.safeTransfer(msg.sender, pendingReward);
        
        emit LPRewardClaimed(msg.sender, pendingReward);
    }
    
    function compoundLPReward() external whenNotPausedStaking whenLPPoolActive nonReentrant {
        _updateLPPool();
        
        uint256 pendingReward = _calculatePendingLPReward(msg.sender);
        if (pendingReward == 0) revert NoLPRewardsToClaim();
        
        LPStakerInfo storage staker = lpStakerInfo[msg.sender];
        staker.rewardDebt = staker.rewardDebt + pendingReward;
        staker.lpAmount = staker.lpAmount + pendingReward;
        staker.lastClaimTime = block.timestamp;
        
        lpPoolInfo.totalLPStaked = lpPoolInfo.totalLPStaked + pendingReward;
        lpPoolInfo.totalRewardDistributed = lpPoolInfo.totalRewardDistributed + pendingReward;
        
        emit LPRewardCompounded(msg.sender, pendingReward);
    }
    
    function setLPRewardRate(uint256 rewardPerSecond) external onlyRewardManager {
        _updateLPPool();
        lpPoolInfo.rewardPerSecond = rewardPerSecond;
        emit LPPoolUpdated(rewardPerSecond, lpPoolInfo.totalLPStaked);
    }
    
    function setLPPoolActive(bool isActive) external onlyLPAdmin {
        lpPoolInfo.isActive = isActive;
    }
    
    function emergencyPause() external onlyEmergency {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
    
    function emergencyUnpause() external onlyEmergency {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
    
    function _updateLPPool() internal {
        LPPoolInfo storage pool = lpPoolInfo;
        if (block.timestamp <= pool.lastRewardTime) return;
        
        if (pool.totalLPStaked > 0 && pool.rewardPerSecond > 0) {
            uint256 timeElapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward = timeElapsed * pool.rewardPerSecond;
            pool.accRewardPerShare = pool.accRewardPerShare + (reward * 1e18 / pool.totalLPStaked);
        }
        
        pool.lastRewardTime = block.timestamp;
    }
    
    function _calculatePendingLPReward(address user) internal view returns (uint256) {
        LPStakerInfo memory staker = lpStakerInfo[user];
        if (staker.lpAmount == 0) return 0;
        
        LPPoolInfo memory pool = lpPoolInfo;
        uint256 accRewardPerShare = pool.accRewardPerShare;
        
        if (block.timestamp > pool.lastRewardTime && pool.totalLPStaked > 0 && pool.rewardPerSecond > 0) {
            uint256 timeElapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward = timeElapsed * pool.rewardPerSecond;
            accRewardPerShare = accRewardPerShare + (reward * 1e18 / pool.totalLPStaked);
        }
        
        return (staker.lpAmount * accRewardPerShare / 1e18) - staker.rewardDebt;
    }
    
    function getPendingLPReward(address user) external view returns (uint256) {
        return _calculatePendingLPReward(user);
    }
    
    function getLPStakerInfo(address user) external view returns (LPStakerInfo memory) {
        return lpStakerInfo[user];
    }
    
    function getLPPoolInfo() external view returns (LPPoolInfo memory) {
        return lpPoolInfo;
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
    
    // Alias functions for compatibility with tests
    function stake(uint256 amount) external {
        this.stakeLP(amount, MIN_LP_LOCK_DURATION);
    }
    
    function unstake(uint256 amount) external {
        this.unstakeLP(amount);
    }
    
    function addRewards(uint256 amount) external onlyRewardManager {
        if (amount == 0) revert InvalidLPAmount();
        
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        lpPoolInfo.totalRewardDistributed = lpPoolInfo.totalRewardDistributed + amount;
        
        emit LPPoolUpdated(lpPoolInfo.rewardPerSecond, lpPoolInfo.totalLPStaked);
    }
    
    function fourthRoot(uint256 x) external pure returns (uint256) {
        return GovernanceMath.nthRoot(x, 4);
    }
    
    function getGovernancePower(address user) external view returns (uint256) {
        LPStakerInfo memory staker = lpStakerInfo[user];
        if (staker.lpAmount == 0) return 0;
        return GovernanceMath.nthRoot(staker.lpAmount, 4);
    }
    
    function getPendingRewardsForUser(address user) external view returns (uint256) {
        return _calculatePendingLPReward(user);
    }
    
    function stakedBalance(address user) external view returns (uint256) {
        return lpStakerInfo[user].lpAmount;
    }
    
    function emergencyRecovery(address token, address to, uint256 amount) external onlyEmergency {
        if (amount == 0) revert InvalidLPAmount();
        IERC20(token).safeTransfer(to, amount);
    }
    
    // Role constants for tests
    function REWARDER_ROLE() external pure returns (bytes32) {
        return REWARD_MANAGER_ROLE;
    }
    
    function GOVERNOR_ROLE() external pure returns (bytes32) {
        return DEFAULT_ADMIN_ROLE;
    }
} 
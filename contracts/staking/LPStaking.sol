// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "../libraries/GovernanceMath.sol";
import "../libraries/GovernanceErrors.sol";

/**
 * @title LPStaking
 * @dev LP token staking contract for Halom protocol with reward distribution and emergency controls
 */
contract LPStaking is 
    Initializable, 
    PausableUpgradeable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable 
{
    using SafeERC20 for ERC20Upgradeable;
    using GovernanceMath for uint256;
    
    // Role definitions
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Token contracts
    ERC20Upgradeable public lpToken;
    ERC20Upgradeable public rewardToken;
    
    // LP Staking data
    mapping(address => uint256) public lpStakedAmount;
    mapping(address => uint256) public lpRewardDebt;
    mapping(address => uint256) public lpLastClaimTime;
    mapping(address => uint256) public lpLockEndTime;
    mapping(address => uint256) public lpLockBoost;
    
    uint256 public totalLPStaked;
    uint256 public lpRewardRate; // rewards per second per LP token
    uint256 public lpLastUpdateTime;
    uint256 public lpRewardPerTokenStored;
    
    // LP Staking constants
    uint256 public constant MIN_LP_STAKE_AMOUNT = 1e18;
    uint256 public constant MAX_LP_LOCK_DURATION = 365 days;
    uint256 public constant MIN_LP_LOCK_DURATION = 1 days;
    uint256 public constant MAX_LP_LOCK_BOOST = 250; // 2.5x boost
    uint256 public constant LP_BOOST_PRECISION = 100;
    
    // Events
    event LPStaked(address indexed user, uint256 amount, uint256 lockDuration);
    event LPUnstaked(address indexed user, uint256 amount);
    event LPRewardClaimed(address indexed user, uint256 amount);
    event LPRewardCompounded(address indexed user, uint256 amount);
    event EmergencyLPWithdrawn(address indexed user, uint256 amount);
    event LPRewardRateSet(uint256 newRate);
    
    // Errors
    error InsufficientBalance();
    error ZeroAmount();
    error TransferFailed();
    error NoLPRewardsToClaim();
    error LPLockNotExpired();
    error InvalidLPLockDuration();
    error LPStakingPaused();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _lpToken,
        address _rewardToken,
        address admin
    ) public initializer {
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        lpToken = ERC20Upgradeable(_lpToken);
        rewardToken = ERC20Upgradeable(_rewardToken);
        lpLastUpdateTime = block.timestamp;
    }
    
    // ============ PUBLIC FUNCTIONS ============

    /**
     * @dev Stake LP tokens to earn rewards
     */
    function stakeLP(uint256 amount, uint256 lockDuration) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (amount < MIN_LP_STAKE_AMOUNT) revert ZeroAmount();
        if (lockDuration < MIN_LP_LOCK_DURATION || lockDuration > MAX_LP_LOCK_DURATION) {
            revert InvalidLPLockDuration();
        }
        if (lpToken.balanceOf(msg.sender) < amount) revert InsufficientBalance();

        _updateLPRewards(msg.sender);
        
        // Calculate lock boost
        uint256 lockBoost = GovernanceMath.calculateLockBoost(
            lockDuration, 
            MAX_LP_LOCK_DURATION, 
            MAX_LP_LOCK_BOOST
        );
        uint256 effectiveAmount = amount * lockBoost / LP_BOOST_PRECISION;
        
        lpStakedAmount[msg.sender] += effectiveAmount;
        lpLockEndTime[msg.sender] = block.timestamp + lockDuration;
        lpLockBoost[msg.sender] = lockBoost;
        totalLPStaked += effectiveAmount;
        
        lpRewardDebt[msg.sender] = lpRewardPerTokenStored;
        
        lpToken.safeTransferFrom(msg.sender, address(this), amount);
        
        emit LPStaked(msg.sender, amount, lockDuration);
    }
    
    /**
     * @dev Unstake LP tokens
     */
    function unstakeLP(uint256 amount) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();
        if (lpStakedAmount[msg.sender] < amount) revert InsufficientBalance();
        if (block.timestamp < lpLockEndTime[msg.sender]) revert LPLockNotExpired();
        
        _updateLPRewards(msg.sender);
        
        uint256 actualAmount = amount * LP_BOOST_PRECISION / lpLockBoost[msg.sender];
        lpStakedAmount[msg.sender] -= amount;
        totalLPStaked -= amount;
        
        if (lpStakedAmount[msg.sender] == 0) {
            lpLockBoost[msg.sender] = 0;
        }
        
        lpToken.safeTransfer(msg.sender, actualAmount);
        
        emit LPUnstaked(msg.sender, actualAmount);
    }
    
    /**
     * @dev Claim accumulated LP rewards
     */
    function claimLPRewards() 
        external 
        whenNotPaused 
        nonReentrant 
    {
        _updateLPRewardPerToken();
        
        uint256 pendingRewards = _earnedLP(msg.sender);
        if (pendingRewards == 0) revert NoLPRewardsToClaim();
        
        lpRewardDebt[msg.sender] = lpRewardPerTokenStored;
        lpLastClaimTime[msg.sender] = block.timestamp;
        
        rewardToken.safeTransfer(msg.sender, pendingRewards);
        
        emit LPRewardClaimed(msg.sender, pendingRewards);
    }
    
    /**
     * @dev Compound LP rewards back into staking
     */
    function compoundLPRewards() 
        external 
        whenNotPaused 
        nonReentrant 
    {
        _updateLPRewardPerToken();
        
        uint256 pendingRewards = _earnedLP(msg.sender);
        if (pendingRewards == 0) revert NoLPRewardsToClaim();
        
        lpRewardDebt[msg.sender] = lpRewardPerTokenStored;
        lpLastClaimTime[msg.sender] = block.timestamp;
        
        // Add rewards to staked amount (no rounding error)
        lpStakedAmount[msg.sender] += pendingRewards;
        totalLPStaked += pendingRewards;
        
        emit LPRewardCompounded(msg.sender, pendingRewards);
    }
    
    // ============ ROLE-BASED FUNCTIONS ============

    /**
     * @dev Set LP reward rate - only GOVERNOR_ROLE
     */
    function setLPRewardRate(uint256 rate) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (totalLPStaked > 0) {
        _updateLPRewardPerToken();
        }
        lpRewardRate = rate;
        emit LPRewardRateSet(rate);
    }

    /**
     * @dev Update LP reward per token - public function for testing
     */
    function updateLPRewardPerToken() external {
        _updateLPRewardPerToken();
    }

    /**
     * @dev Emergency withdraw all LP staked tokens for a user - only GOVERNOR_ROLE
     */
    function emergencyLPWithdraw(address user) 
        external 
        onlyRole(GOVERNOR_ROLE) 
        nonReentrant 
    {
        uint256 amount = lpStakedAmount[user];
        if (amount == 0) revert ZeroAmount();
        
        uint256 actualAmount = amount * LP_BOOST_PRECISION / lpLockBoost[user];
        lpStakedAmount[user] = 0;
        totalLPStaked -= amount;
        lpRewardDebt[user] = 0;
        lpLockBoost[user] = 0;
        
        lpToken.safeTransfer(user, actualAmount);
        
        emit EmergencyLPWithdrawn(user, actualAmount);
    }
    
    /**
     * @dev Pause LP staking - only PAUSER_ROLE
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause LP staking - only PAUSER_ROLE
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Update LP rewards for a user
     */
    function _updateLPRewards(address user) internal {
        _updateLPRewardPerToken();
        
        if (lpStakedAmount[user] > 0) {
            lpRewardDebt[user] = lpRewardPerTokenStored;
        }
    }

    /**
     * @dev Update LP reward per token
     */
    function _updateLPRewardPerToken() internal {
        if (totalLPStaked == 0) {
            lpLastUpdateTime = block.timestamp;
            return;
        }

        uint256 timeElapsed = block.timestamp - lpLastUpdateTime;
        if (timeElapsed > 0) {
            lpRewardPerTokenStored += (lpRewardRate * timeElapsed * 1e18) / totalLPStaked;
            lpLastUpdateTime = block.timestamp;
        }
    }

    /**
     * @dev Calculate earned LP rewards for user
     */
    function _earnedLP(address user) internal view returns (uint256) {
        uint256 rewardPerToken = lpRewardPerTokenStored;
        if (totalLPStaked > 0) {
            uint256 timeElapsed = block.timestamp - lpLastUpdateTime;
            rewardPerToken += (lpRewardRate * timeElapsed * 1e18) / totalLPStaked;
        }
        
        if (rewardPerToken <= lpRewardDebt[user]) {
            return 0;
        }
        
        return (lpStakedAmount[user] * (rewardPerToken - lpRewardDebt[user])) / 1e18;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get LP staking info for user
     */
    function getLPStakingInfo(address user) 
        external 
        view 
        returns (
            uint256 stakedAmount,
            uint256 rewardDebt,
            uint256 lastClaimTime,
            uint256 lockEndTime,
            uint256 lockBoost,
            uint256 pendingRewards
        ) 
    {
        stakedAmount = lpStakedAmount[user];
        rewardDebt = lpRewardDebt[user];
        lastClaimTime = lpLastClaimTime[user];
        lockEndTime = lpLockEndTime[user];
        lockBoost = lpLockBoost[user];
        
        if (stakedAmount > 0) {
            uint256 rewardPerToken = lpRewardPerTokenStored;
            if (totalLPStaked > 0) {
                uint256 timeElapsed = block.timestamp - lpLastUpdateTime;
                rewardPerToken += (lpRewardRate * timeElapsed * 1e18) / totalLPStaked;
    }
            pendingRewards = stakedAmount * (rewardPerToken - rewardDebt) / 1e18;
        }
    }

    /**
     * @dev Get LP pool info
     */
    function getLPPoolInfo() 
        external 
        view 
        returns (
            uint256 totalStaked,
            uint256 rewardRate,
            uint256 lastUpdateTime,
            uint256 rewardPerTokenStored
        ) 
    {
        return (totalLPStaked, lpRewardRate, lpLastUpdateTime, lpRewardPerTokenStored);
    }

    /**
     * @dev Check if user can unstake LP tokens
     */
    function canUnstakeLP(address user) external view returns (bool) {
        return block.timestamp >= lpLockEndTime[user] && lpStakedAmount[user] > 0;
    }
    
    /**
     * @dev Get remaining lock time for user
     */
    function getRemainingLockTime(address user) external view returns (uint256) {
        if (block.timestamp >= lpLockEndTime[user]) {
            return 0;
        }
        return lpLockEndTime[user] - block.timestamp;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
} 
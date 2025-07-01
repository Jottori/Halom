// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../libraries/GovernanceMath.sol";
import "../libraries/GovernanceErrors.sol";

/**
 * @title Staking
 * @dev Staking contract for Halom tokens with reward distribution and emergency controls
 */
contract Staking is 
    Initializable, 
    PausableUpgradeable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable 
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using GovernanceMath for uint256;

    // Role definitions
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Token contract
    IERC20Upgradeable public stakingToken;
    
    // Staking data
    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public lastClaimTime;
    
    uint256 public totalStaked;
    uint256 public rewardRate; // rewards per second per token
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    
    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event EmergencyWithdrawn(address indexed user, uint256 amount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event Upgraded(address indexed implementation);
    event RewardRateSet(uint256 newRate);

    // Errors
    error InsufficientBalance();
    error ZeroAmount();
    error TransferFailed();
    error NoRewardsToClaim();
    error StakingPaused();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _stakingToken,
        address admin
    ) public initializer {
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        stakingToken = IERC20Upgradeable(_stakingToken);
        lastUpdateTime = block.timestamp;
    }

    // ============ PUBLIC FUNCTIONS ============

    /**
     * @dev Stake tokens to earn rewards
     */
    function stake(uint256 amount) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();
        if (stakingToken.balanceOf(msg.sender) < amount) revert InsufficientBalance();

        _updateRewards(msg.sender);
        
        stakedAmount[msg.sender] += amount;
        totalStaked += amount;
        
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        
        emit Staked(msg.sender, amount);
    }

    /**
     * @dev Unstake tokens
     */
    function unstake(uint256 amount) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();
        if (stakedAmount[msg.sender] < amount) revert InsufficientBalance();

        _updateRewards(msg.sender);
        
        stakedAmount[msg.sender] -= amount;
        totalStaked -= amount;
        
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @dev Claim accumulated rewards
     */
    function claimRewards() 
        external 
        whenNotPaused 
        nonReentrant 
    {
        _updateRewards(msg.sender);
        
        uint256 rewards = rewardDebt[msg.sender];
        if (rewards == 0) revert NoRewardsToClaim();
        
        rewardDebt[msg.sender] = 0;
        lastClaimTime[msg.sender] = block.timestamp;
        
        stakingToken.safeTransfer(msg.sender, rewards);
        
        emit RewardClaimed(msg.sender, rewards);
    }

    // ============ ROLE-BASED FUNCTIONS ============

    /**
     * @dev Set reward rate - only GOVERNOR_ROLE
     */
    function setRewardRate(uint256 rate) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        _updateRewardPerToken();
        rewardRate = rate;
        emit RewardRateSet(rate);
    }

    /**
     * @dev Emergency withdraw all staked tokens - only GOVERNOR_ROLE
     */
    function emergencyWithdraw() 
        external 
        onlyRole(GOVERNOR_ROLE) 
        nonReentrant 
    {
        uint256 amount = stakedAmount[msg.sender];
        if (amount == 0) revert ZeroAmount();
        
        stakedAmount[msg.sender] = 0;
        totalStaked -= amount;
        rewardDebt[msg.sender] = 0;
        
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit EmergencyWithdrawn(msg.sender, amount);
    }

    /**
     * @dev Pause staking - only PAUSER_ROLE
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit Paused(msg.sender);
    }

    /**
     * @dev Unpause staking - only PAUSER_ROLE
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
        emit Unpaused(msg.sender);
    }

    /**
     * @dev Upgrade contract - only DEFAULT_ADMIN_ROLE
     */
    function upgradeTo(address newImplementation) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        _upgradeToAndCall(newImplementation, "", false);
        emit Upgraded(newImplementation);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Update rewards for user
     */
    function _updateRewards(address user) internal {
        rewardPerTokenStored = _rewardPerToken();
        lastUpdateTime = block.timestamp;
        
        if (stakedAmount[user] > 0) {
            rewardDebt[user] = _earned(user);
        }
    }

    /**
     * @dev Calculate reward per token
     */
    function _rewardPerToken() internal view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        
        return rewardPerTokenStored + (
            (block.timestamp - lastUpdateTime) * rewardRate * 1e18
        ) / totalStaked;
    }

    /**
     * @dev Calculate earned rewards for user
     */
    function _earned(address user) internal view returns (uint256) {
        return (stakedAmount[user] * (_rewardPerToken() - rewardDebt[user])) / 1e18;
    }

    /**
     * @dev Update reward per token
     */
    function _updateRewardPerToken() internal {
        rewardPerTokenStored = _rewardPerToken();
        lastUpdateTime = block.timestamp;
    }

    /**
     * @dev Required by UUPSUpgradeable
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {}

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get staking info for user
     */
    function getStakeInfo(address user) 
        external 
        view 
        returns (uint256 staked, uint256 pendingRewards, uint256 lastClaim) 
    {
        return (stakedAmount[user], _earned(user), lastClaimTime[user]);
    }

    /**
     * @dev Get total staked amount
     */
    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }

    /**
     * @dev Calculate pending rewards for user
     */
    function pendingRewards(address user) external view returns (uint256) {
        return _earned(user);
    }
} 
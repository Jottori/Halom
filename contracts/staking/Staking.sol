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
    using SafeERC20 for ERC20Upgradeable;
    using GovernanceMath for uint256;

    // Role definitions
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Token contract
    ERC20Upgradeable public stakingToken;
    
    // Staking data
    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    uint256 public totalStaked;
    uint256 public rewardRate; // rewards per second per token
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    
    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event EmergencyWithdrawn(address indexed user, uint256 amount);
    event Upgraded(address indexed implementation);
    event RewardRateSet(uint256 newRate);
    
    // ============ CUSTOM ERRORS ============
    error ZeroAmount();
    error InsufficientBalance();
    error NoRewardsToClaim();

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

        if (_stakingToken == address(0)) revert ZeroAmount();
        if (admin == address(0)) revert ZeroAmount();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        stakingToken = ERC20Upgradeable(_stakingToken);
        lastUpdateTime = block.timestamp;
    }
    
    // ============ PUBLIC FUNCTIONS ============

    /**
     * @notice Stake tokens to earn rewards
     * @param amount The amount of tokens to stake
     */
    function stake(uint256 amount) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();
        if (stakingToken.balanceOf(msg.sender) < amount) revert InsufficientBalance();
        _updateReward(msg.sender);
        stakedAmount[msg.sender] += amount;
        totalStaked += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstake tokens
     * @param amount The amount of tokens to unstake
     */
    function unstake(uint256 amount) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (amount == 0) revert ZeroAmount();
        if (stakedAmount[msg.sender] < amount) revert InsufficientBalance();
        _updateReward(msg.sender);
        stakedAmount[msg.sender] -= amount;
        totalStaked -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }
    
    /**
     * @notice Claim accumulated rewards
     */
    function claimRewards() 
        external 
        whenNotPaused 
        nonReentrant 
    {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        if (reward == 0) revert NoRewardsToClaim();
        rewards[msg.sender] = 0;
        stakingToken.safeTransfer(msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }
    
    // ============ ROLE-BASED FUNCTIONS ============

    /**
     * @notice Set reward rate - only GOVERNOR_ROLE
     * @param rate The new reward rate
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
     * @notice Emergency withdraw all staked tokens for a user - only GOVERNOR_ROLE
     * @param user The address to withdraw for
     */
    function emergencyWithdraw(address user)
        external 
        onlyRole(GOVERNOR_ROLE) 
        nonReentrant 
    {
        uint256 amount = stakedAmount[user];
        if (amount == 0) revert ZeroAmount();
        _updateReward(user);
        stakedAmount[user] = 0;
        totalStaked -= amount;
        rewards[user] = 0;
        stakingToken.safeTransfer(user, amount);
        emit EmergencyWithdrawn(user, amount);
    }
    
    /**
     * @notice Pause staking - only PAUSER_ROLE
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause staking - only PAUSER_ROLE
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Update reward for user and global rewardPerTokenStored
     * @param user The address to update rewards for
     */
    function _updateReward(address user) internal {
        rewardPerTokenStored = _rewardPerToken();
        lastUpdateTime = block.timestamp;
        if (user != address(0)) {
            rewards[user] = _earned(user);
            userRewardPerTokenPaid[user] = rewardPerTokenStored;
        }
    }

    /**
     * @dev Calculate reward per token
     */
    function _rewardPerToken() internal view returns (uint256) {
        if (totalStaked == 0) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored + (((block.timestamp - lastUpdateTime) * rewardRate * 1e18) / totalStaked);
    }
        
    /**
     * @dev Calculate earned rewards for user
     * @param user The address to calculate rewards for
     */
    function _earned(address user) internal view returns (uint256) {
        return (stakedAmount[user] * (_rewardPerToken() - userRewardPerTokenPaid[user])) / 1e18 + rewards[user];
    }

    /**
     * @dev Update reward per token (for admin functions)
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
     * @notice Get staking info for user
     * @param user The address to query
     * @return staked The amount staked
     * @return rewards_ The pending rewards
     */
    function getStakeInfo(address user) 
        external 
        view 
        returns (uint256 staked, uint256 rewards_, uint256)
    {
        return (stakedAmount[user], _earned(user), 0);
    }

    /**
     * @notice Get total staked amount
     */
    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }
    
    /**
     * @notice Calculate pending rewards for user
     */
    function pendingRewards(address user) external view returns (uint256) {
        return _earned(user);
    }
} 
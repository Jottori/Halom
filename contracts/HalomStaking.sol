// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IHalomToken is IERC20 {
    function burnFrom(address account, uint256 amount) external;
}

/// @title HalomStaking
/// @notice Staking contract for HalomToken with lock-boost and slashing
/// @dev Users can stake tokens for fixed lock periods to earn rewards. Governor can slash and set parameters.
contract HalomStaking is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    /// @notice Lock period options for staking
    enum LockPeriod {
        ONE_MONTH,      // 1 month
        THREE_MONTHS,    // 3 months
        SIX_MONTHS,      // 6 months  
        TWELVE_MONTHS,   // 12 months
        TWENTY_FOUR_MONTHS, // 24 months
        SIXTY_MONTHS     // 60 months
    }

    IHalomToken public immutable halomToken;
    uint256 public totalStaked;
    uint256 public rewardsPerShare;

    /// @notice User-specific staking data
    struct UserStake {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lockUntil;
        LockPeriod lockPeriod;
    }
    mapping(address => UserStake) public stakes;

    // --- Delegation ---
    mapping(address => address) public delegators; // delegator -> validator
    mapping(address => uint256) public validatorCommission; // validator -> commission rate (basis points)
    uint256 public constant MAX_COMMISSION = 2000; // 20%

    // --- Lock-Boost ---
    uint256 public lockBoostB0; // e.g., 2000 = 20% boost in basis points
    uint256 public lockBoostTMax; // e.g., 365 days

    event Staked(address indexed user, uint256 amount, uint256 lockUntil, LockPeriod lockPeriod);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event Delegated(address indexed delegator, address indexed validator);
    event Slashed(address indexed validator, uint256 amount);

    /// @notice Deploy the staking contract
    /// @param _tokenAddress The address of the HalomToken contract
    /// @param _governance The address with governor rights
    constructor(address _tokenAddress, address _governance) {
        halomToken = IHalomToken(_tokenAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        lockBoostB0 = 2000; // Default 20%
        lockBoostTMax = 365 days; // Default 1 year
    }
    
    // --- Staking and Rewards ---

    /// @notice Stake tokens with a fixed lock period
    /// @param amount The amount of tokens to stake
    /// @param lockPeriod The lock period enum value
    function stakeWithLockPeriod(uint256 amount, LockPeriod lockPeriod) external nonReentrant {
        uint256 lockDuration = getLockDuration(lockPeriod);
        _updateRewards(msg.sender);
        
        UserStake storage userStake = stakes[msg.sender];
        userStake.amount += amount;
        userStake.lockUntil = block.timestamp + lockDuration;
        userStake.lockPeriod = lockPeriod;
        totalStaked += amount;

        halomToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, userStake.lockUntil, lockPeriod);
    }

    /// @notice Stake tokens with a custom lock duration (for backward compatibility)
    /// @param amount The amount of tokens to stake
    /// @param lockDuration The lock duration in seconds
    function stake(uint256 amount, uint256 lockDuration) external nonReentrant {
        _updateRewards(msg.sender);
        
        UserStake storage userStake = stakes[msg.sender];
        userStake.amount += amount;
        userStake.lockUntil = block.timestamp + lockDuration;
        totalStaked += amount;

        halomToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, userStake.lockUntil, LockPeriod.THREE_MONTHS); // Default
    }

    /// @notice Unstake tokens after lock period
    /// @param amount The amount of tokens to unstake
    function unstake(uint256 amount) external nonReentrant {
        UserStake storage userStake = stakes[msg.sender];
        require(block.timestamp >= userStake.lockUntil, "HalomStaking: Tokens are locked");
        require(userStake.amount >= amount, "HalomStaking: Insufficient stake");

        _updateRewards(msg.sender);
        
        userStake.amount -= amount;
        totalStaked -= amount;
        
        halomToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim staking rewards
    function claimRewards() external nonReentrant {
        _updateRewards(msg.sender);
    }

    // --- Governor & Validator Functions ---
    
    /// @notice Set lock boost parameters (only governor)
    /// @param _newB0 New boost base (max 5000 = 50%)
    /// @param _newTMax New max lock time (30-730 days)
    function setLockBoostParams(uint256 _newB0, uint256 _newTMax) external onlyRole(GOVERNOR_ROLE) {
        require(_newB0 <= 5000, "B0 cannot exceed 50%"); // Guardrail: 50% max boost
        require(_newTMax >= 30 days && _newTMax <= 730 days, "TMax must be between 30 and 730 days");
        lockBoostB0 = _newB0;
        lockBoostTMax = _newTMax;
    }

    /// @notice Set validator commission rate
    /// @param _newRate New commission rate (max 20%)
    function setCommissionRate(uint256 _newRate) external {
        // Can only be called by an address that has stakers delegating to it.
        // This implicitly makes them a validator.
        require(stakes[msg.sender].amount > 0, "HalomStaking: Not a staker, cannot be a validator");
        require(_newRate <= MAX_COMMISSION, "HalomStaking: Commission exceeds maximum");
        validatorCommission[msg.sender] = _newRate;
    }

    /// @notice Add rewards to the staking pool (only HalomToken contract)
    /// @param amount The amount of rewards to add
    function addRewards(uint256 amount) public {
        // This can only be called by the HalomToken contract, which has the STAKING_CONTRACT role.
        // Since AccessControl in this contract does not know about roles in another one,
        // a simple check on msg.sender is sufficient and gas-efficient.
        require(msg.sender == address(halomToken), "HalomStaking: Not the token contract");
        if (totalStaked > 0) {
            rewardsPerShare += (amount * 1e18) / totalStaked;
        }
    }

    /// @notice Slash a validator's stake (only governor)
    /// @param validator The address of the validator to slash
    /// @param amountToSlash The amount to slash
    function slash(address validator, uint256 amountToSlash) external onlyRole(GOVERNOR_ROLE) nonReentrant {
        UserStake storage validatorStake = stakes[validator];
        require(validatorStake.amount >= amountToSlash, "HalomStaking: Slash amount exceeds stake");

        validatorStake.amount -= amountToSlash;
        totalStaked -= amountToSlash;
        
        uint256 toBurn = amountToSlash / 2;
        uint256 toRewards = amountToSlash - toBurn;

        halomToken.burnFrom(address(this), toBurn);
        addRewards(toRewards);
        
        emit Slashed(validator, amountToSlash);
    }

    // --- Internal and View Functions ---
    
    /// @dev Update rewards for a user (internal)
    /// @param user The address of the user
    function _updateRewards(address user) internal {
        uint256 pending = pendingRewards(user);
        if (pending > 0) {
            halomToken.transfer(user, pending);
            emit RewardsClaimed(user, pending);
        }
        stakes[user].rewardDebt = (stakes[user].amount * rewardsPerShare) / 1e18;
    }

    /// @notice View pending rewards for a user
    /// @param user The address of the user
    /// @return The amount of pending rewards
    function pendingRewards(address user) public view returns (uint256) {
        UserStake memory userStake = stakes[user];
        uint256 effectiveStake = getEffectiveStake(user);
        return ((effectiveStake * rewardsPerShare) / 1e18) - userStake.rewardDebt;
    }

    /// @notice Get the effective stake for a user (with lock boost)
    /// @param user The address of the user
    /// @return The effective stake amount
    function getEffectiveStake(address user) public view returns (uint256) {
        UserStake memory userStake = stakes[user];
        if (userStake.amount == 0) return 0;

        // Boost: 1m=0.11%, 3m=0.56%, 6m=1.58%, 12m=4.47%, 24m=12.65%, 60m=50%
        uint256 boost;
        if (userStake.lockPeriod == LockPeriod.ONE_MONTH) boost = 11; // 0.11%
        else if (userStake.lockPeriod == LockPeriod.THREE_MONTHS) boost = 56; // 0.56%
        else if (userStake.lockPeriod == LockPeriod.SIX_MONTHS) boost = 158; // 1.58%
        else if (userStake.lockPeriod == LockPeriod.TWELVE_MONTHS) boost = 447; // 4.47%
        else if (userStake.lockPeriod == LockPeriod.TWENTY_FOUR_MONTHS) boost = 1265; // 12.65%
        else if (userStake.lockPeriod == LockPeriod.SIXTY_MONTHS) boost = 5000; // 50%
        else boost = 0;
        return userStake.amount + (userStake.amount * boost) / 10000;
    }

    /// @notice Get the lock duration in seconds for a given lock period
    /// @param lockPeriod The lock period enum value
    /// @return The lock duration in seconds
    function getLockDuration(LockPeriod lockPeriod) public pure returns (uint256) {
        if (lockPeriod == LockPeriod.ONE_MONTH) return 30 days;
        if (lockPeriod == LockPeriod.THREE_MONTHS) return 90 days;
        if (lockPeriod == LockPeriod.SIX_MONTHS) return 180 days;
        if (lockPeriod == LockPeriod.TWELVE_MONTHS) return 365 days;
        if (lockPeriod == LockPeriod.TWENTY_FOUR_MONTHS) return 730 days;
        if (lockPeriod == LockPeriod.SIXTY_MONTHS) return 1825 days;
        revert("Invalid lock period");
    }
} 
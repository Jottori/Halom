// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IHalomInterfaces.sol";

contract HalomStaking is AccessControl, ReentrancyGuard, Pausable {
    // Custom Errors for gas optimization
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientStakedAmount();
    error LockPeriodTooShort();
    error LockPeriodTooLong();
    error LockNotExpired();
    error NoRewardsToClaim();
    error InvalidStakingContract();
    error InvalidRewardRate();
    error Unauthorized();
    error TransferFailed();
    error InvalidLockPeriod();
    error InvalidAccount();
    error InvalidBlockNumber();
    error InvalidCheckpoint();

    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant REWARDER_ROLE = keccak256("REWARDER_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IHalomToken public halomToken;
    IHalomRoleManager public roleManager;
    uint256 public rewardRate;
    uint256 public minLockPeriod;
    uint256 public maxLockPeriod;
    uint256 public totalRewardsClaimed;

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

    // Slashing parameters
    uint256 public slashPercentage = 5000; // 50% slash (in basis points)
    uint256 public constant MAX_SLASH_PERCENTAGE = 10000; // 100%

    // Lock period tracking per user
    mapping(address => uint256) public userLockPeriod;
    mapping(address => uint256) public lockUntil;
    mapping(address => bool) public hasLockedStake;

    // Lock boost parameters
    uint256 public constant MIN_LOCK_PERIOD = 30 days;
    uint256 public constant MAX_LOCK_PERIOD = 5 * 365 days; // 5 years
    uint256 public constant BOOST_BASE = 1000; // 10% base boost
    uint256 public constant BOOST_PER_MONTH = 10; // 0.1% per month

    // Delegation system
    mapping(address => address) public delegators; // delegator => validator
    mapping(address => uint256) public delegatedAmount; // delegator => amount delegated
    mapping(address => uint256) public validatorCommission; // validator => commission rate (basis points)
    mapping(address => uint256) public validatorTotalDelegated; // validator => total delegated to them
    mapping(address => uint256) public validatorEarnedCommission; // validator => earned commission
    mapping(address => uint256) public delegatorLastClaimTime; // delegator => last commission claim time
    
    uint256 public constant MAX_COMMISSION_RATE = 2000; // 20% maximum commission
    uint256 public constant COMMISSION_DENOMINATOR = 10000; // 100% in basis points

    // Rebase-aware reward tracking
    uint256 public lastRebaseIndex; // Last rebase index when rewards were calculated
    mapping(address => uint256) public userLastRebaseIndex; // User's last rebase index

    event Staked(address indexed user, uint256 amount, uint256 lockTime);
    event Unstaked(address indexed user, uint256 amount);
    event RewardAdded(address indexed rewarder, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event Slashed(address indexed user, uint256 amount, string reason);
    event EmergencyRecovery(address indexed token, address indexed to, uint256 amount);
    event PendingRewardsClaimed(address indexed user, uint256 amount);
    event StakingParametersUpdated(uint256 minStake, uint256 maxStake, uint256 lockPeriod);
    event SlashPercentageUpdated(uint256 oldPercentage, uint256 newPercentage);
    event StakeWithLock(address indexed user, uint256 amount, uint256 lockPeriod, uint256 lockUntil);
    event LockPeriodSet(address indexed user, uint256 lockPeriod, uint256 lockUntil);
    
    // Delegation events
    event Delegated(address indexed delegator, address indexed validator, uint256 amount);
    event Undelegated(address indexed delegator, address indexed validator, uint256 amount);
    event CommissionRateSet(address indexed validator, uint256 commissionRate);
    event CommissionClaimed(address indexed validator, uint256 amount);
    event DelegatorRewardClaimed(address indexed delegator, uint256 amount);

    constructor(
        address _halomToken,
        address _roleManager,
        uint256 _rewardRate,
        uint256 _minLockPeriod,
        uint256 _maxLockPeriod
    ) {
        if (_halomToken == address(0)) revert ZeroAddress();
        if (_roleManager == address(0)) revert ZeroAddress();
        if (_rewardRate == 0) revert InvalidRewardRate();
        if (_minLockPeriod == 0) revert InvalidLockPeriod();
        if (_maxLockPeriod <= _minLockPeriod) revert InvalidLockPeriod();

        halomToken = IHalomToken(_halomToken);
        roleManager = IHalomRoleManager(_roleManager);
        rewardRate = _rewardRate;
        minLockPeriod = _minLockPeriod;
        maxLockPeriod = _maxLockPeriod;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
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

    /**
     * @dev Update rewards with rebase awareness
     */
    modifier updateRewards(address _account) {
        _updateRewards(_account);
        _;
        rewardDebt[_account] = (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18;
    }

    /**
     * @dev Internal function to update rewards with rebase awareness
     */
    function _updateRewards(address _account) internal {
        uint256 pending = (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_account];
        uint256 mask = pending > 0 ? 1 : 0;
        uint256 reward = pending * mask;
        if (reward > 0) {
            SafeERC20.safeTransfer(IERC20(address(halomToken)), _account, reward);
            emit RewardClaimed(_account, reward);
        }
    }

    /**
     * @dev Get current rebase index from token
     */
    function _getRebaseIndex() internal view returns (uint256) {
        // This would need to be implemented based on your token's rebase mechanism
        // For now, we'll use a simple timestamp-based approach
        return block.timestamp / 1 days; // Daily rebase index
    }

    /**
     * @dev Adjust rewards for rebase changes
     */
    function _adjustRewardsForRebase(address _account, uint256 _pendingRewards) internal view returns (uint256) {
        // Get current token balance in contract
        uint256 contractBalance = halomToken.balanceOf(address(this));
        
        // If contract balance is less than total staked, rebase occurred
        if (contractBalance < totalStaked) {
            // Calculate rebase factor
            uint256 rebaseFactor = (contractBalance * 1e18) / totalStaked;
            return (_pendingRewards * rebaseFactor) / 1e18;
        }
        
        return _pendingRewards;
    }

    /**
     * @dev Stake tokens with a specific lock period
     */
    function stakeWithLock(
        uint256 _amount,
        uint256 _lockPeriod
    ) external nonReentrant whenNotPaused updateRewards(msg.sender) {
        if (_amount == 0) revert ZeroAmount();
        if (_lockPeriod < minLockPeriod) revert LockPeriodTooShort();
        if (_lockPeriod > maxLockPeriod) revert LockPeriodTooLong();
        if (stakedBalance[msg.sender] + _amount > maxStakeAmount) revert InsufficientBalance();
        
        SafeERC20.safeTransferFrom(IERC20(address(halomToken)), msg.sender, address(this), _amount);
        
        uint256 oldFourthRoot = fourthRootStake[msg.sender];
        stakedBalance[msg.sender] += _amount;
        totalStaked += _amount;
        
        // Calculate fourth root with boost
        uint256 newFourthRoot = fourthRootWithBoost(stakedBalance[msg.sender], msg.sender);
        fourthRootStake[msg.sender] = newFourthRoot;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        stakeTime[msg.sender] = block.timestamp;
        userLockPeriod[msg.sender] = _lockPeriod;
        lockUntil[msg.sender] = block.timestamp + _lockPeriod;
        hasLockedStake[msg.sender] = true;
        
        // Update rebase index
        userLastRebaseIndex[msg.sender] = _getRebaseIndex();
        
        emit StakeWithLock(msg.sender, _amount, _lockPeriod, lockUntil[msg.sender]);
    }

    /**
     * @dev Stake tokens with fourth root based rewards
     * Note: This function preserves existing lock periods and cannot override them
     */
    function stake(uint256 _amount) external nonReentrant whenNotPaused updateRewards(msg.sender) {
        if (_amount == 0) revert ZeroAmount();
        if (stakedBalance[msg.sender] + _amount > maxStakeAmount) revert InsufficientBalance();
        
        // If user has no existing stake, require them to use stakeWithLock
        if (stakedBalance[msg.sender] == 0) {
            revert("Use stakeWithLock for initial stake");
        }
        
        // If user has locked stake, preserve the existing lock period
        if (hasLockedStake[msg.sender]) {
            require(block.timestamp < lockUntil[msg.sender], "Lock period expired");
        }
        
        SafeERC20.safeTransferFrom(IERC20(address(halomToken)), msg.sender, address(this), _amount);
        
        uint256 oldFourthRoot = fourthRootStake[msg.sender];
        stakedBalance[msg.sender] += _amount;
        totalStaked += _amount;
        
        // Calculate fourth root with boost
        uint256 newFourthRoot = fourthRootWithBoost(stakedBalance[msg.sender], msg.sender);
        fourthRootStake[msg.sender] = newFourthRoot;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        // Preserve existing lock period and stake time
        if (!hasLockedStake[msg.sender]) {
            stakeTime[msg.sender] = block.timestamp;
        }
        
        emit Staked(msg.sender, _amount, block.timestamp);
    }

    /**
     * @dev Unstake tokens (with lock period)
     */
    function unstake(uint256 _amount) external nonReentrant whenNotPaused updateRewards(msg.sender) {
        if (_amount == 0) revert ZeroAmount();
        if (stakedBalance[msg.sender] < _amount) revert InsufficientStakedAmount();
        
        // Check if lock period has expired
        if (lockUntil[msg.sender] > 0 && block.timestamp < lockUntil[msg.sender]) {
            revert LockNotExpired();
        }

        uint256 oldFourthRoot = fourthRootStake[msg.sender];
        stakedBalance[msg.sender] -= _amount;
        totalStaked -= _amount;
        
        uint256 newFourthRoot = fourthRoot(stakedBalance[msg.sender]);
        fourthRootStake[msg.sender] = newFourthRoot;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        // Reset lock period if all tokens are unstaked
        if (stakedBalance[msg.sender] == 0) {
            hasLockedStake[msg.sender] = false;
            userLockPeriod[msg.sender] = 0;
            lockUntil[msg.sender] = 0;
        }
        
        SafeERC20.safeTransfer(IERC20(address(halomToken)), msg.sender, _amount);
        
        emit Unstaked(msg.sender, _amount);
    }

    /**
     * @dev Add rewards to the pool (only rewarder)
     */
    function addRewards(uint256 _amount) external onlyRole(REWARDER_ROLE) {
        require(_amount > 0, "Cannot add 0 rewards");
        
        if (totalFourthRootStake > 0) {
            rewardsPerFourthRoot += (_amount * 1e18) / totalFourthRootStake;
        } else {
            pendingRewards += _amount;
        }
        
        emit RewardAdded(msg.sender, _amount);
    }

    /**
     * @dev Claim pending rewards for first staker
     */
    function claimPendingRewards() external nonReentrant {
        require(pendingRewards > 0, "No pending rewards");
        require(totalFourthRootStake > 0, "No stakers yet");
        
        uint256 amount = pendingRewards;
        pendingRewards = 0;
        
        rewardsPerFourthRoot += (amount * 1e18) / totalFourthRootStake;
        
        emit PendingRewardsClaimed(msg.sender, amount);
    }

    /**
     * @dev Claim rewards for a user
     */
    function claimRewards() external nonReentrant whenNotPaused updateRewards(msg.sender) {
        uint256 rewardAmount = pendingRewards;
        if (rewardAmount == 0) revert NoRewardsToClaim();

        pendingRewards = 0;
        totalRewardsClaimed += rewardAmount;

        emit RewardClaimed(msg.sender, rewardAmount);
    }

    /**
     * @dev Slash user's stake (only slasher)
     */
    function slash(address _user, string memory _reason) external onlyRole(SLASHER_ROLE) {
        require(_user != address(0), "Cannot slash zero address");
        require(stakedBalance[_user] > 0, "User has no stake to slash");
        
        uint256 slashAmount = (stakedBalance[_user] * slashPercentage) / 10000;
        uint256 remainingAmount = stakedBalance[_user] - slashAmount;
        
        // Update fourth root calculations
        uint256 oldFourthRoot = fourthRootStake[_user];
        stakedBalance[_user] = remainingAmount;
        totalStaked -= slashAmount;
        
        uint256 newFourthRoot = fourthRoot(remainingAmount);
        fourthRootStake[_user] = newFourthRoot;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        // Burn slashed tokens using the token's burnFrom function
        IHalomToken(address(halomToken)).burnFrom(address(this), slashAmount);
        
        emit Slashed(_user, slashAmount, _reason);
    }

    /**
     * @dev Update staking parameters (only governor)
     */
    function updateStakingParameters(
        uint256 _minStakeAmount,
        uint256 _maxStakeAmount,
        uint256 _lockPeriod
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_minStakeAmount <= _maxStakeAmount, "Min stake cannot exceed max stake");
        require(_lockPeriod <= 365 days, "Lock period too long");
        
        minStakeAmount = _minStakeAmount;
        maxStakeAmount = _maxStakeAmount;
        lockPeriod = _lockPeriod;
        
        emit StakingParametersUpdated(_minStakeAmount, _maxStakeAmount, _lockPeriod);
    }

    /**
     * @dev Update slash percentage (only governor)
     */
    function updateSlashPercentage(uint256 _newPercentage) external onlyRole(GOVERNOR_ROLE) {
        require(_newPercentage <= MAX_SLASH_PERCENTAGE, "Slash percentage too high");
        
        uint256 oldPercentage = slashPercentage;
        slashPercentage = _newPercentage;
        
        emit SlashPercentageUpdated(oldPercentage, _newPercentage);
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
     * @dev Get user's pending rewards
     */
    function getPendingRewardsForUser(address _user) public view returns (uint256) {
        return (fourthRootStake[_user] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_user];
    }

    /**
     * @dev Get staking info for a user
     */
    function getStakingInfo(address _user) external view returns (
        uint256 _stakedBalance,
        uint256 _fourthRootStake,
        uint256 _governancePower,
        uint256 _stakeTime,
        uint256 _pendingRewards
    ) {
        return (
            stakedBalance[_user],
            fourthRootStake[_user],
            getGovernancePower(_user),
            stakeTime[_user],
            getPendingRewardsForUser(_user)
        );
    }

    // Branchless min/max utility
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        // Branchless min: b ^ ((a ^ b) & ((a - b) >> 255))
        unchecked {
            return b ^ ((a ^ b) & ((a - b) >> 255));
        }
    }
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        // Branchless max: a ^ ((a ^ b) & ((a - b) >> 255))
        unchecked {
            return a ^ ((a ^ b) & ((a - b) >> 255));
        }
    }

    /**
     * @dev Calculate boost multiplier based on lock period (branchless)
     */
    function calculateBoostMultiplier(uint256 _lockPeriod) public pure returns (uint256) {
        // Clamp lock period to [MIN_LOCK_PERIOD, MAX_LOCK_PERIOD] branchless
        uint256 clamped = max(MIN_LOCK_PERIOD, min(_lockPeriod, MAX_LOCK_PERIOD));
        uint256 months = clamped / 30 days;
        uint256 boost = BOOST_BASE + (months * BOOST_PER_MONTH);
        return boost; // Returns basis points (e.g., 1000 = 10%, 5000 = 50%)
    }

    /**
     * @dev Get user's boost multiplier (branchless)
     */
    function getUserBoostMultiplier(address _user) public view returns (uint256) {
        // Branchless: if hasLockedStake[_user] then calculateBoostMultiplier, else BOOST_BASE
        uint256 locked = hasLockedStake[_user] ? 1 : 0;
        uint256 boost = calculateBoostMultiplier(userLockPeriod[_user]);
        return (locked * boost) + ((1 - locked) * BOOST_BASE);
    }

    /**
     * @dev Calculate fourth root with boost applied (branchless)
     */
    function fourthRootWithBoost(uint256 _amount, address _user) public view returns (uint256) {
        uint256 boostMultiplier = getUserBoostMultiplier(_user);
        uint256 boostedAmount = (_amount * boostMultiplier) / 1000; // Apply boost
        return fourthRoot(boostedAmount);
    }

    /**
     * @dev Delegate tokens to a validator
     */
    function delegateToValidator(address _validator, uint256 _amount) external nonReentrant whenNotPaused {
        require(_validator != address(0), "Cannot delegate to zero address");
        require(_validator != msg.sender, "Cannot delegate to self");
        require(_amount > 0, "Cannot delegate 0");
        require(stakedBalance[msg.sender] >= _amount, "Insufficient staked balance");
        
        // Remove previous delegation if exists
        if (delegators[msg.sender] != address(0)) {
            _undelegate(msg.sender, delegators[msg.sender], delegatedAmount[msg.sender]);
        }
        
        // Set new delegation
        delegators[msg.sender] = _validator;
        delegatedAmount[msg.sender] = _amount;
        validatorTotalDelegated[_validator] += _amount;
        
        emit Delegated(msg.sender, _validator, _amount);
    }

    /**
     * @dev Undelegate tokens from validator
     */
    function undelegateFromValidator() external nonReentrant whenNotPaused {
        address validator = delegators[msg.sender];
        require(validator != address(0), "No delegation found");
        
        uint256 amount = delegatedAmount[msg.sender];
        _undelegate(msg.sender, validator, amount);
        
        emit Undelegated(msg.sender, validator, amount);
    }

    /**
     * @dev Internal function to handle undelegation
     */
    function _undelegate(address _delegator, address _validator, uint256 _amount) internal {
        delegators[_delegator] = address(0);
        delegatedAmount[_delegator] = 0;
        validatorTotalDelegated[_validator] -= _amount;
    }

    /**
     * @dev Set commission rate for validator (only governor or validator)
     */
    function setCommissionRate(uint256 _commissionRate) external {
        require(_commissionRate <= MAX_COMMISSION_RATE, "Commission rate too high");
        require(stakedBalance[msg.sender] > 0, "Only validators can set commission");
        
        validatorCommission[msg.sender] = _commissionRate;
        emit CommissionRateSet(msg.sender, _commissionRate);
    }

    /**
     * @dev Claim earned commission (only validators)
     */
    function claimCommission() external nonReentrant {
        uint256 earnedCommission = validatorEarnedCommission[msg.sender];
        require(earnedCommission > 0, "No commission to claim");
        
        validatorEarnedCommission[msg.sender] = 0;
        SafeERC20.safeTransfer(IERC20(address(halomToken)), msg.sender, earnedCommission);
        
        emit CommissionClaimed(msg.sender, earnedCommission);
    }

    /**
     * @dev Claim delegator rewards
     */
    function claimDelegatorRewards() external nonReentrant {
        address validator = delegators[msg.sender];
        require(validator != address(0), "No delegation found");
        
        uint256 pendingDelegatorRewards = _calculateDelegatorRewards(msg.sender);
        require(pendingDelegatorRewards > 0, "No rewards to claim");
        
        delegatorLastClaimTime[msg.sender] = block.timestamp;
        SafeERC20.safeTransfer(IERC20(address(halomToken)), msg.sender, pendingDelegatorRewards);
        
        emit DelegatorRewardClaimed(msg.sender, pendingDelegatorRewards);
    }

    /**
     * @dev Calculate delegator rewards
     */
    function _calculateDelegatorRewards(address _delegator) internal view returns (uint256) {
        address validator = delegators[_delegator];
        if (validator == address(0)) return 0;
        
        uint256 userDelegatedAmount = delegatedAmount[_delegator];
        uint256 userValidatorCommission = validatorCommission[validator];
        
        // Calculate rewards based on validator's performance and commission
        // This is a simplified calculation - in practice, you'd track validator performance
        uint256 timeSinceLastClaim = block.timestamp - delegatorLastClaimTime[_delegator];
        uint256 localRewardRate = 1000; // 10% annual rate (simplified)
        
        uint256 rewards = (userDelegatedAmount * localRewardRate * timeSinceLastClaim) / (365 days * 10000);
        
        // Apply commission
        uint256 commission = (rewards * userValidatorCommission) / COMMISSION_DENOMINATOR;
        return rewards - commission;
    }

    /**
     * @dev Get delegation info for a user
     */
    function getDelegationInfo(address _user) external view returns (
        address validator,
        uint256 userDelegatedAmount,
        uint256 userPendingRewards,
        uint256 commissionRate
    ) {
        validator = delegators[_user];
        userDelegatedAmount = delegatedAmount[_user];
        userPendingRewards = _calculateDelegatorRewards(_user);
        commissionRate = validator != address(0) ? validatorCommission[validator] : 0;
    }

    /**
     * @dev Get validator info
     */
    function getValidatorInfo(address _validator) external view returns (
        uint256 totalDelegated,
        uint256 commissionRate,
        uint256 earnedCommission
    ) {
        totalDelegated = validatorTotalDelegated[_validator];
        commissionRate = validatorCommission[_validator];
        earnedCommission = validatorEarnedCommission[_validator];
    }

    function calculateRewards(address _user) public view returns (uint256) {
        if (stakedBalance[_user] == 0) return 0;
        
        uint256 userRewardRate = 1000; // 10% annual rate (simplified)
        uint256 timeStaked = block.timestamp - stakeTime[_user];
        uint256 reward = (stakedBalance[_user] * userRewardRate * timeStaked) / (365 days * 10000);
        
        return reward;
    }
} 
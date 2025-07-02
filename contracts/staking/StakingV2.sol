// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

/**
 * @title HalomStakingV2
 * @dev Enhanced staking contract with proper delegation functionality
 * @dev Implements immutable role declarations and hierarchical access control
 * @dev Based on OpenZeppelin ERC20Votes pattern with snapshot-based delegation
 */
contract HalomStakingV2 is 
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using Checkpoints for Checkpoints.Trace224;

    // ============ Immutable Role Declarations ============
    bytes32 public immutable GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public immutable REWARDER_ROLE = keccak256("REWARDER_ROLE");
    bytes32 public immutable EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public immutable PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public immutable MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public immutable SLASHER_ROLE = keccak256("SLASHER_ROLE");
    
    // ============ Constants ============
    uint256 public constant MIN_STAKE_AMOUNT = 100 * 10**18; // 100 tokens
    uint256 public constant MAX_COMMISSION = 2000; // 20%
    uint256 public constant DELEGATION_THRESHOLD = 1000 * 10**18; // 1000 tokens to become validator
    
    // ============ Enums ============
    enum LockPeriod {
        ONE_MONTH,      // 1 month
        THREE_MONTHS,    // 3 months
        SIX_MONTHS,      // 6 months  
        TWELVE_MONTHS,   // 12 months
        TWENTY_FOUR_MONTHS, // 24 months
        SIXTY_MONTHS     // 60 months
    }

    // ============ State Variables ============
    IERC20 public halomToken;
    uint256 public totalStaked;
    uint256 public rewardsPerShare;
    uint256 public lastRewardUpdate;
    
    // Delegation tracking
    mapping(address => address) public delegates;
    mapping(address => Checkpoints.Trace224) private _delegateCheckpoints;
    Checkpoints.Trace224 private _totalCheckpoints;
    
    // Staking data
    mapping(address => UserStake) public stakes;
    mapping(address => ValidatorInfo) public validators;
    mapping(address => uint256) public validatorCommission;
    mapping(address => address[]) public delegators;
    mapping(address => mapping(address => uint256)) public delegatorStakes;
    
    // Lock boost parameters
    uint256 public lockBoostB0;
    uint256 public lockBoostTMax;
    
    // ============ Structs ============
    struct UserStake {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lockUntil;
        LockPeriod lockPeriod;
        uint256 lastUpdate;
        bool isValidator;
    }
    
    struct ValidatorInfo {
        bool isActive;
        uint256 totalDelegated;
        uint256 ownStake;
        uint256 commissionRate;
        uint256 totalRewards;
        uint256 lastRewardClaim;
        uint256 reputation;
        uint256 totalDelegators;
    }
    
    struct DelegationSnapshot {
        uint256 amount;
        uint256 timestamp;
        uint256 lockPeriod;
    }
    
    // ============ Events ============
    event Staked(
        address indexed user, 
        uint256 amount, 
        uint256 lockUntil, 
        LockPeriod lockPeriod
    );
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event Delegated(
        address indexed delegator, 
        address indexed validator, 
        uint256 amount
    );
    event Undelegated(
        address indexed delegator, 
        address indexed validator, 
        uint256 amount
    );
    event ValidatorRegistered(address indexed validator, uint256 commissionRate);
    event ValidatorDeregistered(address indexed validator);
    event CommissionUpdated(address indexed validator, uint256 oldRate, uint256 newRate);
    event Slashed(address indexed validator, uint256 amount, string reason);
    event LockBoostUpdated(uint256 oldB0, uint256 newB0, uint256 oldTMax, uint256 newTMax);
    
    // ============ Errors ============
    error Staking__InsufficientStake();
    error Staking__TokensStillLocked();
    error Staking__InvalidValidator();
    error Staking__SelfDelegation();
    error Staking__InvalidCommissionRate();
    error Staking__NotValidator();
    error Staking__InsufficientDelegation();
    error Staking__AlreadyDelegated();
    error Staking__NoDelegation();
    error Staking__InvalidLockPeriod();
    error Staking__EmergencyPaused();
    
    // ============ Modifiers ============
    modifier onlyGovernor() {
        if (!hasRole(GOVERNOR_ROLE, msg.sender)) {
            revert Staking__InvalidValidator();
        }
        _;
    }
    
    modifier onlyRewarder() {
        if (!hasRole(REWARDER_ROLE, msg.sender)) {
            revert Staking__InvalidValidator();
        }
        _;
    }
    
    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) {
            revert Staking__InvalidValidator();
        }
        _;
    }
    
    modifier onlyPauser() {
        if (!hasRole(PAUSER_ROLE, msg.sender)) {
            revert Staking__InvalidValidator();
        }
        _;
    }
    
    modifier onlySlasher() {
        if (!hasRole(SLASHER_ROLE, msg.sender)) {
            revert Staking__InvalidValidator();
        }
        _;
    }
    
    // ============ Initialization ============
    function initialize(
        address _token,
        address _governance
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        halomToken = IERC20(_token);
        
        // Setup hierarchical role structure
        _setupRoleHierarchy();
        
        // Grant initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        _grantRole(REWARDER_ROLE, _governance);
        _grantRole(EMERGENCY_ROLE, _governance);
        _grantRole(PAUSER_ROLE, _governance);
        _grantRole(MINTER_ROLE, _governance);
        _grantRole(SLASHER_ROLE, _governance);
        
        lockBoostB0 = 2000; // Default 20%
        lockBoostTMax = 365 days; // Default 1 year
        lastRewardUpdate = block.timestamp;
    }
    
    // ============ Role Hierarchy Setup ============
    function _setupRoleHierarchy() internal {
        // GOVERNOR_ROLE can manage all other roles
        _setRoleAdmin(REWARDER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(PAUSER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(MINTER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(SLASHER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(EMERGENCY_ROLE, GOVERNOR_ROLE);
    }
    
    // ============ Core Staking Functions ============
    
    /**
     * @dev Stake tokens with lock period
     */
    function stakeWithLockPeriod(
        uint256 _amount,
        LockPeriod _lockPeriod
    ) external nonReentrant {
        if (_amount < MIN_STAKE_AMOUNT) {
            revert Staking__InsufficientStake();
        }
        
        _updateRewards(msg.sender);
        
        uint256 lockDuration = getLockDuration(_lockPeriod);
        UserStake storage userStake = stakes[msg.sender];
        
        userStake.amount += _amount;
        userStake.lockUntil = block.timestamp + lockDuration;
        userStake.lockPeriod = _lockPeriod;
        userStake.lastUpdate = block.timestamp;
        
        totalStaked += _amount;
        
        // Transfer tokens
        halomToken.transferFrom(msg.sender, address(this), _amount);
        
        // Update delegation if user is validator
        if (userStake.isValidator) {
            validators[msg.sender].ownStake += _amount;
            _updateValidatorVotingPower(msg.sender);
        }
        
        emit Staked(msg.sender, _amount, userStake.lockUntil, _lockPeriod);
    }
    
    /**
     * @dev Unstake tokens after lock period
     */
    function unstake(uint256 _amount) external nonReentrant {
        UserStake storage userStake = stakes[msg.sender];
        
        if (block.timestamp < userStake.lockUntil) {
            revert Staking__TokensStillLocked();
        }
        if (userStake.amount < _amount) {
            revert Staking__InsufficientStake();
        }
        
        _updateRewards(msg.sender);
        
        userStake.amount -= _amount;
        totalStaked -= _amount;
        
        // Update validator info if applicable
        if (userStake.isValidator) {
            validators[msg.sender].ownStake -= _amount;
            _updateValidatorVotingPower(msg.sender);
        }
        
        halomToken.transfer(msg.sender, _amount);
        emit Unstaked(msg.sender, _amount);
    }
    
    /**
     * @dev Claim staking rewards
     */
    function claimRewards() external nonReentrant {
        _updateRewards(msg.sender);
    }
    
    // ============ Delegation Functions ============
    
    /**
     * @dev Delegate stake to a validator
     */
    function delegate(address _validator, uint256 _amount) external nonReentrant {
        if (_validator == msg.sender) {
            revert Staking__SelfDelegation();
        }
        if (!validators[_validator].isActive) {
            revert Staking__InvalidValidator();
        }
        if (stakes[msg.sender].amount < _amount) {
            revert Staking__InsufficientStake();
        }
        if (delegates[msg.sender] != address(0)) {
            revert Staking__AlreadyDelegated();
        }
        
        _updateRewards(msg.sender);
        _updateRewards(_validator);
        
        // Update delegation
        delegates[msg.sender] = _validator;
        delegatorStakes[msg.sender][_validator] = _amount;
        validators[_validator].totalDelegated += _amount;
        validators[_validator].totalDelegators++;
        delegators[_validator].push(msg.sender);
        
        // Update voting power
        _updateDelegationVotingPower(msg.sender, _validator, _amount);
        
        emit Delegated(msg.sender, _validator, _amount);
    }
    
    /**
     * @dev Undelegate from validator
     */
    function undelegate() external nonReentrant {
        address validator = delegates[msg.sender];
        if (validator == address(0)) {
            revert Staking__NoDelegation();
        }
        
        uint256 delegatedAmount = delegatorStakes[msg.sender][validator];
        
        _updateRewards(msg.sender);
        _updateRewards(validator);
        
        // Remove delegation
        delegates[msg.sender] = address(0);
        delegatorStakes[msg.sender][validator] = 0;
        validators[validator].totalDelegated -= delegatedAmount;
        validators[validator].totalDelegators--;
        
        // Remove from delegators array
        _removeDelegator(validator, msg.sender);
        
        // Update voting power
        _updateDelegationVotingPower(msg.sender, validator, 0);
        
        emit Undelegated(msg.sender, validator, delegatedAmount);
    }
    
    /**
     * @dev Register as validator
     */
    function registerValidator(uint256 _commissionRate) external {
        if (stakes[msg.sender].amount < DELEGATION_THRESHOLD) {
            revert Staking__InsufficientDelegation();
        }
        if (_commissionRate > MAX_COMMISSION) {
            revert Staking__InvalidCommissionRate();
        }
        
        UserStake storage userStake = stakes[msg.sender];
        userStake.isValidator = true;
        
        ValidatorInfo storage validator = validators[msg.sender];
        validator.isActive = true;
        validator.ownStake = userStake.amount;
        validator.commissionRate = _commissionRate;
        validator.reputation = 100; // Base reputation
        
        _updateValidatorVotingPower(msg.sender);
        
        emit ValidatorRegistered(msg.sender, _commissionRate);
    }
    
    /**
     * @dev Deregister as validator
     */
    function deregisterValidator() external {
        if (!validators[msg.sender].isActive) {
            revert Staking__NotValidator();
        }
        if (validators[msg.sender].totalDelegated > 0) {
            revert Staking__InsufficientDelegation(); // Cannot deregister with active delegations
        }
        
        stakes[msg.sender].isValidator = false;
        validators[msg.sender].isActive = false;
        
        _updateValidatorVotingPower(msg.sender);
        
        emit ValidatorDeregistered(msg.sender);
    }
    
    /**
     * @dev Update commission rate
     */
    function updateCommissionRate(uint256 _newRate) external {
        if (!validators[msg.sender].isActive) {
            revert Staking__NotValidator();
        }
        if (_newRate > MAX_COMMISSION) {
            revert Staking__InvalidCommissionRate();
        }
        
        uint256 oldRate = validators[msg.sender].commissionRate;
        validators[msg.sender].commissionRate = _newRate;
        validatorCommission[msg.sender] = _newRate;
        
        emit CommissionUpdated(msg.sender, oldRate, _newRate);
    }
    
    // ============ Governor Functions ============
    
    /**
     * @dev Set lock boost parameters
     */
    function setLockBoostParams(
        uint256 _newB0,
        uint256 _newTMax
    ) external onlyGovernor {
        uint256 oldB0 = lockBoostB0;
        uint256 oldTMax = lockBoostTMax;
        
        lockBoostB0 = _newB0;
        lockBoostTMax = _newTMax;
        
        emit LockBoostUpdated(oldB0, _newB0, oldTMax, _newTMax);
    }
    
    // ============ Slasher Functions ============
    
    /**
     * @dev Slash validator
     */
    function slash(
        address _validator,
        uint256 _amount,
        string calldata _reason
    ) external onlySlasher nonReentrant {
        if (!validators[_validator].isActive) {
            revert Staking__NotValidator();
        }
        
        UserStake storage validatorStake = stakes[_validator];
        if (validatorStake.amount < _amount) {
            _amount = validatorStake.amount; // Slash entire stake if insufficient
        }
        
        // Update validator stake
        validatorStake.amount -= _amount;
        validators[_validator].ownStake -= _amount;
        totalStaked -= _amount;
        
        // Distribute slashed amount
        uint256 toBurn = _amount / 2;
        uint256 toRewards = _amount - toBurn;
        
        // Burn tokens (assuming token has burn function)
        // halomToken.burnFrom(address(this), toBurn);
        
        // Add to rewards pool
        addRewards(toRewards);
        
        // Update voting power
        _updateValidatorVotingPower(_validator);
        
        emit Slashed(_validator, _amount, _reason);
    }
    
    // ============ Reward Functions ============
    
    /**
     * @dev Add rewards to the pool
     */
    function addRewards(uint256 _amount) public onlyRewarder {
        if (totalStaked > 0) {
            rewardsPerShare += (_amount * 1e18) / totalStaked;
        }
        lastRewardUpdate = block.timestamp;
    }
    
    // ============ Pauser Functions ============
    
    /**
     * @dev Pause staking operations
     */
    function pause() external onlyPauser {
        // Implementation would require PausableUpgradeable inheritance
        // For now, this is a placeholder
    }
    
    /**
     * @dev Unpause staking operations
     */
    function unpause() external onlyPauser {
        // Implementation would require PausableUpgradeable inheritance
        // For now, this is a placeholder
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get user's voting power
     */
    function getVotes(address _account) public view returns (uint256) {
        return _delegateCheckpoints[_account].latest();
    }
    
    /**
     * @dev Get user's voting power at a specific block
     */
    function getPastVotes(address _account, uint256 _blockNumber) public view returns (uint256) {
        return _delegateCheckpoints[_account].upperLookupRecent(uint32(_blockNumber));
    }
    
    /**
     * @dev Get total voting power
     */
    function getTotalVotes() public view returns (uint256) {
        return _totalCheckpoints.latest();
    }
    
    /**
     * @dev Get total voting power at a specific block
     */
    function getPastTotalVotes(uint256 _blockNumber) public view returns (uint256) {
        return _totalCheckpoints.upperLookupRecent(uint32(_blockNumber));
    }
    
    /**
     * @dev Get validator information
     */
    function getValidatorInfo(address _validator) external view returns (
        bool isActive,
        uint256 totalDelegated,
        uint256 ownStake,
        uint256 commissionRate,
        uint256 totalRewards,
        uint256 reputation,
        uint256 totalDelegators
    ) {
        ValidatorInfo storage validator = validators[_validator];
        return (
            validator.isActive,
            validator.totalDelegated,
            validator.ownStake,
            validator.commissionRate,
            validator.totalRewards,
            validator.reputation,
            validator.totalDelegators
        );
    }
    
    /**
     * @dev Get delegators for a validator
     */
    function getDelegators(address _validator) external view returns (address[] memory) {
        return delegators[_validator];
    }
    
    /**
     * @dev Get effective stake with lock boost
     */
    function getEffectiveStake(address _user) public view returns (uint256) {
        UserStake memory userStake = stakes[_user];
        if (userStake.amount == 0) return 0;
        
        uint256 boost = _calculateLockBoost(userStake.lockPeriod);
        return userStake.amount + (userStake.amount * boost) / 10000;
    }
    
    /**
     * @dev Get pending rewards
     */
    function pendingRewards(address _user) public view returns (uint256) {
        UserStake memory userStake = stakes[_user];
        uint256 effectiveStake = getEffectiveStake(_user);
        return ((effectiveStake * rewardsPerShare) / 1e18) - userStake.rewardDebt;
    }
    
    // ============ Internal Functions ============
    
    /**
     * @dev Update rewards for a user
     */
    function _updateRewards(address _user) internal {
        uint256 pending = pendingRewards(_user);
        if (pending > 0) {
            halomToken.transfer(_user, pending);
            emit RewardsClaimed(_user, pending);
        }
        stakes[_user].rewardDebt = (getEffectiveStake(_user) * rewardsPerShare) / 1e18;
    }
    
    /**
     * @dev Update validator voting power
     */
    function _updateValidatorVotingPower(address _validator) internal {
        uint256 votingPower = getEffectiveStake(_validator) + validators[_validator].totalDelegated;
        _delegateCheckpoints[_validator].push(uint32(block.number), uint224(votingPower));
        _totalCheckpoints.push(uint32(block.number), uint224(votingPower));
    }
    
    /**
     * @dev Update delegation voting power
     */
    function _updateDelegationVotingPower(
        address _delegator,
        address _validator,
        uint256 _amount
    ) internal {
        uint256 oldVotingPower = _delegateCheckpoints[_validator].latest();
        uint256 newVotingPower = oldVotingPower - delegatorStakes[_delegator][_validator] + _amount;
        
        _delegateCheckpoints[_validator].push(uint32(block.number), uint224(newVotingPower));
        _totalCheckpoints.push(uint32(block.number), uint224(newVotingPower));
    }
    
    /**
     * @dev Remove delegator from array
     */
    function _removeDelegator(address _validator, address _delegator) internal {
        address[] storage delegatorList = delegators[_validator];
        for (uint256 i = 0; i < delegatorList.length; i++) {
            if (delegatorList[i] == _delegator) {
                delegatorList[i] = delegatorList[delegatorList.length - 1];
                delegatorList.pop();
                break;
            }
        }
    }
    
    /**
     * @dev Calculate lock boost
     */
    function _calculateLockBoost(LockPeriod _lockPeriod) internal pure returns (uint256) {
        if (_lockPeriod == LockPeriod.ONE_MONTH) return 11; // 0.11%
        if (_lockPeriod == LockPeriod.THREE_MONTHS) return 56; // 0.56%
        if (_lockPeriod == LockPeriod.SIX_MONTHS) return 158; // 1.58%
        if (_lockPeriod == LockPeriod.TWELVE_MONTHS) return 447; // 4.47%
        if (_lockPeriod == LockPeriod.TWENTY_FOUR_MONTHS) return 1265; // 12.65%
        if (_lockPeriod == LockPeriod.SIXTY_MONTHS) return 5000; // 50%
        return 0;
    }
    
    /**
     * @dev Get lock duration
     */
    function getLockDuration(LockPeriod _lockPeriod) public pure returns (uint256) {
        if (_lockPeriod == LockPeriod.ONE_MONTH) return 30 days;
        if (_lockPeriod == LockPeriod.THREE_MONTHS) return 90 days;
        if (_lockPeriod == LockPeriod.SIX_MONTHS) return 180 days;
        if (_lockPeriod == LockPeriod.TWELVE_MONTHS) return 365 days;
        if (_lockPeriod == LockPeriod.TWENTY_FOUR_MONTHS) return 730 days;
        if (_lockPeriod == LockPeriod.SIXTY_MONTHS) return 1825 days;
        revert Staking__InvalidLockPeriod();
    }
    
    // ============ UUPS Upgrade ============
    
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
    
    // ============ Emergency Functions ============
    
    /**
     * @dev Emergency withdraw with timelock bypass
     */
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyEmergency {
        IERC20(_token).transfer(_to, _amount);
    }
    
    /**
     * @dev Emergency pause with reason
     */
    function emergencyPause(string calldata _reason) external onlyEmergency {
        // Implementation would require PausableUpgradeable inheritance
        // For now, this is a placeholder
    }
} 

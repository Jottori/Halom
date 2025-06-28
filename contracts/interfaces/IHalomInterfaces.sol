// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IHalomInterfaces
 * @dev Centralized interface definitions for the Halom ecosystem
 * Provides standardized function signatures for all contract interactions
 */

// Core token interface with rebase functionality
interface IHalomToken {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function rebase(int256 supplyDelta) external;
    function mint(address to, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
    function setStakingContract(address _stakingAddress) external;
    function setRewardRate(uint256 _newRate) external;
    function setMaxRebaseDelta(uint256 _newDelta) external;
    
    // Governance functions
    function delegates(address account) external view returns (address);
    function delegate(address delegatee) external;
    function getVotes(address account) external view returns (uint256);
    function getPastVotes(address account, uint256 blockNumber) external view returns (uint256);
    function getPastTotalSupply(uint256 blockNumber) external view returns (uint256);
}

// Staking contract interface
interface IHalomStaking {
    function addRewards(uint256 amount) external;
    function stake(uint256 amount) external;
    function stakeWithLock(uint256 amount, uint256 lockPeriod) external;
    function unstake(uint256 amount) external;
    function claimRewards() external;
    function slash(address user, string memory reason) external;
    function getStakingInfo(address user) external view returns (
        uint256 stakedBalance,
        uint256 fourthRootStake,
        uint256 governancePower,
        uint256 stakeTime,
        uint256 pendingRewards
    );
    function getPendingRewardsForUser(address user) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function stakedBalance(address user) external view returns (uint256);
    
    // Delegation functions
    function delegate(address validator, uint256 amount) external;
    function undelegate() external;
    function claimDelegatorRewards() external;
    function getDelegationInfo(address user) external view returns (
        address validator,
        uint256 userDelegatedAmount,
        uint256 userPendingRewards,
        uint256 commissionRate
    );
}

// LP Staking interface
interface IHalomLPStaking {
    function addRewards(uint256 amount) external;
    function stake(uint256 amount) external;
    function unstake(uint256 amount) external;
    function claimRewards() external;
    function getPendingRewardsForUser(address user) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function stakedBalance(address user) external view returns (uint256);
}

// Oracle interface
interface IHalomOracle {
    function setHOI(uint256 hoi, uint256 nonce) external;
    function submitHOI(uint256 hoi) external;
    function latestHOI() external view returns (uint256);
    function lastUpdateTime() external view returns (uint256);
    function nonce() external view returns (uint256);
    function setHalomToken(address halomToken) external;
    function pause() external;
    function unpause() external;
}

// Treasury interface
interface IHalomTreasury {
    function collectFees(address user, uint256 amount) external;
    function distributeFees(uint256 amount) external;
    function claimFeeRewards() external;
    function withdrawTreasuryFunds(address to, uint256 amount, bool isEmergency) external;
    function updateFeeRate(uint256 newRate) external;
    function getPendingFeeRewards(address user) external view returns (uint256);
    function totalFeesCollected() external view returns (uint256);
}

// Role manager interface
interface IHalomRoleManager {
    function grantRoleToContract(bytes32 role, address contractAddress) external;
    function revokeRoleFromHuman(bytes32 role, address account) external;
    function freezeRole(bytes32 role) external;
    function unfreezeRole(bytes32 role) external;
    function hasRole(bytes32 role, address account) external view returns (bool);
    function getRoleMembers(bytes32 role) external view returns (address[] memory);
    function isRoleFrozen(bytes32 role) external view returns (bool);
    function pause() external;
    function unpause() external;
}

// Governance interface
interface IHalomGovernor {
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external returns (uint256);
    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) external payable returns (uint256);
    function castVote(uint256 proposalId, uint8 support) external returns (uint256);
    function castVoteWithReason(uint256 proposalId, uint8 support, string memory reason) external returns (uint256);
    function lockTokens(uint256 amount) external;
    function unlockTokens() external;
    function getVotePower(address user) external view returns (uint256);
    function setRootPower(uint256 newRootPower) external;
}

// Timelock interface
interface IHalomTimelock {
    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) external;
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external payable;
    function cancel(bytes32 id) external;
    function minDelay() external view returns (uint256);
    function hasRole(bytes32 role, address account) external view returns (bool);
}

// Events interface for consistent event definitions
interface IHalomEvents {
    // Token events
    event Rebase(uint256 newTotalSupply, int256 supplyDelta);
    event AntiWhaleLimitsUpdated(uint256 maxTransfer, uint256 maxWallet);
    event ExcludedFromLimits(address indexed account, bool excluded);
    event StakingContractUpdated(address indexed oldContract, address indexed newContract);
    
    // Staking events
    event Staked(address indexed user, uint256 amount, uint256 lockTime);
    event Unstaked(address indexed user, uint256 amount);
    event RewardAdded(address indexed rewarder, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event Slashed(address indexed user, uint256 amount, string reason);
    event StakeWithLock(address indexed user, uint256 amount, uint256 lockPeriod, uint256 lockUntil);
    
    // Delegation events
    event Delegated(address indexed delegator, address indexed validator, uint256 amount);
    event Undelegated(address indexed delegator, address indexed validator, uint256 amount);
    event CommissionRateSet(address indexed validator, uint256 commissionRate);
    event CommissionClaimed(address indexed validator, uint256 amount);
    event DelegatorRewardClaimed(address indexed delegator, uint256 amount);
    
    // Oracle events
    event HOISet(uint256 newHOI, int256 supplyDelta, uint256 indexed nonce);
    event OracleSubmissionReceived(uint256 indexed nonce, address indexed oracle, uint256 hoi, uint256 timestamp);
    event ConsensusReached(uint256 indexed nonce, uint256 finalHOI, int256 supplyDelta, address[] participants);
    
    // Treasury events
    event FeeCollected(address indexed user, uint256 amount, uint256 fourthRoot);
    event FeeDistributed(address indexed user, uint256 amount);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event TreasuryWithdrawal(address indexed to, uint256 amount, address indexed controller);
    
    // Role management events
    event RoleFrozen(bytes32 indexed role, address indexed frozenBy);
    event RoleUnfrozen(bytes32 indexed role, address indexed unfrozenBy);
    event ContractRoleAssigned(bytes32 indexed role, address indexed contractAddress, address indexed assignedBy);
    event HumanRoleRevoked(bytes32 indexed role, address indexed account, address indexed revokedBy);
    
    // Governance events
    event TokensLocked(address indexed user, uint256 amount, uint256 lockTime);
    event TokensUnlocked(address indexed user, uint256 amount);
    event RootPowerUpdated(uint256 oldPower, uint256 newPower);
}

// Error definitions for consistent error handling
interface IHalomErrors {
    error ZeroAddress();
    error InvalidAmount();
    error InsufficientBalance();
    error Unauthorized();
    error InvalidNonce();
    error Paused();
    error LockPeriodNotMet();
    error AmountBelowMinimum();
    error AmountAboveMaximum();
    error InvalidLockPeriod();
    error NoDelegationFound();
    error CommissionRateTooHigh();
    error InvalidHOIValue();
    error ConsensusNotReached();
    error RoleFrozen();
    error InvalidRootPower();
    error TransferFailed();
    error InvalidFeeRate();
    error WithdrawalCooldownNotMet();
    error EmergencyOnly();
} 
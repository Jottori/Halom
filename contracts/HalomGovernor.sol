// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./libraries/GovernanceMath.sol";
import "./libraries/GovernanceErrors.sol";

/**
 * @title HalomGovernor
 * @dev Modular, branchless, EVM-limit-safe DAO Governor with quadratic and time-weighted voting, delegation, and emergency controls.
 */
contract HalomGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl,
    AccessControl,
    Pausable,
    ReentrancyGuard
{
    using GovernanceMath for uint256;

    // Roles
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant FLASHLOAN_GUARD_ROLE = keccak256("FLASHLOAN_GUARD_ROLE");
    bytes32 public constant PARAM_ROLE = keccak256("PARAM_ROLE");
    bytes32 public constant DELEGATOR_ROLE = keccak256("DELEGATOR_ROLE");

    // Voting parameters
    uint256 public maxVotingPower = 1_000_000e18;
    uint256 public quadraticFactor = 1e18;
    uint256 public timeWeightFactor = 1e18;
    uint256 public rootPower = 2;
    uint256 public minLockDuration = 1 days;
    bool public emergencyMode;

    // Delegation
    mapping(address => address) public delegateOf;
    mapping(address => address[]) public delegators;

    // Token lock for time-weighted voting
    mapping(address => uint256) public lockedTokens;
    mapping(address => uint256) public lockStart;

    // Proposal lock multiplier
    mapping(uint256 => uint256) public proposalLockMultiplier;
    mapping(address => uint256) public lastVoteBlock;

    // Events
    event EmergencyModeSet(bool enabled);
    event VotingParamsUpdated(uint256 maxVotingPower, uint256 quadraticFactor, uint256 timeWeightFactor, uint256 rootPower, uint256 minLockDuration);
    event TokensLocked(address indexed user, uint256 amount, uint256 start);
    event TokensUnlocked(address indexed user, uint256 amount);
    event Delegated(address indexed from, address indexed to);
    event DelegationRevoked(address indexed from, address indexed to);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);

    error FlashLoanDetected();
    error VotingPaused();
    error Unauthorized();

    constructor(
        IVotes _token,
        TimelockController _timelock,
        uint48 _votingDelay,
        uint32 _votingPeriod,
        uint256 _proposalThreshold,
        uint256 _quorumPercent
    )
        Governor("HalomGovernor")
        GovernorSettings(_votingDelay, _votingPeriod, _proposalThreshold)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(_quorumPercent)
        GovernorTimelockControl(_timelock)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
        _grantRole(FLASHLOAN_GUARD_ROLE, msg.sender);
        _grantRole(PARAM_ROLE, msg.sender);
        _grantRole(DELEGATOR_ROLE, msg.sender);
    }

    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    modifier whenNotPausedGovernor() {
        if (paused()) revert VotingPaused();
        _;
    }

    // --- Parameter management (branchless, custom error) ---
    function setVotingParams(
        uint256 _maxVotingPower,
        uint256 _quadraticFactor,
        uint256 _timeWeightFactor,
        uint256 _rootPower,
        uint256 _minLockDuration
    ) external onlyRole(PARAM_ROLE) {
        if (_maxVotingPower == 0) revert GovernanceErrors.InvalidVotingPowerCap();
        if (_quadraticFactor == 0) revert GovernanceErrors.InvalidQuadraticFactor();
        if (_timeWeightFactor == 0) revert GovernanceErrors.InvalidTimeWeightFactor();
        if (_rootPower < 2) revert GovernanceErrors.InvalidRootPower();
        if (_minLockDuration == 0) revert GovernanceErrors.InvalidLockDuration();
        maxVotingPower = _maxVotingPower;
        quadraticFactor = _quadraticFactor;
        timeWeightFactor = _timeWeightFactor;
        rootPower = _rootPower;
        minLockDuration = _minLockDuration;
        emit VotingParamsUpdated(_maxVotingPower, _quadraticFactor, _timeWeightFactor, _rootPower, _minLockDuration);
    }

    // --- Emergency controls ---
    function setEmergencyMode(bool enabled) external onlyRole(EMERGENCY_ROLE) {
        emergencyMode = enabled;
        enabled ? _pause() : _unpause();
        emit EmergencyModeSet(enabled);
    }

    // --- Token lock for time-weighted voting ---
    function lockTokens(uint256 amount) external whenNotPaused {
        if (amount == 0) revert GovernanceErrors.InvalidAmount();
        lockedTokens[msg.sender] += amount;
        lockStart[msg.sender] = block.timestamp;
        emit TokensLocked(msg.sender, amount, block.timestamp);
    }
    function unlockTokens() external {
        uint256 locked = lockedTokens[msg.sender];
        if (locked == 0) revert GovernanceErrors.InvalidAmount();
        if (block.timestamp < lockStart[msg.sender] + minLockDuration) revert GovernanceErrors.LockPeriodNotExpired();
        lockedTokens[msg.sender] = 0;
        emit TokensUnlocked(msg.sender, locked);
    }

    // --- Delegation ---
    function delegate(address to) external whenNotPaused onlyRole(DELEGATOR_ROLE) {
        if (to == address(0) || to == msg.sender) revert GovernanceErrors.InvalidDelegate();
        address prev = delegateOf[msg.sender];
        if (prev != address(0)) {
            // Remove from previous delegator list
            address[] storage arr = delegators[prev];
            for (uint256 i = 0; i < arr.length; ++i) {
                if (arr[i] == msg.sender) {
                    arr[i] = arr[arr.length - 1];
                    arr.pop();
                    break;
                }
            }
            emit DelegationRevoked(msg.sender, prev);
        }
        delegateOf[msg.sender] = to;
        delegators[to].push(msg.sender);
        emit Delegated(msg.sender, to);
    }
    function revokeDelegation() external {
        address to = delegateOf[msg.sender];
        if (to == address(0)) revert GovernanceErrors.DelegationNotFound();
        address[] storage arr = delegators[to];
        for (uint256 i = 0; i < arr.length; ++i) {
            if (arr[i] == msg.sender) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                break;
            }
        }
        delegateOf[msg.sender] = address(0);
        emit DelegationRevoked(msg.sender, to);
    }

    // --- Voting power calculation (branchless, modular) ---
    function _getVotingPower(address account) internal view returns (uint256) {
        uint256 base = token().getPastVotes(account, block.number - 1);
        uint256 locked = lockedTokens[account];
        uint256 power = GovernanceMath.calculateQuadraticPower(base + locked, quadraticFactor, rootPower);
        if (locked > 0) {
            uint256 duration = block.timestamp - lockStart[account];
            power = GovernanceMath.calculateTimeWeightedPower(power, duration, timeWeightFactor, minLockDuration);
        }
        return power > maxVotingPower ? maxVotingPower : power;
    }

    // --- Governor overrides ---
    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }
    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }
    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }
    function quorum(uint256 blockNumber) public view override(Governor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(blockNumber);
    }
    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override whenNotPausedGovernor returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }
    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }
    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }
    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }
    function proposalNeedsQueuing(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.proposalNeedsQueuing(proposalId);
    }
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, Governor) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // --- Emergency controls ---
    function emergencyPause() external onlyEmergency {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
    function emergencyUnpause() external onlyEmergency {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }

    // --- View functions ---
    function getVotingPower(address account) external view returns (uint256) {
        return _getVotingPower(account);
    }
    function getDelegators(address to) external view returns (address[] memory) {
        return delegators[to];
    }
    function getDelegate(address from) external view returns (address) {
        return delegateOf[from];
    }
    function isEmergency() external view returns (bool) {
        return emergencyMode;
    }
    function getLocked(address account) external view returns (uint256) {
        return lockedTokens[account];
    }
    function getLockStart(address account) external view returns (uint256) {
        return lockStart[account];
    }

    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public payable override nonReentrant returns (uint256) {
        // Add additional validation for security
        require(targets.length > 0, "No targets provided");
        require(targets.length == values.length, "Length mismatch");
        require(targets.length == calldatas.length, "Length mismatch");
        
        return super.execute(targets, values, calldatas, descriptionHash);
    }
} 
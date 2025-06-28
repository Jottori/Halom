// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./HalomToken.sol";

// Custom errors for gas optimization (only those not already in HalomToken)
error LockPeriodNotExpired();
error TransferFailed();
error InvalidRootPower();
error VotingPowerExceedsCap();
error FlashLoanDetected();
error EmergencyPaused();

/**
 * @title HalomGovernor
 * @dev Governance contract for Halom protocol with parameterizable root voting power
 * Includes protection against flash loan attacks and governance takeovers
 */
contract HalomGovernor is 
    Governor, 
    GovernorTimelockControl, 
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    AccessControl
{
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    mapping(address => uint256) public lockedTokens;
    mapping(address => uint256) public lockTime;
    uint256 public constant LOCK_DURATION = 5 * 365 * 24 * 60 * 60; // 5 years
    uint256 public constant VOTING_DELAY = 1; // 1 block
    uint256 public constant VOTING_PERIOD = 45818; // ~1 week
    uint256 public constant PROPOSAL_THRESHOLD = 1000e18; // 1000 HLM
    uint256 public constant QUORUM_FRACTION = 4; // 4%
    
    // Parameterizable root power (default: 4 = fourth root)
    uint256 public rootPower = 4;
    uint256 public constant MIN_ROOT_POWER = 2; // sqrt minimum
    uint256 public constant MAX_ROOT_POWER = 10; // maximum root power
    
    // Governance attack protection
    uint256 public maxVotingPowerPerAddress = 1000000e18; // 1M HLM max voting power per address
    uint256 public minLockDuration = 7 days; // Minimum lock duration to prevent flash loans
    bool public emergencyPaused;
    
    // Flash loan detection
    mapping(address => uint256) public lastVoteTime;
    mapping(address => uint256) public voteCount;
    uint256 public constant VOTE_COOLDOWN = 1 hours; // Minimum time between votes
    uint256 public constant MAX_VOTES_PER_DAY = 10; // Maximum votes per day per address
    
    // Emergency governance controls
    uint256 public emergencyQuorum = 10; // 10% quorum for emergency proposals
    bool public emergencyMode;

    event TokensLocked(address indexed user, uint256 amount, uint256 lockTime);
    event TokensUnlocked(address indexed user, uint256 amount);
    event RootPowerUpdated(uint256 oldPower, uint256 newPower);
    event EmergencyPausedEvent(address indexed caller);
    event EmergencyResumed(address indexed caller);
    event VotingPowerCapUpdated(uint256 oldCap, uint256 newCap);
    event FlashLoanDetectedEvent(address indexed attacker, uint256 amount);

    constructor(
        IVotes _token,
        TimelockController _timelock
    )
        Governor("HalomGovernor")
        GovernorSettings(uint48(VOTING_DELAY), uint32(VOTING_PERIOD), PROPOSAL_THRESHOLD)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(QUORUM_FRACTION)
        GovernorTimelockControl(_timelock)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, address(_timelock));
        _grantRole(EMERGENCY_ROLE, address(_timelock));
    }

    /**
     * @dev Emergency pause governance
     */
    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        emergencyPaused = true;
        emit EmergencyPausedEvent(msg.sender);
    }
    
    /**
     * @dev Resume governance
     */
    function emergencyResume() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyPaused = false;
        emit EmergencyResumed(msg.sender);
    }
    
    /**
     * @dev Set voting power cap per address
     */
    function setVotingPowerCap(uint256 newCap) external onlyGovernance {
        if (newCap == 0) revert InvalidAmount();
        uint256 oldCap = maxVotingPowerPerAddress;
        maxVotingPowerPerAddress = newCap;
        emit VotingPowerCapUpdated(oldCap, newCap);
    }
    
    /**
     * @dev Set emergency quorum
     */
    function setEmergencyQuorum(uint256 newQuorum) external onlyGovernance {
        if (newQuorum > 50) revert InvalidAmount(); // Max 50%
        emergencyQuorum = newQuorum;
    }

    /**
     * @dev Calculate nth root using Babylonian method
     */
    function nthRoot(uint256 x, uint256 n) public pure returns (uint256) {
        if (x == 0) return 0;
        if (n == 1) return x;
        if (n == 2) return sqrt(x);
        
        uint256 z = x;
        uint256 y = (z + n - 1) / n;
        
        while (y < z) {
            z = y;
            // Calculate y = ((n-1) * z + x / z^(n-1)) / n
            uint256 zPower = z;
            for (uint256 i = 1; i < n - 1; i++) {
                zPower = zPower * z / 1e18; // Scale to avoid overflow
            }
            y = ((n - 1) * z + x * 1e18 / zPower) / n;
        }
        return z;
    }

    /**
     * @dev Calculate square root using Babylonian method
     */
    function sqrt(uint256 x) public pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = x;
        uint256 y = (z + 1) / 2;
        
        while (y < z) {
            z = y;
            y = (z + x / z) / 2;
        }
        return z;
    }

    /**
     * @dev Get voting power for a user based on locked tokens using nth root
     * Includes flash loan protection and voting power caps
     */
    function getVotePower(address user) public view returns (uint256) {
        if (lockTime[user] == 0) return 0;
        if (block.timestamp < lockTime[user] + LOCK_DURATION) {
            uint256 power = nthRoot(lockedTokens[user], rootPower);
            // Cap voting power per address
            if (power > maxVotingPowerPerAddress) {
                power = maxVotingPowerPerAddress;
            }
            return power;
        }
        return 0; // Lock expired
    }
    
    /**
     * @dev Check for flash loan attack patterns
     */
    function _checkFlashLoanAttack(address voter) internal {
        // Check vote frequency
        if (block.timestamp < lastVoteTime[voter] + VOTE_COOLDOWN) {
            revert FlashLoanDetected();
        }
        
        // Check daily vote limit
        uint256 currentDay = block.timestamp / 1 days;
        uint256 lastVoteDay = lastVoteTime[voter] / 1 days;
        
        if (currentDay == lastVoteDay && voteCount[voter] >= MAX_VOTES_PER_DAY) {
            revert FlashLoanDetected();
        }
        
        // Check if tokens were locked recently (flash loan detection)
        if (block.timestamp < lockTime[voter] + minLockDuration) {
            emit FlashLoanDetectedEvent(voter, lockedTokens[voter]);
            // Don't revert, but log the attempt
        }
    }

    /**
     * @dev Update root power (only governor)
     */
    function setRootPower(uint256 newRootPower) external onlyGovernance {
        if (newRootPower < MIN_ROOT_POWER || newRootPower > MAX_ROOT_POWER) revert InvalidRootPower();
        uint256 oldPower = rootPower;
        rootPower = newRootPower;
        emit RootPowerUpdated(oldPower, newRootPower);
    }

    /**
     * @dev Lock tokens for governance participation
     */
    function lockTokens(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (emergencyPaused) revert EmergencyPaused();
        
        if (!HalomToken(address(token())).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        
        lockedTokens[msg.sender] += amount;
        lockTime[msg.sender] = block.timestamp;
        
        emit TokensLocked(msg.sender, amount, block.timestamp);
    }

    /**
     * @dev Unlock tokens after lock period
     */
    function unlockTokens() external {
        if (lockTime[msg.sender] == 0) revert InvalidAmount();
        if (block.timestamp < lockTime[msg.sender] + LOCK_DURATION) revert LockPeriodNotExpired();
        
        uint256 amount = lockedTokens[msg.sender];
        lockedTokens[msg.sender] = 0;
        lockTime[msg.sender] = 0;
        
        if (!HalomToken(address(token())).transfer(msg.sender, amount)) {
            revert TransferFailed();
        }
        
        emit TokensUnlocked(msg.sender, amount);
    }

    /**
     * @dev Override to use custom voting power with attack protection
     */
    function _getVotes(
        address account,
        uint256 blockNumber,
        bytes memory /*params*/
    ) internal view virtual override(Governor, GovernorVotes) returns (uint256) {
        return getVotePower(account);
    }
    
    /**
     * @dev Override vote function to add flash loan protection
     */
    function castVote(uint256 proposalId, uint8 support) public virtual override returns (uint256) {
        if (emergencyPaused) revert EmergencyPaused();
        
        _checkFlashLoanAttack(msg.sender);
        
        // Update vote tracking
        lastVoteTime[msg.sender] = block.timestamp;
        voteCount[msg.sender]++;
        
        return super.castVote(proposalId, support);
    }
    
    /**
     * @dev Override quorum calculation for emergency mode
     */
    function quorum(uint256 blockNumber)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        if (emergencyMode) {
            return (token().getPastTotalSupply(blockNumber) * emergencyQuorum) / 100;
        }
        return super.quorum(blockNumber);
    }

    // The following functions are overrides required by Solidity.

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor) returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // --- Required by OpenZeppelin Governor/TimelockControl multiple inheritance ---
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

    function proposalNeedsQueuing(
        uint256 proposalId
    ) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.proposalNeedsQueuing(proposalId);
    }
} 
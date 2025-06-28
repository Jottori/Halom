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

/**
 * @title HalomGovernor
 * @dev Governance contract for Halom protocol with parameterizable root voting power
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
    // Custom Errors for gas optimization
    error Unauthorized();
    error InvalidProposal();
    error ProposalNotActive();
    error ProposalAlreadyExecuted();
    error InvalidVote();
    error AlreadyVoted();
    error VotingPeriodNotStarted();
    error VotingPeriodEnded();
    error InsufficientVotes();
    error InvalidTimelock();
    error InvalidSettings();
    error EmergencyRecoveryFailed();

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // Constants for governance
    uint256 public constant LOCK_DURATION = 30 days;
    uint256 public constant MIN_ROOT_POWER = 2;
    uint256 public constant MAX_ROOT_POWER = 10;
    uint256 public emergencyRecoveryTime;

    mapping(address => uint256) public lockedTokens;
    mapping(address => uint256) public lockTime;
    uint256 public constant VOTING_DELAY = 1; // 1 block
    uint256 public constant VOTING_PERIOD = 45818; // ~1 week
    uint256 public constant PROPOSAL_THRESHOLD = 1000e18; // 1000 HLM
    uint256 public constant QUORUM_FRACTION = 4; // 4%
    
    // Parameterizable root power (default: 4 = fourth root)
    uint256 public rootPower = 4;

    event TokensLocked(address indexed user, uint256 amount, uint256 lockTime);
    event TokensUnlocked(address indexed user, uint256 amount);
    event RootPowerUpdated(uint256 oldPower, uint256 newPower);
    event EmergencyRecoveryExecuted(address indexed executor, uint256 timestamp);

    constructor(
        IVotes _token,
        TimelockController _timelock,
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _proposalThreshold,
        uint256 _quorumPercentage
    )
        Governor("Halom Governor")
        GovernorSettings(uint48(_votingDelay), uint32(_votingPeriod), _proposalThreshold)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(_quorumPercentage)
        GovernorTimelockControl(_timelock)
    {
        if (address(_token) == address(0)) revert Unauthorized();
        if (address(_timelock) == address(0)) revert InvalidTimelock();
        if (_votingDelay == 0) revert InvalidSettings();
        if (_votingPeriod == 0) revert InvalidSettings();
        if (_quorumPercentage == 0) revert InvalidSettings();
        
        _grantRole(GOVERNANCE_ROLE, msg.sender);
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
     */
    function getVotePower(address user) public view returns (uint256) {
        if (lockTime[user] == 0) return 0;
        if (block.timestamp < lockTime[user] + LOCK_DURATION) {
            return nthRoot(lockedTokens[user], rootPower);
        }
        return 0; // Lock expired
    }

    /**
     * @dev Update root power (only governor)
     */
    function setRootPower(uint256 newRootPower) external onlyRole(GOVERNANCE_ROLE) {
        require(newRootPower >= MIN_ROOT_POWER && newRootPower <= MAX_ROOT_POWER, "Invalid root power");
        uint256 oldPower = rootPower;
        rootPower = newRootPower;
        emit RootPowerUpdated(oldPower, newRootPower);
    }

    /**
     * @dev Lock tokens for governance participation
     */
    function lockTokens(uint256 _amount, uint256 _lockPeriod) external {
        if (_amount == 0) revert InvalidProposal();
        if (_lockPeriod == 0) revert InvalidProposal();
        if (block.timestamp + _lockPeriod <= block.timestamp) revert InvalidProposal();
        
        // Transfer tokens to this contract
        HalomToken(address(token())).transferFrom(msg.sender, address(this), _amount);
        
        lockedTokens[msg.sender] += _amount;
        lockTime[msg.sender] = block.timestamp + _lockPeriod;
        
        emit TokensLocked(msg.sender, _amount, _lockPeriod);
    }

    /**
     * @dev Unlock tokens after lock period
     */
    function unlockTokens() external {
        require(lockTime[msg.sender] > 0, "No tokens locked");
        require(
            block.timestamp >= lockTime[msg.sender] + LOCK_DURATION,
            "Lock period not expired"
        );
        
        uint256 amount = lockedTokens[msg.sender];
        lockedTokens[msg.sender] = 0;
        lockTime[msg.sender] = 0;
        
        require(
            HalomToken(address(token())).transfer(msg.sender, amount),
            "Transfer failed"
        );
        
        emit TokensUnlocked(msg.sender, amount);
    }

    /**
     * @dev Override to use custom voting power
     */
    function _getVotes(
        address account,
        uint256 blockNumber,
        bytes memory /*params*/
    ) internal view virtual override(Governor, GovernorVotes) returns (uint256) {
        return getVotePower(account);
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

    function quorum(uint256 blockNumber)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
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

    function emergencyRecovery() external onlyRole(GOVERNANCE_ROLE) {
        if (block.timestamp < emergencyRecoveryTime) revert VotingPeriodNotStarted();
        
        // Emergency recovery logic here
        // This could include pausing contracts, transferring funds, etc.
        
        emit EmergencyRecoveryExecuted(msg.sender, block.timestamp);
    }
} 
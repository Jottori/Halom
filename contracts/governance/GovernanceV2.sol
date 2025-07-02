// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

/**
 * @title HalomGovernanceV2
 * @dev Enhanced governance contract with role-based access control
 * @dev Implements immutable role declarations and hierarchical access control
 * @dev Based on OpenZeppelin AccessControl v5 best practices
 */
contract HalomGovernanceV2 is 
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using Checkpoints for Checkpoints.Trace224;

    // ============ Immutable Role Declarations ============
    bytes32 public immutable GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public immutable EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public immutable PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public immutable VETO_ROLE = keccak256("VETO_ROLE");
    bytes32 public immutable EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public immutable PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public immutable TIMELOCK_ROLE = keccak256("TIMELOCK_ROLE");
    bytes32 public immutable MULTISIG_ROLE = keccak256("MULTISIG_ROLE");
    
    // ============ Constants ============
    uint256 public constant MIN_PROPOSAL_THRESHOLD = 1000 * 10**18; // 1000 tokens
    uint256 public constant MIN_VOTING_PERIOD = 1 days;
    uint256 public constant MAX_VOTING_PERIOD = 30 days;
    uint256 public constant MIN_EXECUTION_DELAY = 1 hours;
    uint256 public constant MAX_EXECUTION_DELAY = 7 days;
    uint256 public constant QUORUM_THRESHOLD = 4000; // 40% of total supply
    uint256 public constant APPROVAL_THRESHOLD = 6000; // 60% of votes
    
    // ============ Enums ============
    enum ProposalState {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }
    
    enum VoteType {
        Against,
        For,
        Abstain
    }
    
    // ============ State Variables ============
    uint256 public proposalThreshold;
    uint256 public votingPeriod;
    uint256 public executionDelay;
    uint256 public quorumVotes;
    uint256 public approvalThreshold;
    
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => Receipt)) public proposalReceipts;
    mapping(address => uint256) public latestProposalIds;
    
    // Role expiry tracking
    mapping(bytes32 => mapping(address => uint256)) public roleExpiry;
    mapping(bytes32 => uint256) public roleMaxDuration;
    
    // Multisig tracking
    mapping(uint256 => MultisigProposal) public multisigProposals;
    uint256 public multisigProposalCount;
    
    // ============ Structs ============
    struct Proposal {
        uint256 id;
        address proposer;
        address[] targets;
        uint256[] values;
        string[] signatures;
        bytes[] calldatas;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool canceled;
        bool executed;
        string description;
        ProposalState state;
        uint256 executionTime;
        uint256 quorum;
    }
    
    struct Receipt {
        bool hasVoted;
        bool support;
        uint256 votes;
        VoteType voteType;
    }
    
    struct MultisigProposal {
        uint256 id;
        address proposer;
        address[] targets;
        uint256[] values;
        string[] signatures;
        bytes[] calldatas;
        uint256 requiredSignatures;
        uint256 currentSignatures;
        mapping(address => bool) hasSigned;
        uint256 expiryTime;
        bool executed;
        string description;
    }
    
    // ============ Events ============
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address[] targets,
        uint256[] values,
        string[] signatures,
        bytes[] calldatas,
        uint256 startTime,
        uint256 endTime,
        string description
    );
    
    event ProposalCanceled(uint256 indexed proposalId);
    event ProposalExecuted(uint256 indexed proposalId);
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        VoteType support,
        uint256 votes
    );
    
    event RoleGranted(
        bytes32 indexed role,
        address indexed account,
        address indexed sender,
        uint256 expiryTime
    );
    
    event RoleRevoked(
        bytes32 indexed role,
        address indexed account,
        address indexed sender
    );
    
    event MultisigProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 requiredSignatures,
        uint256 expiryTime
    );
    
    event MultisigProposalSigned(
        uint256 indexed proposalId,
        address indexed signer
    );
    
    event MultisigProposalExecuted(uint256 indexed proposalId);
    
    // ============ Errors ============
    error Governance__ProposalNotFound();
    error Governance__ProposalNotActive();
    error Governance__ProposalAlreadyExecuted();
    error Governance__ProposalAlreadyCanceled();
    error Governance__InsufficientVotes();
    error Governance__QuorumNotMet();
    error Governance__ApprovalThresholdNotMet();
    error Governance__InvalidVotingPeriod();
    error Governance__InvalidExecutionDelay();
    error Governance__InvalidProposalThreshold();
    error Governance__InvalidQuorum();
    error Governance__InvalidApprovalThreshold();
    error Governance__AlreadyVoted();
    error Governance__InvalidVoteType();
    error Governance__RoleExpired();
    error Governance__InvalidRoleDuration();
    error Governance__MultisigProposalNotFound();
    error Governance__MultisigProposalExpired();
    error Governance__AlreadySigned();
    error Governance__InsufficientSignatures();
    error Governance__EmergencyPaused();
    
    // ============ Modifiers ============
    modifier onlyGovernor() {
        if (!hasRole(GOVERNOR_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        _;
    }
    
    modifier onlyProposer() {
        if (!hasRole(PROPOSER_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        _;
    }
    
    modifier onlyExecutor() {
        if (!hasRole(EXECUTOR_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        _;
    }
    
    modifier onlyVeto() {
        if (!hasRole(VETO_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        _;
    }
    
    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        _;
    }
    
    modifier onlyPauser() {
        if (!hasRole(PAUSER_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        _;
    }
    
    modifier onlyMultisig() {
        if (!hasRole(MULTISIG_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        _;
    }
    
    // ============ Initialization ============
    function initialize(
        address _governance,
        uint256 _proposalThreshold,
        uint256 _votingPeriod,
        uint256 _executionDelay,
        uint256 _quorumVotes,
        uint256 _approvalThreshold
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        
        // Setup hierarchical role structure
        _setupRoleHierarchy();
        
        // Grant initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        _grantRole(EXECUTOR_ROLE, _governance);
        _grantRole(PROPOSER_ROLE, _governance);
        _grantRole(VETO_ROLE, _governance);
        _grantRole(EMERGENCY_ROLE, _governance);
        _grantRole(PAUSER_ROLE, _governance);
        _grantRole(TIMELOCK_ROLE, _governance);
        _grantRole(MULTISIG_ROLE, _governance);
        
        // Set governance parameters
        _setGovernanceParameters(
            _proposalThreshold,
            _votingPeriod,
            _executionDelay,
            _quorumVotes,
            _approvalThreshold
        );
        
        // Set role durations
        roleMaxDuration[GOVERNOR_ROLE] = 365 days;
        roleMaxDuration[EXECUTOR_ROLE] = 180 days;
        roleMaxDuration[PROPOSER_ROLE] = 90 days;
        roleMaxDuration[VETO_ROLE] = 365 days;
        roleMaxDuration[EMERGENCY_ROLE] = 30 days;
        roleMaxDuration[PAUSER_ROLE] = 90 days;
        roleMaxDuration[TIMELOCK_ROLE] = 365 days;
        roleMaxDuration[MULTISIG_ROLE] = 180 days;
    }
    
    // ============ Role Hierarchy Setup ============
    function _setupRoleHierarchy() internal {
        // DEFAULT_ADMIN_ROLE can manage all other roles
        _setRoleAdmin(GOVERNOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EXECUTOR_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(PROPOSER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(VETO_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(EMERGENCY_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(PAUSER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(TIMELOCK_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(MULTISIG_ROLE, GOVERNOR_ROLE);
    }
    
    // ============ Proposal Functions ============
    
    /**
     * @dev Create a new proposal
     */
    function propose(
        address[] memory _targets,
        uint256[] memory _values,
        string[] memory _signatures,
        bytes[] memory _calldatas,
        string memory _description
    ) external onlyProposer returns (uint256) {
        if (_targets.length == 0 || _targets.length != _values.length || 
            _targets.length != _signatures.length || _targets.length != _calldatas.length) {
            revert Governance__ProposalNotFound();
        }
        
        uint256 proposalId = proposalCount++;
        
        Proposal storage newProposal = proposals[proposalId];
        newProposal.id = proposalId;
        newProposal.proposer = msg.sender;
        newProposal.targets = _targets;
        newProposal.values = _values;
        newProposal.signatures = _signatures;
        newProposal.calldatas = _calldatas;
        newProposal.startTime = block.timestamp;
        newProposal.endTime = block.timestamp + votingPeriod;
        newProposal.description = _description;
        newProposal.state = ProposalState.Active;
        newProposal.quorum = quorumVotes;
        
        latestProposalIds[msg.sender] = proposalId;
        
        emit ProposalCreated(
            proposalId,
            msg.sender,
            _targets,
            _values,
            _signatures,
            _calldatas,
            newProposal.startTime,
            newProposal.endTime,
            _description
        );
        
        return proposalId;
    }
    
    /**
     * @dev Execute a proposal
     */
    function execute(uint256 _proposalId) external onlyExecutor nonReentrant whenNotPaused {
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.id != _proposalId) {
            revert Governance__ProposalNotFound();
        }
        if (proposal.state != ProposalState.Succeeded) {
            revert Governance__ProposalNotActive();
        }
        if (proposal.executed) {
            revert Governance__ProposalAlreadyExecuted();
        }
        if (block.timestamp < proposal.endTime + executionDelay) {
            revert Governance__ProposalNotActive();
        }
        
        proposal.executed = true;
        proposal.state = ProposalState.Executed;
        proposal.executionTime = block.timestamp;
        
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            _executeTransaction(
                proposal.targets[i],
                proposal.values[i],
                proposal.signatures[i],
                proposal.calldatas[i]
            );
        }
        
        emit ProposalExecuted(_proposalId);
    }
    
    /**
     * @dev Cancel a proposal
     */
    function cancel(uint256 _proposalId) external {
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.id != _proposalId) {
            revert Governance__ProposalNotFound();
        }
        if (proposal.canceled) {
            revert Governance__ProposalAlreadyCanceled();
        }
        if (proposal.executed) {
            revert Governance__ProposalAlreadyExecuted();
        }
        
        // Only proposer or veto can cancel
        if (msg.sender != proposal.proposer && !hasRole(VETO_ROLE, msg.sender)) {
            revert Governance__ProposalNotFound();
        }
        
        proposal.canceled = true;
        proposal.state = ProposalState.Canceled;
        
        emit ProposalCanceled(_proposalId);
    }
    
    /**
     * @dev Cast vote on a proposal
     */
    function castVote(uint256 _proposalId, VoteType _support) external {
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.id != _proposalId) {
            revert Governance__ProposalNotFound();
        }
        if (proposal.state != ProposalState.Active) {
            revert Governance__ProposalNotActive();
        }
        if (block.timestamp > proposal.endTime) {
            revert Governance__ProposalNotActive();
        }
        
        Receipt storage receipt = proposalReceipts[_proposalId][msg.sender];
        if (receipt.hasVoted) {
            revert Governance__AlreadyVoted();
        }
        
        uint256 votes = getVotes(msg.sender);
        if (votes == 0) {
            revert Governance__InsufficientVotes();
        }
        
        receipt.hasVoted = true;
        receipt.voteType = _support;
        receipt.votes = votes;
        
        if (_support == VoteType.For) {
            proposal.forVotes += votes;
        } else if (_support == VoteType.Against) {
            proposal.againstVotes += votes;
        } else if (_support == VoteType.Abstain) {
            proposal.abstainVotes += votes;
        } else {
            revert Governance__InvalidVoteType();
        }
        
        emit VoteCast(msg.sender, _proposalId, _support, votes);
        
        // Update proposal state
        _updateProposalState(_proposalId);
    }
    
    // ============ Multisig Functions ============
    
    /**
     * @dev Create a multisig proposal
     */
    function createMultisigProposal(
        address[] memory _targets,
        uint256[] memory _values,
        string[] memory _signatures,
        bytes[] memory _calldatas,
        uint256 _requiredSignatures,
        uint256 _expiryTime,
        string memory _description
    ) external onlyMultisig returns (uint256) {
        if (_targets.length == 0 || _targets.length != _values.length || 
            _targets.length != _signatures.length || _targets.length != _calldatas.length) {
            revert Governance__ProposalNotFound();
        }
        if (_expiryTime <= block.timestamp) {
            revert Governance__MultisigProposalExpired();
        }
        
        uint256 proposalId = multisigProposalCount++;
        
        MultisigProposal storage newProposal = multisigProposals[proposalId];
        newProposal.id = proposalId;
        newProposal.proposer = msg.sender;
        newProposal.targets = _targets;
        newProposal.values = _values;
        newProposal.signatures = _signatures;
        newProposal.calldatas = _calldatas;
        newProposal.requiredSignatures = _requiredSignatures;
        newProposal.expiryTime = _expiryTime;
        newProposal.description = _description;
        
        emit MultisigProposalCreated(
            proposalId,
            msg.sender,
            _requiredSignatures,
            _expiryTime
        );
        
        return proposalId;
    }
    
    /**
     * @dev Sign a multisig proposal
     */
    function signMultisigProposal(uint256 _proposalId) external onlyMultisig {
        MultisigProposal storage proposal = multisigProposals[_proposalId];
        if (proposal.id != _proposalId) {
            revert Governance__MultisigProposalNotFound();
        }
        if (proposal.expiryTime <= block.timestamp) {
            revert Governance__MultisigProposalExpired();
        }
        if (proposal.hasSigned[msg.sender]) {
            revert Governance__AlreadySigned();
        }
        if (proposal.executed) {
            revert Governance__ProposalAlreadyExecuted();
        }
        
        proposal.hasSigned[msg.sender] = true;
        proposal.currentSignatures++;
        
        emit MultisigProposalSigned(_proposalId, msg.sender);
    }
    
    /**
     * @dev Execute a multisig proposal
     */
    function executeMultisigProposal(uint256 _proposalId) external onlyMultisig nonReentrant whenNotPaused {
        MultisigProposal storage proposal = multisigProposals[_proposalId];
        if (proposal.id != _proposalId) {
            revert Governance__MultisigProposalNotFound();
        }
        if (proposal.expiryTime <= block.timestamp) {
            revert Governance__MultisigProposalExpired();
        }
        if (proposal.currentSignatures < proposal.requiredSignatures) {
            revert Governance__InsufficientSignatures();
        }
        if (proposal.executed) {
            revert Governance__ProposalAlreadyExecuted();
        }
        
        proposal.executed = true;
        
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            _executeTransaction(
                proposal.targets[i],
                proposal.values[i],
                proposal.signatures[i],
                proposal.calldatas[i]
            );
        }
        
        emit MultisigProposalExecuted(_proposalId);
    }
    
    // ============ Role Management Functions ============
    
    /**
     * @dev Grant role with expiry
     */
    function grantRoleWithExpiry(
        bytes32 _role,
        address _account,
        uint256 _duration
    ) external onlyRole(getRoleAdmin(_role)) {
        if (_duration > roleMaxDuration[_role]) {
            revert Governance__InvalidRoleDuration();
        }
        
        uint256 expiryTime = block.timestamp + _duration;
        roleExpiry[_role][_account] = expiryTime;
        _grantRole(_role, _account);
        
        emit RoleGranted(_role, _account, msg.sender, expiryTime);
    }
    
    /**
     * @dev Revoke role
     */
    function revokeRole(bytes32 _role, address _account) external override onlyRole(getRoleAdmin(_role)) {
        roleExpiry[_role][_account] = 0;
        _revokeRole(_role, _account);
        
        emit RoleRevoked(_role, _account, msg.sender);
    }
    
    /**
     * @dev Check if role is expired
     */
    function isRoleExpired(bytes32 _role, address _account) public view returns (bool) {
        uint256 expiry = roleExpiry[_role][_account];
        return expiry > 0 && block.timestamp > expiry;
    }
    
    // ============ Governor Functions ============
    
    /**
     * @dev Set governance parameters
     */
    function setGovernanceParameters(
        uint256 _proposalThreshold,
        uint256 _votingPeriod,
        uint256 _executionDelay,
        uint256 _quorumVotes,
        uint256 _approvalThreshold
    ) external onlyGovernor {
        _setGovernanceParameters(
            _proposalThreshold,
            _votingPeriod,
            _executionDelay,
            _quorumVotes,
            _approvalThreshold
        );
    }
    
    /**
     * @dev Set role max duration
     */
    function setRoleMaxDuration(bytes32 _role, uint256 _maxDuration) external onlyGovernor {
        roleMaxDuration[_role] = _maxDuration;
    }
    
    // ============ Pauser Functions ============
    
    /**
     * @dev Pause governance operations
     */
    function pause() external onlyPauser {
        _pause();
    }
    
    /**
     * @dev Unpause governance operations
     */
    function unpause() external onlyPauser {
        _unpause();
    }
    
    // ============ Emergency Functions ============
    
    /**
     * @dev Emergency pause with reason
     */
    function emergencyPause(string calldata _reason) external onlyEmergency {
        _pause();
    }
    
    /**
     * @dev Emergency unpause
     */
    function emergencyUnpause() external onlyEmergency {
        _unpause();
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get proposal state
     */
    function state(uint256 _proposalId) public view returns (ProposalState) {
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.id != _proposalId) {
            return ProposalState.Pending;
        }
        return proposal.state;
    }
    
    /**
     * @dev Get proposal votes
     */
    function getProposalVotes(uint256 _proposalId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes
    ) {
        Proposal storage proposal = proposals[_proposalId];
        return (proposal.forVotes, proposal.againstVotes, proposal.abstainVotes);
    }
    
    /**
     * @dev Get user's voting power (placeholder - would integrate with staking contract)
     */
    function getVotes(address _account) public view returns (uint256) {
        // This would integrate with the staking contract
        // For now, return a placeholder value
        return 1000 * 10**18; // 1000 tokens
    }
    
    /**
     * @dev Get multisig proposal info
     */
    function getMultisigProposal(uint256 _proposalId) external view returns (
        address proposer,
        uint256 requiredSignatures,
        uint256 currentSignatures,
        uint256 expiryTime,
        bool executed,
        string memory description
    ) {
        MultisigProposal storage proposal = multisigProposals[_proposalId];
        return (
            proposal.proposer,
            proposal.requiredSignatures,
            proposal.currentSignatures,
            proposal.expiryTime,
            proposal.executed,
            proposal.description
        );
    }
    
    /**
     * @dev Check if user has signed multisig proposal
     */
    function hasSignedMultisigProposal(uint256 _proposalId, address _signer) external view returns (bool) {
        return multisigProposals[_proposalId].hasSigned[_signer];
    }
    
    // ============ Internal Functions ============
    
    /**
     * @dev Execute a transaction
     */
    function _executeTransaction(
        address _target,
        uint256 _value,
        string memory _signature,
        bytes memory _data
    ) internal {
        bytes memory callData;
        if (bytes(_signature).length == 0) {
            callData = _data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(_signature))), _data);
        }
        
        (bool success, bytes memory returndata) = _target.call{value: _value}(callData);
        if (!success) {
            if (returndata.length > 0) {
                assembly {
                    let returndata_size := mload(returndata)
                    revert(add(32, returndata), returndata_size)
                }
            } else {
                revert("Governance: transaction failed");
            }
        }
    }
    
    /**
     * @dev Update proposal state
     */
    function _updateProposalState(uint256 _proposalId) internal {
        Proposal storage proposal = proposals[_proposalId];
        
        if (proposal.canceled) {
            proposal.state = ProposalState.Canceled;
        } else if (block.timestamp > proposal.endTime) {
            if (proposal.forVotes + proposal.againstVotes + proposal.abstainVotes < proposal.quorum) {
                proposal.state = ProposalState.Defeated;
            } else if (proposal.forVotes * 10000 < (proposal.forVotes + proposal.againstVotes) * approvalThreshold) {
                proposal.state = ProposalState.Defeated;
            } else {
                proposal.state = ProposalState.Succeeded;
            }
        }
    }
    
    /**
     * @dev Set governance parameters with validation
     */
    function _setGovernanceParameters(
        uint256 _proposalThreshold,
        uint256 _votingPeriod,
        uint256 _executionDelay,
        uint256 _quorumVotes,
        uint256 _approvalThreshold
    ) internal {
        if (_votingPeriod < MIN_VOTING_PERIOD || _votingPeriod > MAX_VOTING_PERIOD) {
            revert Governance__InvalidVotingPeriod();
        }
        if (_executionDelay < MIN_EXECUTION_DELAY || _executionDelay > MAX_EXECUTION_DELAY) {
            revert Governance__InvalidExecutionDelay();
        }
        if (_proposalThreshold < MIN_PROPOSAL_THRESHOLD) {
            revert Governance__InvalidProposalThreshold();
        }
        if (_quorumVotes == 0) {
            revert Governance__InvalidQuorum();
        }
        if (_approvalThreshold < 5000 || _approvalThreshold > 10000) {
            revert Governance__InvalidApprovalThreshold();
        }
        
        proposalThreshold = _proposalThreshold;
        votingPeriod = _votingPeriod;
        executionDelay = _executionDelay;
        quorumVotes = _quorumVotes;
        approvalThreshold = _approvalThreshold;
    }
    
    // ============ UUPS Upgrade ============
    
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
    
    // ============ Override Functions ============
    
    /**
     * @dev Override hasRole to check expiry
     */
    function hasRole(bytes32 _role, address _account) public view override returns (bool) {
        if (isRoleExpired(_role, _account)) {
            return false;
        }
        return super.hasRole(_role, _account);
    }
} 

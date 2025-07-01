// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "./QuadraticVotingUtils.sol";

/**
 * @title Governance
 * @dev Governance contract with quadratic voting mechanism and cross-chain proposal relay
 */
contract Governance is 
    Initializable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable 
{
    using QuadraticVotingUtils for QuadraticVotingUtils.VotingData;

    // Role definitions
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    // Proposal structure
    struct Proposal {
        uint256 id;
        string title;
        bytes payload;
        address proposer;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startTime;
        uint256 endTime;
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
        mapping(address => uint256) votesCast;
    }

    // Governance parameters
    uint256 public quorum;
    uint256 public votingDelay;
    uint256 public votingPeriod;
    uint256 public proposalThreshold;
    
    // Proposal tracking
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public proposalCounts;
    
    // Voting data
    QuadraticVotingUtils.VotingData public votingData;

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string title,
        bytes payload,
        uint256 startTime,
        uint256 endTime
    );
    event Voted(
        uint256 indexed proposalId,
        address indexed voter,
        uint256 votes,
        bool support
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event QuorumChanged(uint256 oldQuorum, uint256 newQuorum);
    event VotingDelayChanged(uint256 oldDelay, uint256 newDelay);
    event VotingPeriodChanged(uint256 oldPeriod, uint256 newPeriod);
    event CrossChainRelayed(uint256 indexed proposalId, uint256 sourceChainId);
    event Upgraded(address indexed implementation);

    // Errors
    error ProposalNotFound();
    error ProposalNotActive();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyCanceled();
    error VotingNotStarted();
    error VotingEnded();
    error AlreadyVoted();
    error InsufficientVotes();
    error QuorumNotMet();
    error InvalidProposal();
    error UnauthorizedExecution();
    error InvalidVotingParams();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        uint256 _quorum,
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _proposalThreshold
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(BRIDGE_ROLE, admin);

        quorum = _quorum;
        votingDelay = _votingDelay;
        votingPeriod = _votingPeriod;
        proposalThreshold = _proposalThreshold;

        proposalCount = 0;
    }

    // ============ PUBLIC FUNCTIONS ============

    /**
     * @dev Create a new proposal
     */
    function propose(string memory title, bytes calldata payload) 
        external 
        whenNotPaused 
        nonReentrant 
        returns (uint256) 
    {
        if (bytes(title).length == 0) revert InvalidProposal();
        if (payload.length == 0) revert InvalidProposal();
        if (proposalCounts[msg.sender] < proposalThreshold) revert InsufficientVotes();

        proposalCount++;
        uint256 proposalId = proposalCount;

        Proposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.title = title;
        proposal.payload = payload;
        proposal.proposer = msg.sender;
        proposal.startTime = block.timestamp + votingDelay;
        proposal.endTime = block.timestamp + votingDelay + votingPeriod;
        proposal.executed = false;
        proposal.canceled = false;

        proposalCounts[msg.sender]++;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            title,
            payload,
            proposal.startTime,
            proposal.endTime
        );

        return proposalId;
    }

    /**
     * @dev Vote on a proposal using quadratic voting
     */
    function vote(uint256 proposalId, uint256 votes) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp < proposal.startTime) revert VotingNotStarted();
        if (block.timestamp > proposal.endTime) revert VotingEnded();
        if (proposal.hasVoted[msg.sender]) revert AlreadyVoted();

        // Calculate quadratic voting weight
        uint256 votingWeight = votingData.calculateQuadraticWeight(votes);
        
        proposal.hasVoted[msg.sender] = true;
        proposal.votesCast[msg.sender] = votes;

        // Add to total votes (using quadratic weight)
        proposal.forVotes += votingWeight;

        emit Voted(proposalId, msg.sender, votes, true);
    }

    /**
     * @dev Vote against a proposal
     */
    function voteAgainst(uint256 proposalId, uint256 votes) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp < proposal.startTime) revert VotingNotStarted();
        if (block.timestamp > proposal.endTime) revert VotingEnded();
        if (proposal.hasVoted[msg.sender]) revert AlreadyVoted();

        // Calculate quadratic voting weight
        uint256 votingWeight = votingData.calculateQuadraticWeight(votes);
        
        proposal.hasVoted[msg.sender] = true;
        proposal.votesCast[msg.sender] = votes;

        // Add to against votes (using quadratic weight)
        proposal.againstVotes += votingWeight;

        emit Voted(proposalId, msg.sender, votes, false);
    }

    // ============ ROLE-BASED FUNCTIONS ============

    /**
     * @dev Execute a successful proposal - only GOVERNOR_ROLE
     */
    function executeProposal(uint256 proposalId) 
        external 
        onlyRole(GOVERNOR_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp <= proposal.endTime) revert VotingEnded();
        if (proposal.forVotes < quorum) revert QuorumNotMet();

        proposal.executed = true;

        // Execute the proposal payload
        (bool success, ) = address(this).call(proposal.payload);
        require(success, "Proposal execution failed");

        emit ProposalExecuted(proposalId);
    }

    /**
     * @dev Set quorum requirement - only GOVERNOR_ROLE
     */
    function setQuorum(uint256 newQuorum) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        uint256 oldQuorum = quorum;
        quorum = newQuorum;
        emit QuorumChanged(oldQuorum, newQuorum);
    }

    /**
     * @dev Set voting delay - only GOVERNOR_ROLE
     */
    function setVotingDelay(uint256 delay) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (delay > 30 days) revert InvalidVotingParams();
        
        uint256 oldDelay = votingDelay;
        votingDelay = delay;
        emit VotingDelayChanged(oldDelay, delay);
    }

    /**
     * @dev Set voting period - only GOVERNOR_ROLE
     */
    function setVotingPeriod(uint256 period) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (period < 1 days || period > 30 days) revert InvalidVotingParams();
        
        uint256 oldPeriod = votingPeriod;
        votingPeriod = period;
        emit VotingPeriodChanged(oldPeriod, period);
    }

    /**
     * @dev Relay cross-chain proposal - only BRIDGE_ROLE
     */
    function relayCrossChainProposal(bytes calldata data) 
        external 
        onlyRole(BRIDGE_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        proposalCount++;
        uint256 proposalId = proposalCount;

        Proposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.title = "Cross-Chain Proposal";
        proposal.payload = data;
        proposal.proposer = msg.sender;
        proposal.startTime = block.timestamp;
        proposal.endTime = block.timestamp + votingPeriod;
        proposal.executed = false;
        proposal.canceled = false;

        emit CrossChainRelayed(proposalId, 0); // Source chain ID would be in data
    }

    /**
     * @dev Cancel a proposal - only proposer or GOVERNOR_ROLE
     */
    function cancelProposal(uint256 proposalId) 
        external 
        whenNotPaused 
    {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.canceled) revert ProposalAlreadyCanceled();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        
        require(
            msg.sender == proposal.proposer || hasRole(GOVERNOR_ROLE, msg.sender),
            "Not authorized to cancel"
        );

        proposal.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    /**
     * @dev Pause governance - only GOVERNOR_ROLE
     */
    function pause() external onlyRole(GOVERNOR_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause governance - only GOVERNOR_ROLE
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
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
     * @dev Required by UUPSUpgradeable
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {}

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get proposal details
     */
    function getProposal(uint256 proposalId) 
        external 
        view 
        returns (
            uint256 id,
            string memory title,
            bytes memory payload,
            address proposer,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 startTime,
            uint256 endTime,
            bool executed,
            bool canceled
        ) 
    {
        Proposal storage proposal = proposals[proposalId];
        return (
            proposal.id,
            proposal.title,
            proposal.payload,
            proposal.proposer,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.startTime,
            proposal.endTime,
            proposal.executed,
            proposal.canceled
        );
    }

    /**
     * @dev Check if user has voted on proposal
     */
    function hasVoted(uint256 proposalId, address voter) 
        external 
        view 
        returns (bool) 
    {
        return proposals[proposalId].hasVoted[voter];
    }

    /**
     * @dev Get user's vote on proposal
     */
    function getVote(uint256 proposalId, address voter) 
        external 
        view 
        returns (uint256) 
    {
        return proposals[proposalId].votesCast[voter];
    }

    /**
     * @dev Get proposal state
     */
    function getProposalState(uint256 proposalId) 
        external 
        view 
        returns (string memory) 
    {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.id == 0) return "Unknown";
        if (proposal.canceled) return "Canceled";
        if (proposal.executed) return "Executed";
        if (block.timestamp < proposal.startTime) return "Pending";
        if (block.timestamp <= proposal.endTime) return "Active";
        if (proposal.forVotes < quorum) return "Defeated";
        return "Succeeded";
    }

    /**
     * @dev Get governance parameters
     */
    function getGovernanceParams() 
        external 
        view 
        returns (
            uint256 _quorum,
            uint256 _votingDelay,
            uint256 _votingPeriod,
            uint256 _proposalThreshold
        ) 
    {
        return (quorum, votingDelay, votingPeriod, proposalThreshold);
    }
} 
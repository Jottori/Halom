// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title BridgeValidator
 * @dev Manages validator network consensus for cross-chain bridge operations
 * @dev Implements multi-signature consensus with stake-based voting
 */
contract BridgeValidator is 
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;

    // ============ Constants ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    uint256 public constant MIN_VALIDATORS = 3;
    uint256 public constant MAX_VALIDATORS = 21;
    uint256 public constant CONSENSUS_THRESHOLD = 2; // 2/3 consensus
    uint256 public constant MIN_STAKE_AMOUNT = 1000 * 10**18; // 1000 tokens
    uint256 public constant VOTING_PERIOD = 1 hours;
    uint256 public constant EXECUTION_DELAY = 30 minutes;
    
    // ============ State Variables ============
    uint256 public totalValidators;
    uint256 public totalStake;
    uint256 public proposalCounter;
    
    mapping(address => ValidatorInfo) public validators;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => Vote)) public votes;
    mapping(address => uint256) public validatorStake;
    mapping(address => uint256) public lastVoteTime;
    
    // ============ Structs ============
    struct ValidatorInfo {
        bool isActive;
        uint256 stake;
        uint256 votingPower;
        uint256 lastActive;
        uint256 totalVotes;
        uint256 correctVotes;
        uint256 reputation;
    }
    
    struct Proposal {
        uint256 id;
        address proposer;
        bytes32 requestHash;
        uint256 timestamp;
        uint256 expiry;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 totalVotingPower;
        bool executed;
        bool canceled;
        string description;
    }
    
    struct Vote {
        bool hasVoted;
        bool approved;
        uint256 votingPower;
        uint256 timestamp;
    }
    
    // ============ Events ============
    event ValidatorAdded(address indexed validator, uint256 stake);
    event ValidatorRemoved(address indexed validator);
    event ValidatorStakeUpdated(address indexed validator, uint256 oldStake, uint256 newStake);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, bytes32 requestHash);
    event VoteCast(uint256 indexed proposalId, address indexed validator, bool approved, uint256 votingPower);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event ReputationUpdated(address indexed validator, uint256 oldReputation, uint256 newReputation);
    
    // ============ Errors ============
    error Validator__InvalidValidator();
    error Validator__InsufficientStake();
    error Validator__ValidatorAlreadyExists();
    error Validator__ValidatorNotFound();
    error Validator__ProposalNotFound();
    error Validator__ProposalExpired();
    error Validator__AlreadyVoted();
    error Validator__VotingPeriodNotStarted();
    error Validator__VotingPeriodEnded();
    error Validator__InsufficientVotes();
    error Validator__ProposalAlreadyExecuted();
    error Validator__ProposalAlreadyCanceled();
    error Validator__InvalidVotingPower();
    error Validator__MaxValidatorsReached();
    
    // ============ Modifiers ============
    modifier onlyValidator() {
        if (!validators[msg.sender].isActive) {
            revert Validator__InvalidValidator();
        }
        _;
    }
    
    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) {
            revert Validator__InvalidValidator();
        }
        _;
    }
    
    modifier proposalExists(uint256 _proposalId) {
        if (proposals[_proposalId].proposer == address(0)) {
            revert Validator__ProposalNotFound();
        }
        _;
    }
    
    // ============ Initialization ============
    function initialize(address _admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(VALIDATOR_ROLE, _admin);
        
        // Add admin as initial validator
        _addValidator(_admin, MIN_STAKE_AMOUNT);
    }
    
    // ============ Validator Management ============
    
    /**
     * @dev Add a new validator
     * @param _validator Validator address
     * @param _stake Stake amount
     */
    function addValidator(address _validator, uint256 _stake) external onlyAdmin {
        if (_stake < MIN_STAKE_AMOUNT) {
            revert Validator__InsufficientStake();
        }
        if (validators[_validator].isActive) {
            revert Validator__ValidatorAlreadyExists();
        }
        if (totalValidators >= MAX_VALIDATORS) {
            revert Validator__MaxValidatorsReached();
        }
        
        _addValidator(_validator, _stake);
    }
    
    /**
     * @dev Remove a validator
     * @param _validator Validator address
     */
    function removeValidator(address _validator) external onlyAdmin {
        if (!validators[_validator].isActive) {
            revert Validator__ValidatorNotFound();
        }
        
        _removeValidator(_validator);
    }
    
    /**
     * @dev Update validator stake
     * @param _validator Validator address
     * @param _newStake New stake amount
     */
    function updateValidatorStake(address _validator, uint256 _newStake) external onlyAdmin {
        if (!validators[_validator].isActive) {
            revert Validator__ValidatorNotFound();
        }
        if (_newStake < MIN_STAKE_AMOUNT) {
            revert Validator__InsufficientStake();
        }
        
        uint256 oldStake = validators[_validator].stake;
        validators[_validator].stake = _newStake;
        validators[_validator].votingPower = _calculateVotingPower(_newStake);
        
        totalStake = totalStake - oldStake + _newStake;
        validatorStake[_validator] = _newStake;
        
        emit ValidatorStakeUpdated(_validator, oldStake, _newStake);
    }
    
    // ============ Proposal Management ============
    
    /**
     * @dev Create a new proposal
     * @param _requestHash Hash of the bridge request
     * @param _description Description of the proposal
     */
    function createProposal(
        bytes32 _requestHash,
        string calldata _description
    ) external onlyValidator returns (uint256) {
        uint256 proposalId = ++proposalCounter;
        
        Proposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.requestHash = _requestHash;
        proposal.timestamp = block.timestamp;
        proposal.expiry = block.timestamp + VOTING_PERIOD;
        proposal.description = _description;
        
        emit ProposalCreated(proposalId, msg.sender, _requestHash);
        
        return proposalId;
    }
    
    /**
     * @dev Vote on a proposal
     * @param _proposalId Proposal ID
     * @param _approved Whether to approve the proposal
     */
    function vote(
        uint256 _proposalId,
        bool _approved
    ) external onlyValidator proposalExists(_proposalId) {
        Proposal storage proposal = proposals[_proposalId];
        Vote storage vote = votes[_proposalId][msg.sender];
        
        if (vote.hasVoted) {
            revert Validator__AlreadyVoted();
        }
        if (block.timestamp < proposal.timestamp) {
            revert Validator__VotingPeriodNotStarted();
        }
        if (block.timestamp > proposal.expiry) {
            revert Validator__VotingPeriodEnded();
        }
        
        uint256 votingPower = validators[msg.sender].votingPower;
        if (votingPower == 0) {
            revert Validator__InvalidVotingPower();
        }
        
        vote.hasVoted = true;
        vote.approved = _approved;
        vote.votingPower = votingPower;
        vote.timestamp = block.timestamp;
        
        if (_approved) {
            proposal.yesVotes += votingPower;
        } else {
            proposal.noVotes += votingPower;
        }
        
        proposal.totalVotingPower += votingPower;
        validators[msg.sender].totalVotes++;
        lastVoteTime[msg.sender] = block.timestamp;
        
        emit VoteCast(_proposalId, msg.sender, _approved, votingPower);
    }
    
    /**
     * @dev Execute a proposal if consensus is reached
     * @param _proposalId Proposal ID
     */
    function executeProposal(uint256 _proposalId) external proposalExists(_proposalId) {
        Proposal storage proposal = proposals[_proposalId];
        
        if (proposal.executed) {
            revert Validator__ProposalAlreadyExecuted();
        }
        if (proposal.canceled) {
            revert Validator__ProposalAlreadyCanceled();
        }
        if (block.timestamp < proposal.expiry + EXECUTION_DELAY) {
            revert Validator__VotingPeriodNotStarted();
        }
        
        // Check consensus threshold
        uint256 totalVotes = proposal.yesVotes + proposal.noVotes;
        if (totalVotes < (totalStake * CONSENSUS_THRESHOLD) / 3) {
            revert Validator__InsufficientVotes();
        }
        
        if (proposal.yesVotes > proposal.noVotes) {
            proposal.executed = true;
            emit ProposalExecuted(_proposalId);
            
            // Update validator reputations
            _updateValidatorReputations(_proposalId, true);
        }
    }
    
    /**
     * @dev Cancel a proposal
     * @param _proposalId Proposal ID
     */
    function cancelProposal(uint256 _proposalId) external onlyAdmin proposalExists(_proposalId) {
        Proposal storage proposal = proposals[_proposalId];
        
        if (proposal.executed) {
            revert Validator__ProposalAlreadyExecuted();
        }
        if (proposal.canceled) {
            revert Validator__ProposalAlreadyCanceled();
        }
        
        proposal.canceled = true;
        emit ProposalCanceled(_proposalId);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get validator information
     * @param _validator Validator address
     */
    function getValidatorInfo(address _validator) external view returns (
        bool isActive,
        uint256 stake,
        uint256 votingPower,
        uint256 lastActive,
        uint256 totalVotes,
        uint256 correctVotes,
        uint256 reputation
    ) {
        ValidatorInfo storage validator = validators[_validator];
        return (
            validator.isActive,
            validator.stake,
            validator.votingPower,
            validator.lastActive,
            validator.totalVotes,
            validator.correctVotes,
            validator.reputation
        );
    }
    
    /**
     * @dev Get proposal information
     * @param _proposalId Proposal ID
     */
    function getProposalInfo(uint256 _proposalId) external view returns (
        uint256 id,
        address proposer,
        bytes32 requestHash,
        uint256 timestamp,
        uint256 expiry,
        uint256 yesVotes,
        uint256 noVotes,
        uint256 totalVotingPower,
        bool executed,
        bool canceled,
        string memory description
    ) {
        Proposal storage proposal = proposals[_proposalId];
        return (
            proposal.id,
            proposal.proposer,
            proposal.requestHash,
            proposal.timestamp,
            proposal.expiry,
            proposal.yesVotes,
            proposal.noVotes,
            proposal.totalVotingPower,
            proposal.executed,
            proposal.canceled,
            proposal.description
        );
    }
    
    /**
     * @dev Get vote information
     * @param _proposalId Proposal ID
     * @param _validator Validator address
     */
    function getVoteInfo(uint256 _proposalId, address _validator) external view returns (
        bool hasVoted,
        bool approved,
        uint256 votingPower,
        uint256 timestamp
    ) {
        Vote storage vote = votes[_proposalId][_validator];
        return (
            vote.hasVoted,
            vote.approved,
            vote.votingPower,
            vote.timestamp
        );
    }
    
    /**
     * @dev Check if proposal has consensus
     * @param _proposalId Proposal ID
     */
    function hasConsensus(uint256 _proposalId) external view returns (bool) {
        Proposal storage proposal = proposals[_proposalId];
        uint256 totalVotes = proposal.yesVotes + proposal.noVotes;
        return totalVotes >= (totalStake * CONSENSUS_THRESHOLD) / 3 && proposal.yesVotes > proposal.noVotes;
    }
    
    // ============ Internal Functions ============
    
    /**
     * @dev Add validator internally
     */
    function _addValidator(address _validator, uint256 _stake) internal {
        validators[_validator].isActive = true;
        validators[_validator].stake = _stake;
        validators[_validator].votingPower = _calculateVotingPower(_stake);
        validators[_validator].lastActive = block.timestamp;
        validators[_validator].reputation = 100; // Base reputation
        
        totalValidators++;
        totalStake += _stake;
        validatorStake[_validator] = _stake;
        
        _grantRole(VALIDATOR_ROLE, _validator);
        
        emit ValidatorAdded(_validator, _stake);
    }
    
    /**
     * @dev Remove validator internally
     */
    function _removeValidator(address _validator) internal {
        uint256 stake = validators[_validator].stake;
        
        validators[_validator].isActive = false;
        validators[_validator].stake = 0;
        validators[_validator].votingPower = 0;
        
        totalValidators--;
        totalStake -= stake;
        validatorStake[_validator] = 0;
        
        _revokeRole(VALIDATOR_ROLE, _validator);
        
        emit ValidatorRemoved(_validator);
    }
    
    /**
     * @dev Calculate voting power based on stake
     */
    function _calculateVotingPower(uint256 _stake) internal pure returns (uint256) {
        // Simple linear relationship, can be made more complex
        return _stake / 10**18;
    }
    
    /**
     * @dev Update validator reputations based on voting accuracy
     */
    function _updateValidatorReputations(uint256 _proposalId, bool _proposalPassed) internal {
        Proposal storage proposal = proposals[_proposalId];
        
        for (uint256 i = 0; i < totalValidators; i++) {
            // This is a simplified implementation
            // In practice, you'd iterate through validators differently
            address validator = address(0); // Placeholder
            Vote storage vote = votes[_proposalId][validator];
            
            if (vote.hasVoted) {
                ValidatorInfo storage validatorInfo = validators[validator];
                uint256 oldReputation = validatorInfo.reputation;
                
                if (vote.approved == _proposalPassed) {
                    validatorInfo.correctVotes++;
                    validatorInfo.reputation = oldReputation + 1;
                } else {
                    validatorInfo.reputation = oldReputation > 1 ? oldReputation - 1 : 1;
                }
                
                emit ReputationUpdated(validator, oldReputation, validatorInfo.reputation);
            }
        }
    }
    
    // ============ UUPS Upgrade ============
    
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
} 

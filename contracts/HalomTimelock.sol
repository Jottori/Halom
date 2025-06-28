// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

// Custom errors for gas optimization
error ProposalNotPending();
error ProposalAlreadyExecuted();
error ProposalAlreadyCanceled();
error InvalidDelay();
error Unauthorized();
error ZeroAddress();

/**
 * @title HalomTimelock
 * @dev Enhanced timelock controller for Halom protocol governance
 * Provides time-delayed execution of administrative functions with enhanced security
 */
contract HalomTimelock is TimelockController {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // Enhanced proposal tracking
    mapping(bytes32 => ProposalDetails) public proposalDetails;
    mapping(bytes32 => bool) public proposalCanceled;
    mapping(bytes32 => uint256) public proposalExecutionTime;
    
    // Governance parameter updates
    mapping(bytes32 => GovernanceUpdate) public pendingGovernanceUpdates;
    mapping(bytes32 => bool) public governanceUpdateExecuted;
    
    // Events
    event ProposalQueued(bytes32 indexed proposalId, address indexed proposer, uint256 executionTime);
    event ProposalExecuted(bytes32 indexed proposalId, address indexed executor, uint256 executionTime);
    event ProposalCanceled(bytes32 indexed proposalId, address indexed canceler, string reason);
    event GovernanceUpdateQueued(bytes32 indexed updateId, string parameter, uint256 newValue, uint256 executionTime);
    event GovernanceUpdateExecuted(bytes32 indexed updateId, string parameter, uint256 oldValue, uint256 newValue);
    event EmergencyExecute(bytes32 indexed proposalId, address indexed executor);
    
    struct ProposalDetails {
        address proposer;
        uint256 queueTime;
        uint256 executionTime;
        string description;
        bool executed;
        bool canceled;
    }
    
    struct GovernanceUpdate {
        string parameter;
        uint256 newValue;
        uint256 oldValue;
        address targetContract;
        bytes4 functionSelector;
        uint256 queueTime;
        uint256 executionTime;
    }
    
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(EMERGENCY_ROLE, admin);
    }

    /**
     * @dev Enhanced queue function with detailed tracking
     */
    function queue(
        address[] memory targets,
        uint256[] memory values,
        bytes[] calldata calldatas,
        bytes32 salt,
        string memory description
    ) public virtual returns (bytes32) {
        // Generate proposalId as Governor does
        bytes32 proposalId = keccak256(abi.encode(targets, values, calldatas, keccak256(bytes(description))));
        uint256 delay = getMinDelay();
        for (uint256 i = 0; i < targets.length; ++i) {
            super.schedule(targets[i], values[i], calldatas[i], bytes32(0), salt, delay);
        }
        // Store proposal details
        proposalDetails[proposalId] = ProposalDetails({
            proposer: msg.sender,
            queueTime: block.timestamp,
            executionTime: block.timestamp + delay,
            description: description,
            executed: false,
            canceled: false
        });
        emit ProposalQueued(proposalId, msg.sender, block.timestamp + delay);
        return proposalId;
    }

    /**
     * @dev Enhanced execute function with validation
     */
    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] calldata calldatas,
        bytes32 salt
    ) public payable virtual returns (bytes32) {
        bytes32 proposalId = keccak256(abi.encode(targets, values, calldatas, keccak256("")));
        for (uint256 i = 0; i < targets.length; ++i) {
            super.execute(targets[i], values[i], calldatas[i], bytes32(0), salt);
        }
        ProposalDetails storage details = proposalDetails[proposalId];
        details.executed = true;
        proposalExecutionTime[proposalId] = block.timestamp;
        emit ProposalExecuted(proposalId, msg.sender, block.timestamp);
        return proposalId;
    }

    /**
     * @dev Cancel proposal (only if pending)
     */
    function cancel(bytes32 proposalId, string memory reason) external onlyRole(GOVERNOR_ROLE) {
        if (proposalCanceled[proposalId]) revert ProposalAlreadyCanceled();
        if (proposalDetails[proposalId].executed) revert ProposalAlreadyExecuted();
        
        // Check if proposal is still pending (not yet executable)
        if (block.timestamp >= proposalDetails[proposalId].executionTime) {
            revert ProposalNotPending();
        }
        
        proposalCanceled[proposalId] = true;
        proposalDetails[proposalId].canceled = true;
        
        // Cancel the underlying proposal
        super.cancel(proposalId);
        
        emit ProposalCanceled(proposalId, msg.sender, reason);
    }

    /**
     * @dev Queue governance parameter update
     */
    function queueGovernanceUpdate(
        string memory parameter,
        uint256 newValue,
        address targetContract,
        bytes4 functionSelector,
        uint256 oldValue
    ) external onlyRole(GOVERNOR_ROLE) returns (bytes32) {
        bytes32 updateId = keccak256(abi.encodePacked(parameter, newValue, targetContract, block.timestamp));
        
        pendingGovernanceUpdates[updateId] = GovernanceUpdate({
            parameter: parameter,
            newValue: newValue,
            oldValue: oldValue,
            targetContract: targetContract,
            functionSelector: functionSelector,
            queueTime: block.timestamp,
            executionTime: block.timestamp + getMinDelay()
        });
        
        emit GovernanceUpdateQueued(updateId, parameter, newValue, block.timestamp + getMinDelay());
        return updateId;
    }

    /**
     * @dev Execute governance parameter update
     */
    function executeGovernanceUpdate(bytes32 updateId) external onlyRole(GOVERNOR_ROLE) {
        GovernanceUpdate storage update = pendingGovernanceUpdates[updateId];
        if (update.executionTime == 0) revert Unauthorized();
        if (governanceUpdateExecuted[updateId]) revert ProposalAlreadyExecuted();
        if (block.timestamp < update.executionTime) revert ProposalNotPending();
        
        // Execute the update
        (bool success, ) = update.targetContract.call(
            abi.encodeWithSelector(update.functionSelector, update.newValue)
        );
        require(success, "Governance update failed");
        
        governanceUpdateExecuted[updateId] = true;
        
        emit GovernanceUpdateExecuted(updateId, update.parameter, update.oldValue, update.newValue);
    }

    /**
     * @dev Emergency execute (bypass timelock)
     */
    function emergencyExecute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] calldata calldatas,
        bytes32 salt
    ) external onlyRole(EMERGENCY_ROLE) returns (bytes32) {
        bytes32 proposalId = keccak256(abi.encode(targets, values, calldatas, keccak256("")));
        for (uint256 i = 0; i < targets.length; ++i) {
            super.execute(targets[i], values[i], calldatas[i], bytes32(0), salt);
        }
        emit EmergencyExecute(proposalId, msg.sender);
        return proposalId;
    }

    /**
     * @dev Get proposal details
     */
    function getProposalDetails(bytes32 proposalId) public view returns (
        address proposer,
        uint256 queueTime,
        uint256 executionTime,
        string memory description,
        bool executed,
        bool canceled
    ) {
        ProposalDetails storage details = proposalDetails[proposalId];
        return (
            details.proposer,
            details.queueTime,
            details.executionTime,
            details.description,
            details.executed,
            details.canceled
        );
    }

    /**
     * @dev Get governance update details (part 1)
     */
    function getGovernanceUpdatePart1(bytes32 updateId) public view returns (
        string memory parameter,
        uint256 newValue,
        uint256 oldValue,
        address targetContract
    ) {
        GovernanceUpdate storage update = pendingGovernanceUpdates[updateId];
        return (
            update.parameter,
            update.newValue,
            update.oldValue,
            update.targetContract
        );
    }

    /**
     * @dev Get governance update details (part 2)
     */
    function getGovernanceUpdatePart2(bytes32 updateId) public view returns (
        bytes4 functionSelector,
        uint256 queueTime,
        uint256 executionTime,
        bool executed
    ) {
        GovernanceUpdate storage update = pendingGovernanceUpdates[updateId];
        return (
            update.functionSelector,
            update.queueTime,
            update.executionTime,
            governanceUpdateExecuted[updateId]
        );
    }

    /**
     * @dev Check if proposal can be executed
     */
    function canExecute(bytes32 proposalId) public view returns (bool) {
        if (proposalCanceled[proposalId]) return false;
        if (proposalDetails[proposalId].executed) return false;
        
        return block.timestamp >= proposalDetails[proposalId].executionTime;
    }

    /**
     * @dev Check if governance update can be executed
     */
    function canExecuteGovernanceUpdate(bytes32 updateId) public view returns (bool) {
        if (governanceUpdateExecuted[updateId]) return false;
        
        GovernanceUpdate storage update = pendingGovernanceUpdates[updateId];
        return block.timestamp >= update.executionTime;
    }

    /**
     * @dev Get remaining time until execution
     */
    function getRemainingTime(bytes32 proposalId) public view returns (uint256) {
        if (proposalCanceled[proposalId] || proposalDetails[proposalId].executed) return 0;
        
        uint256 executionTime = proposalDetails[proposalId].executionTime;
        if (block.timestamp >= executionTime) return 0;
        
        return executionTime - block.timestamp;
    }
} 
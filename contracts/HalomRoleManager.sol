// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// Custom errors for gas optimization
error ZeroAddress();
error NotContract();
error RoleFrozen();
error RoleAlreadyFrozen();
error RoleNotFrozen();
error Unauthorized();
error InvalidRole();
error TimeNotElapsed();
error MultiSigRequired();

/**
 * @title HalomRoleManager
 * @dev Centralized role management for the Halom ecosystem
 * Implements secure role separation and governance controls
 */
contract HalomRoleManager is AccessControl, Pausable {
    
    // Core roles - never assigned to individual wallets
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    
    // Token management roles
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant REBASE_CALLER = keccak256("REBASE_CALLER");
    bytes32 public constant STAKING_CONTRACT_ROLE = keccak256("STAKING_CONTRACT_ROLE");
    
    // Oracle roles
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");
    
    // Governance and slashing roles
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    
    // Reward management roles
    bytes32 public constant REWARDER_ROLE = keccak256("REWARDER_ROLE");
    
    // Treasury management roles
    bytes32 public constant TREASURY_CONTROLLER = keccak256("TREASURY_CONTROLLER");
    
    // Emergency roles
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // Role assignment tracking
    mapping(bytes32 => address[]) public roleAssignments;
    mapping(bytes32 => bool) public roleFrozen;
    
    // Time-based role grants
    mapping(bytes32 => mapping(address => uint256)) public roleGrantTimestamps;
    mapping(bytes32 => uint256) public roleGrantDelays;
    
    // Multi-sig requirements
    mapping(bytes32 => bool) public multiSigRequired;
    mapping(bytes32 => mapping(address => uint256)) public pendingRoleGrants;
    mapping(bytes32 => mapping(address => address[])) public roleGrantApprovals;
    
    // Role hierarchy (higher number = higher privilege)
    mapping(bytes32 => uint8) public roleHierarchy;
    
    // Events
    event RoleFrozenEvent(bytes32 indexed role, address indexed frozenBy);
    event RoleUnfrozen(bytes32 indexed role, address indexed unfrozenBy);
    event ContractRoleAssigned(bytes32 indexed role, address indexed contractAddress, address indexed assignedBy);
    event HumanRoleRevoked(bytes32 indexed role, address indexed account, address indexed revokedBy);
    event RoleGrantRequested(bytes32 indexed role, address indexed account, address indexed requester);
    event RoleGrantApproved(bytes32 indexed role, address indexed account, address indexed approver);
    event RoleGrantDelaySet(bytes32 indexed role, uint256 delay);
    event MultiSigRequiredSet(bytes32 indexed role, bool required);
    // Note: RoleGranted and RoleRevoked events are already defined in IAccessControl
    
    constructor(address _timelock, address _governor) {
        if (_timelock == address(0)) revert ZeroAddress();
        if (_governor == address(0)) revert ZeroAddress();
        
        // Only Timelock gets DEFAULT_ADMIN_ROLE
        _grantRole(DEFAULT_ADMIN_ROLE, _timelock);
        
        // Governor gets GOVERNOR_ROLE
        _grantRole(GOVERNOR_ROLE, _governor);
        
        // Governor can pause/unpause
        _grantRole(PAUSER_ROLE, _governor);
        
        // Emergency role for critical situations
        _grantRole(EMERGENCY_ROLE, _governor);
        
        // Set role hierarchy (higher number = higher privilege)
        roleHierarchy[DEFAULT_ADMIN_ROLE] = 100;
        roleHierarchy[EMERGENCY_ROLE] = 90;
        roleHierarchy[GOVERNOR_ROLE] = 80;
        roleHierarchy[PAUSER_ROLE] = 70;
        roleHierarchy[MINTER_ROLE] = 60;
        roleHierarchy[REBASE_CALLER] = 50;
        roleHierarchy[TREASURY_CONTROLLER] = 40;
        roleHierarchy[SLASHER_ROLE] = 30;
        roleHierarchy[ORACLE_UPDATER_ROLE] = 20;
        roleHierarchy[REWARDER_ROLE] = 10;
        roleHierarchy[STAKING_CONTRACT_ROLE] = 5;
        
        // Set default grant delays (in seconds)
        roleGrantDelays[EMERGENCY_ROLE] = 7 days;
        roleGrantDelays[GOVERNOR_ROLE] = 3 days;
        roleGrantDelays[MINTER_ROLE] = 1 days;
        roleGrantDelays[REBASE_CALLER] = 1 days;
        roleGrantDelays[TREASURY_CONTROLLER] = 2 days;
        
        // Set multi-sig requirements for critical roles
        multiSigRequired[EMERGENCY_ROLE] = true;
        multiSigRequired[GOVERNOR_ROLE] = true;
        multiSigRequired[MINTER_ROLE] = true;
        multiSigRequired[TREASURY_CONTROLLER] = true;
    }
    
    /**
     * @dev Grant role to contract only (no human addresses)
     */
    function grantRoleToContract(bytes32 role, address contractAddress) external onlyRole(GOVERNOR_ROLE) {
        if (contractAddress == address(0)) revert ZeroAddress();
        if (contractAddress.code.length == 0) revert NotContract();
        if (roleFrozen[role]) revert RoleFrozen();
        
        // Check role hierarchy - can't grant higher privilege than self
        if (roleHierarchy[role] >= roleHierarchy[GOVERNOR_ROLE]) revert Unauthorized();
        
        _grantRole(role, contractAddress);
        roleAssignments[role].push(contractAddress);
        roleGrantTimestamps[role][contractAddress] = block.timestamp;
        
        emit ContractRoleAssigned(role, contractAddress, msg.sender);
    }
    
    /**
     * @dev Request role grant for human (with delay and multi-sig)
     */
    function requestRoleGrant(bytes32 role, address account) external onlyRole(GOVERNOR_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (account.code.length > 0) revert NotContract();
        if (roleFrozen[role]) revert RoleFrozen();
        
        // Check role hierarchy
        if (roleHierarchy[role] >= roleHierarchy[GOVERNOR_ROLE]) revert Unauthorized();
        
        pendingRoleGrants[role][account] = block.timestamp + roleGrantDelays[role];
        roleGrantApprovals[role][account] = new address[](0);
        
        emit RoleGrantRequested(role, account, msg.sender);
    }
    
    /**
     * @dev Approve pending role grant (multi-sig)
     */
    function approveRoleGrant(bytes32 role, address account) external onlyRole(GOVERNOR_ROLE) {
        if (pendingRoleGrants[role][account] == 0) revert InvalidRole();
        if (block.timestamp < pendingRoleGrants[role][account]) revert TimeNotElapsed();
        
        address[] storage approvals = roleGrantApprovals[role][account];
        
        // Check if already approved
        for (uint256 i = 0; i < approvals.length; i++) {
            if (approvals[i] == msg.sender) revert Unauthorized();
        }
        
        approvals.push(msg.sender);
        
        emit RoleGrantApproved(role, account, msg.sender);
        
        // Grant role if enough approvals (2 for multi-sig)
        if (approvals.length >= 2 || !multiSigRequired[role]) {
            _grantRole(role, account);
            roleAssignments[role].push(account);
            roleGrantTimestamps[role][account] = block.timestamp;
            
            // Clear pending grant
            delete pendingRoleGrants[role][account];
            delete roleGrantApprovals[role][account];
            
            emit ContractRoleAssigned(role, account, msg.sender);
        }
    }
    
    /**
     * @dev Revoke role from human address (security measure)
     */
    function revokeRoleFromHuman(bytes32 role, address account) external onlyRole(GOVERNOR_ROLE) {
        if (account.code.length > 0) revert NotContract();
        if (!hasRole(role, account)) revert Unauthorized();
        
        _revokeRole(role, account);
        
        emit HumanRoleRevoked(role, account, msg.sender);
    }
    
    /**
     * @dev Freeze a role to prevent further assignments
     */
    function freezeRole(bytes32 role) external onlyRole(GOVERNOR_ROLE) {
        if (roleFrozen[role]) revert RoleAlreadyFrozen();
        
        roleFrozen[role] = true;
        emit RoleFrozenEvent(role, msg.sender);
    }
    
    /**
     * @dev Unfreeze a role (only in emergency)
     */
    function unfreezeRole(bytes32 role) external onlyRole(EMERGENCY_ROLE) {
        if (!roleFrozen[role]) revert RoleNotFrozen();
        roleFrozen[role] = false;
        
        emit RoleUnfrozen(role, msg.sender);
    }
    
    /**
     * @dev Set role grant delay
     */
    function setRoleGrantDelay(bytes32 role, uint256 delay) external onlyRole(GOVERNOR_ROLE) {
        roleGrantDelays[role] = delay;
        emit RoleGrantDelaySet(role, delay);
    }
    
    /**
     * @dev Set multi-sig requirement for role
     */
    function setMultiSigRequired(bytes32 role, bool required) external onlyRole(GOVERNOR_ROLE) {
        multiSigRequired[role] = required;
        emit MultiSigRequiredSet(role, required);
    }
    
    /**
     * @dev Get all addresses with a specific role
     */
    function getRoleMembers(bytes32 role) external view returns (address[] memory) {
        return roleAssignments[role];
    }
    
    /**
     * @dev Check if role is frozen
     */
    function isRoleFrozen(bytes32 role) external view returns (bool) {
        return roleFrozen[role];
    }
    
    /**
     * @dev Check pending role grant
     */
    function getPendingRoleGrant(bytes32 role, address account)
        external
        view
        returns (uint256 timestamp, address[] memory approvals)
    {
        timestamp = pendingRoleGrants[role][account];
        approvals = roleGrantApprovals[role][account];
    }
    
    /**
     * @dev Enhanced grantRole with security checks and audit events
     */
    function grantRole(bytes32 role, address account) public virtual override onlyRole(getRoleAdmin(role)) {
        if (account == address(0)) revert ZeroAddress();
        if (roleFrozen[role]) revert RoleFrozen();
        
        // Check role hierarchy for security
        if (roleHierarchy[role] >= roleHierarchy[GOVERNOR_ROLE] && !hasRole(getRoleAdmin(role), msg.sender)) {
            revert Unauthorized();
        }
        
        // For human addresses, require multi-sig if configured
        if (account.code.length == 0 && multiSigRequired[role]) {
            revert MultiSigRequired();
        }
        
        super.grantRole(role, account);
        
        // Track assignment
        roleAssignments[role].push(account);
        roleGrantTimestamps[role][account] = block.timestamp;
        
        emit RoleGranted(role, account, msg.sender);
        emit ContractRoleAssigned(role, account, msg.sender);
    }
    
    /**
     * @dev Enhanced revokeRole with security checks and audit events
     */
    function revokeRole(bytes32 role, address account) public virtual override onlyRole(getRoleAdmin(role)) {
        if (!hasRole(role, account)) revert Unauthorized();
        
        // Prevent revoking from self (DEFAULT_ADMIN_ROLE)
        if (role == DEFAULT_ADMIN_ROLE && account == msg.sender) revert Unauthorized();
        
        super.revokeRole(role, account);
        
        // Remove from tracking
        _removeFromRoleAssignments(role, account);
        
        emit RoleRevoked(role, account, msg.sender);
        emit HumanRoleRevoked(role, account, msg.sender);
    }
    
    /**
     * @dev Fast hasRole wrapper for gas optimization
     */
    function hasRole(bytes32 role, address account) public view virtual override returns (bool) {
        return super.hasRole(role, account);
    }
    
    /**
     * @dev Get role assignments count
     */
    function getRoleAssignmentsCount(bytes32 role) public view returns (uint256) {
        return roleAssignments[role].length;
    }
    
    /**
     * @dev Get role assignment at index
     */
    function getRoleAssignment(bytes32 role, uint256 index) public view returns (address) {
        require(index < roleAssignments[role].length, "Index out of bounds");
        return roleAssignments[role][index];
    }
    
    /**
     * @dev Get role grant timestamp
     */
    function getRoleGrantTimestamp(bytes32 role, address account) public view returns (uint256) {
        return roleGrantTimestamps[role][account];
    }
    
    /**
     * @dev Check if role grant is pending
     */
    function isRoleGrantPending(bytes32 role, address account) public view returns (bool) {
        return pendingRoleGrants[role][account] > 0;
    }
    
    /**
     * @dev Get pending role grant timestamp
     */
    function getPendingRoleGrantTimestamp(bytes32 role, address account) public view returns (uint256) {
        return pendingRoleGrants[role][account];
    }
    
    /**
     * @dev Get role grant approvals count
     */
    function getRoleGrantApprovalsCount(bytes32 role, address account) public view returns (uint256) {
        return roleGrantApprovals[role][account].length;
    }
    
    /**
     * @dev Get role grant approval at index
     */
    function getRoleGrantApproval(bytes32 role, address account, uint256 index) public view returns (address) {
        require(index < roleGrantApprovals[role][account].length, "Index out of bounds");
        return roleGrantApprovals[role][account][index];
    }
    
    /**
     * @dev Pause role management (emergency)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause role management
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }
    
    /**
     * @dev Emergency function to revoke all roles from an address
     */
    function emergencyRevokeAllRoles(address account) external onlyRole(EMERGENCY_ROLE) {
        bytes32[] memory allRoles = new bytes32[](10);
        allRoles[0] = MINTER_ROLE;
        allRoles[1] = REBASE_CALLER;
        allRoles[2] = STAKING_CONTRACT_ROLE;
        allRoles[3] = ORACLE_UPDATER_ROLE;
        allRoles[4] = SLASHER_ROLE;
        allRoles[5] = REWARDER_ROLE;
        allRoles[6] = TREASURY_CONTROLLER;
        allRoles[7] = PAUSER_ROLE;
        allRoles[8] = GOVERNOR_ROLE;
        allRoles[9] = EMERGENCY_ROLE;
        
        for (uint256 i = 0; i < allRoles.length; i++) {
            if (hasRole(allRoles[i], account)) {
                _revokeRole(allRoles[i], account);
            }
        }
    }
    
    /**
     * @dev Remove account from role assignments tracking
     */
    function _removeFromRoleAssignments(bytes32 role, address account) internal {
        address[] storage assignments = roleAssignments[role];
        for (uint256 i = 0; i < assignments.length; i++) {
            if (assignments[i] == account) {
                assignments[i] = assignments[assignments.length - 1];
                assignments.pop();
                break;
            }
        }
    }
    
    /**
     * @dev Get role hierarchy level
     */
    function getRoleHierarchy(bytes32 role) public view returns (uint8) {
        return roleHierarchy[role];
    }
    
    /**
     * @dev Check if account has higher privilege than role
     */
    function hasHigherPrivilege(address account, bytes32 role) public view returns (bool) {
        uint8 accountLevel = 0;
        uint8 roleLevel = roleHierarchy[role];
        
        // Find highest role level for account
        for (uint256 i = 0; i < roleAssignments[DEFAULT_ADMIN_ROLE].length; i++) {
            if (hasRole(DEFAULT_ADMIN_ROLE, account)) {
                accountLevel = roleHierarchy[DEFAULT_ADMIN_ROLE];
                break;
            }
        }
        
        // Check other roles
        bytes32[] memory allRoles = new bytes32[](10);
        allRoles[0] = EMERGENCY_ROLE;
        allRoles[1] = GOVERNOR_ROLE;
        allRoles[2] = PAUSER_ROLE;
        allRoles[3] = MINTER_ROLE;
        allRoles[4] = REBASE_CALLER;
        allRoles[5] = TREASURY_CONTROLLER;
        allRoles[6] = SLASHER_ROLE;
        allRoles[7] = ORACLE_UPDATER_ROLE;
        allRoles[8] = REWARDER_ROLE;
        allRoles[9] = STAKING_CONTRACT_ROLE;
        
        for (uint256 i = 0; i < allRoles.length; i++) {
            if (hasRole(allRoles[i], account)) {
                uint8 level = roleHierarchy[allRoles[i]];
                if (level > accountLevel) {
                    accountLevel = level;
                }
            }
        }
        
        return accountLevel > roleLevel;
    }

    /**
     * @dev Emergency role management (only EMERGENCY_ROLE)
     */
    function emergencyGrantRole(bytes32 role, address account) external onlyRole(EMERGENCY_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        
        super.grantRole(role, account);
        roleAssignments[role].push(account);
        roleGrantTimestamps[role][account] = block.timestamp;
        
        emit RoleGranted(role, account, msg.sender);
        emit ContractRoleAssigned(role, account, msg.sender);
    }

    /**
     * @dev Emergency role revocation (only EMERGENCY_ROLE)
     */
    function emergencyRevokeRole(bytes32 role, address account) external onlyRole(EMERGENCY_ROLE) {
        if (!hasRole(role, account)) revert Unauthorized();
        
        super.revokeRole(role, account);
        _removeFromRoleAssignments(role, account);
        
        emit RoleRevoked(role, account, msg.sender);
        emit HumanRoleRevoked(role, account, msg.sender);
    }
} 
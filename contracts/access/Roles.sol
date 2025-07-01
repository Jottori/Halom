// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title Roles
 * @dev Centralized role management for the Halom protocol
 * This contract serves as the single source of truth for all role definitions
 * and access control across the entire Halom ecosystem.
 */
contract Roles is 
    Initializable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable 
{
    // ============ ROLE DEFINITIONS ============
    
    // Core administrative roles
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    
    // Governance roles
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // Token management roles
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BLACKLIST_ROLE = keccak256("BLACKLIST_ROLE");
    
    // Cross-chain and external integration roles
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    // ============ ROLE DESCRIPTIONS ============
    
    mapping(bytes32 => string) public roleDescriptions;
    
    // ============ ROLE HIERARCHY ============
    
    mapping(bytes32 => bytes32[]) public roleHierarchy;
    
    // ============ EVENTS ============
    
    event RoleDescriptionSet(bytes32 indexed role, string description);
    event RoleHierarchyUpdated(bytes32 indexed role, bytes32[] parentRoles);
    event Upgraded(address indexed implementation);
    event EmergencyRoleActivated(address indexed account, string reason);

    // ============ ERRORS ============
    
    error InvalidRole();
    error RoleAlreadyExists();
    error InvalidAccount();
    error UnauthorizedRoleManagement();
    error CircularRoleDependency();
    error EmergencyRoleRequired();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        // Grant DEFAULT_ADMIN_ROLE to the admin
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        
        // Set up initial role descriptions
        _setRoleDescriptions();
        
        // Set up role hierarchy
        _setRoleHierarchy();
    }

    // ============ ROLE MANAGEMENT FUNCTIONS ============

    /**
     * @dev Grant role to account - only DEFAULT_ADMIN_ROLE
     */
    function grantRole(bytes32 role, address account) 
        public 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (account == address(0)) revert InvalidAccount();
        if (!_isValidRole(role)) revert InvalidRole();
        
        super.grantRole(role, account);
    }

    /**
     * @dev Revoke role from account - only DEFAULT_ADMIN_ROLE
     */
    function revokeRole(bytes32 role, address account) 
        public 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (account == address(0)) revert InvalidAccount();
        if (!_isValidRole(role)) revert InvalidRole();
        
        super.revokeRole(role, account);
    }

    /**
     * @dev Renounce role - any account can renounce their own roles
     */
    function renounceRole(bytes32 role, address account) 
        public 
        override 
    {
        if (account != msg.sender) revert UnauthorizedRoleManagement();
        if (!_isValidRole(role)) revert InvalidRole();
        
        super.renounceRole(role, account);
    }

    /**
     * @dev Set role description - only DEFAULT_ADMIN_ROLE
     */
    function setRoleDescription(bytes32 role, string memory description) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (!_isValidRole(role)) revert InvalidRole();
        
        roleDescriptions[role] = description;
        emit RoleDescriptionSet(role, description);
    }

    /**
     * @dev Set role hierarchy - only DEFAULT_ADMIN_ROLE
     */
    function setRoleHierarchy(bytes32 role, bytes32[] memory parentRoles) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (!_isValidRole(role)) revert InvalidRole();
        
        // Check for circular dependencies
        for (uint256 i = 0; i < parentRoles.length; i++) {
            if (_hasCircularDependency(role, parentRoles[i])) {
                revert CircularRoleDependency();
            }
        }
        
        roleHierarchy[role] = parentRoles;
        emit RoleHierarchyUpdated(role, parentRoles);
    }

    /**
     * @dev Emergency role activation - only EMERGENCY_ROLE
     */
    function activateEmergencyRole(string memory reason) 
        external 
        onlyRole(EMERGENCY_ROLE) 
    {
        emit EmergencyRoleActivated(msg.sender, reason);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Set initial role descriptions
     */
    function _setRoleDescriptions() internal {
        roleDescriptions[DEFAULT_ADMIN_ROLE] = "Full administrative control - grant/revoke roles, proxy upgrades, critical setter calls";
        roleDescriptions[UPGRADER_ROLE] = "Contract upgrade operations";
        roleDescriptions[GOVERNOR_ROLE] = "Governance parameter modification (reward rate, max tx parameters, fees, oracle config)";
        roleDescriptions[EMERGENCY_ROLE] = "Emergency operations and crisis management";
        roleDescriptions[MINTER_ROLE] = "Token mint (bridge or token contract), LP staking contract reward mint";
        roleDescriptions[PAUSER_ROLE] = "Token or staking contract pause/unpause functions";
        roleDescriptions[BLACKLIST_ROLE] = "Address blacklisting or un-blacklisting (blacklist, destroyFunds)";
        roleDescriptions[BRIDGE_ROLE] = "Cross-chain bridge operations (mintFromBridge, unlockTokens, relayCrossChainProposal)";
        roleDescriptions[ORACLE_ROLE] = "Data submission to Oracle contract (submitPrice)";
    }

    /**
     * @dev Set initial role hierarchy
     */
    function _setRoleHierarchy() internal {
        // DEFAULT_ADMIN_ROLE has no parents (root role)
        roleHierarchy[DEFAULT_ADMIN_ROLE] = new bytes32[](0);
        
        // UPGRADER_ROLE can be granted by DEFAULT_ADMIN_ROLE
        roleHierarchy[UPGRADER_ROLE] = new bytes32[](1);
        roleHierarchy[UPGRADER_ROLE][0] = DEFAULT_ADMIN_ROLE;
        
        // GOVERNOR_ROLE can be granted by DEFAULT_ADMIN_ROLE
        roleHierarchy[GOVERNOR_ROLE] = new bytes32[](1);
        roleHierarchy[GOVERNOR_ROLE][0] = DEFAULT_ADMIN_ROLE;
        
        // EMERGENCY_ROLE can be granted by DEFAULT_ADMIN_ROLE or GOVERNOR_ROLE
        bytes32[] memory emergencyParents = new bytes32[](2);
        emergencyParents[0] = DEFAULT_ADMIN_ROLE;
        emergencyParents[1] = GOVERNOR_ROLE;
        roleHierarchy[EMERGENCY_ROLE] = emergencyParents;
        
        // Other roles can be granted by DEFAULT_ADMIN_ROLE or GOVERNOR_ROLE
        bytes32[] memory standardParents = new bytes32[](2);
        standardParents[0] = DEFAULT_ADMIN_ROLE;
        standardParents[1] = GOVERNOR_ROLE;
        
        roleHierarchy[MINTER_ROLE] = standardParents;
        roleHierarchy[PAUSER_ROLE] = standardParents;
        roleHierarchy[BLACKLIST_ROLE] = standardParents;
        roleHierarchy[BRIDGE_ROLE] = standardParents;
        roleHierarchy[ORACLE_ROLE] = standardParents;
    }

    /**
     * @dev Check if role is valid
     */
    function _isValidRole(bytes32 role) internal pure returns (bool) {
        return (
            role == DEFAULT_ADMIN_ROLE ||
            role == UPGRADER_ROLE ||
            role == GOVERNOR_ROLE ||
            role == EMERGENCY_ROLE ||
            role == MINTER_ROLE ||
            role == PAUSER_ROLE ||
            role == BLACKLIST_ROLE ||
            role == BRIDGE_ROLE ||
            role == ORACLE_ROLE
        );
    }

    /**
     * @dev Check for circular dependencies in role hierarchy
     */
    function _hasCircularDependency(bytes32 role, bytes32 parentRole) internal view returns (bool) {
        if (role == parentRole) return true;
        
        bytes32[] memory parentParents = roleHierarchy[parentRole];
        for (uint256 i = 0; i < parentParents.length; i++) {
            if (_hasCircularDependency(role, parentParents[i])) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * @dev Required by UUPSUpgradeable
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(UPGRADER_ROLE) 
    {}

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get role description
     */
    function getRoleDescription(bytes32 role) external view returns (string memory) {
        return roleDescriptions[role];
    }

    /**
     * @dev Get role hierarchy
     */
    function getRoleHierarchy(bytes32 role) external view returns (bytes32[] memory) {
        return roleHierarchy[role];
    }

    /**
     * @dev Check if account has role or any parent role
     */
    function hasRoleOrParent(bytes32 role, address account) external view returns (bool) {
        if (hasRole(role, account)) return true;
        
        bytes32[] memory parents = roleHierarchy[role];
        for (uint256 i = 0; i < parents.length; i++) {
            if (hasRole(parents[i], account)) return true;
        }
        
        return false;
    }

    /**
     * @dev Get all accounts with a specific role (simplified implementation)
     */
    function getRoleMembers(bytes32 /*role*/) external pure returns (address[] memory) {
        // This is a simplified implementation
        // In a real implementation, you might want to track role members
        return new address[](0);
    }

    // ============ ROLE CONSTANTS FOR EXTERNAL USE ============
    
    /**
     * @dev Get all role constants for external contracts
     */
    function getRoleConstants() external pure returns (
        bytes32 upgraderRole,
        bytes32 governorRole,
        bytes32 emergencyRole,
        bytes32 minterRole,
        bytes32 pauserRole,
        bytes32 blacklistRole,
        bytes32 bridgeRole,
        bytes32 oracleRole
    ) {
        return (
            UPGRADER_ROLE,
            GOVERNOR_ROLE,
            EMERGENCY_ROLE,
            MINTER_ROLE,
            PAUSER_ROLE,
            BLACKLIST_ROLE,
            BRIDGE_ROLE,
            ORACLE_ROLE
        );
    }
} 
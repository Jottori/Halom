// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

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
    
    // Events
    event RoleFrozen(bytes32 indexed role, address indexed frozenBy);
    event RoleUnfrozen(bytes32 indexed role, address indexed unfrozenBy);
    event ContractRoleAssigned(bytes32 indexed role, address indexed contractAddress, address indexed assignedBy);
    event HumanRoleRevoked(bytes32 indexed role, address indexed account, address indexed revokedBy);
    
    constructor(address _timelock, address _governor) {
        require(_timelock != address(0), "Timelock cannot be zero");
        require(_governor != address(0), "Governor cannot be zero");
        
        // Only Timelock gets DEFAULT_ADMIN_ROLE
        _grantRole(DEFAULT_ADMIN_ROLE, _timelock);
        
        // Governor gets GOVERNOR_ROLE
        _grantRole(GOVERNOR_ROLE, _governor);
        
        // Governor can pause/unpause
        _grantRole(PAUSER_ROLE, _governor);
        
        // Emergency role for critical situations
        _grantRole(EMERGENCY_ROLE, _governor);
    }
    
    /**
     * @dev Grant role to contract only (no human addresses)
     */
    function grantRoleToContract(bytes32 role, address contractAddress) external onlyRole(GOVERNOR_ROLE) {
        require(contractAddress != address(0), "Contract address cannot be zero");
        require(contractAddress.code.length > 0, "Address must be a contract");
        require(!roleFrozen[role], "Role is frozen");
        
        _grantRole(role, contractAddress);
        roleAssignments[role].push(contractAddress);
        
        emit ContractRoleAssigned(role, contractAddress, msg.sender);
    }
    
    /**
     * @dev Revoke role from human address (security measure)
     */
    function revokeRoleFromHuman(bytes32 role, address account) external onlyRole(GOVERNOR_ROLE) {
        require(account.code.length == 0, "Cannot revoke from contract");
        require(hasRole(role, account), "Account does not have role");
        
        _revokeRole(role, account);
        
        emit HumanRoleRevoked(role, account, msg.sender);
    }
    
    /**
     * @dev Freeze a role to prevent further assignments
     */
    function freezeRole(bytes32 role) external onlyRole(GOVERNOR_ROLE) {
        require(!roleFrozen[role], "Role already frozen");
        roleFrozen[role] = true;
        
        emit RoleFrozen(role, msg.sender);
    }
    
    /**
     * @dev Unfreeze a role (only in emergency)
     */
    function unfreezeRole(bytes32 role) external onlyRole(EMERGENCY_ROLE) {
        require(roleFrozen[role], "Role not frozen");
        roleFrozen[role] = false;
        
        emit RoleUnfrozen(role, msg.sender);
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
     * @dev Override grantRole to prevent direct usage
     */
    function grantRole(bytes32 role, address account) public virtual override {
        revert("Use grantRoleToContract for contracts or specific functions for humans");
    }
    
    /**
     * @dev Override revokeRole to prevent direct usage
     */
    function revokeRole(bytes32 role, address account) public virtual override {
        revert("Use revokeRoleFromHuman for humans or specific functions for contracts");
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
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./libraries/GovernanceErrors.sol";

/**
 * @title HalomRoleManager
 * @dev Minimal, modular, branchless, EVM-limit-safe role manager contract for DAO governance.
 */
contract HalomRoleManager is AccessControl {
    using GovernanceErrors for *;
    
    // Core roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant STAKING_ROLE = keccak256("STAKING_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    event RolesGranted(address indexed account, bytes32[] roles);
    event RolesRevoked(address indexed account, bytes32[] roles);
    event RoleTransferred(address indexed from, address indexed to, bytes32 role);

    error Unauthorized();
    error InvalidRole();
    error InvalidAccount();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    modifier onlyAdmin() {
        if (!hasRole(ADMIN_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    function grantRoles(address account, bytes32[] calldata roles) external onlyAdmin {
        if (account == address(0)) revert InvalidAccount();
        for (uint256 i = 0; i < roles.length; i++) {
            _grantRole(roles[i], account);
        }
        emit RolesGranted(account, roles);
    }

    function revokeRoles(address account, bytes32[] calldata roles) external onlyAdmin {
        if (account == address(0)) revert InvalidAccount();
        for (uint256 i = 0; i < roles.length; i++) {
            _revokeRole(roles[i], account);
        }
        emit RolesRevoked(account, roles);
    }

    function transferRole(address to, bytes32 role) external {
        if (!hasRole(role, msg.sender)) revert Unauthorized();
        if (to == address(0)) revert InvalidAccount();
        _revokeRole(role, msg.sender);
        _grantRole(role, to);
        emit RoleTransferred(msg.sender, to, role);
    }

    function hasRoleFor(address account, bytes32 role) external view returns (bool) {
        return hasRole(role, account);
    }

    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
} 
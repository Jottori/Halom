// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./libraries/GovernanceErrors.sol";

/**
 * @title HalomTimelock
 * @dev Minimal, modular, branchless, EVM-limit-safe timelock contract for DAO governance.
 */
contract HalomTimelock is TimelockController, ReentrancyGuard {
    using GovernanceErrors for *;

    bytes32 public constant PARAM_ROLE = keccak256("PARAM_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    uint256 public minDelay;
    uint256 public constant MIN_MIN_DELAY = 24 hours;
    uint256 public constant MAX_MIN_DELAY = 30 days;
    uint256 public constant GRACE_PERIOD = 14 days;
    uint256 public constant CRITICAL_OPERATION_DELAY = 7 days;

    event MinDelayUpdated(uint256 newDelay);
    event EmergencyPaused(address indexed caller);
    event EmergencyResumed(address indexed caller);
    event TransactionQueued(bytes32 indexed operationHash, address indexed target, uint256 value, bytes data, uint256 eta);
    event TransactionExecuted(bytes32 indexed operationHash, address indexed target, uint256 value, bytes data, uint256 eta);
    event TransactionCancelled(bytes32 indexed operationHash);
    event CriticalOperationDetected(bytes32 indexed operationHash, address indexed target, string operation);

    bool public emergencyPaused;

    error TimelockEmergencyPaused();

    constructor(
        uint256 _minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(_minDelay, proposers, executors, admin) {
        if (_minDelay < MIN_MIN_DELAY || _minDelay > MAX_MIN_DELAY) revert TimelockInsufficientDelay(_minDelay, MIN_MIN_DELAY);
        minDelay = _minDelay;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_ROLE, admin);
        _grantRole(EMERGENCY_ROLE, admin);
    }

    // --- Parameter management (branchless, custom error) ---
    function setMinDelay(uint256 newDelay) external onlyRole(PARAM_ROLE) {
        if (newDelay < MIN_MIN_DELAY || newDelay > MAX_MIN_DELAY) revert TimelockInsufficientDelay(newDelay, MIN_MIN_DELAY);
        minDelay = newDelay;
        emit MinDelayUpdated(newDelay);
    }

    // --- Emergency controls ---
    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        emergencyPaused = true;
        emit EmergencyPaused(msg.sender);
    }
    function emergencyResume() external onlyRole(EMERGENCY_ROLE) {
        emergencyPaused = false;
        emit EmergencyResumed(msg.sender);
    }

    // --- Timelock logic (queue, execute, cancel) ---
    function queueTransaction(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) external onlyRole(PROPOSER_ROLE) returns (bytes32) {
        if (delay < MIN_MIN_DELAY) revert TimelockInsufficientDelay(delay, MIN_MIN_DELAY);
        if (emergencyPaused) revert TimelockEmergencyPaused();
        
        // Check for critical operations and apply additional delay
        uint256 effectiveDelay = delay;
        if (_isCriticalOperation(target, data)) {
            effectiveDelay = delay + CRITICAL_OPERATION_DELAY;
            emit CriticalOperationDetected(
                hashOperation(target, value, data, predecessor, salt),
                target,
                _getOperationType(data)
            );
        }
        
        bytes32 operationHash = hashOperation(target, value, data, predecessor, salt);
        schedule(target, value, data, predecessor, salt, effectiveDelay);
        emit TransactionQueued(operationHash, target, value, data, block.timestamp + effectiveDelay);
        return operationHash;
    }
    
    function _isCriticalOperation(address target, bytes calldata data) internal pure returns (bool) {
        if (data.length < 4) return false;
        
        bytes4 selector = bytes4(data[:4]);
        
        // Critical operation selectors (add more as needed)
        bytes4[] memory criticalSelectors = new bytes4[](10);
        criticalSelectors[0] = bytes4(keccak256("setRewardToken(address)"));
        criticalSelectors[1] = bytes4(keccak256("setMinDelay(uint256)"));
        criticalSelectors[2] = bytes4(keccak256("grantRole(bytes32,address)"));
        criticalSelectors[3] = bytes4(keccak256("revokeRole(bytes32,address)"));
        criticalSelectors[4] = bytes4(keccak256("pause()"));
        criticalSelectors[5] = bytes4(keccak256("unpause()"));
        criticalSelectors[6] = bytes4(keccak256("emergencyPause()"));
        criticalSelectors[7] = bytes4(keccak256("emergencyUnpause()"));
        criticalSelectors[8] = bytes4(keccak256("setFallbackValue(uint256,uint256)"));
        criticalSelectors[9] = bytes4(keccak256("deactivateFallback()"));
        
        for (uint256 i = 0; i < criticalSelectors.length; i++) {
            if (selector == criticalSelectors[i]) {
                return true;
            }
        }
        
        return false;
    }
    
    function _getOperationType(bytes calldata data) internal pure returns (string memory) {
        if (data.length < 4) return "UNKNOWN";
        
        bytes4 selector = bytes4(data[:4]);
        
        if (selector == bytes4(keccak256("setRewardToken(address)"))) return "SET_REWARD_TOKEN";
        if (selector == bytes4(keccak256("setMinDelay(uint256)"))) return "SET_MIN_DELAY";
        if (selector == bytes4(keccak256("grantRole(bytes32,address)"))) return "GRANT_ROLE";
        if (selector == bytes4(keccak256("revokeRole(bytes32,address)"))) return "REVOKE_ROLE";
        if (selector == bytes4(keccak256("pause()"))) return "PAUSE";
        if (selector == bytes4(keccak256("unpause()"))) return "UNPAUSE";
        if (selector == bytes4(keccak256("emergencyPause()"))) return "EMERGENCY_PAUSE";
        if (selector == bytes4(keccak256("emergencyUnpause()"))) return "EMERGENCY_UNPAUSE";
        if (selector == bytes4(keccak256("setFallbackValue(uint256,uint256)"))) return "SET_FALLBACK_VALUE";
        if (selector == bytes4(keccak256("deactivateFallback()"))) return "DEACTIVATE_FALLBACK";
        
        return "UNKNOWN";
    }

    function executeTransaction(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external payable onlyRole(EXECUTOR_ROLE) nonReentrant returns (bytes memory) {
        if (emergencyPaused) revert TimelockEmergencyPaused();
        bytes32 operationHash = hashOperation(target, value, data, predecessor, salt);
        execute(target, value, data, predecessor, salt);
        emit TransactionExecuted(operationHash, target, value, data, block.timestamp);
        return bytes("");
    }

    function cancelTransaction(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) external onlyRole(PARAM_ROLE) {
        if (emergencyPaused) revert TimelockEmergencyPaused();
        bytes32 operationHash = hashOperation(target, value, data, predecessor, salt);
        cancel(operationHash);
        emit TransactionCancelled(operationHash);
    }

    // --- View functions ---
    function isOperationExpired(bytes32 operationHash) public view returns (bool) {
        uint256 timestamp = getTimestamp(operationHash);
        return timestamp > 0 && block.timestamp > timestamp + GRACE_PERIOD;
    }
    function getMinDelay() public view override returns (uint256) {
        return minDelay;
    }
    function isEmergency() external view returns (bool) {
        return emergencyPaused;
    }
} 
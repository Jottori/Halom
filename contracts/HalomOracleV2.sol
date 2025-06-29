// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./libraries/GovernanceMath.sol";
import "./libraries/GovernanceErrors.sol";

contract HalomOracleV2 is AccessControl, ReentrancyGuard, Pausable {
    using GovernanceMath for uint256;
    
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    struct OracleData {
        uint256 value;
        uint256 timestamp;
        uint256 blockNumber;
        bool isValid;
    }
    
    struct OracleConfig {
        uint256 minUpdateInterval;
        uint256 maxDeviationPercent;
        uint256 heartbeatInterval;
        uint256 staleThreshold;
    }
    
    mapping(bytes32 => OracleData) public oracleData;
    mapping(bytes32 => OracleConfig) public oracleConfigs;
    mapping(bytes32 => bool) public supportedFeeds;
    
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_DEVIATION = 50e16; // 50%
    uint256 public constant MIN_UPDATE_INTERVAL = 1 hours;
    uint256 public constant MAX_UPDATE_INTERVAL = 24 hours;
    
    event OracleUpdated(bytes32 indexed feedId, uint256 value, uint256 timestamp);
    event FeedAdded(bytes32 indexed feedId, uint256 minUpdateInterval, uint256 maxDeviationPercent);
    event FeedRemoved(bytes32 indexed feedId);
    event ConfigUpdated(bytes32 indexed feedId, uint256 minUpdateInterval, uint256 maxDeviationPercent);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);
    
    error InvalidFeed();
    error FeedNotSupported();
    error StaleData();
    error InvalidValue();
    error UpdateTooFrequent();
    error DeviationTooHigh();
    error InvalidConfig();
    error Unauthorized();
    error ContractPaused();
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
        _grantRole(UPDATER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }
    
    modifier onlyOracle() {
        if (!hasRole(ORACLE_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyUpdater() {
        if (!hasRole(UPDATER_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier whenNotPausedOracle() {
        if (paused()) revert ContractPaused();
        _;
    }
    
    function addFeed(
        bytes32 feedId,
        uint256 minUpdateInterval,
        uint256 maxDeviationPercent
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (supportedFeeds[feedId]) revert InvalidFeed();
        if (minUpdateInterval < MIN_UPDATE_INTERVAL || minUpdateInterval > MAX_UPDATE_INTERVAL) revert InvalidConfig();
        if (maxDeviationPercent > MAX_DEVIATION) revert InvalidConfig();
        
        supportedFeeds[feedId] = true;
        oracleConfigs[feedId] = OracleConfig({
            minUpdateInterval: minUpdateInterval,
            maxDeviationPercent: maxDeviationPercent,
            heartbeatInterval: minUpdateInterval * 2,
            staleThreshold: block.timestamp + minUpdateInterval * 4
        });
        
        emit FeedAdded(feedId, minUpdateInterval, maxDeviationPercent);
    }
    
    function removeFeed(bytes32 feedId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        
        supportedFeeds[feedId] = false;
        delete oracleConfigs[feedId];
        delete oracleData[feedId];
        
        emit FeedRemoved(feedId);
    }
    
    function updateOracleData(
        bytes32 feedId,
        uint256 value,
        uint256 timestamp
    ) external onlyUpdater whenNotPausedOracle nonReentrant {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        if (value == 0) revert InvalidValue();
        if (timestamp > block.timestamp) revert InvalidValue();
        
        OracleConfig memory config = oracleConfigs[feedId];
        OracleData memory currentData = oracleData[feedId];
        
        if (currentData.isValid) {
            if (block.timestamp < currentData.timestamp + config.minUpdateInterval) revert UpdateTooFrequent();
            
            uint256 deviation = GovernanceMath.calculateDeviation(currentData.value, value);
            if (deviation > config.maxDeviationPercent) revert DeviationTooHigh();
        }
        
        oracleData[feedId] = OracleData({
            value: value,
            timestamp: timestamp,
            blockNumber: block.number,
            isValid: true
        });
        
        emit OracleUpdated(feedId, value, timestamp);
    }
    
    function _getOracleData(bytes32 feedId) internal view returns (OracleData memory) {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        
        OracleData memory data = oracleData[feedId];
        if (!data.isValid) revert InvalidValue();
        
        OracleConfig memory config = oracleConfigs[feedId];
        if (block.timestamp > data.timestamp + config.staleThreshold) revert StaleData();
        
        return data;
    }
    
    function getOracleData(bytes32 feedId) external view returns (OracleData memory) {
        return _getOracleData(feedId);
    }
    
    function getLatestValue(bytes32 feedId) external view returns (uint256) {
        OracleData memory data = _getOracleData(feedId);
        return data.value;
    }
    
    function isDataStale(bytes32 feedId) external view returns (bool) {
        if (!supportedFeeds[feedId]) return true;
        
        OracleData memory data = oracleData[feedId];
        if (!data.isValid) return true;
        
        OracleConfig memory config = oracleConfigs[feedId];
        return block.timestamp > data.timestamp + config.staleThreshold;
    }
    
    function updateConfig(
        bytes32 feedId,
        uint256 minUpdateInterval,
        uint256 maxDeviationPercent
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        if (minUpdateInterval < MIN_UPDATE_INTERVAL || minUpdateInterval > MAX_UPDATE_INTERVAL) revert InvalidConfig();
        if (maxDeviationPercent > MAX_DEVIATION) revert InvalidConfig();
        
        oracleConfigs[feedId].minUpdateInterval = minUpdateInterval;
        oracleConfigs[feedId].maxDeviationPercent = maxDeviationPercent;
        oracleConfigs[feedId].heartbeatInterval = minUpdateInterval * 2;
        oracleConfigs[feedId].staleThreshold = block.timestamp + minUpdateInterval * 4;
        
        emit ConfigUpdated(feedId, minUpdateInterval, maxDeviationPercent);
    }
    
    function emergencyPause() external onlyEmergency {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
    
    function emergencyUnpause() external onlyEmergency {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
    
    function batchUpdateOracleData(
        bytes32[] calldata feedIds,
        uint256[] calldata values,
        uint256[] calldata timestamps
    ) external onlyUpdater whenNotPausedOracle nonReentrant {
        uint256 length = feedIds.length;
        if (length != values.length || length != timestamps.length) revert InvalidConfig();
        
        for (uint256 i = 0; i < length; i++) {
            bytes32 feedId = feedIds[i];
            uint256 value = values[i];
            uint256 timestamp = timestamps[i];
            
            if (!supportedFeeds[feedId]) continue;
            if (value == 0) continue;
            if (timestamp > block.timestamp) continue;
            
            OracleConfig memory config = oracleConfigs[feedId];
            OracleData memory currentData = oracleData[feedId];
            
            if (currentData.isValid) {
                if (block.timestamp < currentData.timestamp + config.minUpdateInterval) continue;
                
                uint256 deviation = GovernanceMath.calculateDeviation(currentData.value, value);
                if (deviation > config.maxDeviationPercent) continue;
            }
            
            oracleData[feedId] = OracleData({
                value: value,
                timestamp: timestamp,
                blockNumber: block.number,
                isValid: true
            });
            
            emit OracleUpdated(feedId, value, timestamp);
        }
    }
    
    function getMultipleOracleData(bytes32[] calldata feedIds) external view returns (OracleData[] memory) {
        uint256 length = feedIds.length;
        OracleData[] memory results = new OracleData[](length);
        
        for (uint256 i = 0; i < length; i++) {
            bytes32 feedId = feedIds[i];
            
            if (supportedFeeds[feedId]) {
                OracleData memory data = oracleData[feedId];
                OracleConfig memory config = oracleConfigs[feedId];
                
                if (data.isValid && block.timestamp <= data.timestamp + config.staleThreshold) {
                    results[i] = data;
                }
            }
        }
        
        return results;
    }
    
    function getSupportedFeeds() external view returns (bytes32[] memory) {
        uint256 count = 0;
        bytes32[] memory temp = new bytes32[](100);
        
        for (uint256 i = 0; i < 100; i++) {
            bytes32 feedId = bytes32(i);
            if (supportedFeeds[feedId]) {
                temp[count] = feedId;
                count++;
            }
        }
        
        bytes32[] memory result = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = temp[i];
        }
        
        return result;
    }
} 
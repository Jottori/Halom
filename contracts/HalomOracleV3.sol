// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./libraries/GovernanceMath.sol";
import "./libraries/GovernanceErrors.sol";

contract HalomOracleV3 is AccessControl, ReentrancyGuard, Pausable {
    using GovernanceMath for uint256;
    
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant AGGREGATOR_ROLE = keccak256("AGGREGATOR_ROLE");
    
    struct OracleData {
        uint256 value;
        uint256 timestamp;
        uint256 blockNumber;
        bool isValid;
        uint256 confidence; // Confidence score (0-100)
        address source; // Source address
    }
    
    struct OracleConfig {
        uint256 minUpdateInterval;
        uint256 maxDeviationPercent;
        uint256 heartbeatInterval;
        uint256 staleThreshold;
        uint256 weight; // Weight for aggregation (0-100)
        bool isActive; // Whether this feed is active
    }
    
    struct AggregatedData {
        uint256 weightedValue;
        uint256 totalWeight;
        uint256 validFeeds;
        uint256 timestamp;
        bool isValid;
        uint256 confidence;
    }
    
    struct FeedValue {
        uint256 value;
        uint256 weight;
        uint256 confidence;
        address source;
    }
    
    mapping(bytes32 => OracleData) public oracleData;
    mapping(bytes32 => OracleConfig) public oracleConfigs;
    mapping(bytes32 => bool) public supportedFeeds;
    mapping(bytes32 => AggregatedData) public aggregatedData;
    
    // Aggregation settings
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_DEVIATION = 50e16; // 50%
    uint256 public constant MIN_UPDATE_INTERVAL = 1 hours;
    uint256 public constant MAX_UPDATE_INTERVAL = 24 hours;
    uint256 public constant MIN_VALID_FEEDS = 3; // Increased from 2 to 3 for median
    uint256 public constant MIN_WEIGHTED_AVERAGE_FEEDS = 2; // Minimum feeds for weighted average
    uint256 public constant MAX_WEIGHT = 100; // Maximum weight per feed
    uint256 public constant MIN_CONFIDENCE = 50; // Minimum confidence for valid data
    uint256 public constant MAX_DEVIATION_FOR_CONSENSUS = 5e16; // 5% deviation for consensus
    uint256 public constant MIN_CONSENSUS_FEEDS = 3; // Minimum feeds for median consensus
    
    // Fallback settings
    uint256 public fallbackValue;
    uint256 public fallbackTimestamp;
    bool public fallbackActive;
    
    event OracleUpdated(bytes32 indexed feedId, uint256 value, uint256 timestamp, uint256 confidence, address source);
    event FeedAdded(bytes32 indexed feedId, uint256 minUpdateInterval, uint256 maxDeviationPercent, uint256 weight);
    event FeedRemoved(bytes32 indexed feedId);
    event ConfigUpdated(bytes32 indexed feedId, uint256 minUpdateInterval, uint256 maxDeviationPercent, uint256 weight);
    event AggregatedDataUpdated(bytes32 indexed feedId, uint256 weightedValue, uint256 totalWeight, uint256 validFeeds);
    event FallbackActivated(uint256 value, uint256 timestamp);
    event FallbackDeactivated();
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
    error InsufficientValidFeeds();
    error InvalidWeight();
    error InvalidConfidence();
    error FallbackNotActive();
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
        _grantRole(UPDATER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
        _grantRole(AGGREGATOR_ROLE, msg.sender);
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
    
    modifier onlyAggregator() {
        if (!hasRole(AGGREGATOR_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier whenNotPausedOracle() {
        if (paused()) revert ContractPaused();
        _;
    }
    
    function addFeed(
        bytes32 feedId,
        uint256 minUpdateInterval,
        uint256 maxDeviationPercent,
        uint256 weight
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (supportedFeeds[feedId]) revert InvalidFeed();
        if (minUpdateInterval < MIN_UPDATE_INTERVAL || minUpdateInterval > MAX_UPDATE_INTERVAL) revert InvalidConfig();
        if (maxDeviationPercent > MAX_DEVIATION) revert InvalidConfig();
        if (weight > MAX_WEIGHT) revert InvalidWeight();
        
        supportedFeeds[feedId] = true;
        oracleConfigs[feedId] = OracleConfig({
            minUpdateInterval: minUpdateInterval,
            maxDeviationPercent: maxDeviationPercent,
            heartbeatInterval: minUpdateInterval * 2,
            staleThreshold: block.timestamp + minUpdateInterval * 4,
            weight: weight,
            isActive: true
        });
        
        emit FeedAdded(feedId, minUpdateInterval, maxDeviationPercent, weight);
    }
    
    function removeFeed(bytes32 feedId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        
        supportedFeeds[feedId] = false;
        delete oracleConfigs[feedId];
        delete oracleData[feedId];
        delete aggregatedData[feedId];
        
        emit FeedRemoved(feedId);
    }
    
    function updateOracleData(
        bytes32 feedId,
        uint256 value,
        uint256 timestamp,
        uint256 confidence
    ) external onlyUpdater whenNotPausedOracle nonReentrant {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        if (value == 0) revert InvalidValue();
        if (timestamp > block.timestamp) revert InvalidValue();
        if (confidence > 100) revert InvalidConfidence();
        
        OracleConfig memory config = oracleConfigs[feedId];
        if (!config.isActive) revert FeedNotSupported();
        
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
            isValid: true,
            confidence: confidence,
            source: msg.sender
        });
        
        emit OracleUpdated(feedId, value, timestamp, confidence, msg.sender);
    }
    
    function aggregateFeeds(bytes32[] calldata feedIds) external onlyAggregator whenNotPausedOracle {
        uint256 totalWeight = 0;
        uint256 weightedSum = 0;
        uint256 validFeeds = 0;
        uint256 latestTimestamp = 0;
        uint256 totalConfidence = 0;
        
        // Collect valid feed values for median calculation
        FeedValue[] memory feedValues = new FeedValue[](feedIds.length);
        uint256 feedValuesCount = 0;
        
        for (uint256 i = 0; i < feedIds.length; i++) {
            bytes32 feedId = feedIds[i];
            
            if (!supportedFeeds[feedId]) continue;
            
            OracleConfig memory config = oracleConfigs[feedId];
            if (!config.isActive) continue;
            
            OracleData memory data = oracleData[feedId];
            if (!data.isValid) continue;
            
            // Check if data is stale
            if (block.timestamp > data.timestamp + config.staleThreshold) continue;
            
            // Check minimum confidence
            if (data.confidence < MIN_CONFIDENCE) continue;
            
            // Store feed value for median calculation
            feedValues[feedValuesCount] = FeedValue({
                value: data.value,
                weight: config.weight,
                confidence: data.confidence,
                source: data.source
            });
            feedValuesCount++;
            
            // Use this feed for aggregation
            weightedSum += data.value * config.weight;
            totalWeight += config.weight;
            validFeeds++;
            totalConfidence += data.confidence;
            
            if (data.timestamp > latestTimestamp) {
                latestTimestamp = data.timestamp;
            }
        }
        
        if (validFeeds < MIN_VALID_FEEDS) {
            // Not enough valid feeds, check if we can use weighted average
            if (validFeeds >= MIN_WEIGHTED_AVERAGE_FEEDS) {
                // Use weighted average as fallback
                uint256 finalValue = weightedSum / totalWeight;
                uint256 finalConfidence = totalConfidence / validFeeds;
                
                aggregatedData[feedIds[0]] = AggregatedData({
                    weightedValue: finalValue,
                    totalWeight: totalWeight,
                    validFeeds: validFeeds,
                    timestamp: latestTimestamp,
                    isValid: true,
                    confidence: finalConfidence
                });
                
                emit AggregatedDataUpdated(feedIds[0], finalValue, totalWeight, validFeeds);
            } else if (fallbackActive) {
                // Use fallback value if available
                aggregatedData[feedIds[0]] = AggregatedData({
                    weightedValue: fallbackValue,
                    totalWeight: 100,
                    validFeeds: 1,
                    timestamp: fallbackTimestamp,
                    isValid: true,
                    confidence: 100
                });
                emit AggregatedDataUpdated(feedIds[0], fallbackValue, 100, 1);
            } else {
                revert InsufficientValidFeeds();
            }
        } else {
            // Calculate median-based consensus if we have enough feeds
            uint256 finalValue;
            uint256 finalConfidence;
            
            if (validFeeds >= MIN_CONSENSUS_FEEDS) {
                // Use median-based consensus
                (finalValue, finalConfidence) = _calculateMedianConsensus(feedValues, feedValuesCount);
            } else {
                // Fall back to weighted average
                finalValue = weightedSum / totalWeight;
                finalConfidence = totalConfidence / validFeeds;
            }
            
            aggregatedData[feedIds[0]] = AggregatedData({
                weightedValue: finalValue,
                totalWeight: totalWeight,
                validFeeds: validFeeds,
                timestamp: latestTimestamp,
                isValid: true,
                confidence: finalConfidence
            });
            
            emit AggregatedDataUpdated(feedIds[0], finalValue, totalWeight, validFeeds);
        }
    }
    
    function _calculateMedianConsensus(FeedValue[] memory feedValues, uint256 count) internal pure returns (uint256 medianValue, uint256 consensusConfidence) {
        // Sort values for median calculation
        uint256[] memory values = new uint256[](count);
        uint256[] memory weights = new uint256[](count);
        uint256[] memory confidences = new uint256[](count);
        
        for (uint256 i = 0; i < count; i++) {
            values[i] = feedValues[i].value;
            weights[i] = feedValues[i].weight;
            confidences[i] = feedValues[i].confidence;
        }
        
        // Sort values (bubble sort for simplicity)
        for (uint256 i = 0; i < count - 1; i++) {
            for (uint256 j = 0; j < count - i - 1; j++) {
                if (values[j] > values[j + 1]) {
                    // Swap values
                    uint256 tempValue = values[j];
                    values[j] = values[j + 1];
                    values[j + 1] = tempValue;
                    
                    // Swap weights
                    uint256 tempWeight = weights[j];
                    weights[j] = weights[j + 1];
                    weights[j + 1] = tempWeight;
                    
                    // Swap confidences
                    uint256 tempConfidence = confidences[j];
                    confidences[j] = confidences[j + 1];
                    confidences[j + 1] = tempConfidence;
                }
            }
        }
        
        // Calculate median
        if (count % 2 == 0) {
            // Even number of feeds - average of two middle values
            uint256 mid1 = values[count / 2 - 1];
            uint256 mid2 = values[count / 2];
            medianValue = (mid1 + mid2) / 2;
        } else {
            // Odd number of feeds - middle value
            medianValue = values[count / 2];
        }
        
        // Calculate consensus confidence based on deviation from median
        uint256 totalDeviation = 0;
        uint256 validConsensusFeeds = 0;
        
        for (uint256 i = 0; i < count; i++) {
            uint256 deviation = GovernanceMath.calculateDeviation(medianValue, values[i]);
            if (deviation <= MAX_DEVIATION_FOR_CONSENSUS) {
                totalDeviation += deviation;
                validConsensusFeeds++;
            }
        }
        
        if (validConsensusFeeds > 0) {
            consensusConfidence = 100 - (totalDeviation / validConsensusFeeds);
        } else {
            consensusConfidence = 50; // Minimum confidence if no consensus
        }
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
    
    function getAggregatedValue(bytes32 feedId) external view returns (uint256) {
        AggregatedData memory data = aggregatedData[feedId];
        if (!data.isValid) revert InvalidValue();
        return data.weightedValue;
    }
    
    function getAggregatedData(bytes32 feedId) external view returns (AggregatedData memory) {
        return aggregatedData[feedId];
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
        uint256 maxDeviationPercent,
        uint256 weight
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        if (minUpdateInterval < MIN_UPDATE_INTERVAL || minUpdateInterval > MAX_UPDATE_INTERVAL) revert InvalidConfig();
        if (maxDeviationPercent > MAX_DEVIATION) revert InvalidConfig();
        if (weight > MAX_WEIGHT) revert InvalidWeight();
        
        oracleConfigs[feedId].minUpdateInterval = minUpdateInterval;
        oracleConfigs[feedId].maxDeviationPercent = maxDeviationPercent;
        oracleConfigs[feedId].heartbeatInterval = minUpdateInterval * 2;
        oracleConfigs[feedId].staleThreshold = block.timestamp + minUpdateInterval * 4;
        oracleConfigs[feedId].weight = weight;
        
        emit ConfigUpdated(feedId, minUpdateInterval, maxDeviationPercent, weight);
    }
    
    function setFeedActive(bytes32 feedId, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!supportedFeeds[feedId]) revert FeedNotSupported();
        oracleConfigs[feedId].isActive = active;
    }
    
    function setFallbackValue(uint256 value, uint256 timestamp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        fallbackValue = value;
        fallbackTimestamp = timestamp;
        fallbackActive = true;
        emit FallbackActivated(value, timestamp);
    }
    
    function deactivateFallback() external onlyRole(DEFAULT_ADMIN_ROLE) {
        fallbackActive = false;
        emit FallbackDeactivated();
    }
    
    function batchUpdateOracleData(
        bytes32[] calldata feedIds,
        uint256[] calldata values,
        uint256[] calldata timestamps,
        uint256[] calldata confidences
    ) external onlyUpdater whenNotPausedOracle nonReentrant {
        uint256 length = feedIds.length;
        if (length != values.length || length != timestamps.length || length != confidences.length) revert InvalidConfig();
        
        for (uint256 i = 0; i < length; i++) {
            bytes32 feedId = feedIds[i];
            uint256 value = values[i];
            uint256 timestamp = timestamps[i];
            uint256 confidence = confidences[i];
            
            if (!supportedFeeds[feedId]) continue;
            if (value == 0) continue;
            if (timestamp > block.timestamp) continue;
            if (confidence > 100) continue;
            
            OracleConfig memory config = oracleConfigs[feedId];
            if (!config.isActive) continue;
            
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
                isValid: true,
                confidence: confidence,
                source: msg.sender
            });
            
            emit OracleUpdated(feedId, value, timestamp, confidence, msg.sender);
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
    
    function emergencyPause() external onlyEmergency {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
    
    function emergencyUnpause() external onlyEmergency {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
} 
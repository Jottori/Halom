// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./HalomToken.sol";
import "./interfaces/IHalomInterfaces.sol";

// Custom errors for gas optimization (only those not already in HalomToken)
error InvalidHOI();
error HOITooHigh();
error SubmissionWindowClosed();
error AlreadySubmitted();
error AlreadyExecuted();
error InsufficientSubmissions();
error ConsensusNotReached();
error DeviationTooHigh();
error OutlierDetected();
error EmergencyPaused();
error InvalidParameters();
error NotContract();
error ZeroAddress();
error Unauthorized();

/**
 * @title HalomOracleV2
 * @dev Enhanced oracle with multiple nodes and consensus mechanism
 * Implements secure role structure with ORACLE_UPDATER_ROLE for authorized nodes only
 * Includes protection against data manipulation and outlier attacks
 */
contract HalomOracleV2 is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    IHalomToken public halomToken;
    
    uint256 public latestHOI;
    uint256 public lastUpdateTime;
    uint256 public nonce;
    uint256 public immutable chainId;
    
    // Consensus parameters
    uint256 public constant MIN_ORACLE_NODES = 3;
    uint256 public consensusThreshold = 2; // Minimum 2 nodes must agree
    uint256 public maxDeviation = 500; // 5% max deviation between submissions
    uint256 public constant SUBMISSION_WINDOW = 300; // 5 minutes window for submissions
    
    // Enhanced security parameters
    uint256 public constant MAX_HOI_CHANGE = 200; // 2% max change between updates
    uint256 public constant MIN_HOI_VALUE = 100; // Minimum HOI value (1.0)
    uint256 public constant MAX_HOI_VALUE = 1000; // Maximum HOI value (10.0)
    uint256 public constant OUTLIER_THRESHOLD = 300; // 3% threshold for outlier detection
    
    // Oracle reputation and slashing
    mapping(address => uint256) public oracleReputation;
    mapping(address => uint256) public oracleErrors;
    mapping(address => uint256) public lastSubmissionTime;
    uint256 public constant MAX_ERRORS = 5; // Max errors before oracle is slashed
    uint256 public constant REPUTATION_THRESHOLD = 50; // Minimum reputation to submit
    
    // Emergency controls
    bool public emergencyPaused;
    uint256 public emergencyHOI;
    uint256 public emergencyTimestamp;
    
    // Data validation
    mapping(uint256 => uint256[]) public historicalHOI;
    uint256 public historicalHOICount;
    uint256 public constant MAX_HISTORY = 100; // Keep last 100 HOI values
    
    struct OracleSubmission {
        uint256 hoi;
        uint256 timestamp;
        bool submitted;
    }
    
    struct ConsensusRound {
        uint256 nonce;
        uint256 startTime;
        uint256 endTime;
        uint256[] submissions;
        address[] submitters;
        bool executed;
        uint256 finalHOI;
        uint256 medianHOI;
        uint256[] validSubmissions;
    }
    
    mapping(uint256 => mapping(address => OracleSubmission)) public submissions; // nonce => oracle => submission
    mapping(uint256 => ConsensusRound) public consensusRounds; // nonce => round
    mapping(address => bool) public authorizedOracles;
    address[] public oracleNodes;
    
    // Oracle node management
    uint256 public maxOracleNodes = 10;
    uint256 public minOracleNodes = 3;
    
    event OracleSubmissionReceived(
        uint256 indexed nonce,
        address indexed oracle,
        uint256 hoi,
        uint256 timestamp
    );
    
    event ConsensusReached(
        uint256 indexed nonce,
        uint256 finalHOI,
        int256 supplyDelta,
        address[] participants
    );
    
    event OracleAuthorized(address indexed oracle, bool authorized);
    event ConsensusParametersUpdated(uint256 minNodes, uint256 threshold, uint256 maxDeviation);
    event OracleNodeAdded(address indexed oracle, address indexed addedBy);
    event OracleNodeRemoved(address indexed oracle, address indexed removedBy);
    event OracleSlashed(address indexed oracle, uint256 errors);
    event OutlierDetectedEvent(address indexed oracle, uint256 hoi, uint256 median);
    event EmergencyHOISet(uint256 hoi, address indexed caller);

    constructor(address _governance, uint256 _chainId) {
        if (_governance == address(0)) revert ZeroAddress();
        if (_chainId == 0) revert InvalidParameters();
        
        chainId = _chainId;
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        _grantRole(PAUSER_ROLE, _governance);
        _grantRole(EMERGENCY_ROLE, _governance);
    }

    /**
     * @dev Set HalomToken address (only governor)
     */
    function setHalomToken(address _halomToken) external onlyRole(GOVERNOR_ROLE) {
        if (_halomToken == address(0)) revert ZeroAddress();
        if (_halomToken.code.length == 0) revert NotContract();
        halomToken = IHalomToken(_halomToken);
    }

    /**
     * @dev Add oracle node (only governor)
     */
    function addOracleNode(address _oracle) external onlyRole(GOVERNOR_ROLE) {
        if (_oracle == address(0)) revert ZeroAddress();
        if (_oracle.code.length == 0) revert NotContract();
        if (authorizedOracles[_oracle]) revert Unauthorized();
        if (oracleNodes.length >= maxOracleNodes) revert InvalidParameters();
        
        authorizedOracles[_oracle] = true;
        oracleNodes.push(_oracle);
        _grantRole(ORACLE_UPDATER_ROLE, _oracle);
        
        // Initialize reputation
        oracleReputation[_oracle] = 100;
        
        emit OracleAuthorized(_oracle, true);
        emit OracleNodeAdded(_oracle, msg.sender);
    }

    /**
     * @dev Remove oracle node (only governor)
     */
    function removeOracleNode(address _oracle) external onlyRole(GOVERNOR_ROLE) {
        if (!authorizedOracles[_oracle]) revert Unauthorized();
        if (oracleNodes.length <= minOracleNodes) revert InvalidParameters();
        
        authorizedOracles[_oracle] = false;
        _revokeRole(ORACLE_UPDATER_ROLE, _oracle);
        
        // Remove from oracleNodes array
        for (uint256 i = 0; i < oracleNodes.length; i++) {
            if (oracleNodes[i] == _oracle) {
                oracleNodes[i] = oracleNodes[oracleNodes.length - 1];
                oracleNodes.pop();
                break;
            }
        }
        
        emit OracleAuthorized(_oracle, false);
        emit OracleNodeRemoved(_oracle, msg.sender);
    }

    /**
     * @dev Emergency pause oracle
     */
    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        emergencyPaused = true;
        _pause();
    }
    
    /**
     * @dev Emergency set HOI value
     */
    function emergencySetHOI(uint256 _hoi) external onlyRole(EMERGENCY_ROLE) {
        if (_hoi < MIN_HOI_VALUE || _hoi > MAX_HOI_VALUE) revert InvalidHOI();
        
        emergencyHOI = _hoi;
        emergencyTimestamp = block.timestamp;
        latestHOI = _hoi;
        lastUpdateTime = block.timestamp;
        
        emit EmergencyHOISet(_hoi, msg.sender);
    }
    
    /**
     * @dev Resume oracle
     */
    function emergencyResume() external onlyRole(GOVERNOR_ROLE) {
        emergencyPaused = false;
        _unpause();
    }

    /**
     * @dev Set HOI with multiple node aggregation and weighted consensus
     * @param node The oracle node address
     * @param hoiValue The HOI value to submit
     */
    function setHOI(address node, uint256 hoiValue) external onlyRole(ORACLE_UPDATER_ROLE) {
        if (emergencyPaused) revert EmergencyPaused();
        if (!authorizedOracles[node]) revert Unauthorized();
        if (hoiValue < MIN_HOI_VALUE || hoiValue > MAX_HOI_VALUE) revert InvalidHOI();
        
        // Timestamp validation: only accept fresh data (within last 5 minutes)
        if (block.timestamp > lastUpdateTime + 300) revert SubmissionWindowClosed();
        
        // Check if already submitted for this round
        if (submissions[nonce][node].submitted) revert AlreadySubmitted();
        
        // Validate oracle reputation
        if (oracleReputation[node] < REPUTATION_THRESHOLD) revert Unauthorized();
        
        // Store submission
        submissions[nonce][node] = OracleSubmission({
            hoi: hoiValue,
            timestamp: block.timestamp,
            submitted: true
        });
        
        // Add to consensus round
        ConsensusRound storage round = consensusRounds[nonce];
        if (round.startTime == 0) {
            round.startTime = block.timestamp;
            round.endTime = block.timestamp + SUBMISSION_WINDOW;
        }
        round.submissions.push(hoiValue);
        round.submitters.push(node);
        
        emit OracleSubmissionReceived(nonce, node, hoiValue, block.timestamp);
        
        // Check if consensus can be reached
        if (round.submissions.length >= consensusThreshold) {
            _executeConsensus();
        }
    }

    /**
     * @dev Execute consensus with weighted aggregation
     */
    function _executeConsensus() internal {
        ConsensusRound storage round = consensusRounds[nonce];
        if (round.executed) revert AlreadyExecuted();
        
        // Calculate weighted average based on oracle reputation
        uint256 totalWeight = 0;
        uint256 weightedSum = 0;
        
        for (uint256 i = 0; i < round.submissions.length; i++) {
            address oracle = round.submitters[i];
            uint256 weight = oracleReputation[oracle];
            uint256 submission = round.submissions[i];
            
            totalWeight += weight;
            weightedSum += submission * weight;
        }
        
        uint256 weightedAverage = weightedSum / totalWeight;
        
        // Outlier detection and removal
        uint256[] memory validSubmissions = new uint256[](round.submissions.length);
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < round.submissions.length; i++) {
            uint256 submission = round.submissions[i];
            uint256 deviation = _calculateDeviation(submission, weightedAverage);
            
            if (deviation <= OUTLIER_THRESHOLD) {
                validSubmissions[validCount] = submission;
                validCount++;
            } else {
                // Penalize outlier oracle
                address oracle = round.submitters[i];
                oracleErrors[oracle]++;
                oracleReputation[oracle] = oracleReputation[oracle] > 10 ? oracleReputation[oracle] - 10 : 0;
                
                emit OutlierDetectedEvent(oracle, submission, weightedAverage);
                
                if (oracleErrors[oracle] >= MAX_ERRORS) {
                    emit OracleSlashed(oracle, oracleErrors[oracle]);
                }
            }
        }
        
        if (validCount < consensusThreshold) revert InsufficientSubmissions();
        
        // Calculate final HOI from valid submissions
        uint256 finalHOI = 0;
        for (uint256 i = 0; i < validCount; i++) {
            finalHOI += validSubmissions[i];
        }
        finalHOI = finalHOI / validCount;
        
        // Validate final HOI change
        if (latestHOI > 0) {
            uint256 change = _calculateDeviation(finalHOI, latestHOI);
            if (change > MAX_HOI_CHANGE) revert HOITooHigh();
        }
        
        // Update state
        latestHOI = finalHOI;
        lastUpdateTime = block.timestamp;
        round.executed = true;
        round.finalHOI = finalHOI;
        round.validSubmissions = validSubmissions;
        
        // Update historical data
        historicalHOI[nonce] = validSubmissions;
        historicalHOICount++;
        if (historicalHOICount > MAX_HISTORY) {
            // Remove oldest entry (circular buffer helyett egyszerű törlés)
            delete historicalHOI[nonce - MAX_HISTORY];
        }
        
        // Calculate supply delta for rebase
        int256 supplyDelta = _calculateSupplyDelta(finalHOI);
        
        // Reward participating oracles
        for (uint256 i = 0; i < round.submitters.length; i++) {
            address oracle = round.submitters[i];
            if (oracleErrors[oracle] < MAX_ERRORS) {
                oracleReputation[oracle] = oracleReputation[oracle] < 100 ? oracleReputation[oracle] + 1 : 100;
            }
        }
        
        emit ConsensusReached(nonce, finalHOI, supplyDelta, round.submitters);
        
        // Increment nonce for next round
        nonce++;
    }

    /**
     * @dev Calculate deviation between two values
     */
    function _calculateDeviation(uint256 value1, uint256 value2) internal pure returns (uint256) {
        if (value2 == 0) return 0;
        uint256 diff = value1 > value2 ? value1 - value2 : value2 - value1;
        return (diff * 10000) / value2; // Return as basis points
    }

    /**
     * @dev Calculate supply delta for rebase based on HOI
     */
    function _calculateSupplyDelta(uint256 hoi) internal view returns (int256) {
        if (hoi == 100) return 0; // No change if HOI = 1.0
        
        uint256 totalSupply = halomToken.totalSupply();
        int256 delta;
        
        if (hoi > 100) {
            // Inflation: HOI > 1.0
            uint256 inflationRate = hoi - 100;
            delta = int256((totalSupply * inflationRate) / 10000);
        } else {
            // Deflation: HOI < 1.0
            uint256 deflationRate = 100 - hoi;
            delta = -int256((totalSupply * deflationRate) / 10000);
        }
        
        return delta;
    }

    /**
     * @dev Get weighted HOI from multiple nodes
     */
    function getWeightedHOI() public view returns (uint256 weightedHOI, uint256 totalWeight) {
        uint256 sum = 0;
        uint256 weightSum = 0;
        
        for (uint256 i = 0; i < oracleNodes.length; i++) {
            address oracle = oracleNodes[i];
            if (authorizedOracles[oracle] && oracleReputation[oracle] >= REPUTATION_THRESHOLD) {
                uint256 weight = oracleReputation[oracle];
                // Use latest submission or fallback to historical data
                uint256 hoi = submissions[nonce][oracle].submitted ? 
                    submissions[nonce][oracle].hoi : latestHOI;
                
                sum += hoi * weight;
                weightSum += weight;
            }
        }
        
        if (weightSum > 0) {
            weightedHOI = sum / weightSum;
        } else {
            weightedHOI = latestHOI;
        }
        
        totalWeight = weightSum;
    }

    /**
     * @dev Get oracle statistics
     */
    function getOracleStats(address oracle) public view returns (
        uint256 reputation,
        uint256 errors,
        uint256 lastSubmission,
        bool authorized
    ) {
        return (
            oracleReputation[oracle],
            oracleErrors[oracle],
            lastSubmissionTime[oracle],
            authorizedOracles[oracle]
        );
    }

    /**
     * @dev Update consensus parameters (only governor)
     */
    function updateConsensusParameters(
        uint256 _minNodes,
        uint256 _threshold,
        uint256 _maxDeviation
    ) external onlyRole(GOVERNOR_ROLE) {
        if (_minNodes < 2 || _threshold < 2) revert InvalidParameters();
        
        minOracleNodes = _minNodes;
        consensusThreshold = _threshold;
        maxDeviation = _maxDeviation;
        
        emit ConsensusParametersUpdated(_minNodes, _threshold, _maxDeviation);
    }

    /**
     * @dev Get historical HOI data
     */
    function getHistoricalHOI() external view returns (uint256[] memory) {
        return historicalHOI[0];
    }
} 
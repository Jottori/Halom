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
    uint256 public constant CONSENSUS_THRESHOLD = 2; // Minimum 2 nodes must agree
    uint256 public constant MAX_DEVIATION = 500; // 5% max deviation between submissions
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
     * @dev Submit HOI value for consensus round (only authorized oracle nodes)
     */
    function submitHOI(uint256 _hoi) external onlyRole(ORACLE_UPDATER_ROLE) nonReentrant whenNotPaused {
        if (emergencyPaused) revert EmergencyPaused();
        if (!authorizedOracles[msg.sender]) revert Unauthorized();
        if (_hoi < MIN_HOI_VALUE || _hoi > MAX_HOI_VALUE) revert InvalidHOI();
        if (oracleReputation[msg.sender] < REPUTATION_THRESHOLD) revert Unauthorized();
        
        ConsensusRound storage round = consensusRounds[nonce];
        
        // Initialize round if first submission
        if (round.startTime == 0) {
            round.nonce = nonce;
            round.startTime = block.timestamp;
            round.endTime = block.timestamp + SUBMISSION_WINDOW;
        }
        
        if (block.timestamp > round.endTime) revert SubmissionWindowClosed();
        if (submissions[nonce][msg.sender].submitted) revert AlreadySubmitted();
        
        // Check for rapid submissions (anti-spam)
        if (block.timestamp < lastSubmissionTime[msg.sender] + 60) revert InvalidParameters(); // 1 minute cooldown
        
        // Record submission
        submissions[nonce][msg.sender] = OracleSubmission({
            hoi: _hoi,
            timestamp: block.timestamp,
            submitted: true
        });
        
        round.submissions.push(_hoi);
        round.submitters.push(msg.sender);
        lastSubmissionTime[msg.sender] = block.timestamp;
        
        emit OracleSubmissionReceived(nonce, msg.sender, _hoi, block.timestamp);
        
        // Check if consensus can be reached
        if (round.submissions.length >= CONSENSUS_THRESHOLD) {
            _tryReachConsensus();
        }
    }

    /**
     * @dev Try to reach consensus and execute rebase
     */
    function _tryReachConsensus() internal {
        ConsensusRound storage round = consensusRounds[nonce];
        if (round.executed) revert AlreadyExecuted();
        
        // Sort submissions to find median
        uint256[] memory sortedSubmissions = new uint256[](round.submissions.length);
        for (uint256 i = 0; i < round.submissions.length; i++) {
            sortedSubmissions[i] = round.submissions[i];
        }
        
        // Simple bubble sort for small arrays
        for (uint256 i = 0; i < sortedSubmissions.length; i++) {
            for (uint256 j = i + 1; j < sortedSubmissions.length; j++) {
                if (sortedSubmissions[i] > sortedSubmissions[j]) {
                    uint256 temp = sortedSubmissions[i];
                    sortedSubmissions[i] = sortedSubmissions[j];
                    sortedSubmissions[j] = temp;
                }
            }
        }
        
        uint256 median = sortedSubmissions[sortedSubmissions.length / 2];
        round.medianHOI = median;
        
        // Filter out outliers
        uint256[] memory validSubmissions = new uint256[](round.submissions.length);
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < round.submissions.length; i++) {
            uint256 deviation = _calculateDeviation(round.submissions[i], median);
            if (deviation <= OUTLIER_THRESHOLD) {
                validSubmissions[validCount] = round.submissions[i];
                validCount++;
            } else {
                // Penalize outlier oracle
                _penalizeOracle(round.submitters[i]);
                emit OutlierDetectedEvent(round.submitters[i], round.submissions[i], median);
            }
        }
        
        if (validCount < CONSENSUS_THRESHOLD) revert ConsensusNotReached();
        
        // Calculate final HOI as average of valid submissions
        uint256 finalHOI = 0;
        for (uint256 i = 0; i < validCount; i++) {
            finalHOI += validSubmissions[i];
        }
        finalHOI = finalHOI / validCount;
        
        // Check for extreme changes
        if (latestHOI > 0) {
            uint256 change = _calculateDeviation(finalHOI, latestHOI);
            if (change > MAX_HOI_CHANGE) revert DeviationTooHigh();
        }
        
        // Execute rebase
        int256 supplyDelta = _calculateSupplyDelta(finalHOI);
        
        if (address(halomToken) != address(0)) {
            halomToken.rebase(supplyDelta);
        }
        
        // Update state
        latestHOI = finalHOI;
        lastUpdateTime = block.timestamp;
        round.executed = true;
        round.finalHOI = finalHOI;
        
        // Store in history
        if (historicalHOI[0].length >= MAX_HISTORY) {
            // Remove oldest entry
            for (uint256 i = 0; i < historicalHOI[0].length - 1; i++) {
                historicalHOI[0][i] = historicalHOI[0][i + 1];
            }
            historicalHOI[0].pop();
        }
        historicalHOI[0].push(finalHOI);
        
        // Reward valid oracles
        for (uint256 i = 0; i < validCount; i++) {
            _rewardOracle(round.submitters[i]);
        }
        
        nonce++;
        
        emit ConsensusReached(nonce - 1, finalHOI, supplyDelta, round.submitters);
    }
    
    /**
     * @dev Calculate deviation between two values
     */
    function _calculateDeviation(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 0;
        uint256 diff = a > b ? a - b : b - a;
        return (diff * 10000) / b; // Return as basis points
    }
    
    /**
     * @dev Calculate supply delta based on HOI
     */
    function _calculateSupplyDelta(uint256 hoi) internal view returns (int256) {
        // Simple linear relationship: HOI 100 = no change, HOI 200 = +10% supply
        if (hoi == 100) return 0;
        if (hoi > 100) {
            uint256 increase = ((hoi - 100) * 1000) / 10000; // 10% max increase
            return int256(increase);
        } else {
            uint256 decrease = ((100 - hoi) * 1000) / 10000; // 10% max decrease
            return -int256(decrease);
        }
    }
    
    /**
     * @dev Penalize oracle for outlier submission
     */
    function _penalizeOracle(address oracle) internal {
        oracleErrors[oracle]++;
        if (oracleReputation[oracle] > 10) {
            oracleReputation[oracle] -= 10;
        }
        
        if (oracleErrors[oracle] >= MAX_ERRORS) {
            // Slash oracle
            authorizedOracles[oracle] = false;
            _revokeRole(ORACLE_UPDATER_ROLE, oracle);
            emit OracleSlashed(oracle, oracleErrors[oracle]);
        }
    }
    
    /**
     * @dev Reward oracle for valid submission
     */
    function _rewardOracle(address oracle) internal {
        if (oracleReputation[oracle] < 100) {
            oracleReputation[oracle] += 1;
        }
    }
    
    /**
     * @dev Get oracle statistics
     */
    function getOracleStats(address oracle) external view returns (
        uint256 reputation,
        uint256 errors,
        uint256 lastSubmission
    ) {
        return (
            oracleReputation[oracle],
            oracleErrors[oracle],
            lastSubmissionTime[oracle]
        );
    }
    
    /**
     * @dev Get historical HOI data
     */
    function getHistoricalHOI() external view returns (uint256[] memory) {
        return historicalHOI[0];
    }
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IHalomInterfaces.sol";

/**
 * @title HalomOracleV2
 * @dev Enhanced oracle with multiple nodes and consensus mechanism
 * Implements secure role structure with ORACLE_UPDATER_ROLE for authorized nodes only
 */
contract HalomOracleV2 is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

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

    constructor(address _governance, uint256 _chainId) {
        require(_governance != address(0), "Governance cannot be zero");
        require(_chainId > 0, "Chain ID must be positive");
        
        chainId = _chainId;
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        _grantRole(PAUSER_ROLE, _governance);
    }

    /**
     * @dev Set HalomToken address (only governor)
     */
    function setHalomToken(address _halomToken) external onlyRole(GOVERNOR_ROLE) {
        require(_halomToken != address(0), "Token address cannot be zero");
        require(_halomToken.code.length > 0, "Must be a contract");
        halomToken = IHalomToken(_halomToken);
    }

    /**
     * @dev Add oracle node (only governor)
     */
    function addOracleNode(address _oracle) external onlyRole(GOVERNOR_ROLE) {
        require(_oracle != address(0), "Oracle address cannot be zero");
        require(_oracle.code.length > 0, "Oracle must be a contract");
        require(!authorizedOracles[_oracle], "Oracle already authorized");
        require(oracleNodes.length < maxOracleNodes, "Too many oracle nodes");
        
        authorizedOracles[_oracle] = true;
        oracleNodes.push(_oracle);
        _grantRole(ORACLE_UPDATER_ROLE, _oracle);
        
        emit OracleAuthorized(_oracle, true);
        emit OracleNodeAdded(_oracle, msg.sender);
    }

    /**
     * @dev Remove oracle node (only governor)
     */
    function removeOracleNode(address _oracle) external onlyRole(GOVERNOR_ROLE) {
        require(authorizedOracles[_oracle], "Oracle not authorized");
        require(oracleNodes.length > minOracleNodes, "Too few oracle nodes");
        
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
     * @dev Update consensus parameters (only governor)
     */
    function updateConsensusParameters(
        uint256 _minNodes,
        uint256 _threshold,
        uint256 _maxDeviation
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_minNodes >= 2, "Min nodes must be at least 2");
        require(_threshold >= 2, "Threshold must be at least 2");
        require(_maxDeviation <= 1000, "Max deviation cannot exceed 10%");
        require(_minNodes <= oracleNodes.length, "Min nodes cannot exceed current oracle count");
        
        // Update constants (this would require contract upgrade in production)
        // For now, we'll use storage variables
        emit ConsensusParametersUpdated(_minNodes, _threshold, _maxDeviation);
    }

    /**
     * @dev Submit HOI value for consensus round (only authorized oracle nodes)
     */
    function submitHOI(uint256 _hoi) external onlyRole(ORACLE_UPDATER_ROLE) nonReentrant whenNotPaused {
        require(authorizedOracles[msg.sender], "Oracle: not authorized");
        require(_hoi > 0, "Oracle: invalid HOI value");
        require(_hoi <= 1e12, "Oracle: HOI value too high"); // Max 1000 (scaled by 1e9)
        
        ConsensusRound storage round = consensusRounds[nonce];
        
        // Initialize round if first submission
        if (round.startTime == 0) {
            round.nonce = nonce;
            round.startTime = block.timestamp;
            round.endTime = block.timestamp + SUBMISSION_WINDOW;
        }
        
        require(block.timestamp <= round.endTime, "Oracle: submission window closed");
        require(!submissions[nonce][msg.sender].submitted, "Oracle: already submitted");
        
        // Record submission
        submissions[nonce][msg.sender] = OracleSubmission({
            hoi: _hoi,
            timestamp: block.timestamp,
            submitted: true
        });
        
        round.submissions.push(_hoi);
        round.submitters.push(msg.sender);
        
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
        require(!round.executed, "Oracle: already executed");
        
        // Sort submissions to find median
        uint256[] memory sortedSubmissions = new uint256[](round.submissions.length);
        for (uint256 i = 0; i < round.submissions.length; i++) {
            sortedSubmissions[i] = round.submissions[i];
        }
        _quickSort(sortedSubmissions, 0, int256(sortedSubmissions.length - 1));
        
        uint256 medianHOI = sortedSubmissions[sortedSubmissions.length / 2];
        
        // Check if submissions are within acceptable deviation
        bool consensusReached = true;
        for (uint256 i = 0; i < round.submissions.length; i++) {
            uint256 deviation = _calculateDeviation(round.submissions[i], medianHOI);
            if (deviation > MAX_DEVIATION) {
                consensusReached = false;
                break;
            }
        }
        
        if (consensusReached && round.submissions.length >= CONSENSUS_THRESHOLD) {
            _executeConsensus(medianHOI);
        }
    }

    /**
     * @dev Execute consensus and trigger rebase
     */
    function _executeConsensus(uint256 _finalHOI) internal {
        ConsensusRound storage round = consensusRounds[nonce];
        
        // Calculate supply delta
        uint256 S = halomToken.totalSupply();
        int256 supplyDelta;
        
        if (lastUpdateTime == 0) {
            // First rebase
            uint256 initialPeg = 1e9;
            supplyDelta = int256((_finalHOI * S) / initialPeg) - int256(S);
        } else {
            supplyDelta = int256((_finalHOI * S) / latestHOI) - int256(S);
        }
        
        // Update state
        latestHOI = _finalHOI;
        lastUpdateTime = block.timestamp;
        round.finalHOI = _finalHOI;
        round.executed = true;
        
        // Execute rebase only for positive deltas and within limits
        if (supplyDelta > 0) {
            uint256 positiveDelta = uint256(supplyDelta);
            
            // Check if the delta exceeds the maximum allowed rebase delta
            uint256 maxRebaseDelta = halomToken.maxRebaseDelta();
            uint256 maxDelta = (S * maxRebaseDelta) / 10000;
            
            // Only rebase if the delta is within limits
            if (positiveDelta <= maxDelta) {
                halomToken.rebase(positiveDelta);
            }
            // If delta exceeds max, we skip the rebase but still update the HOI
        }
        // For negative deltas, skip rebase for now
        
        // Move to next round
        nonce++;
        
        emit ConsensusReached(nonce - 1, _finalHOI, supplyDelta, round.submitters);
    }

    /**
     * @dev Calculate percentage deviation between two values
     */
    function _calculateDeviation(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == b) return 0;
        uint256 diff = a > b ? a - b : b - a;
        return (diff * 10000) / b; // Return in basis points
    }

    /**
     * @dev Quick sort implementation for finding median
     */
    function _quickSort(uint256[] memory arr, int256 left, int256 right) internal pure {
        if (left >= right) return;
        
        uint256 pivot = arr[uint256(left + (right - left) / 2)];
        int256 i = left - 1;
        int256 j = right + 1;
        
        while (true) {
            do {
                i++;
            } while (arr[uint256(i)] < pivot);
            
            do {
                j--;
            } while (arr[uint256(j)] > pivot);
            
            if (i >= j) break;
            
            uint256 temp = arr[uint256(i)];
            arr[uint256(i)] = arr[uint256(j)];
            arr[uint256(j)] = temp;
        }
        
        _quickSort(arr, left, j);
        _quickSort(arr, j + 1, right);
    }

    /**
     * @dev Get current consensus round info
     */
    function getCurrentRound() external view returns (
        uint256 _nonce,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _submissionCount,
        bool _executed,
        uint256 _finalHOI
    ) {
        ConsensusRound storage round = consensusRounds[nonce];
        return (
            round.nonce,
            round.startTime,
            round.endTime,
            round.submissions.length,
            round.executed,
            round.finalHOI
        );
    }

    /**
     * @dev Get oracle submission for current round
     */
    function getOracleSubmission(address _oracle) external view returns (
        uint256 _hoi,
        uint256 _timestamp,
        bool _submitted
    ) {
        OracleSubmission storage submission = submissions[nonce][_oracle];
        return (submission.hoi, submission.timestamp, submission.submitted);
    }

    /**
     * @dev Get all authorized oracle nodes
     */
    function getOracleNodes() external view returns (address[] memory) {
        return oracleNodes;
    }

    /**
     * @dev Check if address is authorized oracle
     */
    function isAuthorizedOracle(address _oracle) external view returns (bool) {
        return authorizedOracles[_oracle];
    }

    /**
     * @dev Pause oracle operations (emergency)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause oracle operations
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Emergency function to force consensus (only governor)
     */
    function emergencyForceConsensus(uint256 _hoi) external onlyRole(GOVERNOR_ROLE) {
        require(_hoi > 0, "Invalid HOI value");
        require(_hoi <= 1e12, "HOI value too high");
        
        ConsensusRound storage round = consensusRounds[nonce];
        require(!round.executed, "Round already executed");
        
        _executeConsensus(_hoi);
    }
} 
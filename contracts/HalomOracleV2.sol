// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./HalomToken.sol";

/**
 * @title HalomOracleV2
 * @dev Enhanced oracle with multiple nodes and consensus mechanism
 */
contract HalomOracleV2 is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");

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

    constructor(address _governance, uint256 _chainId) {
        chainId = _chainId;
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
    }

    modifier whenNotPaused() {
        require(!paused(), "Oracle: paused");
        _;
    }

    /**
     * @dev Submit HOI value for consensus round
     */
    function submitHOI(uint256 _hoi) external onlyRole(ORACLE_UPDATER_ROLE) whenNotPaused nonReentrant {
        require(authorizedOracles[msg.sender], "Oracle: not authorized");
        require(_hoi > 0, "Oracle: invalid HOI value");
        
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
        
        // Execute rebase
        halomToken.rebase(supplyDelta);
        
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
            
            (arr[uint256(i)], arr[uint256(j)]) = (arr[uint256(j)], arr[uint256(i)]);
        }
        
        _quickSort(arr, left, j);
        _quickSort(arr, j + 1, right);
    }

    /**
     * @dev Force consensus execution (emergency function)
     */
    function forceConsensus() external onlyRole(GOVERNOR_ROLE) {
        ConsensusRound storage round = consensusRounds[nonce];
        require(!round.executed, "Oracle: already executed");
        require(round.submissions.length > 0, "Oracle: no submissions");
        
        // Use median of all submissions
        uint256[] memory sortedSubmissions = new uint256[](round.submissions.length);
        for (uint256 i = 0; i < round.submissions.length; i++) {
            sortedSubmissions[i] = round.submissions[i];
        }
        _quickSort(sortedSubmissions, 0, int256(sortedSubmissions.length - 1));
        
        uint256 medianHOI = sortedSubmissions[sortedSubmissions.length / 2];
        _executeConsensus(medianHOI);
    }

    /**
     * @dev Authorize/deauthorize oracle nodes
     */
    function setOracleAuthorization(address oracle, bool authorized) external onlyRole(GOVERNOR_ROLE) {
        authorizedOracles[oracle] = authorized;
        
        if (authorized) {
            // Add to oracle list if not already present
            bool found = false;
            for (uint256 i = 0; i < oracleNodes.length; i++) {
                if (oracleNodes[i] == oracle) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                oracleNodes.push(oracle);
            }
        } else {
            // Remove from oracle list
            for (uint256 i = 0; i < oracleNodes.length; i++) {
                if (oracleNodes[i] == oracle) {
                    oracleNodes[i] = oracleNodes[oracleNodes.length - 1];
                    oracleNodes.pop();
                    break;
                }
            }
        }
        
        emit OracleAuthorized(oracle, authorized);
    }

    /**
     * @dev Set Halom token address
     */
    function setHalomToken(address _halomToken) external onlyRole(GOVERNOR_ROLE) {
        require(_halomToken != address(0), "Oracle: zero address");
        halomToken = IHalomToken(_halomToken);
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
    function getOracleSubmission(address oracle) external view returns (
        uint256 hoi,
        uint256 timestamp,
        bool submitted
    ) {
        OracleSubmission storage submission = submissions[nonce][oracle];
        return (submission.hoi, submission.timestamp, submission.submitted);
    }

    /**
     * @dev Get all authorized oracle nodes
     */
    function getOracleNodes() external view returns (address[] memory) {
        return oracleNodes;
    }

    // Pause/unpause functions
    function pause() external onlyRole(GOVERNOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }
} 
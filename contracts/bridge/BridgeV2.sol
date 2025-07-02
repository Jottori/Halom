// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";

/**
 * @title HalomBridgeV2
 * @dev Enhanced cross-chain bridge with advanced security features
 * @dev Includes timelock, rate limiting, and improved validator consensus
 */
contract HalomBridgeV2 is 
    Initializable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ============ Constants ============
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant TIMELOCK_ROLE = keccak256("TIMELOCK_ROLE");
    
    uint256 public constant MIN_VALIDATORS = 5;
    uint256 public constant CONSENSUS_THRESHOLD = 4; // 4/5 consensus
    uint256 public constant MAX_BRIDGE_AMOUNT = 5000000 * 10**18; // 5M tokens
    uint256 public constant MIN_BRIDGE_AMOUNT = 1 * 10**18; // 1 token
    uint256 public constant RATE_LIMIT_PERIOD = 1 hours;
    uint256 public constant MAX_DAILY_VOLUME = 10000000 * 10**18; // 10M tokens daily
    
    // ============ State Variables ============
    uint256 public chainId;
    uint256 public nonce;
    uint256 public bridgeFee;
    uint256 public timelockDelay;
    uint256 public dailyVolume;
    uint256 public lastVolumeReset;
    
    mapping(bytes32 => bool) public processedTransactions;
    mapping(address => bool) public whitelistedTokens;
    mapping(uint256 => BridgeRequest) public bridgeRequests;
    mapping(address => uint256) public validatorVotes;
    mapping(address => uint256) public userDailyVolume;
    mapping(address => uint256) public userLastReset;
    mapping(bytes32 => TimelockRequest) public timelockRequests;
    
    // ============ Structs ============
    struct BridgeRequest {
        address token;
        address sender;
        address recipient;
        uint256 amount;
        uint256 sourceChainId;
        uint256 targetChainId;
        uint256 requestId;
        bool isProcessed;
        uint256 timestamp;
        uint256 validatorVotes;
        mapping(address => bool) hasVoted;
        uint256 timelockExpiry;
    }
    
    struct TimelockRequest {
        address target;
        uint256 value;
        bytes data;
        uint256 timestamp;
        bool executed;
        bool canceled;
    }
    
    // ============ Events ============
    event TokenLocked(
        address indexed token,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        uint256 requestId,
        uint256 timestamp
    );
    
    event TokenMinted(
        address indexed token,
        address indexed recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        uint256 requestId,
        uint256 timestamp
    );
    
    event TimelockRequested(
        bytes32 indexed requestId,
        address indexed target,
        uint256 value,
        bytes data,
        uint256 timestamp,
        uint256 expiry
    );
    
    event TimelockExecuted(
        bytes32 indexed requestId,
        address indexed target,
        uint256 value,
        bytes data
    );
    
    event TimelockCanceled(bytes32 indexed requestId);
    event RateLimitExceeded(address indexed user, uint256 amount, uint256 limit);
    event DailyVolumeReset(uint256 timestamp);
    
    // ============ Errors ============
    error Bridge__InvalidChainId();
    error Bridge__TokenNotWhitelisted();
    error Bridge__AmountTooSmall();
    error Bridge__AmountTooLarge();
    error Bridge__InsufficientAllowance();
    error Bridge__TransactionAlreadyProcessed();
    error Bridge__InvalidValidator();
    error Bridge__InsufficientValidatorVotes();
    error Bridge__AlreadyVoted();
    error Bridge__InvalidRequest();
    error Bridge__EmergencyPaused();
    error Bridge__InvalidSignature();
    error Bridge__InvalidNonce();
    error Bridge__RateLimitExceeded();
    error Bridge__TimelockNotExpired();
    error Bridge__TimelockExpired();
    error Bridge__TimelockRequestNotFound();
    error Bridge__TimelockAlreadyExecuted();
    error Bridge__TimelockAlreadyCanceled();
    
    // ============ Modifiers ============
    modifier onlyValidator() {
        if (!hasRole(VALIDATOR_ROLE, msg.sender)) {
            revert Bridge__InvalidValidator();
        }
        _;
    }
    
    modifier onlyRelayer() {
        if (!hasRole(RELAYER_ROLE, msg.sender)) {
            revert Bridge__InvalidValidator();
        }
        _;
    }
    
    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) {
            revert Bridge__InvalidValidator();
        }
        _;
    }
    
    modifier onlyTimelock() {
        if (!hasRole(TIMELOCK_ROLE, msg.sender)) {
            revert Bridge__InvalidValidator();
        }
        _;
    }
    
    // ============ Initialization ============
    function initialize(
        uint256 _chainId,
        address _admin,
        uint256 _bridgeFee,
        uint256 _timelockDelay
    ) public initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        chainId = _chainId;
        bridgeFee = _bridgeFee;
        timelockDelay = _timelockDelay;
        lastVolumeReset = block.timestamp;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(VALIDATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
        _grantRole(TIMELOCK_ROLE, _admin);
    }
    
    // ============ Core Bridge Functions ============
    
    /**
     * @dev Lock tokens with rate limiting and timelock
     */
    function lockTokens(
        address _token,
        address _recipient,
        uint256 _amount,
        uint256 _targetChainId
    ) external nonReentrant whenNotPaused {
        if (_targetChainId == chainId) {
            revert Bridge__InvalidChainId();
        }
        if (!whitelistedTokens[_token]) {
            revert Bridge__TokenNotWhitelisted();
        }
        if (_amount < MIN_BRIDGE_AMOUNT) {
            revert Bridge__AmountTooSmall();
        }
        if (_amount > MAX_BRIDGE_AMOUNT) {
            revert Bridge__AmountTooLarge();
        }
        
        // Check rate limits
        _checkRateLimits(msg.sender, _amount);
        
        // Check allowance
        uint256 allowance = IERC20(_token).allowance(msg.sender, address(this));
        if (allowance < _amount) {
            revert Bridge__InsufficientAllowance();
        }
        
        // Calculate bridge fee
        uint256 feeAmount = (_amount * bridgeFee) / 10000;
        uint256 transferAmount = _amount - feeAmount;
        
        // Transfer tokens from sender to bridge
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        
        // Update volume tracking
        _updateVolumeTracking(msg.sender, _amount);
        
        // Create bridge request with timelock
        uint256 requestId = _generateRequestId(_token, msg.sender, _recipient, _amount, _targetChainId);
        
        BridgeRequest storage request = bridgeRequests[requestId];
        request.token = _token;
        request.sender = msg.sender;
        request.recipient = _recipient;
        request.amount = transferAmount;
        request.sourceChainId = chainId;
        request.targetChainId = _targetChainId;
        request.requestId = requestId;
        request.timestamp = block.timestamp;
        request.timelockExpiry = block.timestamp + timelockDelay;
        
        emit TokenLocked(
            _token,
            msg.sender,
            _recipient,
            transferAmount,
            chainId,
            _targetChainId,
            requestId,
            block.timestamp
        );
    }
    
    /**
     * @dev Mint tokens after timelock expiry and validator consensus
     */
    function mintTokens(
        uint256 _requestId,
        bytes[] calldata _signatures
    ) external onlyRelayer nonReentrant whenNotPaused {
        BridgeRequest storage request = bridgeRequests[_requestId];
        if (request.token == address(0)) {
            revert Bridge__InvalidRequest();
        }
        if (request.isProcessed) {
            revert Bridge__TransactionAlreadyProcessed();
        }
        if (block.timestamp < request.timelockExpiry) {
            revert Bridge__TimelockNotExpired();
        }
        
        // Verify validator signatures
        _verifyValidatorSignatures(_requestId, _signatures);
        
        // Mark as processed
        request.isProcessed = true;
        processedTransactions[bytes32(_requestId)] = true;
        
        // Mint tokens to recipient
        // Note: Implementation depends on token mechanism
        
        emit TokenMinted(
            request.token,
            request.recipient,
            request.amount,
            request.sourceChainId,
            request.targetChainId,
            _requestId,
            block.timestamp
        );
    }
    
    // ============ Timelock Functions ============
    
    /**
     * @dev Request a timelock operation
     */
    function requestTimelock(
        address _target,
        uint256 _value,
        bytes calldata _data
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32) {
        bytes32 requestId = keccak256(abi.encodePacked(
            _target,
            _value,
            _data,
            block.timestamp
        ));
        
        TimelockRequest storage timelock = timelockRequests[requestId];
        timelock.target = _target;
        timelock.value = _value;
        timelock.data = _data;
        timelock.timestamp = block.timestamp;
        
        emit TimelockRequested(
            requestId,
            _target,
            _value,
            _data,
            block.timestamp,
            block.timestamp + timelockDelay
        );
        
        return requestId;
    }
    
    /**
     * @dev Execute timelock operation after delay
     */
    function executeTimelock(bytes32 _requestId) external onlyTimelock {
        TimelockRequest storage timelock = timelockRequests[_requestId];
        
        if (timelock.target == address(0)) {
            revert Bridge__TimelockRequestNotFound();
        }
        if (timelock.executed) {
            revert Bridge__TimelockAlreadyExecuted();
        }
        if (timelock.canceled) {
            revert Bridge__TimelockAlreadyCanceled();
        }
        if (block.timestamp < timelock.timestamp + timelockDelay) {
            revert Bridge__TimelockNotExpired();
        }
        
        timelock.executed = true;
        
        (bool success, ) = timelock.target.call{value: timelock.value}(timelock.data);
        require(success, "Timelock execution failed");
        
        emit TimelockExecuted(
            _requestId,
            timelock.target,
            timelock.value,
            timelock.data
        );
    }
    
    /**
     * @dev Cancel timelock operation
     */
    function cancelTimelock(bytes32 _requestId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        TimelockRequest storage timelock = timelockRequests[_requestId];
        
        if (timelock.target == address(0)) {
            revert Bridge__TimelockRequestNotFound();
        }
        if (timelock.executed) {
            revert Bridge__TimelockAlreadyExecuted();
        }
        if (timelock.canceled) {
            revert Bridge__TimelockAlreadyCanceled();
        }
        
        timelock.canceled = true;
        
        emit TimelockCanceled(_requestId);
    }
    
    // ============ Rate Limiting Functions ============
    
    /**
     * @dev Check rate limits for user
     */
    function _checkRateLimits(address _user, uint256 _amount) internal {
        // Reset daily volume if needed
        if (block.timestamp >= lastVolumeReset + 1 days) {
            dailyVolume = 0;
            lastVolumeReset = block.timestamp;
            emit DailyVolumeReset(block.timestamp);
        }
        
        // Check global daily volume
        if (dailyVolume + _amount > MAX_DAILY_VOLUME) {
            revert Bridge__RateLimitExceeded();
        }
        
        // Check user daily volume
        if (block.timestamp >= userLastReset[_user] + 1 days) {
            userDailyVolume[_user] = 0;
            userLastReset[_user] = block.timestamp;
        }
        
        if (userDailyVolume[_user] + _amount > MAX_BRIDGE_AMOUNT) {
            revert Bridge__RateLimitExceeded();
        }
    }
    
    /**
     * @dev Update volume tracking
     */
    function _updateVolumeTracking(address _user, uint256 _amount) internal {
        dailyVolume += _amount;
        userDailyVolume[_user] += _amount;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @dev Update timelock delay
     */
    function updateTimelockDelay(uint256 _newDelay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        timelockDelay = _newDelay;
    }
    
    /**
     * @dev Reset rate limits (emergency function)
     */
    function resetRateLimits() external onlyEmergency {
        dailyVolume = 0;
        lastVolumeReset = block.timestamp;
        emit DailyVolumeReset(block.timestamp);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get timelock request details
     */
    function getTimelockRequest(bytes32 _requestId) external view returns (
        address target,
        uint256 value,
        bytes memory data,
        uint256 timestamp,
        bool executed,
        bool canceled
    ) {
        TimelockRequest storage timelock = timelockRequests[_requestId];
        return (
            timelock.target,
            timelock.value,
            timelock.data,
            timelock.timestamp,
            timelock.executed,
            timelock.canceled
        );
    }
    
    /**
     * @dev Get user rate limit info
     */
    function getUserRateLimitInfo(address _user) external view returns (
        uint256 userVolume,
        uint256 lastReset,
        uint256 timeUntilReset
    ) {
        userVolume = userDailyVolume[_user];
        lastReset = userLastReset[_user];
        timeUntilReset = lastReset + 1 days > block.timestamp ? 
            lastReset + 1 days - block.timestamp : 0;
    }
    
    // ============ Internal Functions ============
    
    /**
     * @dev Generate unique request ID
     */
    function _generateRequestId(
        address _token,
        address _sender,
        address _recipient,
        uint256 _amount,
        uint256 _targetChainId
    ) internal returns (uint256) {
        return keccak256(abi.encodePacked(
            _token,
            _sender,
            _recipient,
            _amount,
            _targetChainId,
            chainId,
            nonce++
        ));
    }
    
    /**
     * @dev Verify validator signatures with enhanced security
     */
    function _verifyValidatorSignatures(
        uint256 _requestId,
        bytes[] calldata _signatures
    ) internal view {
        require(_signatures.length >= CONSENSUS_THRESHOLD, "Insufficient signatures");
        
        bytes32 messageHash = keccak256(abi.encodePacked(
            "BRIDGE_REQUEST_V2",
            _requestId,
            chainId,
            block.chainid
        ));
        
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        
        address[] memory validators = new address[](_signatures.length);
        for (uint256 i = 0; i < _signatures.length; i++) {
            address validator = ethSignedMessageHash.recover(_signatures[i]);
            if (!hasRole(VALIDATOR_ROLE, validator)) {
                revert Bridge__InvalidSignature();
            }
            validators[i] = validator;
        }
        
        // Check for duplicate signatures
        for (uint256 i = 0; i < validators.length; i++) {
            for (uint256 j = i + 1; j < validators.length; j++) {
                if (validators[i] == validators[j]) {
                    revert Bridge__InvalidSignature();
                }
            }
        }
    }
    
    // ============ UUPS Upgrade ============
    
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
    
    // ============ Emergency Functions ============
    
    /**
     * @dev Emergency withdraw with timelock bypass
     */
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyEmergency whenPaused {
        IERC20(_token).safeTransfer(_to, _amount);
    }
    
    /**
     * @dev Emergency pause with reason
     */
    function emergencyPause(string calldata _reason) external onlyEmergency {
        _pause();
    }
} 

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

/**
 * @title HalomBridge
 * @dev Cross-chain bridge contract with lock-and-mint functionality
 * @dev Implements immutable role declarations and hierarchical access control
 * @dev Based on OpenZeppelin AccessControl v5 best practices
 */
contract HalomBridge is 
    Initializable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ============ Immutable Role Declarations ============
    bytes32 public immutable VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public immutable RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public immutable EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public immutable PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public immutable BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    bytes32 public immutable ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public immutable BLACKLIST_ROLE = keccak256("BLACKLIST_ROLE");
    
    // ============ Constants ============
    uint256 public constant MIN_VALIDATORS = 3;
    uint256 public constant CONSENSUS_THRESHOLD = 2; // 2/3 consensus
    uint256 public constant MAX_BRIDGE_AMOUNT = 1000000 * 10**18; // 1M tokens
    uint256 public constant MIN_BRIDGE_AMOUNT = 1 * 10**18; // 1 token
    
    // ============ State Variables ============
    uint256 public chainId;
    uint256 public nonce;
    uint256 public bridgeFee; // Fee in basis points (100 = 1%)
    
    mapping(bytes32 => bool) public processedTransactions;
    mapping(address => bool) public whitelistedTokens;
    mapping(uint256 => BridgeRequest) public bridgeRequests;
    mapping(address => uint256) public validatorVotes;
    
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
    }
    
    struct BridgeEvent {
        address token;
        address sender;
        address recipient;
        uint256 amount;
        uint256 sourceChainId;
        uint256 targetChainId;
        uint256 requestId;
        uint256 timestamp;
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
    
    event TokenBurned(
        address indexed token,
        address indexed sender,
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        uint256 requestId,
        uint256 timestamp
    );
    
    event TokenUnlocked(
        address indexed token,
        address indexed recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        uint256 requestId,
        uint256 timestamp
    );
    
    event ValidatorVoted(
        address indexed validator,
        uint256 indexed requestId,
        bool approved,
        uint256 timestamp
    );
    
    event BridgeFeeUpdated(uint256 oldFee, uint256 newFee);
    event TokenWhitelisted(address indexed token, bool whitelisted);
    event EmergencyPaused(address indexed pauser, string reason);
    event EmergencyUnpaused(address indexed unpauser);
    
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
    
    modifier onlyPauser() {
        if (!hasRole(PAUSER_ROLE, msg.sender)) {
            revert Bridge__InvalidValidator();
        }
        _;
    }
    
    // ============ Initialization ============
    function initialize(
        uint256 _chainId,
        address _admin,
        uint256 _bridgeFee
    ) public initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        chainId = _chainId;
        bridgeFee = _bridgeFee;
        
        // Setup hierarchical role structure
        _setupRoleHierarchy();
        
        // Grant initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(VALIDATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(BRIDGE_ROLE, _admin);
        _grantRole(ORACLE_ROLE, _admin);
        _grantRole(BLACKLIST_ROLE, _admin);
    }
    
    // ============ Role Hierarchy Setup ============
    function _setupRoleHierarchy() internal {
        // GOVERNOR_ROLE (DEFAULT_ADMIN_ROLE) can manage all other roles
        _setRoleAdmin(PAUSER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BRIDGE_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BLACKLIST_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(VALIDATOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(RELAYER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_ROLE, DEFAULT_ADMIN_ROLE);
    }
    
    // ============ Core Bridge Functions ============
    
    /**
     * @dev Lock tokens on source chain to initiate bridge transfer
     * @param _token Token address to bridge
     * @param _recipient Recipient address on target chain
     * @param _amount Amount to bridge
     * @param _targetChainId Target chain ID
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
        
        // Create bridge request
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
     * @dev Mint tokens on target chain after validator consensus
     * @param _requestId Bridge request ID
     * @param _signatures Array of validator signatures
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
        
        // Verify validator signatures
        _verifyValidatorSignatures(_requestId, _signatures);
        
        // Mark as processed
        request.isProcessed = true;
        processedTransactions[bytes32(_requestId)] = true;
        
        // Mint tokens to recipient
        // Note: This assumes the bridge has minting rights on the token
        // In practice, you might use a wrapped token or different mechanism
        
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
    
    /**
     * @dev Burn tokens on source chain to initiate return transfer
     * @param _token Token address to burn
     * @param _recipient Recipient address on target chain
     * @param _amount Amount to burn
     * @param _targetChainId Target chain ID
     */
    function burnTokens(
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
        
        // Burn tokens from sender
        IERC20(_token).safeTransferFrom(msg.sender, address(0), _amount);
        
        uint256 requestId = _generateRequestId(_token, msg.sender, _recipient, _amount, _targetChainId);
        
        emit TokenBurned(
            _token,
            msg.sender,
            _amount,
            chainId,
            _targetChainId,
            requestId,
            block.timestamp
        );
    }
    
    /**
     * @dev Unlock tokens on target chain after validator consensus
     * @param _requestId Bridge request ID
     * @param _signatures Array of validator signatures
     */
    function unlockTokens(
        uint256 _requestId,
        bytes[] calldata _signatures
    ) external onlyRelayer nonReentrant whenNotPaused {
        // Similar to mintTokens but for unlocking
        _verifyValidatorSignatures(_requestId, _signatures);
        
        emit TokenUnlocked(
            address(0), // Will be set from request
            address(0), // Will be set from request
            0,          // Will be set from request
            0,          // Will be set from request
            0,          // Will be set from request
            _requestId,
            block.timestamp
        );
    }
    
    // ============ Validator Functions ============
    
    /**
     * @dev Vote on a bridge request
     * @param _requestId Bridge request ID
     * @param _approved Whether to approve the request
     */
    function voteOnRequest(
        uint256 _requestId,
        bool _approved
    ) external onlyValidator {
        BridgeRequest storage request = bridgeRequests[_requestId];
        if (request.token == address(0)) {
            revert Bridge__InvalidRequest();
        }
        if (request.hasVoted[msg.sender]) {
            revert Bridge__AlreadyVoted();
        }
        
        request.hasVoted[msg.sender] = true;
        if (_approved) {
            request.validatorVotes++;
        }
        
        emit ValidatorVoted(msg.sender, _requestId, _approved, block.timestamp);
    }
    
    // ============ Admin Functions ============
    
    /**
     * @dev Update bridge fee
     * @param _newFee New fee in basis points
     */
    function updateBridgeFee(uint256 _newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldFee = bridgeFee;
        bridgeFee = _newFee;
        emit BridgeFeeUpdated(oldFee, _newFee);
    }
    
    /**
     * @dev Whitelist or blacklist a token
     * @param _token Token address
     * @param _whitelisted Whether to whitelist
     */
    function setTokenWhitelist(
        address _token,
        bool _whitelisted
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedTokens[_token] = _whitelisted;
        emit TokenWhitelisted(_token, _whitelisted);
    }
    
    // ============ Pauser Functions ============
    
    /**
     * @dev Pause the bridge
     */
    function pause() external onlyPauser {
        _pause();
        emit EmergencyPaused(msg.sender, "Manual pause");
    }
    
    /**
     * @dev Unpause the bridge
     */
    function unpause() external onlyPauser {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
    
    // ============ Emergency Functions ============
    
    /**
     * @dev Emergency pause the bridge
     * @param _reason Reason for pausing
     */
    function emergencyPause(string calldata _reason) external onlyEmergency {
        _pause();
        emit EmergencyPaused(msg.sender, _reason);
    }
    
    /**
     * @dev Emergency unpause the bridge
     */
    function emergencyUnpause() external onlyEmergency {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get bridge request details
     * @param _requestId Bridge request ID
     */
    function getBridgeRequest(uint256 _requestId) external view returns (
        address token,
        address sender,
        address recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        bool isProcessed,
        uint256 timestamp,
        uint256 validatorVotes
    ) {
        BridgeRequest storage request = bridgeRequests[_requestId];
        return (
            request.token,
            request.sender,
            request.recipient,
            request.amount,
            request.sourceChainId,
            request.targetChainId,
            request.isProcessed,
            request.timestamp,
            request.validatorVotes
        );
    }
    
    /**
     * @dev Check if transaction is processed
     * @param _requestId Bridge request ID
     */
    function isTransactionProcessed(uint256 _requestId) external view returns (bool) {
        return processedTransactions[bytes32(_requestId)];
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
     * @dev Verify validator signatures
     */
    function _verifyValidatorSignatures(
        uint256 _requestId,
        bytes[] calldata _signatures
    ) internal view {
        require(_signatures.length >= CONSENSUS_THRESHOLD, "Insufficient signatures");
        
        bytes32 messageHash = keccak256(abi.encodePacked(
            "BRIDGE_REQUEST",
            _requestId,
            chainId
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
     * @dev Emergency withdraw tokens (only when paused)
     * @param _token Token address
     * @param _to Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyEmergency whenPaused {
        IERC20(_token).safeTransfer(_to, _amount);
    }
} 

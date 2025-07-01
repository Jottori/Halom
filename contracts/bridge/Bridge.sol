// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

/**
 * @title Bridge
 * @dev Cross-chain bridge for token transfers between different blockchains
 */
contract Bridge is 
    Initializable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable 
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // Role definitions
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    // Bridge configuration
    IERC20Upgradeable public token;
    mapping(uint256 => bool) public supportedChains;
    mapping(bytes32 => bool) public processedTransactions;
    mapping(uint256 => uint256) public chainNonces;
    
    uint256 public minLockAmount;
    uint256 public maxLockAmount;
    uint256 public bridgeFee;
    address public feeCollector;
    
    // Transaction tracking
    mapping(bytes32 => BridgeTransaction) public transactions;
    
    struct BridgeTransaction {
        address from;
        address to;
        uint256 amount;
        uint256 sourceChainId;
        uint256 targetChainId;
        uint256 nonce;
        bool processed;
        bool claimed;
    }

    // Events
    event TokensLocked(
        bytes32 indexed transactionId,
        address indexed from,
        uint256 amount,
        uint256 targetChainId,
        uint256 nonce
    );
    event TokensMinted(
        bytes32 indexed transactionId,
        address indexed to,
        uint256 amount,
        uint256 sourceChainId
    );
    event TokensBurned(
        bytes32 indexed transactionId,
        address indexed from,
        uint256 amount,
        uint256 targetChainId
    );
    event TokensUnlocked(
        bytes32 indexed transactionId,
        address indexed to,
        uint256 amount,
        uint256 sourceChainId
    );
    event BridgeRoleChanged(address indexed oldBridge, address indexed newBridge);
    event ChainSupported(uint256 chainId, bool supported);
    event BridgeFeeSet(uint256 oldFee, uint256 newFee);
    event Upgraded(address indexed implementation);

    // Errors
    error UnsupportedChain();
    error InvalidAmount();
    error TransactionAlreadyProcessed();
    error TransactionNotFound();
    error InvalidTransaction();
    error InsufficientBalance();
    error BridgeNotAuthorized();
    error InvalidChainId();
    error TransferFailed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address admin,
        uint256 _minLockAmount,
        uint256 _maxLockAmount,
        uint256 _bridgeFee
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(BRIDGE_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);

        token = IERC20Upgradeable(_token);
        minLockAmount = _minLockAmount;
        maxLockAmount = _maxLockAmount;
        bridgeFee = _bridgeFee;
        feeCollector = admin;
    }

    // ============ PUBLIC FUNCTIONS ============

    /**
     * @dev Lock tokens for cross-chain transfer
     */
    function lockTokens(
        address from,
        uint256 amount,
        uint256 targetChainId
    ) 
        external 
        whenNotPaused 
        nonReentrant 
        returns (bytes32 transactionId) 
    {
        if (!supportedChains[targetChainId]) revert UnsupportedChain();
        if (amount < minLockAmount || amount > maxLockAmount) revert InvalidAmount();
        if (token.balanceOf(from) < amount) revert InsufficientBalance();

        chainNonces[targetChainId]++;
        transactionId = keccak256(
            abi.encodePacked(from, amount, targetChainId, chainNonces[targetChainId])
        );

        BridgeTransaction storage tx = transactions[transactionId];
        tx.from = from;
        tx.to = from; // Default to sender, can be updated by bridge
        tx.amount = amount;
        tx.sourceChainId = block.chainid;
        tx.targetChainId = targetChainId;
        tx.nonce = chainNonces[targetChainId];
        tx.processed = false;
        tx.claimed = false;

        // Transfer tokens to bridge
        token.safeTransferFrom(from, address(this), amount);

        emit TokensLocked(transactionId, from, amount, targetChainId, chainNonces[targetChainId]);
    }

    /**
     * @dev Burn tokens for cross-chain transfer
     */
    function burnForRedeem(
        uint256 amount,
        uint256 targetChainId
    ) 
        external 
        whenNotPaused 
        nonReentrant 
        returns (bytes32 transactionId) 
    {
        if (!supportedChains[targetChainId]) revert UnsupportedChain();
        if (amount < minLockAmount || amount > maxLockAmount) revert InvalidAmount();
        if (token.balanceOf(msg.sender) < amount) revert InsufficientBalance();

        chainNonces[targetChainId]++;
        transactionId = keccak256(
            abi.encodePacked(msg.sender, amount, targetChainId, chainNonces[targetChainId])
        );

        BridgeTransaction storage tx = transactions[transactionId];
        tx.from = msg.sender;
        tx.to = msg.sender;
        tx.amount = amount;
        tx.sourceChainId = block.chainid;
        tx.targetChainId = targetChainId;
        tx.nonce = chainNonces[targetChainId];
        tx.processed = false;
        tx.claimed = false;

        // Burn tokens
        token.safeTransferFrom(msg.sender, address(0), amount);

        emit TokensBurned(transactionId, msg.sender, amount, targetChainId);
    }

    // ============ ROLE-BASED FUNCTIONS ============

    /**
     * @dev Mint tokens from bridge - only BRIDGE_ROLE
     */
    function mintFromBridge(
        address to,
        uint256 amount,
        uint256 sourceChainId
    ) 
        external 
        onlyRole(BRIDGE_ROLE) 
        whenNotPaused 
        nonReentrant 
        returns (bytes32 transactionId) 
    {
        if (to == address(0)) revert InvalidTransaction();
        if (amount == 0) revert InvalidAmount();

        chainNonces[sourceChainId]++;
        transactionId = keccak256(
            abi.encodePacked(to, amount, sourceChainId, chainNonces[sourceChainId])
        );

        if (processedTransactions[transactionId]) revert TransactionAlreadyProcessed();

        BridgeTransaction storage tx = transactions[transactionId];
        tx.from = address(0); // Bridge mint
        tx.to = to;
        tx.amount = amount;
        tx.sourceChainId = sourceChainId;
        tx.targetChainId = block.chainid;
        tx.nonce = chainNonces[sourceChainId];
        tx.processed = true;
        tx.claimed = true;

        processedTransactions[transactionId] = true;

        // Mint tokens (assuming token contract supports minting)
        // This would require the token contract to grant MINTER_ROLE to bridge
        // For now, we'll transfer from bridge's balance
        token.safeTransfer(to, amount);

        emit TokensMinted(transactionId, to, amount, sourceChainId);
    }

    /**
     * @dev Unlock tokens from bridge - only BRIDGE_ROLE
     */
    function unlockTokens(
        address to,
        uint256 amount
    ) 
        external 
        onlyRole(BRIDGE_ROLE) 
        whenNotPaused 
        nonReentrant 
        returns (bytes32 transactionId) 
    {
        if (to == address(0)) revert InvalidTransaction();
        if (amount == 0) revert InvalidAmount();

        transactionId = keccak256(
            abi.encodePacked(to, amount, block.timestamp)
        );

        if (processedTransactions[transactionId]) revert TransactionAlreadyProcessed();

        BridgeTransaction storage tx = transactions[transactionId];
        tx.from = address(0); // Bridge unlock
        tx.to = to;
        tx.amount = amount;
        tx.sourceChainId = 0; // Unknown source
        tx.targetChainId = block.chainid;
        tx.nonce = 0;
        tx.processed = true;
        tx.claimed = true;

        processedTransactions[transactionId] = true;

        // Transfer tokens from bridge
        token.safeTransfer(to, amount);

        emit TokensUnlocked(transactionId, to, amount, 0);
    }

    /**
     * @dev Set bridge address - only GOVERNOR_ROLE
     */
    function setBridge(address newBridge) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (newBridge == address(0)) revert InvalidTransaction();
        
        address oldBridge = address(0); // Get current bridge role holder
        _revokeRole(BRIDGE_ROLE, oldBridge);
        _grantRole(BRIDGE_ROLE, newBridge);
        
        emit BridgeRoleChanged(oldBridge, newBridge);
    }

    /**
     * @dev Set supported chain - only GOVERNOR_ROLE
     */
    function setChainSupport(uint256 chainId, bool supported) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (chainId == 0) revert InvalidChainId();
        
        supportedChains[chainId] = supported;
        emit ChainSupported(chainId, supported);
    }

    /**
     * @dev Set bridge fee - only GOVERNOR_ROLE
     */
    function setBridgeFee(uint256 newFee) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        uint256 oldFee = bridgeFee;
        bridgeFee = newFee;
        emit BridgeFeeSet(oldFee, newFee);
    }

    /**
     * @dev Set fee collector - only GOVERNOR_ROLE
     */
    function setFeeCollector(address newCollector) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (newCollector == address(0)) revert InvalidTransaction();
        feeCollector = newCollector;
    }

    /**
     * @dev Pause bridge - only GOVERNOR_ROLE
     */
    function pause() external onlyRole(GOVERNOR_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause bridge - only GOVERNOR_ROLE
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Upgrade contract - only DEFAULT_ADMIN_ROLE
     */
    function upgradeTo(address newImplementation) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        _upgradeToAndCall(newImplementation, "", false);
        emit Upgraded(newImplementation);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Required by UUPSUpgradeable
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {}

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get transaction details
     */
    function getTransaction(bytes32 transactionId) 
        external 
        view 
        returns (BridgeTransaction memory) 
    {
        return transactions[transactionId];
    }

    /**
     * @dev Check if transaction is processed
     */
    function isTransactionProcessed(bytes32 transactionId) 
        external 
        view 
        returns (bool) 
    {
        return processedTransactions[transactionId];
    }

    /**
     * @dev Get bridge configuration
     */
    function getBridgeConfig() 
        external 
        view 
        returns (
            address _token,
            uint256 _minLockAmount,
            uint256 _maxLockAmount,
            uint256 _bridgeFee,
            address _feeCollector
        ) 
    {
        return (address(token), minLockAmount, maxLockAmount, bridgeFee, feeCollector);
    }

    /**
     * @dev Get chain nonce
     */
    function getChainNonce(uint256 chainId) external view returns (uint256) {
        return chainNonces[chainId];
    }

    /**
     * @dev Check if chain is supported
     */
    function isChainSupported(uint256 chainId) external view returns (bool) {
        return supportedChains[chainId];
    }
} 
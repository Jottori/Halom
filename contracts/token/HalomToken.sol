// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "../utils/AntiWhale.sol";
import "../utils/FeeOnTransfer.sol";
import "../utils/Blacklist.sol";

/**
 * @title HalomToken
 * @dev Main ERC20 token with advanced features including anti-whale protection, 
 * fee management, blacklist functionality, upgradeable architecture, and zkSync compatibility.
 */
contract HalomToken is 
    Initializable, 
    ERC20Upgradeable, 
    PausableUpgradeable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable
{
    using AntiWhale for AntiWhale.AntiWhaleData;
    using FeeOnTransfer for FeeOnTransfer.FeeData;
    using Blacklist for Blacklist.BlacklistData;
    using ECDSAUpgradeable for bytes32;

    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant BLACKLIST_ROLE = keccak256("BLACKLIST_ROLE");
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    // Anti-whale and fee data
    AntiWhale.AntiWhaleData public antiWhaleData;
    FeeOnTransfer.FeeData public feeData;
    Blacklist.BlacklistData public blacklistData;

    // EIP-2612 permit support
    mapping(address => uint256) public nonces;
    bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // zkSync paymaster support
    mapping(address => mapping(address => uint256)) public paymasterDeposits; // user => paymaster => amount
    mapping(address => uint256) public totalPaymasterDeposits; // paymaster => total amount

    // zkSync full exit support
    struct ExitInfo {
        bool requested;
        uint256 requestTime;
        uint32 accountId;
        address token;
        uint256 amount;
        bool completed;
        uint256 completionTime;
    }
    
    mapping(uint32 => mapping(address => ExitInfo)) public exitRequests; // accountId => token => exitInfo
    mapping(uint32 => uint256) public exitRequestCount; // accountId => count

    // Events
    event FeeParamsChanged(uint256 bps, uint256 maxFee);
    event AntiWhaleParamsChanged(uint256 maxTx, uint256 maxWallet, uint256 cooldown);
    event Blacklisted(address indexed account);
    event UnBlacklisted(address indexed account);
    event Upgraded(address indexed implementation);
    event PaymasterDeposited(address indexed user, address indexed paymaster, uint256 amount);
    event PaymasterWithdrawn(address indexed user, address indexed paymaster, uint256 amount);
    event FullExitRequested(uint32 indexed accountId, address indexed token, uint256 amount);
    event FullExitCompleted(uint32 indexed accountId, address indexed token, uint256 amount);

    // Errors
    error TransferPaused();
    error InsufficientBalance();
    error TransferAmountExceedsLimit();
    error WalletBalanceExceedsLimit();
    error CooldownNotExpired();
    error BlacklistedAddress();
    error InvalidFeeParams();
    error InvalidAntiWhaleParams();
    error PermitExpired();
    error InvalidSignature();
    error InvalidPaymaster();
    error InsufficientPaymasterDeposit();
    error ExitAlreadyRequested();
    error ExitNotRequested();
    error InvalidAccountId();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name,
        string memory symbol,
        address admin
    ) public initializer {
        __ERC20_init(name, symbol);
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __EIP712_init(name, "1");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(BLACKLIST_ROLE, admin);
        _grantRole(BRIDGE_ROLE, admin);

        // Initialize with default values
        antiWhaleData.setAntiWhaleParams(
            1000 * 10**decimals(), // 1000 tokens max tx
            10000 * 10**decimals(), // 10000 tokens max wallet
            300 // 5 minutes cooldown
        );

        feeData.setFeeParams(100, 500, admin); // 1% fee, 5% max, admin collector
    }

    // ============ PUBLIC FUNCTIONS ============

    /**
     * @dev Transfer tokens with all modifiers applied
     */
    function transfer(address to, uint256 amount) 
        public 
        override 
        whenNotPaused 
        nonReentrant 
        returns (bool) 
    {
        _validateTransfer(msg.sender, to, amount);
        _applyFeeAndTransfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @dev TransferFrom with all modifiers applied
     */
    function transferFrom(address from, address to, uint256 amount) 
        public 
        override 
        whenNotPaused 
        nonReentrant 
        returns (bool) 
    {
        _validateTransfer(from, to, amount);
        _applyFeeAndTransferFrom(from, to, amount);
        return true;
    }

    /**
     * @dev Approve spender to spend tokens
     */
    function approve(address spender, uint256 amount) 
        public 
        override 
        returns (bool) 
    {
        return super.approve(spender, amount);
    }

    // ============ EIP-2612 PERMIT FUNCTIONS ============

    /**
     * @dev EIP-2612 permit function for gasless approvals
     * @param owner Token owner
     * @param spender Spender address
     * @param value Amount to approve
     * @param deadline Deadline for the permit
     * @param v Signature component
     * @param r Signature component
     * @param s Signature component
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public whenNotPaused {
        if (block.timestamp > deadline) revert PermitExpired();
        if (owner == address(0)) revert("Invalid owner");

        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(v, r, s);

        if (signer != owner) revert InvalidSignature();

        _approve(owner, spender, value);
    }

    /**
     * @dev Get current nonce for an address
     * @param owner Address to get nonce for
     * @return Current nonce
     */
    function nonces(address owner) public view returns (uint256) {
        return nonces[owner];
    }

    /**
     * @dev Get EIP-712 domain separator
     * @return Domain separator
     */
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============ ZKSYNC PAYMASTER FUNCTIONS ============

    /**
     * @dev Deposit tokens to paymaster for gas fee payments
     * @param paymaster Paymaster contract address
     * @param amount Amount to deposit
     */
    function depositToPaymaster(address paymaster, uint256 amount) 
        public 
        whenNotPaused 
        nonReentrant 
    {
        if (paymaster == address(0)) revert InvalidPaymaster();
        if (amount == 0) revert("Invalid amount");
        if (balanceOf(msg.sender) < amount) revert InsufficientBalance();

        _transfer(msg.sender, address(this), amount);
        paymasterDeposits[msg.sender][paymaster] += amount;
        totalPaymasterDeposits[paymaster] += amount;

        emit PaymasterDeposited(msg.sender, paymaster, amount);
    }

    /**
     * @dev Withdraw tokens from paymaster
     * @param paymaster Paymaster contract address
     * @param amount Amount to withdraw
     */
    function withdrawFromPaymaster(address paymaster, uint256 amount) 
        public 
        whenNotPaused 
        nonReentrant 
    {
        if (paymaster == address(0)) revert InvalidPaymaster();
        if (amount == 0) revert("Invalid amount");
        if (paymasterDeposits[msg.sender][paymaster] < amount) revert InsufficientPaymasterDeposit();

        paymasterDeposits[msg.sender][paymaster] -= amount;
        totalPaymasterDeposits[paymaster] -= amount;
        _transfer(address(this), msg.sender, amount);

        emit PaymasterWithdrawn(msg.sender, paymaster, amount);
    }

    /**
     * @dev Get paymaster deposit for user
     * @param user User address
     * @param paymaster Paymaster address
     * @return Deposit amount
     */
    function getPaymasterDeposit(address user, address paymaster) public view returns (uint256) {
        return paymasterDeposits[user][paymaster];
    }

    /**
     * @dev Get total paymaster deposits
     * @param paymaster Paymaster address
     * @return Total deposits
     */
    function getTotalPaymasterDeposits(address paymaster) public view returns (uint256) {
        return totalPaymasterDeposits[paymaster];
    }

    // ============ ZKSYNC FULL EXIT FUNCTIONS ============

    /**
     * @dev Request full exit from zkSync L2 to L1
     * @param accountId zkSync account ID
     * @param token Token address (this contract)
     */
    function requestFullExit(uint32 accountId, address token) 
        public 
        whenNotPaused 
        nonReentrant 
    {
        if (accountId == 0) revert InvalidAccountId();
        if (token != address(this)) revert("Invalid token");
        if (exitRequests[accountId][token].requested) revert ExitAlreadyRequested();

        uint256 balance = balanceOf(msg.sender);
        if (balance == 0) revert InsufficientBalance();

        ExitInfo memory exitInfo = ExitInfo({
            requested: true,
            requestTime: block.timestamp,
            accountId: accountId,
            token: token,
            amount: balance,
            completed: false,
            completionTime: 0
        });

        exitRequests[accountId][token] = exitInfo;
        exitRequestCount[accountId]++;

        // Burn tokens for exit
        _burn(msg.sender, balance);

        emit FullExitRequested(accountId, token, balance);
    }

    /**
     * @dev Get full exit receipt
     * @param accountId zkSync account ID
     * @param token Token address
     * @return Exit information
     */
    function getFullExitReceipt(uint32 accountId, address token) 
        public 
        view 
        returns (ExitInfo memory) 
    {
        return exitRequests[accountId][token];
    }

    /**
     * @dev Complete full exit (called by zkSync system)
     * @param accountId zkSync account ID
     * @param token Token address
     * @param recipient Recipient address
     * @param amount Amount to mint
     */
    function completeFullExit(
        uint32 accountId, 
        address token, 
        address recipient, 
        uint256 amount
    ) 
        public 
        onlyRole(GOVERNOR_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        if (!exitRequests[accountId][token].requested) revert ExitNotRequested();
        if (exitRequests[accountId][token].completed) revert("Exit already completed");

        exitRequests[accountId][token].completed = true;
        exitRequests[accountId][token].completionTime = block.timestamp;

        // Mint tokens to recipient
        _mint(recipient, amount);

        emit FullExitCompleted(accountId, token, amount);
    }

    /**
     * @dev Get exit request count for account
     * @param accountId zkSync account ID
     * @return Request count
     */
    function getExitRequestCount(uint32 accountId) public view returns (uint256) {
        return exitRequestCount[accountId];
    }

    // ============ ZKSYNC CREATE2 HELPER ============

    /**
     * @dev Compute CREATE2 address for zkSync
     * @param sender Sender address
     * @param salt Salt for address computation
     * @param bytecodeHash Bytecode hash
     * @param constructorInputHash Constructor input hash
     * @return Computed address
     */
    function computeCreate2Address(
        address sender,
        bytes32 salt,
        bytes32 bytecodeHash,
        bytes32 constructorInputHash
    ) public pure returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                sender,
                salt,
                bytecodeHash,
                constructorInputHash
            )
        );
        return address(uint160(uint256(hash)));
    }

    // ============ ROLE-BASED FUNCTIONS ============

    /**
     * @dev Mint new tokens - only MINTER_ROLE
     */
    function mint(address to, uint256 amount) 
        external 
        onlyRole(MINTER_ROLE) 
        whenNotPaused 
    {
        if (to == address(0)) revert("Invalid recipient");
        if (amount == 0) revert("Invalid amount");
        
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens - only DEFAULT_ADMIN_ROLE
     */
    function burn(uint256 amount) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
        whenNotPaused 
    {
        if (amount == 0) revert("Invalid amount");
        if (balanceOf(msg.sender) < amount) revert InsufficientBalance();
        
        _burn(msg.sender, amount);
    }

    /**
     * @dev Pause all transfers - only PAUSER_ROLE
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause all transfers - only PAUSER_ROLE
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Set fee parameters - only GOVERNOR_ROLE
     */
    function setFeeParams(uint256 bps, uint256 maxFee) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        (,, address collector) = feeData.getFeeParams();
        feeData.setFeeParams(bps, maxFee, collector);
    }

    /**
     * @dev Set anti-whale parameters - only GOVERNOR_ROLE
     */
    function setAntiWhaleParams(uint256 maxTx, uint256 maxWallet, uint256 cooldown) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        antiWhaleData.setAntiWhaleParams(maxTx, maxWallet, cooldown);
    }

    /**
     * @dev Blacklist address - only BLACKLIST_ROLE
     */
    function blacklist(address account) 
        external 
        onlyRole(BLACKLIST_ROLE) 
    {
        blacklistData.blacklist(account, "Blacklisted by admin");
    }

    /**
     * @dev Unblacklist address - only BLACKLIST_ROLE
     */
    function unBlacklist(address account) 
        external 
        onlyRole(BLACKLIST_ROLE) 
    {
        blacklistData.unBlacklist(account);
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

    // ============ ZKSYNC PAYMASTER INTERFACE ============

    /**
     * @dev zkSync Era paymaster interface: validate and pay for paymaster transaction
     * @param from Sender address
     * @param to Recipient address
     * @param value ETH value sent
     * @param gas Gas limit
     * @param gasPrice Gas price
     * @param data Calldata
     * @return context Context for postTransaction
     * @return validationResult Validation result (0 = success)
     */
    function validateAndPayForPaymasterTransaction(
        address from,
        address to,
        uint256 value,
        uint256 gas,
        uint256 gasPrice,
        bytes calldata data
    ) external payable returns (bytes memory context, uint256 validationResult) {
        // Only allow zkSync system or paymaster role to call
        require(hasRole(BRIDGE_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Unauthorized");
        // Calculate required fee (gas * gasPrice)
        uint256 requiredFee = gas * gasPrice;
        // Check paymaster deposit
        require(paymasterDeposits[from][address(this)] >= requiredFee, "Insufficient paymaster deposit");
        // Deduct fee
        paymasterDeposits[from][address(this)] -= requiredFee;
        totalPaymasterDeposits[address(this)] -= requiredFee;
        // Context: encode who paid and how much
        context = abi.encode(from, requiredFee);
        validationResult = 0; // 0 = success
        emit PaymasterWithdrawn(from, address(this), requiredFee);
    }

    /**
     * @dev zkSync Era paymaster interface: post-transaction hook
     * @param context Context from validateAndPayForPaymasterTransaction
     * @param success Transaction success
     * @param actualGas Actual gas used
     */
    function postTransaction(
        bytes calldata context,
        bool success,
        uint256 actualGas
    ) external payable {
        // Only allow zkSync system or paymaster role to call
        require(hasRole(BRIDGE_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Unauthorized");
        // Decode context
        (address from, uint256 fee) = abi.decode(context, (address, uint256));
        // Optionally refund if tx failed (not required in minimal implementation)
        // emit event for audit
        emit PaymasterWithdrawn(from, address(this), fee);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Validate transfer with anti-whale and blacklist checks
     */
    function _validateTransfer(address from, address to, uint256 amount) internal view {
        if (blacklistData.isBlacklisted(from) || blacklistData.isBlacklisted(to)) {
            revert BlacklistedAddress();
        }

        antiWhaleData.antiWhale(from, to, amount, balanceOf(to));
    }

    /**
     * @dev Apply fee and transfer
     */
    function _applyFeeAndTransfer(address from, address to, uint256 amount) internal {
        uint256 fee = feeData.calculateFee(amount);
        uint256 transferAmount = amount - fee;

        _transfer(from, to, transferAmount);
        
        if (fee > 0) {
            (,, address collector) = feeData.getFeeParams();
            _transfer(from, collector, fee);
        }
    }

    /**
     * @dev Apply fee and transferFrom
     */
    function _applyFeeAndTransferFrom(address from, address to, uint256 amount) internal {
        uint256 fee = feeData.calculateFee(amount);
        uint256 transferAmount = amount - fee;

        _transfer(from, to, transferAmount);
        
        if (fee > 0) {
            (,, address collector) = feeData.getFeeParams();
            _transfer(from, collector, fee);
        }
    }

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
     * @dev Get fee parameters
     */
    function getFeeParams() external view returns (uint256 bps, uint256 maxFee, address collector) {
        return feeData.getFeeParams();
    }

    /**
     * @dev Get anti-whale parameters
     */
    function getAntiWhaleParams() external view returns (uint256 maxTx, uint256 maxWallet, uint256 cooldown) {
        return antiWhaleData.getAntiWhaleParams();
    }

    /**
     * @dev Check if address is blacklisted
     */
    function isBlacklisted(address account) external view returns (bool) {
        return blacklistData.isBlacklisted(account);
    }

    /**
     * @dev Get blacklist reason
     */
    function getBlacklistReason(address account) external view returns (string memory) {
        (,, string memory reason,,) = blacklistData.getBlacklistInfo(account);
        return reason;
    }
} 
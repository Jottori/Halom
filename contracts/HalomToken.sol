// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./libraries/GovernanceMath.sol";
import "./libraries/GovernanceErrors.sol";

/**
 * @title HalomToken
 * @dev Rebase-aware ERC20 token with governance capabilities
 * Features: Anti-whale protection, rebase logic, governance voting, emergency controls
 */
contract HalomToken is ERC20, ERC20Burnable, ERC20Permit, ERC20Votes, AccessControl, ReentrancyGuard, Pausable {
    using GovernanceMath for uint256;
    
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REBASER_ROLE = keccak256("REBASER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant REBASE_CALLER = keccak256("REBASE_CALLER");
    bytes32 public constant STAKING_CONTRACT_ROLE = keccak256("STAKING_CONTRACT_ROLE");
    
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 1e18; // 100M tokens
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1B tokens (increased for testing)
    uint256 public constant MIN_REBASE_INTERVAL = 3600; // 1 hour minimum between rebases
    uint256 public constant MAX_REBASE_PERCENT = 500; // 5% max rebase percent
    uint256 public constant MAX_REBASE_DELTA = 1000; // 10% max rebase delta
    
    uint256 public lastRebaseTime;
    uint256 public rebaseIndex;
    uint256 public totalRebased;
    uint256 public maxRebaseDelta;
    
    address public halomStakingAddress;
    uint256 public rewardRate;
    
    // Anti-whale protection
    uint256 public maxTransferAmount;
    uint256 public maxWalletAmount;
    mapping(address => bool) public isExcludedFromLimits;
    
    mapping(address => uint256) public rebaseBalances;
    mapping(address => uint256) public lastRebaseIndex;
    
    event RebaseExecuted(uint256 newIndex, uint256 totalSupply, uint256 timestamp);
    event RebaseBalanceUpdated(address indexed account, uint256 oldBalance, uint256 newBalance);
    event EmergencyPaused(address indexed pauser);
    event EmergencyUnpaused(address indexed unpauser);
    event StakingContractSet(address indexed stakingAddress);
    event RewardRateSet(uint256 newRate);
    event AntiWhaleLimitsSet(uint256 maxTransfer, uint256 maxWallet);
    event ExcludedFromLimitsSet(address indexed account, bool excluded);
    
    error InvalidAmount();
    error ExceedsMaxSupply();
    error RebaseTooFrequent();
    error InvalidRebasePercent();
    error NoRebaseNeeded();
    error TransferPaused();
    error Unauthorized();
    error ContractPaused();
    error RebaseDeltaTooHigh();
    error InsufficientBalance();
    error TransferAmountExceedsLimit();
    error WalletBalanceExceedsLimit();
    
    constructor(address _initialAdmin, address _rebaseCaller) ERC20("Halom", "HALOM") ERC20Permit("Halom") {
        _grantRole(DEFAULT_ADMIN_ROLE, _initialAdmin);
        _grantRole(MINTER_ROLE, _initialAdmin);
        _grantRole(BURNER_ROLE, _initialAdmin);
        _grantRole(REBASER_ROLE, _initialAdmin);
        _grantRole(EMERGENCY_ROLE, _initialAdmin);
        _grantRole(REBASE_CALLER, _rebaseCaller);
        
        rebaseIndex = 1e18;
        maxRebaseDelta = MAX_REBASE_DELTA;
        maxTransferAmount = INITIAL_SUPPLY / 100; // 1% of initial supply
        maxWalletAmount = INITIAL_SUPPLY / 10; // 10% of initial supply
        
        // Exclude initial admin from limits
        isExcludedFromLimits[_initialAdmin] = true;
        
        _mint(_initialAdmin, INITIAL_SUPPLY);
    }
    
    modifier onlyMinter() {
        if (!hasRole(MINTER_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyBurner() {
        if (!hasRole(BURNER_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyRebaser() {
        if (!hasRole(REBASER_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier onlyRebaseCaller() {
        if (!hasRole(REBASE_CALLER, msg.sender)) revert Unauthorized();
        _;
    }
    
    modifier whenNotPausedToken() {
        if (paused()) revert ContractPaused();
        _;
    }
    
    function mint(address to, uint256 amount) external onlyMinter whenNotPausedToken {
        if (amount == 0) revert InvalidAmount();
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        
        _mint(to, amount);
        _updateRebaseBalance(to);
    }
    
    function burnFrom(address account, uint256 amount) public override onlyBurner whenNotPausedToken {
        if (amount == 0) revert InvalidAmount();
        
        super.burnFrom(account, amount);
        _updateRebaseBalance(account);
    }
    
    function rebase(int256 supplyDelta) external onlyRebaseCaller whenNotPausedToken nonReentrant {
        if (block.timestamp < lastRebaseTime + MIN_REBASE_INTERVAL) revert RebaseTooFrequent();
        uint256 currentSupply = totalSupply();
        uint256 maxDelta = (currentSupply * maxRebaseDelta) / 10000;
        if (supplyDelta > 0) {
            if (uint256(supplyDelta) > maxDelta) revert RebaseDeltaTooHigh();
            if (currentSupply + uint256(supplyDelta) > MAX_SUPPLY) revert ExceedsMaxSupply();
            lastRebaseTime = block.timestamp;
            totalRebased += uint256(supplyDelta);
            _mint(address(this), uint256(supplyDelta));
            if (halomStakingAddress != address(0)) {
                _transfer(address(this), halomStakingAddress, uint256(supplyDelta));
            }
        } else if (supplyDelta < 0) {
            if (uint256(-supplyDelta) > maxDelta) revert RebaseDeltaTooHigh();
            if (uint256(-supplyDelta) > currentSupply) revert InsufficientBalance();
            lastRebaseTime = block.timestamp;
            totalRebased += uint256(-supplyDelta);
            _burn(address(this), uint256(-supplyDelta));
        }
        emit RebaseExecuted(rebaseIndex, totalSupply(), block.timestamp);
    }
    
    function setStakingContract(address _stakingAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        halomStakingAddress = _stakingAddress;
        emit StakingContractSet(_stakingAddress);
    }
    
    function setRewardRate(uint256 _rewardRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rewardRate = _rewardRate;
        emit RewardRateSet(_rewardRate);
    }
    
    function setAntiWhaleLimits(uint256 _maxTransferAmount, uint256 _maxWalletAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxTransferAmount = _maxTransferAmount;
        maxWalletAmount = _maxWalletAmount;
        emit AntiWhaleLimitsSet(_maxTransferAmount, _maxWalletAmount);
    }
    
    function setExcludedFromLimits(address account, bool excluded) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isExcludedFromLimits[account] = excluded;
        emit ExcludedFromLimitsSet(account, excluded);
    }
    
    function getAntiWhaleLimits() public view returns (uint256 maxTx, uint256 maxWallet) {
        return (maxTransferAmount, maxWalletAmount);
    }
    
    function getRebaseBalance(address account) public view returns (uint256) {
        uint256 balance = balanceOf(account);
        uint256 accountIndex = lastRebaseIndex[account];
        
        if (accountIndex == 0) {
            accountIndex = 1e18;
        }
        
        return balance * rebaseIndex / accountIndex;
    }
    
    function _updateRebaseBalance(address account) internal {
        uint256 oldBalance = rebaseBalances[account];
        uint256 newBalance = getRebaseBalance(account);
        
        rebaseBalances[account] = newBalance;
        lastRebaseIndex[account] = rebaseIndex;
        
        if (oldBalance != newBalance) {
            emit RebaseBalanceUpdated(account, oldBalance, newBalance);
        }
    }
    
    function _update(address from, address to, uint256 amount) internal virtual override(ERC20, ERC20Votes) {
        super._update(from, to, amount);
        
        if (paused()) revert TransferPaused();
        
        // Anti-whale protection
        if (!isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
            if (amount > maxTransferAmount) revert TransferAmountExceedsLimit();
            if (to != address(0) && balanceOf(to) > maxWalletAmount) revert WalletBalanceExceedsLimit();
        }
        
        if (from != address(0)) {
            _updateRebaseBalance(from);
        }
        if (to != address(0)) {
            _updateRebaseBalance(to);
        }
    }
    
    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
    
    function emergencyPause() external onlyEmergency {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
    
    function emergencyUnpause() external onlyEmergency {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
    
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external onlyMinter whenNotPausedToken {
        uint256 length = recipients.length;
        if (length != amounts.length) revert InvalidAmount();
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < length; i++) {
            totalAmount += amounts[i];
        }
        
        if (totalSupply() + totalAmount > MAX_SUPPLY) revert ExceedsMaxSupply();
        
        for (uint256 i = 0; i < length; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            
            if (amount > 0) {
                _mint(recipient, amount);
                _updateRebaseBalance(recipient);
            }
        }
    }
    
    function batchBurn(address[] calldata accounts, uint256[] calldata amounts) external onlyBurner whenNotPausedToken {
        uint256 length = accounts.length;
        if (length != amounts.length) revert InvalidAmount();
        
        for (uint256 i = 0; i < length; i++) {
            address account = accounts[i];
            uint256 amount = amounts[i];
            
            if (amount > 0) {
                _burn(account, amount);
                _updateRebaseBalance(account);
            }
        }
    }
    
    function getRebaseInfo() external view returns (uint256, uint256, uint256, uint256) {
        return (rebaseIndex, lastRebaseTime, totalRebased, totalSupply());
    }
    
    function getAccountRebaseInfo(address account) external view returns (uint256, uint256, uint256) {
        return (rebaseBalances[account], lastRebaseIndex[account], getRebaseBalance(account));
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
} 
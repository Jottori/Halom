// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract HalomToken is ERC20, AccessControl, IVotes, EIP712 {
    // Custom Errors for gas optimization
    error InsufficientBalance();
    error TransferAmountExceedsBalance();
    error TransferAmountExceedsAllowance();
    error TransferToZeroAddress();
    error TransferFromZeroAddress();
    error ExceedsMaxTransferAmount();
    error ExceedsMaxWalletBalance();
    error ExceedsMaxRebaseDelta();
    error InvalidRebaseAmount();
    error InvalidLockPeriod();
    error LockPeriodTooShort();
    error LockPeriodTooLong();
    error InsufficientLockedTokens();
    error LockNotExpired();
    error InvalidDelegatee();
    error InvalidNonce();
    error SignatureExpired();
    error InvalidSignature();
    error Unauthorized();
    error InvalidCheckpoint();
    error InvalidBlockNumber();

    bytes32 public constant REBASE_CALLER = keccak256("REBASE_CALLER");
    bytes32 public constant STAKING_CONTRACT_ROLE = keccak256("STAKING_CONTRACT_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant REBASER_ROLE = keccak256("REBASER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    mapping(address => uint256) private _gonBalances;

    uint256 private constant TOTAL_GONS = type(uint256).max;
    uint256 private _gonsPerFragment;

    uint256 public rewardRate; // e.g., 2000 = 20% (stored in basis points, 1% = 100)
    address public halomStakingAddress;
    address public roleManager;

    uint256 private _totalSupply;
    uint256 public maxRebaseDelta; // In basis points, e.g., 500 = 5%
    
    // Anti-whale protection
    uint256 public maxTransferAmount; // Maximum transfer amount
    uint256 public maxWalletAmount; // Maximum wallet balance
    mapping(address => bool) public isExcludedFromLimits; // Excluded addresses (contracts, etc.)

    // IVotes implementation
    mapping(address => address) private _delegates;
    mapping(address => mapping(uint256 => uint256)) private _delegateCheckpoints;
    mapping(address => uint256) private _delegateCheckpointCounts;
    mapping(uint256 => uint256) private _totalSupplyCheckpoints;
    uint256 private _totalSupplyCheckpointCount;

    event Rebase(uint256 oldTotalSupply, uint256 newTotalSupply, int256 supplyDelta);
    event AntiWhaleLimitsUpdated(uint256 maxTransfer, uint256 maxWallet);
    event ExcludedFromLimits(address indexed account, bool excluded);
    event StakingContractUpdated(address indexed oldContract, address indexed newContract);
    
    constructor(
        string memory name,
        string memory symbol,
        address _roleManager,
        uint256 _initialSupply,
        uint256 _maxTransferAmount,
        uint256 _maxWalletAmount,
        uint256 _maxRebaseDelta
    ) ERC20(name, symbol) EIP712(name, "1") {
        if (_roleManager == address(0)) revert TransferToZeroAddress();
        if (_initialSupply == 0) revert InvalidRebaseAmount();
        if (_maxTransferAmount == 0) revert ExceedsMaxTransferAmount();
        if (_maxWalletAmount == 0) revert ExceedsMaxWalletBalance();
        if (_maxRebaseDelta == 0) revert ExceedsMaxRebaseDelta();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(REBASER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(GOVERNANCE_ROLE, msg.sender);

        roleManager = _roleManager;
        maxTransferAmount = _maxTransferAmount;
        maxWalletAmount = _maxWalletAmount;
        maxRebaseDelta = _maxRebaseDelta;

        _mint(msg.sender, _initialSupply);
    }

    function setStakingContract(address _stakingAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_stakingAddress != address(0), "HalomToken: Zero address");
        require(_stakingAddress.code.length > 0, "HalomToken: Must be a contract");
        
        address oldContract = halomStakingAddress;
        if (halomStakingAddress != address(0)) {
            _revokeRole(STAKING_CONTRACT_ROLE, halomStakingAddress);
        }
        halomStakingAddress = _stakingAddress;
        _grantRole(STAKING_CONTRACT_ROLE, _stakingAddress);
        isExcludedFromLimits[_stakingAddress] = true; // Exclude staking contract from limits
        
        emit StakingContractUpdated(oldContract, _stakingAddress);
    }

    function setRewardRate(uint256 _newRate) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newRate <= 10000, "HalomToken: Rate cannot exceed 100%");
        rewardRate = _newRate;
    }

    function setMaxRebaseDelta(uint256 _newDelta) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newDelta > 0 && _newDelta <= 1000, "HalomToken: Delta must be between 0.01% and 10%");
        maxRebaseDelta = _newDelta;
    }
    
    function setAntiWhaleLimits(uint256 _maxTransfer, uint256 _maxWallet) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maxTransfer > 0, "HalomToken: Max transfer must be > 0");
        require(_maxWallet > 0, "HalomToken: Max wallet must be > 0");
        require(_maxTransfer <= _maxWallet, "HalomToken: Max transfer cannot exceed max wallet");
        
        maxTransferAmount = _maxTransfer;
        maxWalletAmount = _maxWallet;
        
        emit AntiWhaleLimitsUpdated(_maxTransfer, _maxWallet);
    }
    
    function setExcludedFromLimits(address _account, bool _excluded) public onlyRole(DEFAULT_ADMIN_ROLE) {
        isExcludedFromLimits[_account] = _excluded;
        emit ExcludedFromLimits(_account, _excluded);
    }

    function rebase(uint256 supplyDelta) external onlyRole(REBASER_ROLE) {
        if (supplyDelta == 0) revert InvalidRebaseAmount();
        
        uint256 oldTotalSupply = totalSupply();
        uint256 newTotalSupply;
        
        // For now, only allow positive supply changes
        newTotalSupply = oldTotalSupply + supplyDelta;
        
        if (supplyDelta > maxRebaseDelta) revert ExceedsMaxRebaseDelta();

        _totalSupply = newTotalSupply;
        
        emit Rebase(oldTotalSupply, newTotalSupply, int256(supplyDelta));
    }

    function burnFrom(address account, uint256 amount) external onlyRole(STAKING_CONTRACT_ROLE) {
        _burn(account, amount);
    }

    /**
     * @dev Mint tokens - only for contracts with MINTER_ROLE
     * This replaces the old public mint function for security
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(to != address(0), "HalomToken: Cannot mint to zero address");
        require(amount > 0, "HalomToken: Cannot mint zero amount");
        _mint(to, amount);
    }

    // --- Overrides for rebase token ---

    function totalSupply() public view override(ERC20) returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override(ERC20) returns (uint256) {
        return _gonBalances[account] / _gonsPerFragment;
    }

    // OpenZeppelin ERC20 now uses _update for all transfers, mints, burns
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from == address(0)) {
            // Minting
            if (to == address(0)) revert TransferToZeroAddress();
            if (value == 0) revert InvalidRebaseAmount();
            
            // Check wallet limits for non-excluded addresses
            if (!isExcludedFromLimits[to]) {
                if (balanceOf(to) + value > maxWalletAmount) revert ExceedsMaxWalletBalance();
            }
        } else if (to == address(0)) {
            // Burning
            if (from == address(0)) revert TransferFromZeroAddress();
            if (value == 0) revert InvalidRebaseAmount();
        } else {
            // Transfer
            if (from == address(0)) revert TransferFromZeroAddress();
            if (to == address(0)) revert TransferToZeroAddress();
            if (value == 0) revert InvalidRebaseAmount();
            
            // Check transfer limits for non-excluded addresses
            if (!isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
                if (value > maxTransferAmount) revert ExceedsMaxTransferAmount();
            }
            
            // Check wallet limits for non-excluded addresses
            if (!isExcludedFromLimits[to]) {
                if (balanceOf(to) + value > maxWalletAmount) revert ExceedsMaxWalletBalance();
            }
        }

        super._update(from, to, value);
    }

    // --- IVotes implementation ---

    function delegates(address account) public view virtual override returns (address) {
        return _delegates[account];
    }

    function delegate(address delegatee) public virtual override {
        if (delegatee == address(0)) revert InvalidDelegatee();
        address currentDelegate = delegates(msg.sender);
        _delegates[msg.sender] = delegatee;
        _moveDelegateVotes(currentDelegate, delegatee, balanceOf(msg.sender));
    }

    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override {
        if (delegatee == address(0)) revert InvalidDelegatee();
        if (nonce != _useNonce(delegatee)) revert InvalidNonce();
        if (block.timestamp > expiry) revert SignatureExpired();
        
        address signer = ecrecover(
            _hashTypedDataV4(keccak256(abi.encode(_DELEGATION_TYPEHASH, delegatee, nonce, expiry))),
            v, r, s
        );
        if (signer == address(0)) revert InvalidSignature();
        
        _delegates[signer] = delegatee;
        _moveDelegateVotes(address(0), delegatee, balanceOf(signer));
    }

    function getVotes(address account) public view virtual override returns (uint256) {
        uint256 pos = _delegateCheckpointCounts[account];
        return pos == 0 ? 0 : _delegateCheckpoints[account][pos - 1];
    }

    function getPastVotes(address account, uint256 blockNumber) public view virtual override returns (uint256) {
        require(blockNumber < block.number, "ERC20Votes: block not yet mined");
        return _checkpointsLookup(_delegateCheckpoints[account], blockNumber, _delegateCheckpointCounts[account]);
    }

    function getPastTotalSupply(uint256 blockNumber) public view virtual override returns (uint256) {
        require(blockNumber < block.number, "ERC20Votes: block not yet mined");
        return _checkpointsLookup(_totalSupplyCheckpoints, blockNumber, _totalSupplyCheckpointCount);
    }

    function _moveDelegateVotes(address src, address dst, uint256 amount) private {
        if (src != dst && amount > 0) {
            if (src != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(
                    _delegateCheckpoints[src],
                    _delegateCheckpointCounts[src],
                    _delegateCheckpoints[src][_delegateCheckpointCounts[src] - 1],
                    _delegateCheckpoints[src][_delegateCheckpointCounts[src] - 1] - amount
                );
            }

            if (dst != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(
                    _delegateCheckpoints[dst],
                    _delegateCheckpointCounts[dst],
                    _delegateCheckpoints[dst][_delegateCheckpointCounts[dst] - 1],
                    _delegateCheckpoints[dst][_delegateCheckpointCounts[dst] - 1] + amount
                );
            }
        }
    }

    function _writeCheckpoint(
        mapping(uint256 => uint256) storage checkpoints,
        uint256 checkpointCount,
        uint256 oldWeight,
        uint256 newWeight
    ) private returns (uint256, uint256) {
        uint256 pos = checkpointCount;

        if (pos > 0 && checkpoints[pos - 1] == oldWeight) {
            checkpoints[pos - 1] = newWeight;
        } else {
            checkpoints[pos] = newWeight;
            checkpointCount = pos + 1;
        }

        return (oldWeight, newWeight);
    }

    function _writeTotalSupplyCheckpoint(uint256 checkpointCount, uint256 oldWeight, uint256 newWeight) private {
        uint256 pos = checkpointCount;

        if (pos > 0 && _totalSupplyCheckpoints[pos - 1] == oldWeight) {
            _totalSupplyCheckpoints[pos - 1] = newWeight;
        } else {
            _totalSupplyCheckpoints[pos] = newWeight;
            _totalSupplyCheckpointCount = pos + 1;
        }
    }

    function _checkpointsLookup(
        mapping(uint256 => uint256) storage checkpoints,
        uint256 blockNumber,
        uint256 count
    ) private view returns (uint256) {
        if (count == 0) return 0;
        
        // Simple lookup for now - return the latest checkpoint
        return checkpoints[count - 1];
    }

    function _useNonce(address owner) internal virtual returns (uint256 current) {
        current = _nonces[owner];
        _nonces[owner] = current + 1;
    }

    mapping(address => uint256) private _nonces;
    bytes32 private constant _DELEGATION_TYPEHASH = keccak256(
        "Delegation(address delegatee,uint256 nonce,uint256 expiry)"
    );
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title HalomToken
 * @dev Rebase-aware ERC20 token with governance capabilities
 * Features: Anti-whale protection, rebase logic, governance voting, emergency controls
 */
contract HalomToken is ERC20, AccessControl, IVotes, EIP712 {
    // Roles
    bytes32 public constant REBASE_CALLER = keccak256("REBASE_CALLER");
    bytes32 public constant STAKING_CONTRACT_ROLE = keccak256("STAKING_CONTRACT_ROLE");
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");
    bytes32 public constant REWARDER_ROLE = keccak256("REWARDER_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant TREASURY_CONTROLLER = keccak256("TREASURY_CONTROLLER");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Rebase state
    uint256 private _totalSupply;
    uint256 private _gonsPerFragment;
    uint256 public constant TOTAL_GONS = type(uint256).max - (type(uint256).max % 1e18);
    
    // Anti-whale protection
    uint256 public maxTransferAmount; // Maximum transfer amount
    uint256 public maxWalletAmount; // Maximum wallet balance
    mapping(address => bool) public isExcludedFromLimits;
    
    // Rebase protection
    uint256 public rebaseCooldown = 1 hours;
    uint256 public maxRebasePerDay = 3;
    uint256 public lastRebaseTime;
    uint256 public lastRebaseDay;
    uint256 public dailyRebaseCount;
    
    // Rebase history tracking
    struct RebaseInfo {
        int256 supplyDelta;
        uint256 timestamp;
        uint256 newSupply;
        address caller;
    }
    RebaseInfo[] public rebaseHistory;
    uint256 public constant MAX_REBASE_HISTORY = 100;
    
    // Governance parameters
    uint256 public rewardRate;
    uint256 public maxRebaseDelta;
    address public halomStakingAddress;
    
    // IVotes implementation
    mapping(address => address) private _delegates;
    mapping(address => mapping(uint256 => uint256)) private _delegateCheckpoints;
    mapping(address => uint256) private _delegateCheckpointCounts;
    mapping(uint256 => uint256) private _totalSupplyCheckpoints;
    uint256 private _totalSupplyCheckpointCount;
    
    // Gon balances for rebase token
    mapping(address => uint256) private _gonBalances;

    // Events
    event Rebase(uint256 indexed newSupply, int256 supplyDelta);
    event AntiWhaleLimitsUpdated(uint256 maxTransfer, uint256 maxWallet);
    event ExcludedFromLimits(address indexed account, bool excluded);
    event StakingContractUpdated(address indexed oldContract, address indexed newContract);
    event RebaseProtectionUpdated(uint256 cooldown, uint256 maxPerDay);
    event RebaseEmergencyPaused(address indexed caller);
    event RebaseResumed(uint256 cooldown);
    
    constructor(address _oracleAddress, address _governance) ERC20("Halom", "HOM") EIP712("Halom", "1") {
        uint256 initialSupply = 1_000_000 * 10**decimals();

        // Mint initial supply to governance using _update to avoid conflicts
        _update(address(0), _governance, initialSupply);

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(REBASE_CALLER, _oracleAddress);

        rewardRate = 2000; // Default 20%
        maxRebaseDelta = 500; // Default 5%
        
        // Anti-whale limits (1% of total supply)
        maxTransferAmount = initialSupply / 100;
        maxWalletAmount = initialSupply / 50; // 2% of total supply
        
        // Exclude governance and oracle from limits
        isExcludedFromLimits[_governance] = true;
        isExcludedFromLimits[_oracleAddress] = true;
        
        // Initialize IVotes
        _delegates[_governance] = _governance;
        _writeCheckpoint(_delegateCheckpoints[_governance], 0, 0, initialSupply);
        _writeTotalSupplyCheckpoint(0, 0, initialSupply);
    }

    function setStakingContract(address _stakingAddress) public onlyRole(REBASE_CALLER) {
        if (_stakingAddress == address(0)) revert ZeroAddress();
        if (_stakingAddress.code.length == 0) revert InvalidAmount();
        
        address oldContract = halomStakingAddress;
        if (halomStakingAddress != address(0)) {
            _revokeRole(STAKING_CONTRACT_ROLE, halomStakingAddress);
        }
        halomStakingAddress = _stakingAddress;
        _grantRole(STAKING_CONTRACT_ROLE, _stakingAddress);
        isExcludedFromLimits[_stakingAddress] = true; // Exclude staking contract from limits
        
        emit StakingContractUpdated(oldContract, _stakingAddress);
    }

    function setRewardRate(uint256 _newRate) public onlyRole(REBASE_CALLER) {
        if (_newRate > 10000) revert RateExceedsMaximum();
        rewardRate = _newRate;
    }

    function setMaxRebaseDelta(uint256 _newDelta) public onlyRole(REBASE_CALLER) {
        if (_newDelta == 0) revert InvalidRebaseDelta();
        if (_newDelta > 1000) revert RebaseDeltaTooHigh(); // Max 10%
        maxRebaseDelta = _newDelta;
    }
    
    function setAntiWhaleLimits(uint256 _maxTransfer, uint256 _maxWallet) public onlyRole(REBASE_CALLER) {
        require(_maxTransfer > 0, "HalomToken: Max transfer must be > 0");
        require(_maxWallet > 0, "HalomToken: Max wallet must be > 0");
        require(_maxTransfer <= _maxWallet, "HalomToken: Max transfer cannot exceed max wallet");
        
        maxTransferAmount = _maxTransfer;
        maxWalletAmount = _maxWallet;
        
        emit AntiWhaleLimitsUpdated(_maxTransfer, _maxWallet);
    }
    
    function setExcludedFromLimits(address _account, bool _excluded) public onlyRole(REBASE_CALLER) {
        isExcludedFromLimits[_account] = _excluded;
        emit ExcludedFromLimits(_account, _excluded);
    }

    function setRebaseProtection(
        uint256 _cooldown, 
        uint256 _maxPerDay
    ) external onlyRole(REBASE_CALLER) {
        if (_cooldown > 24 hours) revert InvalidRebaseDelta(); // Max 24h cooldown
        if (_maxPerDay == 0 || _maxPerDay > 10) revert RebaseDeltaTooHigh(); // Max 10 per day
        
        rebaseCooldown = _cooldown;
        maxRebasePerDay = _maxPerDay;
        
        emit RebaseProtectionUpdated(_cooldown, _maxPerDay);
    }

    function rebase(int256 supplyDelta) external onlyRole(REBASE_CALLER) {
        // Cooldown check
        if (block.timestamp < lastRebaseTime + rebaseCooldown) revert TimeNotElapsed();
        
        // Daily limit check
        uint256 currentDay = block.timestamp / 1 days;
        if (currentDay != lastRebaseDay) {
            dailyRebaseCount = 0;
            lastRebaseDay = currentDay;
        }
        if (dailyRebaseCount >= maxRebasePerDay) revert RebaseDeltaTooHigh();
        
        uint256 S = _totalSupply;
        uint256 absDelta = supplyDelta < 0 ? uint256(-supplyDelta) : uint256(supplyDelta);
        
        // Check max rebase delta
        if (absDelta > (S * maxRebaseDelta) / 10000) revert RebaseDeltaTooHigh();
        
        // Additional safety: prevent extreme supply changes
        if (absDelta > S / 2) revert RebaseDeltaTooHigh(); // Max 50% change in one rebase
        
        uint256 newS;
        if (supplyDelta > 0) {
            // Prevent overflow by checking bounds
            if (uint256(supplyDelta) > type(uint256).max - S) revert SupplyOverflow();
            newS = S + uint256(supplyDelta);
            
            // Calculate rewards for staking contract
            uint256 rewards = (uint256(supplyDelta) * rewardRate) / 10000;
            if (rewards > 0 && halomStakingAddress != address(0)) {
                // Mint rewards directly to staking contract
                _mint(halomStakingAddress, rewards);
            }
        } else {
            // Prevent underflow by checking bounds
            if (absDelta > S) revert SupplyUnderflow();
            newS = S - absDelta;
        }
        
        // Update state
        _totalSupply = newS;
        _gonsPerFragment = TOTAL_GONS / _totalSupply;
        lastRebaseTime = block.timestamp;
        dailyRebaseCount++;
        
        // Record rebase history
        if (rebaseHistory.length >= MAX_REBASE_HISTORY) {
            // Remove oldest entry
            for (uint256 i = 0; i < rebaseHistory.length - 1; i++) {
                rebaseHistory[i] = rebaseHistory[i + 1];
            }
            rebaseHistory.pop();
        }
        
        rebaseHistory.push(RebaseInfo({
            supplyDelta: supplyDelta,
            timestamp: block.timestamp,
            newSupply: newS,
            caller: msg.sender
        }));
        
        emit Rebase(newS, supplyDelta);
    }

    function burnFrom(address account, uint256 amount) external onlyRole(STAKING_CONTRACT_ROLE) {
        _burn(account, amount);
    }

    /**
     * @dev Mint tokens - only for contracts with MINTER_ROLE
     * This replaces the old public mint function for security
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        _mint(to, amount);
    }

    // --- Overrides for rebase token ---

    function totalSupply() public view override(ERC20) returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override(ERC20) returns (uint256) {
        return _gonBalances[account] / _gonsPerFragment;
    }

    function _update(address from, address to, uint256 amount) internal virtual override {
        // Mint
        if (from == address(0)) {
            unchecked {
                _totalSupply += amount;
            }
            if (_totalSupply > 0) {
                _gonsPerFragment = TOTAL_GONS / _totalSupply;
            } else {
                _gonsPerFragment = 0;
            }
            unchecked {
                _gonBalances[to] += amount * _gonsPerFragment;
            }
            emit Transfer(address(0), to, amount);
            return;
        }
        // Burn
        if (to == address(0)) {
            unchecked {
                _totalSupply -= amount;
            }
            if (_totalSupply > 0) {
                _gonsPerFragment = TOTAL_GONS / _totalSupply;
            } else {
                _gonsPerFragment = 0;
            }
            unchecked {
                _gonBalances[from] -= amount * _gonsPerFragment;
            }
            emit Transfer(from, address(0), amount);
            return;
        }
        // Transfer
        if (from == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf(from) < amount) revert InsufficientBalance();

        // Anti-whale checks
        if (!isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
            if (amount > maxTransferAmount) revert TransferAmountExceedsLimit();
            if (balanceOf(to) + amount > maxWalletAmount) revert WalletBalanceExceedsLimit();
        }

        uint256 gons = amount * _gonsPerFragment;
        unchecked {
            _gonBalances[from] -= gons;
            _gonBalances[to] += gons;
        }
        emit Transfer(from, to, amount);
    }

    // --- IVotes implementation ---

    function delegates(address account) public view virtual override returns (address) {
        return _delegates[account];
    }

    function delegate(address delegatee) public virtual override {
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
        if (block.timestamp > expiry) revert InvalidNonce();
        address signer = ecrecover(
            _hashTypedDataV4(keccak256(abi.encode(_DELEGATION_TYPEHASH, delegatee, nonce, expiry))),
            v, r, s
        );
        if (signer == address(0)) revert Unauthorized();
        if (nonce != _useNonce(signer)) revert InvalidNonce();
        _delegates[signer] = delegatee;
        _moveDelegateVotes(address(0), delegatee, balanceOf(signer));
    }

    function getVotes(address account) public view virtual override returns (uint256) {
        uint256 pos = _delegateCheckpointCounts[account];
        return pos == 0 ? 0 : _delegateCheckpoints[account][pos - 1];
    }

    function getPastVotes(address account, uint256 blockNumber) public view virtual override returns (uint256) {
        if (blockNumber >= block.number) revert InvalidNonce();
        return _checkpointsLookup(_delegateCheckpoints[account], blockNumber, _delegateCheckpointCounts[account]);
    }

    function getPastTotalSupply(uint256 blockNumber) public view virtual override returns (uint256) {
        if (blockNumber >= block.number) revert InvalidNonce();
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
                // Log voting power change for source delegate
                emit DelegateVotesChanged(src, oldWeight, newWeight);
            }

            if (dst != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(
                    _delegateCheckpoints[dst],
                    _delegateCheckpointCounts[dst],
                    _delegateCheckpoints[dst][_delegateCheckpointCounts[dst] - 1],
                    _delegateCheckpoints[dst][_delegateCheckpointCounts[dst] - 1] + amount
                );
                // Log voting power change for destination delegate
                emit DelegateVotesChanged(dst, oldWeight, newWeight);
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
        if (count == 0) {
            return 0;
        }

        uint256 low = 0;
        uint256 high = count - 1;

        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            if (checkpoints[mid] <= blockNumber) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return checkpoints[low];
    }

    function _useNonce(address owner) internal virtual returns (uint256 current) {
        current = _nonces[owner];
        _nonces[owner] = current + 1;
    }

    mapping(address => uint256) private _nonces;
    bytes32 private constant _DELEGATION_TYPEHASH = keccak256(
        "Delegation(address delegatee,uint256 nonce,uint256 expiry)"
    );

    /**
     * @dev Get rebase history for monitoring
     */
    function getRebaseHistory() external view returns (RebaseInfo[] memory) {
        return rebaseHistory;
    }
    
    /**
     * @dev Emergency pause rebase functionality
     */
    function emergencyPauseRebase() external onlyRole(EMERGENCY_ROLE) {
        rebaseCooldown = type(uint256).max; // Effectively disable rebase
        emit RebaseEmergencyPaused(msg.sender);
    }
    
    /**
     * @dev Resume rebase functionality
     */
    function resumeRebase(uint256 _cooldown) external onlyRole(REBASE_CALLER) {
        rebaseCooldown = _cooldown;
        emit RebaseResumed(_cooldown);
    }

    // Custom errors for gas optimization
    error ZeroAddress();
    error InvalidAmount();
    error InsufficientBalance();
    error TransferAmountExceedsLimit();
    error WalletBalanceExceedsLimit();
    error RateExceedsMaximum();
    error InvalidRebaseDelta();
    error RebaseDeltaTooHigh();
    error SupplyOverflow();
    error SupplyUnderflow();
    error TimeNotElapsed();
    error InvalidNonce();
    error Unauthorized();
} 
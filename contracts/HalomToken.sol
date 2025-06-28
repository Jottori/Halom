// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract HalomToken is ERC20, AccessControl, IVotes, EIP712 {
    bytes32 public constant REBASE_CALLER = keccak256("REBASE_CALLER");
    bytes32 public constant STAKING_CONTRACT_ROLE = keccak256("STAKING_CONTRACT_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(address => uint256) private _gonBalances;

    uint256 private constant TOTAL_GONS = type(uint256).max;
    uint256 private _gonsPerFragment;

    uint256 public rewardRate; // e.g., 2000 = 20% (stored in basis points, 1% = 100)
    address public halomStakingAddress;

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

    event Rebase(uint256 newTotalSupply, int256 supplyDelta);
    event AntiWhaleLimitsUpdated(uint256 maxTransfer, uint256 maxWallet);
    event ExcludedFromLimits(address indexed account, bool excluded);
    event StakingContractUpdated(address indexed oldContract, address indexed newContract);
    
    constructor(address _oracleAddress, address _governance) ERC20("Halom", "HOM") EIP712("Halom", "1") {
        uint256 initialSupply = 1_000_000 * 10**decimals();

        // Mint initial supply to governance using _update to avoid conflicts
        _update(address(0), _governance, initialSupply);

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

    function rebase(int256 supplyDelta) external onlyRole(REBASE_CALLER) {
        uint256 S = totalSupply();
        if (supplyDelta == 0) {
            emit Rebase(S, 0);
            return;
        }

        uint256 newS;
        if (supplyDelta > 0) {
            // Prevent overflow by checking bounds
            require(uint256(supplyDelta) <= type(uint256).max - S, "HalomToken: Supply overflow");
            newS = S + uint256(supplyDelta);
            
            // Calculate rewards for staking contract
            uint256 rewards = (uint256(supplyDelta) * rewardRate) / 10000;
            if (rewards > 0 && halomStakingAddress != address(0)) {
                // Mint rewards directly to staking contract
                _mint(halomStakingAddress, rewards);
            }
        } else {
            // Prevent underflow by checking bounds
            uint256 absDelta = uint256(-supplyDelta);
            require(absDelta <= S, "HalomToken: Supply underflow");
            newS = S - absDelta;
        }
        
        uint256 maxDeltaValue = (S * maxRebaseDelta) / 10000;
        if (newS > S) {
            require(newS - S <= maxDeltaValue, "HalomToken: Supply increase too large");
        } else {
            require(S - newS <= maxDeltaValue, "HalomToken: Supply decrease too large");
        }
        
        _totalSupply = newS;
        _gonsPerFragment = TOTAL_GONS / _totalSupply;
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
        require(to != address(0), "HalomToken: Cannot mint to zero address");
        require(amount > 0, "HalomToken: Cannot mint zero amount");
        _mint(to, amount);
    }

    // --- Overrides for rebase token ---

    function totalSupply() public view override(ERC20) returns (uint256) {
        return super.totalSupply();
    }

    function balanceOf(address account) public view override(ERC20) returns (uint256) {
        return _gonBalances[account] / _gonsPerFragment;
    }

    // OpenZeppelin ERC20 now uses _update for all transfers, mints, burns
    function _update(address from, address to, uint256 amount) internal override {
        // Mint
        if (from == address(0)) {
            // Only update _totalSupply if this is not the initial mint in constructor
            if (_totalSupply == 0) {
                _totalSupply = amount;
            } else {
                unchecked {
                    _totalSupply += amount;
                }
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
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balanceOf(from) >= amount, "ERC20: transfer amount exceeds balance");

        // Anti-whale checks
        if (!isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
            require(amount <= maxTransferAmount, "HalomToken: Transfer amount exceeds limit");
            require(balanceOf(to) + amount <= maxWalletAmount, "HalomToken: Wallet balance would exceed limit");
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
        require(block.timestamp <= expiry, "ERC20Votes: signature expired");
        address signer = ecrecover(_hashTypedDataV4(keccak256(abi.encode(_DELEGATION_TYPEHASH, delegatee, nonce, expiry))), v, r, s);
        require(signer != address(0), "ERC20Votes: invalid signature");
        require(nonce == _useNonce(signer), "ERC20Votes: invalid nonce");
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
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(_delegateCheckpoints[src], _delegateCheckpointCounts[src], _delegateCheckpoints[src][_delegateCheckpointCounts[src] - 1], _delegateCheckpoints[src][_delegateCheckpointCounts[src] - 1] - amount);
            }

            if (dst != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(_delegateCheckpoints[dst], _delegateCheckpointCounts[dst], _delegateCheckpoints[dst][_delegateCheckpointCounts[dst] - 1], _delegateCheckpoints[dst][_delegateCheckpointCounts[dst] - 1] + amount);
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

    function _checkpointsLookup(mapping(uint256 => uint256) storage checkpoints, uint256 blockNumber, uint256 count) private view returns (uint256) {
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
    bytes32 private constant _DELEGATION_TYPEHASH = keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
} 
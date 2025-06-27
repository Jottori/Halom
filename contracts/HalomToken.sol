// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

interface IHalomStaking {
    function addRewards(uint256 amount) external;
}

interface IHalomToken is IERC20 {
    function rebase(int256 supplyDelta) external;
    function burnFrom(address account, uint256 amount) external;
}

contract HalomToken is IHalomToken, ERC20, AccessControl, IVotes {
    bytes32 public constant REBASE_CALLER = keccak256("REBASE_CALLER");
    bytes32 public constant STAKING_CONTRACT = keccak256("STAKING_CONTRACT");

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
    mapping(address => uint256) private _delegates;
    mapping(address => mapping(uint256 => uint256)) private _delegateCheckpoints;
    mapping(address => uint256) private _delegateCheckpointCounts;
    mapping(uint256 => uint256) private _totalSupplyCheckpoints;
    uint256 private _totalSupplyCheckpointCount;

    event Rebase(uint256 newTotalSupply, int256 supplyDelta);
    event AntiWhaleLimitsUpdated(uint256 maxTransfer, uint256 maxWallet);
    event ExcludedFromLimits(address indexed account, bool excluded);
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event DelegateVotesChanged(address indexed delegate, uint256 previousBalance, uint256 newBalance);
    
    constructor(address _oracleAddress, address _governance) ERC20("Halom", "HOM") {
        uint256 initialSupply = 1_000_000 * 10**decimals();
        _totalSupply = initialSupply;
        _gonsPerFragment = TOTAL_GONS / initialSupply;
        _gonBalances[_governance] = TOTAL_GONS;
        
        emit Transfer(address(0), _governance, initialSupply);

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
        _writeCheckpoint(_governance, 0, 0, initialSupply);
        _writeTotalSupplyCheckpoint(0, 0, initialSupply);
    }

    function setStakingContract(address _stakingAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_stakingAddress != address(0), "HalomToken: Zero address");
        if (halomStakingAddress != address(0)) {
            _revokeRole(STAKING_CONTRACT, halomStakingAddress);
        }
        halomStakingAddress = _stakingAddress;
        _grantRole(STAKING_CONTRACT, _stakingAddress);
        isExcludedFromLimits[_stakingAddress] = true; // Exclude staking contract from limits
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
            newS = S + uint256(supplyDelta);
            uint256 rewards = (uint256(supplyDelta) * rewardRate) / 10000;
            if (rewards > 0 && halomStakingAddress != address(0)) {
                _mint(halomStakingAddress, rewards);
                // Call addRewards on staking contract to distribute rewards
                IHalomStaking(halomStakingAddress).addRewards(rewards);
            }
        } else {
            newS = S - uint256(-supplyDelta);
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

    function burnFrom(address account, uint256 amount) external onlyRole(STAKING_CONTRACT) {
        _burn(account, amount);
    }

    function mint(address to, uint256 amount) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _mint(to, amount);
    }

    // --- Overrides for rebase token ---

    function totalSupply() public view override(ERC20, IERC20) returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override(ERC20, IERC20) returns (uint256) {
        if (_gonsPerFragment == 0) return 0;
        return _gonBalances[account] / _gonsPerFragment;
    }

    function _transfer(address from, address to, uint256 amount) internal override(ERC20) {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balanceOf(from) >= amount, "ERC20: transfer amount exceeds balance");

        // Anti-whale checks
        if (!isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
            require(amount <= maxTransferAmount, "HalomToken: Transfer amount exceeds limit");
            require(balanceOf(to) + amount <= maxWalletAmount, "HalomToken: Wallet balance would exceed limit");
        }

        uint256 gons = amount * _gonsPerFragment;
        _gonBalances[from] -= gons;
        _gonBalances[to] += gons;

        emit Transfer(from, to, amount);
    }

    function _mint(address account, uint256 amount) internal override(ERC20) {
        require(account != address(0), "ERC20: mint to the zero address");
        
        _totalSupply += amount;
        if (_totalSupply > 0) {
            _gonsPerFragment = TOTAL_GONS / _totalSupply;
        } else {
            _gonsPerFragment = 0;
        }
        _gonBalances[account] += amount * _gonsPerFragment;

        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) internal override(ERC20) {
        require(account != address(0), "ERC20: burn from the zero address");

        _totalSupply -= amount;
        if (_totalSupply > 0) {
            _gonsPerFragment = TOTAL_GONS / _totalSupply;
        } else {
            _gonsPerFragment = 0;
        }
        _gonBalances[account] -= amount * _gonsPerFragment;

        emit Transfer(account, address(0), amount);
    }

    // IVotes implementation
    function delegates(address account) external view returns (address) {
        return _delegates[account];
    }

    function getVotes(address account) external view returns (uint256) {
        uint256 pos = _delegateCheckpointCounts[account];
        return pos == 0 ? 0 : _delegateCheckpoints[account][pos - 1];
    }

    function getPastVotes(address account, uint256 blockNumber) external view returns (uint256) {
        require(blockNumber < block.number, "HalomToken: Too recent");
        uint256 pos = _delegateCheckpointCounts[account];
        if (pos == 0) {
            return 0;
        }

        uint256[] memory checkpoints = _delegateCheckpoints[account];
        if (checkpoints.length == 0) {
            return 0;
        }

        if (checkpoints[pos - 1] <= blockNumber) {
            return checkpoints[pos - 1];
        }

        uint256 lower = 0;
        uint256 upper = pos - 1;
        while (upper > lower) {
            uint256 center = upper - (upper - lower) / 2;
            if (checkpoints[center] <= blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return checkpoints[lower];
    }

    function getPastTotalSupply(uint256 blockNumber) external view returns (uint256) {
        require(blockNumber < block.number, "HalomToken: Too recent");
        uint256 pos = _totalSupplyCheckpointCount;
        if (pos == 0) {
            return 0;
        }

        uint256[] memory checkpoints = _totalSupplyCheckpoints;
        if (checkpoints.length == 0) {
            return 0;
        }

        if (checkpoints[pos - 1] <= blockNumber) {
            return checkpoints[pos - 1];
        }

        uint256 lower = 0;
        uint256 upper = pos - 1;
        while (upper > lower) {
            uint256 center = upper - (upper - lower) / 2;
            if (checkpoints[center] <= blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return checkpoints[lower];
    }

    function _writeCheckpoint(address delegatee, uint256 pos, uint256 oldVotes, uint256 newVotes) internal {
        uint256 blockNumber = block.number;
        if (pos == 0) {
            _delegateCheckpoints[delegatee].push(0);
            pos = _delegateCheckpoints[delegatee].length;
        }
        _delegateCheckpoints[delegatee][pos - 1] = newVotes;
        _delegateCheckpointCounts[delegatee] = pos;
        emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
    }

    function _writeTotalSupplyCheckpoint(uint256 pos, uint256 oldTotalSupply, uint256 newTotalSupply) internal {
        uint256 blockNumber = block.number;
        if (pos == 0) {
            _totalSupplyCheckpoints.push(0);
            pos = _totalSupplyCheckpoints.length;
        }
        _totalSupplyCheckpoints[pos - 1] = newTotalSupply;
        _totalSupplyCheckpointCount = pos;
    }
} 
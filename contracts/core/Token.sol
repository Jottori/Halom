// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

interface IHalomToken is IERC20 {
    function rebase(int256 supplyDelta) external;
    function burnFrom(address account, uint256 amount) external;
}

contract Token is IHalomToken, ERC20, AccessControlEnumerable {
    // ============ Immutable Role Declarations ============
    bytes32 public immutable REBASE_CALLER_ROLE = keccak256("REBASE_CALLER_ROLE");
    bytes32 public immutable STAKING_CONTRACT_ROLE = keccak256("STAKING_CONTRACT_ROLE");
    bytes32 public immutable MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public immutable BURNER_ROLE = keccak256("BURNER_ROLE");

    mapping(address => uint256) private _gonBalances;

    uint256 private constant TOTAL_GONS = type(uint256).max;
    uint256 private _gonsPerFragment;

    uint256 public rewardRate; // e.g., 2000 = 20% (stored in basis points, 1% = 100)
    address public halomStakingAddress;

    uint256 private _totalSupply;
    uint256 public maxRebaseDelta; // In basis points, e.g., 500 = 5%

    event Rebase(uint256 newTotalSupply, int256 supplyDelta);
    event StakingContractUpdated(address oldAddress, address newAddress);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event MaxRebaseDeltaUpdated(uint256 oldDelta, uint256 newDelta);
    
    constructor(address _oracleAddress, address _governance) ERC20("Halom", "HOM") {
        uint256 initialSupply = 1_000_000 * 10**decimals();
        _totalSupply = initialSupply;
        _gonsPerFragment = TOTAL_GONS / initialSupply;
        _gonBalances[_governance] = TOTAL_GONS;
        
        emit Transfer(address(0), _governance, initialSupply);

        // Setup hierarchical role structure
        _setupRoleHierarchy();
        
        // Grant initial roles
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(REBASE_CALLER_ROLE, _oracleAddress);
        _grantRole(MINTER_ROLE, _governance);
        _grantRole(BURNER_ROLE, _governance);

        rewardRate = 2000; // Default 20%
        maxRebaseDelta = 500; // Default 5%
    }
    
    // ============ Role Hierarchy Setup ============
    function _setupRoleHierarchy() internal {
        // DEFAULT_ADMIN_ROLE can manage all other roles
        _setRoleAdmin(REBASE_CALLER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(STAKING_CONTRACT_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MINTER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BURNER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    function setStakingContract(address _stakingAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_stakingAddress != address(0), "HalomToken: Zero address");
        
        address oldAddress = halomStakingAddress;
        if (oldAddress != address(0)) {
            _revokeRole(STAKING_CONTRACT_ROLE, oldAddress);
        }
        
        halomStakingAddress = _stakingAddress;
        _grantRole(STAKING_CONTRACT_ROLE, _stakingAddress);
        
        emit StakingContractUpdated(oldAddress, _stakingAddress);
    }

    function setRewardRate(uint256 _newRate) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newRate <= 10000, "HalomToken: Rate cannot exceed 100%");
        
        uint256 oldRate = rewardRate;
        rewardRate = _newRate;
        
        emit RewardRateUpdated(oldRate, _newRate);
    }

    function setMaxRebaseDelta(uint256 _newDelta) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newDelta > 0 && _newDelta <= 1000, "HalomToken: Delta must be between 0.01% and 10%");
        
        uint256 oldDelta = maxRebaseDelta;
        maxRebaseDelta = _newDelta;
        
        emit MaxRebaseDeltaUpdated(oldDelta, _newDelta);
    }

    function rebase(int256 supplyDelta) external onlyRole(REBASE_CALLER_ROLE) {
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

    function burnFrom(address account, uint256 amount) external onlyRole(STAKING_CONTRACT_ROLE) {
        _burn(account, amount);
    }

    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
    
    function burn(address from, uint256 amount) public onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }

    // ============ View Functions ============
    
    function getRoleInfo(bytes32 role) external view returns (
        uint256 memberCount,
        address[] memory members
    ) {
        uint256 count = getRoleMemberCount(role);
        address[] memory roleMembers = new address[](count);
        
        for (uint256 i = 0; i < count; i++) {
            roleMembers[i] = getRoleMember(role, i);
        }
        
        return (count, roleMembers);
    }

    // --- Overrides for rebase token ---

    function totalSupply() public view override(ERC20, IERC20) returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override(ERC20, IERC20) returns (uint256) {
        if (_gonsPerFragment == 0) return 0;
        return _gonBalances[account] / _gonsPerFragment;
    }

    function _update(address from, address to, uint256 amount) internal override(ERC20) {
        if (from != address(0)) {
            require(from != address(0), "ERC20: transfer from the zero address");
            uint256 gons = amount * _gonsPerFragment;
            _gonBalances[from] -= gons;
        }
        
        if (to != address(0)) {
            require(to != address(0), "ERC20: transfer to the zero address");
            uint256 gons = amount * _gonsPerFragment;
            _gonBalances[to] += gons;
        }
        
        if (from == address(0)) {
            // Minting
            _totalSupply += amount;
            if (_totalSupply > 0) {
                _gonsPerFragment = TOTAL_GONS / _totalSupply;
            } else {
                _gonsPerFragment = 0;
            }
        } else if (to == address(0)) {
            // Burning
            _totalSupply -= amount;
            if (_totalSupply > 0) {
                _gonsPerFragment = TOTAL_GONS / _totalSupply;
            } else {
                _gonsPerFragment = 0;
            }
        }
        
        super._update(from, to, amount);
    }
} 

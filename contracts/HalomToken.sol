// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface IHalomToken is IERC20 {
    function rebase(int256 supplyDelta) external;
    function burnFrom(address account, uint256 amount) external;
}

contract HalomToken is IHalomToken, ERC20, AccessControl {
    bytes32 public constant REBASE_CALLER = keccak256("REBASE_CALLER");
    bytes32 public constant STAKING_CONTRACT = keccak256("STAKING_CONTRACT");

    mapping(address => uint256) private _gonBalances;

    uint256 private constant TOTAL_GONS = type(uint256).max;
    uint256 private _gonsPerFragment;

    uint256 public rewardRate; // e.g., 2000 = 20% (stored in basis points, 1% = 100)
    address public halomStakingAddress;

    uint256 private _totalSupply;
    uint256 public maxRebaseDelta; // In basis points, e.g., 500 = 5%

    event Rebase(uint256 newTotalSupply, int256 supplyDelta);
    
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
    }

    function setStakingContract(address _stakingAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_stakingAddress != address(0), "HalomToken: Zero address");
        if (halomStakingAddress != address(0)) {
            _revokeRole(STAKING_CONTRACT, halomStakingAddress);
        }
        halomStakingAddress = _stakingAddress;
        _grantRole(STAKING_CONTRACT, _stakingAddress);
    }

    function setRewardRate(uint256 _newRate) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newRate <= 10000, "HalomToken: Rate cannot exceed 100%");
        rewardRate = _newRate;
    }

    function setMaxRebaseDelta(uint256 _newDelta) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newDelta > 0 && _newDelta <= 1000, "HalomToken: Delta must be between 0.01% and 10%");
        maxRebaseDelta = _newDelta;
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
} 
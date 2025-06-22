// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHalomToken is IERC20 {
    function burnFrom(address account, uint256 amount) external;
}

contract HalomStaking is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    IHalomToken public immutable halomToken;
    uint256 public totalStaked;
    uint256 public rewardsPerShare;

    // --- User-specific data ---
    struct Stake {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lockUntil;
    }
    mapping(address => Stake) public stakes;

    // --- Delegation ---
    mapping(address => address) public delegators; // delegator -> validator
    mapping(address => uint256) public validatorCommission; // validator -> commission rate (basis points)
    uint256 public constant MAX_COMMISSION = 2000; // 20%

    // --- Lock-Boost ---
    uint256 public lockBoostB0; // e.g., 2000 = 20% boost in basis points
    uint256 public lockBoostTMax; // e.g., 365 days

    event Staked(address indexed user, uint256 amount, uint256 lockUntil);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event Delegated(address indexed delegator, address indexed validator);
    event Slashed(address indexed validator, uint256 amount);

    constructor(address _tokenAddress, address _governance) {
        halomToken = IHalomToken(_tokenAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        lockBoostB0 = 2000; // Default 20%
        lockBoostTMax = 365 days; // Default 1 year
    }
    
    // --- Staking and Rewards ---

    function stake(uint256 amount, uint256 lockDuration) external nonReentrant {
        _updateRewards(msg.sender);
        
        Stake storage userStake = stakes[msg.sender];
        userStake.amount += amount;
        userStake.lockUntil = block.timestamp + lockDuration;
        totalStaked += amount;

        halomToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, userStake.lockUntil);
    }

    function unstake(uint256 amount) external nonReentrant {
        Stake storage userStake = stakes[msg.sender];
        require(block.timestamp >= userStake.lockUntil, "HalomStaking: Tokens are locked");
        require(userStake.amount >= amount, "HalomStaking: Insufficient stake");

        _updateRewards(msg.sender);
        
        userStake.amount -= amount;
        totalStaked -= amount;
        
        halomToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external nonReentrant {
        _updateRewards(msg.sender);
    }

    // --- Governor & Validator Functions ---
    
    function setLockBoostParams(uint256 _newB0, uint256 _newTMax) external onlyRole(GOVERNOR_ROLE) {
        require(_newB0 <= 5000, "B0 cannot exceed 50%"); // Guardrail: 50% max boost
        require(_newTMax >= 30 days && _newTMax <= 730 days, "TMax must be between 30 and 730 days");
        lockBoostB0 = _newB0;
        lockBoostTMax = _newTMax;
    }

    function setCommissionRate(uint256 _newRate) external {
        // Can only be called by an address that has stakers delegating to it.
        // This implicitly makes them a validator.
        require(stakes[msg.sender].amount > 0, "HalomStaking: Not a staker, cannot be a validator");
        require(_newRate <= MAX_COMMISSION, "HalomStaking: Commission exceeds maximum");
        validatorCommission[msg.sender] = _newRate;
    }

    function addRewards(uint256 amount) external {
        // This can only be called by the HalomToken contract, which has the STAKING_CONTRACT role.
        // Since AccessControl in this contract does not know about roles in another one,
        // a simple check on msg.sender is sufficient and gas-efficient.
        require(msg.sender == address(halomToken), "HalomStaking: Not the token contract");
        if (totalStaked > 0) {
            rewardsPerShare += (amount * 1e18) / totalStaked;
        }
    }

    function slash(address validator, uint256 amountToSlash) external onlyRole(GOVERNOR_ROLE) nonReentrant {
        Stake storage validatorStake = stakes[validator];
        require(validatorStake.amount >= amountToSlash, "HalomStaking: Slash amount exceeds stake");

        validatorStake.amount -= amountToSlash;
        totalStaked -= amountToSlash;
        
        uint256 toBurn = amountToSlash / 2;
        uint256 toRewards = amountToSlash - toBurn;

        halomToken.burnFrom(address(this), toBurn);
        addRewards(toRewards);
        
        emit Slashed(validator, amountToSlash);
    }

    // --- Internal and View Functions ---
    
    function _updateRewards(address user) internal {
        uint256 pending = pendingRewards(user);
        if (pending > 0) {
            halomToken.transfer(user, pending);
            emit RewardsClaimed(user, pending);
        }
        stakes[user].rewardDebt = (stakes[user].amount * rewardsPerShare) / 1e18;
    }

    function pendingRewards(address user) public view returns (uint256) {
        Stake memory stake = stakes[user];
        uint256 effectiveStake = getEffectiveStake(user);
        return ((effectiveStake * rewardsPerShare) / 1e18) - stake.rewardDebt;
    }

    function getEffectiveStake(address user) public view returns (uint256) {
        Stake memory userStake = stakes[user];
        if (userStake.amount == 0) return 0;

        uint256 lockDuration = userStake.lockUntil > block.timestamp ? userStake.lockUntil - block.timestamp : 0;
        uint256 boostMultiplier = (lockDuration * lockBoostB0) / lockBoostTMax;
        
        return userStake.amount + (userStake.amount * boostMultiplier) / 10000;
    }
} 
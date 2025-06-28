// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IHalomInterfaces.sol";

contract HalomLPStaking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant REWARDER_ROLE = keccak256("REWARDER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable lpToken;
    IHalomToken public immutable halomToken;
    IHalomRoleManager public roleManager;
    uint256 public rewardRate;

    uint256 public totalStaked;
    mapping(address => uint256) public stakedBalance;

    // Fourth root based reward system
    uint256 public totalFourthRootStake; // Sum of fourth roots of all stakes
    mapping(address => uint256) public fourthRootStake; // Fourth root of user's stake
    uint256 public rewardsPerFourthRoot; // Rewards per fourth root unit
    mapping(address => uint256) public rewardDebt;

    // Emergency recovery
    uint256 public pendingRewards; // Rewards waiting for first staker

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardAdded(address indexed rewarder, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event EmergencyRecovery(address indexed token, address indexed to, uint256 amount);
    event PendingRewardsClaimed(address indexed user, uint256 amount);

    constructor(
        address _lpToken,
        address _halomToken,
        address _roleManager,
        uint256 _rewardRate
    ) {
        require(_lpToken != address(0),
            "LP token is zero address"
        );
        require(_halomToken != address(0),
            "Halom token is zero address"
        );
        require(_roleManager != address(0),
            "Role manager is zero address"
        );
        require(_rewardRate > 0,
            "Reward rate must be greater than 0"
        );

        lpToken = IERC20(_lpToken);
        halomToken = IHalomToken(_halomToken);
        roleManager = IHalomRoleManager(_roleManager);
        rewardRate = _rewardRate;
        
        // Roles will be granted by deployment script, not in constructor
        _grantRole(DEFAULT_ADMIN_ROLE, _roleManager);
        _grantRole(GOVERNOR_ROLE, _roleManager);
        _grantRole(REWARDER_ROLE, _roleManager);
        _grantRole(PAUSER_ROLE, _roleManager);
    }

    /**
     * @dev Calculate fourth root using Babylonian method
     */
    function fourthRoot(uint256 x) public pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = x;
        uint256 y = (z + 3) / 4;
        
        while (y < z) {
            z = y;
            y = (3 * z + x / (z * z * z)) / 4;
        }
        return z;
    }

    /**
     * @dev Get governance power (fourth root of stake)
     */
    function getGovernancePower(address user) public view returns (uint256) {
        return fourthRoot(stakedBalance[user]);
    }

    modifier updateRewards(address _account) {
        uint256 pending = (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_account];
        if (pending > 0) {
            SafeERC20.safeTransfer(IERC20(address(halomToken)), _account, pending);
            emit RewardClaimed(_account, pending);
        }
        _;
        rewardDebt[_account] = (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18;
    }

    function stake(uint256 _amount) external nonReentrant updateRewards(msg.sender) {
        require(_amount > 0, "Cannot stake 0");
        
        // If this is the first staker and there are pending rewards, distribute them
        if (totalStaked == 0 && pendingRewards > 0) {
            rewardsPerFourthRoot = (pendingRewards * 1e18) / fourthRoot(_amount);
            pendingRewards = 0;
            emit PendingRewardsClaimed(msg.sender, pendingRewards);
        }
        
        // Calculate old and new fourth root values
        uint256 oldFourthRoot = fourthRootStake[msg.sender];
        uint256 newStake = stakedBalance[msg.sender] + _amount;
        uint256 newFourthRoot = fourthRoot(newStake);
        
        // Update totals
        totalStaked += _amount;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        // Update user state
        stakedBalance[msg.sender] = newStake;
        fourthRootStake[msg.sender] = newFourthRoot;
        
        lpToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount);
    }

    function unstake(uint256 _amount) external nonReentrant updateRewards(msg.sender) {
        require(_amount > 0, "Cannot unstake 0");
        require(stakedBalance[msg.sender] >= _amount, "Insufficient staked balance");
        
        // Calculate old and new fourth root values
        uint256 oldFourthRoot = fourthRootStake[msg.sender];
        uint256 newStake = stakedBalance[msg.sender] - _amount;
        uint256 newFourthRoot = fourthRoot(newStake);
        
        // Update totals
        totalStaked -= _amount;
        totalFourthRootStake = totalFourthRootStake - oldFourthRoot + newFourthRoot;
        
        // Update user state
        stakedBalance[msg.sender] = newStake;
        fourthRootStake[msg.sender] = newFourthRoot;
        
        lpToken.safeTransfer(msg.sender, _amount);
        emit Unstaked(msg.sender, _amount);
    }
    
    function claimRewards() external nonReentrant updateRewards(msg.sender) {
        // The updateRewards modifier handles the logic
    }

    function addRewards(uint256 _amount) external onlyRole(REWARDER_ROLE) {
        require(_amount > 0, "Cannot add 0 rewards");
        SafeERC20.safeTransferFrom(IERC20(address(halomToken)), msg.sender, address(this), _amount);
        if (totalFourthRootStake == 0) {
            pendingRewards += _amount;
            emit RewardAdded(msg.sender, _amount);
        } else {
            rewardsPerFourthRoot += (_amount * 1e18) / totalFourthRootStake;
            emit RewardAdded(msg.sender, _amount);
        }
    }

    function getPendingRewardsForUser(address _account) external view returns (uint256) {
        return (fourthRootStake[_account] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_account];
    }

    /**
     * @dev Emergency recovery function to withdraw tokens sent by mistake
     * @param _token Token address to recover
     * @param _to Address to send tokens to
     * @param _amount Amount to recover
     */
    function emergencyRecovery(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_to != address(0),
            "Cannot recover to zero address"
        );
        require(_amount > 0,
            "Cannot recover 0 amount"
        );
        // Prevent recovery of staked LP tokens
        require(_token != address(lpToken),
            "Cannot recover staked LP tokens"
        );
        // For reward tokens, only allow recovery of excess amounts
        if (_token == address(halomToken)) {
            uint256 contractBalance = halomToken.balanceOf(address(this));
            uint256 requiredBalance = pendingRewards;
            require(
                _amount <= contractBalance - requiredBalance,
                "Cannot recover required rewards"
            );
        }
        
        IERC20(_token).safeTransfer(_to, _amount);
        emit EmergencyRecovery(_token, _to, _amount);
    }

    /**
     * @dev Get pending rewards for first staker
     */
    function getPendingRewards() external view returns (uint256) {
        return pendingRewards;
    }

    /**
     * @dev Get total contract balances
     */
    function getContractBalances() external view returns (
        uint256 lpTokenBalance,
        uint256 halomTokenBalance,
        uint256 pendingRewardsBalance
    ) {
        lpTokenBalance = lpToken.balanceOf(address(this));
        halomTokenBalance = halomToken.balanceOf(address(this));
        pendingRewardsBalance = pendingRewards;
    }

    /**
     * @dev Get total fourth root stake
     */
    function getTotalFourthRootStake() external view returns (uint256) {
        return totalFourthRootStake;
    }
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./HalomToken.sol";

/**
 * @title HalomTreasury
 * @dev Treasury contract for managing protocol fees and DAO funds
 */
contract HalomTreasury is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable halomToken;
    IERC20 public immutable eurcToken; // EURC instead of DAI

    // Fourth root based fee distribution
    uint256 public totalFourthRootFees; // Sum of fourth roots of all fee contributions
    mapping(address => uint256) public fourthRootFees; // Fourth root of user's fee contribution
    uint256 public rewardsPerFourthRoot; // Rewards per fourth root unit
    mapping(address => uint256) public rewardDebt;

    // Fee collection
    uint256 public totalFeesCollected;
    mapping(address => uint256) public userFeeContributions;

    // Treasury parameters
    uint256 public feeRate = 25; // 0.25% in basis points
    uint256 public constant MAX_FEE_RATE = 100; // 1% maximum
    uint256 public constant MIN_FEE_RATE = 1; // 0.01% minimum

    event FeeCollected(address indexed user, uint256 amount, uint256 fourthRoot);
    event FeeDistributed(address indexed user, uint256 amount);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event EmergencyRecovery(address indexed token, address indexed to, uint256 amount);
    event TreasuryPaused(address indexed pauser);
    event TreasuryUnpaused(address indexed unpauser);

    constructor(
        address _halomToken,
        address _eurcToken,
        address _governor,
        address _operator,
        address _pauser
    ) {
        require(_halomToken != address(0), "Halom token is zero address");
        require(_eurcToken != address(0), "EURC token is zero address");

        halomToken = IERC20(_halomToken);
        eurcToken = IERC20(_eurcToken);

        _grantRole(DEFAULT_ADMIN_ROLE, _governor);
        _grantRole(GOVERNOR_ROLE, _governor);
        _grantRole(OPERATOR_ROLE, _operator);
        _grantRole(PAUSER_ROLE, _pauser);
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
     * @dev Get governance power (fourth root of fee contribution)
     */
    function getGovernancePower(address user) public view returns (uint256) {
        return fourthRoot(userFeeContributions[user]);
    }

    modifier updateRewards(address _account) {
        uint256 pending = (fourthRootFees[_account] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_account];
        if (pending > 0) {
            halomToken.safeTransfer(_account, pending);
            emit FeeDistributed(_account, pending);
        }
        _;
        rewardDebt[_account] = (fourthRootFees[_account] * rewardsPerFourthRoot) / 1e18;
    }

    /**
     * @dev Collect fees from users (called by other contracts)
     */
    function collectFee(address user, uint256 amount) external onlyRole(OPERATOR_ROLE) {
        require(amount > 0, "Fee amount must be greater than 0");
        
        // Calculate old and new fourth root values
        uint256 oldFourthRoot = fourthRootFees[user];
        uint256 newFeeContribution = userFeeContributions[user] + amount;
        uint256 newFourthRoot = fourthRoot(newFeeContribution);
        
        // Update totals
        totalFeesCollected += amount;
        totalFourthRootFees = totalFourthRootFees - oldFourthRoot + newFourthRoot;
        
        // Update user state
        userFeeContributions[user] = newFeeContribution;
        fourthRootFees[user] = newFourthRoot;
        
        emit FeeCollected(user, amount, newFourthRoot);
    }

    /**
     * @dev Distribute fees to users based on fourth root of their contributions
     */
    function distributeFees(uint256 amount) external onlyRole(OPERATOR_ROLE) {
        require(amount > 0, "Distribution amount must be greater than 0");
        require(totalFourthRootFees > 0, "No fee contributors to distribute to");
        
        halomToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardsPerFourthRoot += (amount * 1e18) / totalFourthRootFees;
    }

    /**
     * @dev Claim distributed fees
     */
    function claimFees() external nonReentrant whenNotPaused updateRewards(msg.sender) {
        // The updateRewards modifier handles the logic
    }

    /**
     * @dev Get pending fees for a user
     */
    function getPendingFeesForUser(address _account) external view returns (uint256) {
        return (fourthRootFees[_account] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_account];
    }

    /**
     * @dev Update fee rate (only governor)
     */
    function setFeeRate(uint256 newFeeRate) external onlyRole(GOVERNOR_ROLE) {
        require(newFeeRate >= MIN_FEE_RATE && newFeeRate <= MAX_FEE_RATE, "Fee rate out of bounds");
        uint256 oldRate = feeRate;
        feeRate = newFeeRate;
        emit FeeRateUpdated(oldRate, newFeeRate);
    }

    /**
     * @dev Calculate fee for a given amount
     */
    function calculateFee(uint256 amount) public view returns (uint256) {
        return (amount * feeRate) / 10000; // Basis points
    }

    /**
     * @dev Emergency recovery function
     */
    function emergencyRecovery(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_to != address(0), "Cannot recover to zero address");
        require(_amount > 0, "Cannot recover 0 amount");
        
        IERC20(_token).safeTransfer(_to, _amount);
        emit EmergencyRecovery(_token, _to, _amount);
    }

    /**
     * @dev Pause treasury operations (only pauser)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit TreasuryPaused(msg.sender);
    }

    /**
     * @dev Unpause treasury operations (only governor)
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
        emit TreasuryUnpaused(msg.sender);
    }

    /**
     * @dev Get treasury statistics
     */
    function getTreasuryStats() external view returns (
        uint256 totalFees,
        uint256 totalFourthRootFeesValue,
        uint256 currentFeeRate,
        uint256 halomBalance,
        uint256 eurcBalance
    ) {
        totalFees = totalFeesCollected;
        totalFourthRootFeesValue = totalFourthRootFees;
        currentFeeRate = feeRate;
        halomBalance = halomToken.balanceOf(address(this));
        eurcBalance = eurcToken.balanceOf(address(this));
    }

    /**
     * @dev Get user's fee contribution statistics
     */
    function getUserFeeStats(address _user) external view returns (
        uint256 feeContribution,
        uint256 fourthRootValue,
        uint256 governancePower,
        uint256 pendingFees
    ) {
        feeContribution = userFeeContributions[_user];
        fourthRootValue = fourthRootFees[_user];
        governancePower = getGovernancePower(_user);
        pendingFees = (fourthRootFees[_user] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_user];
    }
} 
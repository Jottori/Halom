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

    // Fee distribution addresses
    address public stakingAddress;
    address public lpStakingAddress;
    address public daoReserveAddress;
    
    // Fee distribution percentages (in basis points)
    uint256 public stakingFeePercentage = 6000; // 60%
    uint256 public lpStakingFeePercentage = 2000; // 20%
    uint256 public daoReserveFeePercentage = 2000; // 20%

    event FeeCollected(address indexed user, uint256 amount, uint256 fourthRoot);
    event FeeDistributed(address indexed user, uint256 amount);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event EmergencyRecovery(address indexed token, address indexed to, uint256 amount);
    event TreasuryPaused(address indexed pauser);
    event TreasuryUnpaused(address indexed unpauser);
    event FeeDistributionUpdated(address staking, address lpStaking, address daoReserve);
    event FeePercentagesUpdated(uint256 staking, uint256 lpStaking, uint256 daoReserve);

    constructor(
        address _halomToken,
        address _eurcToken,
        address _governor,
        address _operator,
        address _pauser
    ) {
        require(_halomToken != address(0), "Halom token is zero address");
        require(_eurcToken != address(0), "EURC token is zero address");
        require(_governor != address(0), "Governor is zero address");
        require(_operator != address(0), "Operator is zero address");
        require(_pauser != address(0), "Pauser is zero address");

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

    /**
     * @dev Update fee distribution addresses (only governor)
     */
    function updateFeeDistributionAddresses(
        address _stakingAddress,
        address _lpStakingAddress,
        address _daoReserveAddress
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_stakingAddress != address(0), "Staking address cannot be zero");
        require(_lpStakingAddress != address(0), "LP staking address cannot be zero");
        require(_daoReserveAddress != address(0), "DAO reserve address cannot be zero");
        
        stakingAddress = _stakingAddress;
        lpStakingAddress = _lpStakingAddress;
        daoReserveAddress = _daoReserveAddress;
        
        emit FeeDistributionUpdated(_stakingAddress, _lpStakingAddress, _daoReserveAddress);
    }

    /**
     * @dev Update fee distribution percentages (only governor)
     */
    function updateFeePercentages(
        uint256 _stakingPercentage,
        uint256 _lpStakingPercentage,
        uint256 _daoReservePercentage
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_stakingPercentage + _lpStakingPercentage + _daoReservePercentage == 10000, "Percentages must sum to 100%");
        require(_stakingPercentage > 0, "Staking percentage must be greater than 0");
        require(_lpStakingPercentage > 0, "LP staking percentage must be greater than 0");
        require(_daoReservePercentage > 0, "DAO reserve percentage must be greater than 0");
        
        stakingFeePercentage = _stakingPercentage;
        lpStakingFeePercentage = _lpStakingPercentage;
        daoReserveFeePercentage = _daoReservePercentage;
        
        emit FeePercentagesUpdated(_stakingPercentage, _lpStakingPercentage, _daoReservePercentage);
    }

    /**
     * @dev Distribute collected fees to staking contracts and DAO reserve
     */
    function distributeCollectedFees() external onlyRole(OPERATOR_ROLE) {
        uint256 halomBalance = halomToken.balanceOf(address(this));
        uint256 eurcBalance = eurcToken.balanceOf(address(this));
        
        require(halomBalance > 0 || eurcBalance > 0, "No fees to distribute");
        
        // Validate addresses before distribution
        require(stakingAddress != address(0), "Staking address not set");
        require(lpStakingAddress != address(0), "LP staking address not set");
        require(daoReserveAddress != address(0), "DAO reserve address not set");
        
        // Distribute HLM tokens
        if (halomBalance > 0) {
            uint256 stakingAmount = (halomBalance * stakingFeePercentage) / 10000;
            uint256 lpStakingAmount = (halomBalance * lpStakingFeePercentage) / 10000;
            uint256 daoReserveAmount = halomBalance - stakingAmount - lpStakingAmount; // Remainder to avoid rounding errors
            
            if (stakingAmount > 0) {
                halomToken.safeTransfer(stakingAddress, stakingAmount);
            }
            if (lpStakingAmount > 0) {
                halomToken.safeTransfer(lpStakingAddress, lpStakingAmount);
            }
            if (daoReserveAmount > 0) {
                halomToken.safeTransfer(daoReserveAddress, daoReserveAmount);
            }
        }
        
        // Distribute EURC tokens
        if (eurcBalance > 0) {
            uint256 stakingAmount = (eurcBalance * stakingFeePercentage) / 10000;
            uint256 lpStakingAmount = (eurcBalance * lpStakingFeePercentage) / 10000;
            uint256 daoReserveAmount = eurcBalance - stakingAmount - lpStakingAmount; // Remainder to avoid rounding errors
            
            if (stakingAmount > 0) {
                eurcToken.safeTransfer(stakingAddress, stakingAmount);
            }
            if (lpStakingAmount > 0) {
                eurcToken.safeTransfer(lpStakingAddress, lpStakingAmount);
            }
            if (daoReserveAmount > 0) {
                eurcToken.safeTransfer(daoReserveAddress, daoReserveAmount);
            }
        }
    }
} 
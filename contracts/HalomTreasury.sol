// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./HalomToken.sol";
import "./interfaces/IHalomInterfaces.sol";

/**
 * @title HalomTreasury
 * @dev Treasury contract for managing protocol fees and DAO funds
 * Implements secure role structure with proper governance controls
 */
contract HalomTreasury is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant TREASURY_CONTROLLER = keccak256("TREASURY_CONTROLLER");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IHalomToken public immutable halomToken;
    IERC20 public immutable eurcToken; // EURC instead of DAI
    IHalomRoleManager public roleManager;

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

    // Treasury management
    uint256 public maxWithdrawalAmount = 1000000e18; // 1M HLM max withdrawal
    uint256 public withdrawalCooldown = 24 hours;
    mapping(address => uint256) public lastWithdrawalTime;

    event FeeCollected(address indexed user, uint256 amount, uint256 fourthRoot);
    event FeeDistributed(address indexed user, uint256 amount);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event EmergencyRecovery(address indexed token, address indexed to, uint256 amount);
    event TreasuryPaused(address indexed pauser);
    event TreasuryUnpaused(address indexed unpauser);
    event FeeDistributionUpdated(address staking, address lpStaking, address daoReserve);
    event FeePercentagesUpdated(uint256 staking, uint256 lpStaking, uint256 daoReserve);
    event TreasuryWithdrawal(address indexed to, uint256 amount, address indexed controller);
    event WithdrawalParametersUpdated(uint256 maxAmount, uint256 cooldown);

    constructor(
        address _halomToken,
        address _eurcToken,
        address _roleManager
    ) {
        require(_halomToken != address(0), "Halom token is zero address");
        require(_eurcToken != address(0), "EURC token is zero address");
        require(_roleManager != address(0), "Role manager is zero address");

        halomToken = IHalomToken(_halomToken);
        eurcToken = IERC20(_eurcToken);
        roleManager = IHalomRoleManager(_roleManager);
        
        // Roles will be granted by deployment script, not in constructor
        _grantRole(DEFAULT_ADMIN_ROLE, _roleManager);
        _grantRole(GOVERNOR_ROLE, _roleManager);
        _grantRole(TREASURY_CONTROLLER, _roleManager);
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
     * @dev Collect fees from user (only treasury controller)
     */
    function collectFees(address _user, uint256 _amount) external onlyRole(TREASURY_CONTROLLER) {
        require(_user != address(0), "Cannot collect from zero address");
        require(_amount > 0, "Cannot collect 0 fees");
        
        // Remove transferFrom since HalomToken now mints directly
        // halomToken.safeTransferFrom(_user, address(this), _amount);
        
        emit FeeCollected(_user, _amount, 0); // fourthRoot is 0 since we're not calculating it here
    }

    /**
     * @dev Distribute fees to users based on fourth root
     */
    function distributeFees(uint256 _amount) external onlyRole(TREASURY_CONTROLLER) {
        require(_amount > 0, "Amount must be greater than 0");
        require(_amount <= halomToken.balanceOf(address(this)), "Insufficient treasury balance");
        
        if (totalFourthRootFees > 0) {
            rewardsPerFourthRoot += (_amount * 1e18) / totalFourthRootFees;
        }
        
        emit FeeDistributed(msg.sender, _amount);
    }

    /**
     * @dev Claim user's fee rewards
     */
    function claimFeeRewards() external nonReentrant whenNotPaused {
        uint256 pending = (fourthRootFees[msg.sender] * rewardsPerFourthRoot) / 1e18 - rewardDebt[msg.sender];
        require(pending > 0, "No rewards to claim");
        
        // halomToken.safeTransfer(msg.sender, pending);
        SafeERC20.safeTransfer(IERC20(address(halomToken)), msg.sender, pending);
        rewardDebt[msg.sender] = (fourthRootFees[msg.sender] * rewardsPerFourthRoot) / 1e18;
        
        emit FeeDistributed(msg.sender, pending);
    }

    /**
     * @dev Withdraw treasury funds (only treasury controller)
     */
    function withdrawTreasuryFunds(
        address _to,
        uint256 _amount,
        bool _isEmergency
    ) external onlyRole(TREASURY_CONTROLLER) {
        require(_to != address(0), "Cannot withdraw to zero address");
        require(_amount > 0, "Amount must be greater than 0");
        require(_amount <= halomToken.balanceOf(address(this)), "Insufficient treasury balance");
        
        if (!_isEmergency) {
            require(_amount <= maxWithdrawalAmount, "Amount exceeds maximum withdrawal");
            require(block.timestamp >= lastWithdrawalTime[_to] + withdrawalCooldown, "Withdrawal cooldown not met");
            lastWithdrawalTime[_to] = block.timestamp;
        }
        
        // halomToken.safeTransfer(_to, _amount);
        SafeERC20.safeTransfer(IERC20(address(halomToken)), _to, _amount);
        
        emit TreasuryWithdrawal(_to, _amount, msg.sender);
    }

    /**
     * @dev Update fee rate (only governor)
     */
    function updateFeeRate(uint256 _newRate) external onlyRole(GOVERNOR_ROLE) {
        require(_newRate >= MIN_FEE_RATE && _newRate <= MAX_FEE_RATE, "Fee rate out of bounds");
        
        uint256 oldRate = feeRate;
        feeRate = _newRate;
        
        emit FeeRateUpdated(oldRate, _newRate);
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
     * @dev Update withdrawal parameters (only governor)
     */
    function updateWithdrawalParameters(uint256 _maxAmount, uint256 _cooldown) external onlyRole(GOVERNOR_ROLE) {
        require(_maxAmount > 0, "Max amount must be greater than 0");
        require(_cooldown <= 7 days, "Cooldown too long");
        
        maxWithdrawalAmount = _maxAmount;
        withdrawalCooldown = _cooldown;
        
        emit WithdrawalParametersUpdated(_maxAmount, _cooldown);
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
        require(_to != address(0), "Cannot recover to zero address");
        require(_amount > 0, "Cannot recover 0 amount");
        
        IERC20(_token).safeTransfer(_to, _amount);
        emit EmergencyRecovery(_token, _to, _amount);
    }

    /**
     * @dev Pause treasury operations (emergency)
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause treasury operations
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Get user's pending fee rewards
     */
    function getPendingFeeRewards(address _user) public view returns (uint256) {
        return (fourthRootFees[_user] * rewardsPerFourthRoot) / 1e18 - rewardDebt[_user];
    }

    /**
     * @dev Get treasury info
     */
    function getTreasuryInfo() external view returns (
        uint256 _totalFeesCollected,
        uint256 _totalFourthRootFees,
        uint256 _rewardsPerFourthRoot,
        uint256 _halomBalance,
        uint256 _eurcBalance
    ) {
        return (
            totalFeesCollected,
            totalFourthRootFees,
            rewardsPerFourthRoot,
            halomToken.balanceOf(address(this)),
            eurcToken.balanceOf(address(this))
        );
    }

    /**
     * @dev Get user's fee contribution info
     */
    function getUserFeeInfo(address _user) external view returns (
        uint256 _contribution,
        uint256 _fourthRoot,
        uint256 _pendingRewards
    ) {
        return (
            userFeeContributions[_user],
            fourthRootFees[_user],
            getPendingFeeRewards(_user)
        );
    }
} 
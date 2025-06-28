// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./HalomToken.sol";
import "./interfaces/IHalomInterfaces.sol";

// Custom errors for gas optimization (only those not already in HalomToken)
error AmountExceedsMaximum();
error WithdrawalCooldownNotMet();
error FeeRateOutOfBounds();
error EmergencyPaused();
error MultiSigRequired();
error WithdrawalLimitExceeded();
error NoRewardsToClaim();
error ZeroAddress();
error InvalidAmount();
error InsufficientBalance();
error Unauthorized();

/**
 * @title HalomTreasury
 * @dev Treasury contract for managing protocol fees and DAO funds
 * Implements secure role structure with proper governance controls
 * Includes protection against drain attacks and unauthorized withdrawals
 */
contract HalomTreasury is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant TREASURY_CONTROLLER = keccak256("TREASURY_CONTROLLER");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

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
    
    // Enhanced security features
    bool public emergencyPaused;
    uint256 public dailyWithdrawalLimit = 5000000e18; // 5M HLM daily limit
    uint256 public dailyWithdrawalUsed;
    uint256 public lastDailyReset;
    
    // Time-based reward distribution
    uint256 public lastDistributionTime;
    uint256 public daoReserveBalance;
    
    // Multi-sig withdrawal system
    mapping(bytes32 => WithdrawalRequest) public withdrawalRequests;
    mapping(bytes32 => mapping(address => bool)) public withdrawalApprovals;
    uint256 public constant WITHDRAWAL_APPROVAL_THRESHOLD = 2; // 2 approvals required
    uint256 public constant WITHDRAWAL_REQUEST_EXPIRY = 7 days; // 7 days expiry
    
    // Withdrawal tracking
    mapping(address => uint256) public totalWithdrawn;
    mapping(address => uint256) public withdrawalCount;
    uint256 public constant MAX_WITHDRAWALS_PER_DAY = 5; // Max 5 withdrawals per day per address
    
    struct WithdrawalRequest {
        address to;
        uint256 amount;
        uint256 timestamp;
        bool executed;
        uint256 approvalCount;
        string reason;
    }

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
    event EmergencyPausedEvent(address indexed caller);
    event EmergencyResumed(address indexed caller);
    event WithdrawalRequestCreated(bytes32 indexed requestId, address indexed to, uint256 amount, string reason);
    event WithdrawalRequestApproved(bytes32 indexed requestId, address indexed approver);
    event WithdrawalRequestExecuted(bytes32 indexed requestId, address indexed to, uint256 amount);
    event DailyWithdrawalLimitReset(uint256 newLimit);

    constructor(
        address _halomToken,
        address _eurcToken,
        address _roleManager
    ) {
        if (_halomToken == address(0)) revert ZeroAddress();
        if (_eurcToken == address(0)) revert ZeroAddress();
        if (_roleManager == address(0)) revert ZeroAddress();

        halomToken = IHalomToken(_halomToken);
        eurcToken = IERC20(_eurcToken);
        roleManager = IHalomRoleManager(_roleManager);
        
        // Roles will be granted by deployment script, not in constructor
        _grantRole(DEFAULT_ADMIN_ROLE, _roleManager);
        _grantRole(GOVERNOR_ROLE, _roleManager);
        _grantRole(TREASURY_CONTROLLER, _roleManager);
        _grantRole(PAUSER_ROLE, _roleManager);
        _grantRole(EMERGENCY_ROLE, _roleManager);
        
        lastDailyReset = block.timestamp;
    }

    /**
     * @dev Emergency pause treasury
     */
    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        emergencyPaused = true;
        _pause();
        emit EmergencyPausedEvent(msg.sender);
    }
    
    /**
     * @dev Resume treasury
     */
    function emergencyResume() external onlyRole(GOVERNOR_ROLE) {
        emergencyPaused = false;
        _unpause();
        emit EmergencyResumed(msg.sender);
    }
    
    /**
     * @dev Set daily withdrawal limit
     */
    function setDailyWithdrawalLimit(uint256 newLimit) external onlyRole(GOVERNOR_ROLE) {
        if (newLimit == 0) revert InvalidAmount();
        dailyWithdrawalLimit = newLimit;
        emit DailyWithdrawalLimitReset(newLimit);
    }
    
    /**
     * @dev Reset daily withdrawal counter
     */
    function resetDailyWithdrawalCounter() external onlyRole(TREASURY_CONTROLLER) {
        uint256 currentDay = block.timestamp / 1 days;
        if (currentDay > lastDailyReset / 1 days) {
            dailyWithdrawalUsed = 0;
            lastDailyReset = block.timestamp;
            emit DailyWithdrawalLimitReset(dailyWithdrawalLimit);
        }
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
        if (_user == address(0)) revert ZeroAddress();
        if (_amount == 0) revert InvalidAmount();
        
        // Calculate fourth root of fee contribution
        uint256 fourthRootValue = fourthRoot(_amount);
        
        // Update user's fourth root fees
        fourthRootFees[_user] += fourthRootValue;
        totalFourthRootFees += fourthRootValue;
        
        // Update total fees collected
        totalFeesCollected += _amount;
        userFeeContributions[_user] += _amount;
        
        emit FeeCollected(_user, _amount, fourthRootValue);
    }

    /**
     * @dev Distribute fees to users based on fourth root
     */
    function distributeFees(uint256 _amount) external onlyRole(TREASURY_CONTROLLER) {
        if (_amount == 0) revert InvalidAmount();
        if (_amount > halomToken.balanceOf(address(this))) revert InsufficientBalance();
        
        if (totalFourthRootFees > 0) {
            rewardsPerFourthRoot += (_amount * 1e18) / totalFourthRootFees;
        }
        
        emit FeeDistributed(msg.sender, _amount);
    }

    /**
     * @dev Claim user's fee rewards
     */
    function claimFeeRewards() external nonReentrant whenNotPaused {
        if (emergencyPaused) revert EmergencyPaused();
        
        uint256 pending = (fourthRootFees[msg.sender] * rewardsPerFourthRoot) / 1e18 - rewardDebt[msg.sender];
        if (pending == 0) revert NoRewardsToClaim();
        
        // halomToken.safeTransfer(msg.sender, pending);
        SafeERC20.safeTransfer(IERC20(address(halomToken)), msg.sender, pending);
        rewardDebt[msg.sender] = (fourthRootFees[msg.sender] * rewardsPerFourthRoot) / 1e18;
        
        emit FeeDistributed(msg.sender, pending);
    }

    /**
     * @dev Create withdrawal request (multi-sig)
     */
    function createWithdrawalRequest(
        address _to,
        uint256 _amount,
        string memory _reason
    ) external onlyRole(TREASURY_CONTROLLER) returns (bytes32) {
        if (_to == address(0)) revert ZeroAddress();
        if (_amount == 0) revert InvalidAmount();
        if (_amount > halomToken.balanceOf(address(this))) revert InsufficientBalance();
        if (_amount > maxWithdrawalAmount) revert AmountExceedsMaximum();
        
        bytes32 requestId = keccak256(abi.encodePacked(_to, _amount, block.timestamp, _reason));
        
        withdrawalRequests[requestId] = WithdrawalRequest({
            to: _to,
            amount: _amount,
            timestamp: block.timestamp,
            executed: false,
            approvalCount: 0,
            reason: _reason
        });
        
        emit WithdrawalRequestCreated(requestId, _to, _amount, _reason);
        return requestId;
    }
    
    /**
     * @dev Approve withdrawal request
     */
    function approveWithdrawalRequest(bytes32 _requestId) external onlyRole(TREASURY_CONTROLLER) {
        WithdrawalRequest storage request = withdrawalRequests[_requestId];
        if (request.timestamp == 0) revert InvalidAmount();
        if (request.executed) revert InvalidAmount();
        if (block.timestamp > request.timestamp + WITHDRAWAL_REQUEST_EXPIRY) revert InvalidAmount();
        if (withdrawalApprovals[_requestId][msg.sender]) revert Unauthorized();
        
        withdrawalApprovals[_requestId][msg.sender] = true;
        request.approvalCount++;
        
        emit WithdrawalRequestApproved(_requestId, msg.sender);
        
        // Execute if enough approvals
        if (request.approvalCount >= WITHDRAWAL_APPROVAL_THRESHOLD) {
            _executeWithdrawalRequest(_requestId);
        }
    }
    
    /**
     * @dev Execute withdrawal request
     */
    function _executeWithdrawalRequest(bytes32 _requestId) internal {
        WithdrawalRequest storage request = withdrawalRequests[_requestId];
        
        // Check daily limits
        _checkDailyWithdrawalLimits(request.to, request.amount);
        
        SafeERC20.safeTransfer(IERC20(address(halomToken)), request.to, request.amount);
        request.executed = true;
        
        // Update tracking
        totalWithdrawn[request.to] += request.amount;
        withdrawalCount[request.to]++;
        dailyWithdrawalUsed += request.amount;
        
        emit WithdrawalRequestExecuted(_requestId, request.to, request.amount);
        emit TreasuryWithdrawal(request.to, request.amount, msg.sender);
    }
    
    /**
     * @dev Check daily withdrawal limits
     */
    function _checkDailyWithdrawalLimits(address _to, uint256 _amount) internal {
        // Reset daily counter if needed
        uint256 currentDay = block.timestamp / 1 days;
        if (currentDay > lastDailyReset / 1 days) {
            dailyWithdrawalUsed = 0;
            lastDailyReset = block.timestamp;
        }
        
        if (dailyWithdrawalUsed + _amount > dailyWithdrawalLimit) revert WithdrawalLimitExceeded();
        
        // Check per-address limits
        if (withdrawalCount[_to] >= MAX_WITHDRAWALS_PER_DAY) revert WithdrawalLimitExceeded();
    }

    /**
     * @dev Withdraw treasury funds (only treasury controller) - legacy function
     */
    function withdrawTreasuryFunds(
        address _to,
        uint256 _amount,
        bool _isEmergency
    ) external onlyRole(TREASURY_CONTROLLER) {
        if (emergencyPaused && !_isEmergency) revert EmergencyPaused();
        if (_to == address(0)) revert ZeroAddress();
        if (_amount == 0) revert InvalidAmount();
        if (_amount > halomToken.balanceOf(address(this))) revert InsufficientBalance();
        
        if (!_isEmergency) {
            if (_amount > maxWithdrawalAmount) revert AmountExceedsMaximum();
            if (block.timestamp < lastWithdrawalTime[_to] + withdrawalCooldown) revert WithdrawalCooldownNotMet();
            lastWithdrawalTime[_to] = block.timestamp;
            
            // Check daily limits
            _checkDailyWithdrawalLimits(_to, _amount);
        }
        
        SafeERC20.safeTransfer(IERC20(address(halomToken)), _to, _amount);
        
        emit TreasuryWithdrawal(_to, _amount, msg.sender);
    }

    /**
     * @dev Update fee rate (only governor)
     */
    function updateFeeRate(uint256 _newRate) external onlyRole(GOVERNOR_ROLE) {
        if (_newRate < MIN_FEE_RATE || _newRate > MAX_FEE_RATE) revert FeeRateOutOfBounds();
        
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
        if (_stakingAddress == address(0)) revert ZeroAddress();
        if (_lpStakingAddress == address(0)) revert ZeroAddress();
        if (_daoReserveAddress == address(0)) revert ZeroAddress();
        
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
        uint256 totalPercentage = _stakingPercentage + _lpStakingPercentage + _daoReservePercentage;
        require(totalPercentage == 10000, "Percentages must sum to 100%");
        
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

    /**
     * @dev Allocate funds to specific target (stake or LP reward)
     */
    function allocateTo(address target, uint256 amount) external onlyRole(TREASURY_CONTROLLER) {
        if (target == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (emergencyPaused) revert EmergencyPaused();
        
        // Check treasury balance
        uint256 treasuryBalance = halomToken.balanceOf(address(this));
        if (amount > treasuryBalance) revert InsufficientBalance();
        
        // Transfer tokens to target
        IERC20(address(halomToken)).safeTransfer(target, amount);
        
        emit TreasuryWithdrawal(target, amount, msg.sender);
    }

    /**
     * @dev Emergency drain treasury (only TREASURY_CONTROLLER)
     */
    function drainTreasury(address to) external onlyRole(TREASURY_CONTROLLER) {
        if (to == address(0)) revert ZeroAddress();
        if (emergencyPaused) revert EmergencyPaused();
        
        uint256 halomBalance = halomToken.balanceOf(address(this));
        uint256 eurcBalance = eurcToken.balanceOf(address(this));
        
        if (halomBalance > 0) {
            IERC20(address(halomToken)).safeTransfer(to, halomBalance);
        }
        
        if (eurcBalance > 0) {
            eurcToken.safeTransfer(to, eurcBalance);
        }
        
        emit EmergencyRecovery(address(halomToken), to, halomBalance);
        emit EmergencyRecovery(address(eurcToken), to, eurcBalance);
    }

    /**
     * @dev Time-based reward distribution (called by rebase trigger)
     */
    function distributeTimeBasedRewards() external onlyRole(TREASURY_CONTROLLER) {
        if (emergencyPaused) revert EmergencyPaused();
        
        uint256 currentTime = block.timestamp;
        uint256 timeSinceLastDistribution = currentTime - lastDistributionTime;
        
        // Distribute rewards every 24 hours
        if (timeSinceLastDistribution >= 1 days) {
            _executeDailyRewardDistribution();
            lastDistributionTime = currentTime;
        }
    }

    /**
     * @dev Execute daily reward distribution
     */
    function _executeDailyRewardDistribution() internal {
        uint256 treasuryBalance = halomToken.balanceOf(address(this));
        if (treasuryBalance == 0) return;
        
        // Calculate daily distribution amounts
        uint256 stakingReward = (treasuryBalance * stakingFeePercentage) / 10000;
        uint256 lpStakingReward = (treasuryBalance * lpStakingFeePercentage) / 10000;
        uint256 daoReserveAmount = (treasuryBalance * daoReserveFeePercentage) / 10000;
        
        // Distribute to staking contract
        if (stakingAddress != address(0) && stakingReward > 0) {
            IERC20(address(halomToken)).safeTransfer(stakingAddress, stakingReward);
            emit FeeDistributed(stakingAddress, stakingReward);
        }
        
        // Distribute to LP staking contract
        if (lpStakingAddress != address(0) && lpStakingReward > 0) {
            IERC20(address(halomToken)).safeTransfer(lpStakingAddress, lpStakingReward);
            emit FeeDistributed(lpStakingAddress, lpStakingReward);
        }
        
        // Keep DAO reserve in treasury
        if (daoReserveAmount > 0) {
            // Update DAO reserve tracking
            daoReserveBalance += daoReserveAmount;
            emit FeeDistributed(daoReserveAddress, daoReserveAmount);
        }
    }

    /**
     * @dev Set distribution addresses
     */
    function setDistributionAddresses(
        address _stakingAddress,
        address _lpStakingAddress,
        address _daoReserveAddress
    ) external onlyRole(GOVERNOR_ROLE) {
        stakingAddress = _stakingAddress;
        lpStakingAddress = _lpStakingAddress;
        daoReserveAddress = _daoReserveAddress;
        
        emit FeeDistributionUpdated(_stakingAddress, _lpStakingAddress, _daoReserveAddress);
    }

    /**
     * @dev Get treasury statistics
     */
    function getTreasuryStats() public view returns (
        uint256 totalFees,
        uint256 halomBalance,
        uint256 eurcBalance,
        uint256 daoReserve,
        uint256 dailyWithdrawalUsedCount,
        uint256 dailyWithdrawalLimitValue
    ) {
        return (
            totalFeesCollected,
            halomToken.balanceOf(address(this)),
            eurcToken.balanceOf(address(this)),
            daoReserveBalance,
            dailyWithdrawalUsed,
            dailyWithdrawalLimit
        );
    }

    /**
     * @dev Get user fee statistics
     */
    function getUserFeeStats(address user) public view returns (
        uint256 totalContribution,
        uint256 fourthRootFeesValue,
        uint256 rewardDebtValue,
        uint256 pendingRewards
    ) {
        uint256 userFourthRoot = fourthRootFees[user];
        uint256 pending = (userFourthRoot * rewardsPerFourthRoot) - rewardDebt[user];
        
        return (
            userFeeContributions[user],
            userFourthRoot,
            rewardDebt[user],
            pending
        );
    }
} 
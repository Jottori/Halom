// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/GovernanceMath.sol";
import "../libraries/GovernanceErrors.sol";

/**
 * @title HalomTreasury
 * @dev Minimal, modular, branchless, EVM-limit-safe treasury contract for DAO rewards and allocations.
 */
contract HalomTreasury is AccessControl {
    using SafeERC20 for IERC20;
    using GovernanceMath for uint256;
    using GovernanceErrors for *;

    bytes32 public constant TREASURY_CONTROLLER = keccak256("TREASURY_CONTROLLER");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    IERC20 public rewardToken;
    uint256 public lastDistribution;
    uint256 public immutable distributionInterval;
    
    // Reward exhaustion handling
    uint256 public constant MIN_REWARD_THRESHOLD = 1000e18; // 1000 HOM minimum
    uint256 public constant REWARD_EXHAUSTION_WARNING_THRESHOLD = 5000e18; // 5000 HOM warning
    bool public rewardExhaustionWarning;
    uint256 public lastExhaustionCheck;
    uint256 public constant EXHAUSTION_CHECK_INTERVAL = 1 hours;

    event Allocated(address indexed to, uint256 amount);
    event RewardTokenSet(address indexed token);
    event TreasuryDrained(address indexed to, uint256 amount);
    event EmergencyDrained(address indexed to, uint256 amount);
    event RewardExhaustionWarning(uint256 currentBalance, uint256 threshold);
    event FallbackFundingRequested(uint256 requestedAmount, address indexed requester);
    event FallbackFundingReceived(uint256 amount, address indexed funder);

    error Unauthorized();
    error InvalidToken();
    error InvalidAmount();
    error DistributionTooSoon();
    error RewardExhausted();
    error InsufficientBalance();
    error ExhaustionCheckTooFrequent();

    constructor(address _rewardToken, address _roleManager, uint256 _interval) {
        if (_rewardToken == address(0) || _roleManager == address(0)) revert InvalidToken();
        rewardToken = IERC20(_rewardToken);
        distributionInterval = _interval;
        _grantRole(DEFAULT_ADMIN_ROLE, _roleManager);
        _grantRole(TREASURY_CONTROLLER, _roleManager);
        _grantRole(EMERGENCY_ROLE, _roleManager);
        
        // Also grant CONTROLLER_ROLE to msg.sender for testing
        _grantRole(TREASURY_CONTROLLER, msg.sender);
    }

    modifier onlyController() {
        if (!hasRole(TREASURY_CONTROLLER, msg.sender)) revert Unauthorized();
        _;
    }
    modifier onlyEmergency() {
        if (!hasRole(EMERGENCY_ROLE, msg.sender)) revert Unauthorized();
        _;
    }

    function setRewardToken(address _token) external onlyController {
        if (_token == address(0)) revert InvalidToken();
        rewardToken = IERC20(_token);
        emit RewardTokenSet(_token);
    }

    function allocateTo(address to, uint256 amount) external onlyController {
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp < lastDistribution + distributionInterval) revert DistributionTooSoon();
        
        uint256 currentBalance = rewardToken.balanceOf(address(this));
        if (currentBalance < amount) revert InsufficientBalance();
        
        // Check for exhaustion before allocation
        if (currentBalance - amount <= MIN_REWARD_THRESHOLD) {
            rewardExhaustionWarning = true;
            emit RewardExhaustionWarning(currentBalance - amount, MIN_REWARD_THRESHOLD);
        }
        
        rewardToken.safeTransfer(to, amount);
        lastDistribution = block.timestamp;
        emit Allocated(to, amount);
    }

    function drainTreasury(address to, uint256 amount) external onlyController {
        if (amount == 0) revert InvalidAmount();
        
        uint256 currentBalance = rewardToken.balanceOf(address(this));
        if (currentBalance < amount) revert InsufficientBalance();
        
        // Check for exhaustion before draining
        if (currentBalance - amount <= MIN_REWARD_THRESHOLD) {
            rewardExhaustionWarning = true;
            emit RewardExhaustionWarning(currentBalance - amount, MIN_REWARD_THRESHOLD);
        }
        
        rewardToken.safeTransfer(to, amount);
        emit TreasuryDrained(to, amount);
    }

    function emergencyDrain(address to, uint256 amount) external onlyEmergency {
        if (amount == 0) revert InvalidAmount();
        rewardToken.safeTransfer(to, amount);
        emit EmergencyDrained(to, amount);
    }

    function emergencyDrain(address token, address to, uint256 amount) external onlyEmergency {
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyDrained(to, amount);
    }

    // --- Reward exhaustion handling ---
    function checkRewardExhaustion() external {
        if (block.timestamp < lastExhaustionCheck + EXHAUSTION_CHECK_INTERVAL) {
            revert ExhaustionCheckTooFrequent();
        }
        
        uint256 currentBalance = rewardToken.balanceOf(address(this));
        lastExhaustionCheck = block.timestamp;
        
        if (currentBalance <= MIN_REWARD_THRESHOLD) {
            rewardExhaustionWarning = true;
            emit RewardExhaustionWarning(currentBalance, MIN_REWARD_THRESHOLD);
        } else if (currentBalance <= REWARD_EXHAUSTION_WARNING_THRESHOLD) {
            rewardExhaustionWarning = true;
            emit RewardExhaustionWarning(currentBalance, REWARD_EXHAUSTION_WARNING_THRESHOLD);
        } else {
            rewardExhaustionWarning = false;
        }
    }
    
    function requestFallbackFunding(uint256 amount) external onlyController {
        if (amount == 0) revert InvalidAmount();
        emit FallbackFundingRequested(amount, msg.sender);
    }
    
    function provideFallbackFunding(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit FallbackFundingReceived(amount, msg.sender);
        
        // Reset warning if balance is sufficient
        uint256 currentBalance = rewardToken.balanceOf(address(this));
        if (currentBalance > REWARD_EXHAUSTION_WARNING_THRESHOLD) {
            rewardExhaustionWarning = false;
        }
    }
} 
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./HalomToken.sol";

/**
 * @title HalomTreasury
 * @dev Treasury contract for managing protocol fees and DAO funds
 */
contract HalomTreasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    HalomToken public halomToken;
    
    // Fee collection addresses
    address public stakingRewardsAddress;
    address public lpStakingRewardsAddress;
    address public daoReserveAddress;
    
    // Fee percentages (in basis points, 100 = 1%)
    uint256 public stakingRewardsFee = 6000; // 60% to staking rewards
    uint256 public lpStakingRewardsFee = 2000; // 20% to LP staking rewards
    uint256 public daoReserveFee = 2000; // 20% to DAO reserve
    
    // Emergency pause
    bool public paused;
    
    event FeesDistributed(
        uint256 totalAmount,
        uint256 stakingRewards,
        uint256 lpStakingRewards,
        uint256 daoReserve
    );
    
    event FeePercentagesUpdated(
        uint256 stakingRewardsFee,
        uint256 lpStakingRewardsFee,
        uint256 daoReserveFee
    );
    
    event AddressesUpdated(
        address stakingRewardsAddress,
        address lpStakingRewardsAddress,
        address daoReserveAddress
    );

    constructor(address _governance, address _halomToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        _grantRole(OPERATOR_ROLE, _governance);
        
        halomToken = HalomToken(_halomToken);
    }

    modifier whenNotPaused() {
        require(!paused, "Treasury: paused");
        _;
    }

    /**
     * @dev Distribute fees to different addresses
     */
    function distributeFees() external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        uint256 balance = halomToken.balanceOf(address(this));
        require(balance > 0, "Treasury: no fees to distribute");
        
        uint256 stakingRewards = (balance * stakingRewardsFee) / 10000;
        uint256 lpStakingRewards = (balance * lpStakingRewardsFee) / 10000;
        uint256 daoReserve = balance - stakingRewards - lpStakingRewards; // Remainder to avoid rounding errors
        
        if (stakingRewards > 0 && stakingRewardsAddress != address(0)) {
            halomToken.safeTransfer(stakingRewardsAddress, stakingRewards);
        }
        
        if (lpStakingRewards > 0 && lpStakingRewardsAddress != address(0)) {
            halomToken.safeTransfer(lpStakingRewardsAddress, lpStakingRewards);
        }
        
        if (daoReserve > 0 && daoReserveAddress != address(0)) {
            halomToken.safeTransfer(daoReserveAddress, daoReserve);
        }
        
        emit FeesDistributed(balance, stakingRewards, lpStakingRewards, daoReserve);
    }

    /**
     * @dev Update fee distribution percentages
     */
    function updateFeePercentages(
        uint256 _stakingRewardsFee,
        uint256 _lpStakingRewardsFee,
        uint256 _daoReserveFee
    ) external onlyRole(GOVERNOR_ROLE) {
        require(
            _stakingRewardsFee + _lpStakingRewardsFee + _daoReserveFee == 10000,
            "Treasury: fees must sum to 100%"
        );
        
        stakingRewardsFee = _stakingRewardsFee;
        lpStakingRewardsFee = _lpStakingRewardsFee;
        daoReserveFee = _daoReserveFee;
        
        emit FeePercentagesUpdated(_stakingRewardsFee, _lpStakingRewardsFee, _daoReserveFee);
    }

    /**
     * @dev Update fee collection addresses
     */
    function updateAddresses(
        address _stakingRewardsAddress,
        address _lpStakingRewardsAddress,
        address _daoReserveAddress
    ) external onlyRole(GOVERNOR_ROLE) {
        stakingRewardsAddress = _stakingRewardsAddress;
        lpStakingRewardsAddress = _lpStakingRewardsAddress;
        daoReserveAddress = _daoReserveAddress;
        
        emit AddressesUpdated(_stakingRewardsAddress, _lpStakingRewardsAddress, _daoReserveAddress);
    }

    /**
     * @dev Emergency withdraw tokens (only governor)
     */
    function emergencyWithdraw(address token, address to, uint256 amount) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev Pause/unpause treasury operations
     */
    function setPaused(bool _paused) external onlyRole(GOVERNOR_ROLE) {
        paused = _paused;
    }

    /**
     * @dev Get current fee distribution
     */
    function getFeeDistribution() external view returns (
        uint256 _stakingRewardsFee,
        uint256 _lpStakingRewardsFee,
        uint256 _daoReserveFee
    ) {
        return (stakingRewardsFee, lpStakingRewardsFee, daoReserveFee);
    }

    /**
     * @dev Get current balances
     */
    function getBalances() external view returns (
        uint256 halomBalance,
        uint256 stakingRewardsBalance,
        uint256 lpStakingRewardsBalance,
        uint256 daoReserveBalance
    ) {
        halomBalance = halomToken.balanceOf(address(this));
        stakingRewardsBalance = stakingRewardsAddress != address(0) ? 
            halomToken.balanceOf(stakingRewardsAddress) : 0;
        lpStakingRewardsBalance = lpStakingRewardsAddress != address(0) ? 
            halomToken.balanceOf(lpStakingRewardsAddress) : 0;
        daoReserveBalance = daoReserveAddress != address(0) ? 
            halomToken.balanceOf(daoReserveAddress) : 0;
    }
} 
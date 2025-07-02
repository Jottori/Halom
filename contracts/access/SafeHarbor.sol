// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Safe Harbor contract for whitehat security researchers to rescue protocol funds
 * during active blackhat attacks. Implements Immunefi Safe Harbor framework.
 */
contract SafeHarbor is Ownable, Pausable {
    using SafeERC20 for IERC20;

    // Immunefi vault address for rescued funds
    address public immutable immunefiVault;
    
    // Emergency admin addresses
    mapping(address => bool) public emergencyAdmins;
    
    // Whitehat registry
    mapping(address => bool) public authorizedWhitehats;
    
    // Safe Harbor state
    bool public safeHarborActive;
    uint256 public constant MAX_REWARD_PERCENTAGE = 60; // 60% of rescued funds
    
    // Events
    event SafeHarborActivated(address indexed whitehat, uint256 rescuedAmount, string reason);
    event FundsRescued(address indexed whitehat, address indexed token, uint256 amount);
    event RewardClaimed(address indexed whitehat, uint256 reward);
    event WhitehatAuthorized(address indexed whitehat);
    event WhitehatRemoved(address indexed whitehat);
    event EmergencyAdminAdded(address indexed admin);
    event EmergencyAdminRemoved(address indexed admin);
    
    // Errors
    error NotAuthorizedWhitehat();
    error NotEmergencyAdmin();
    error SafeHarborNotActive();
    error InvalidRewardPercentage();
    error NoFundsToRescue();
    error TransferFailed();
    
    /**
     * @dev Constructor
     * @param _immunefiVault Address of Immunefi vault
     * @param _owner Owner of the contract
     */
    constructor(address _immunefiVault, address _owner) Ownable(_owner) {
        require(_immunefiVault != address(0), "Invalid vault address");
        require(_owner != address(0), "Invalid owner address");
        
        immunefiVault = _immunefiVault;
        
        // Add owner as emergency admin
        emergencyAdmins[_owner] = true;
        emit EmergencyAdminAdded(_owner);
    }
    
    /**
     * @dev Modifier for authorized whitehats
     */
    modifier onlyWhitehat() {
        if (!authorizedWhitehats[msg.sender]) {
            revert NotAuthorizedWhitehat();
        }
        _;
    }
    
    /**
     * @dev Modifier for emergency admins
     */
    modifier onlyEmergencyAdmin() {
        if (!emergencyAdmins[msg.sender]) {
            revert NotEmergencyAdmin();
        }
        _;
    }
    
    /**
     * @dev Activate Safe Harbor mode
     * @param reason Reason for activation
     */
    function activateSafeHarbor(string memory reason) external onlyWhitehat {
        safeHarborActive = true;
        emit SafeHarborActivated(msg.sender, 0, reason);
    }
    
    /**
     * @dev Deactivate Safe Harbor mode
     */
    function deactivateSafeHarbor() external onlyEmergencyAdmin {
        safeHarborActive = false;
    }
    
    /**
     * @dev Rescue funds from a target contract
     * @param target Target contract address
     * @param token Token address to rescue
     * @param amount Amount to rescue
     */
    function rescueFunds(
        address target,
        address token,
        uint256 amount
    ) external onlyWhitehat {
        if (!safeHarborActive) {
            revert SafeHarborNotActive();
        }
        
        if (amount == 0) {
            revert NoFundsToRescue();
        }
        
        // Transfer funds from target to Immunefi vault
        IERC20(token).safeTransferFrom(target, immunefiVault, amount);
        
        emit FundsRescued(msg.sender, token, amount);
    }
    
    /**
     * @dev Claim reward for rescued funds
     * @param rescuedAmount Total amount rescued
     * @param rewardPercentage Percentage of rescued amount as reward (max 60%)
     */
    function claimReward(uint256 rescuedAmount, uint256 rewardPercentage) external onlyWhitehat {
        if (rewardPercentage > MAX_REWARD_PERCENTAGE) {
            revert InvalidRewardPercentage();
        }
        
        uint256 reward = (rescuedAmount * rewardPercentage) / 100;
        
        // Transfer reward from Immunefi vault to whitehat
        IERC20(address(0)).safeTransferFrom(immunefiVault, msg.sender, reward);
        
        emit RewardClaimed(msg.sender, reward);
    }
    
    /**
     * @dev Add authorized whitehat
     * @param whitehat Whitehat address
     */
    function addWhitehat(address whitehat) external onlyEmergencyAdmin {
        require(whitehat != address(0), "Invalid whitehat address");
        authorizedWhitehats[whitehat] = true;
        emit WhitehatAuthorized(whitehat);
    }
    
    /**
     * @dev Remove authorized whitehat
     * @param whitehat Whitehat address
     */
    function removeWhitehat(address whitehat) external onlyEmergencyAdmin {
        authorizedWhitehats[whitehat] = false;
        emit WhitehatRemoved(whitehat);
    }
    
    /**
     * @dev Add emergency admin
     * @param admin Admin address
     */
    function addEmergencyAdmin(address admin) external onlyOwner {
        require(admin != address(0), "Invalid admin address");
        emergencyAdmins[admin] = true;
        emit EmergencyAdminAdded(admin);
    }
    
    /**
     * @dev Remove emergency admin
     * @param admin Admin address
     */
    function removeEmergencyAdmin(address admin) external onlyOwner {
        emergencyAdmins[admin] = false;
        emit EmergencyAdminRemoved(admin);
    }
    
    /**
     * @dev Pause Safe Harbor operations
     */
    function pause() external onlyEmergencyAdmin {
        _pause();
    }
    
    /**
     * @dev Unpause Safe Harbor operations
     */
    function unpause() external onlyEmergencyAdmin {
        _unpause();
    }
    
    /**
     * @dev Check if address is authorized whitehat
     * @param whitehat Address to check
     * @return True if authorized
     */
    function isAuthorizedWhitehat(address whitehat) external view returns (bool) {
        return authorizedWhitehats[whitehat];
    }
    
    /**
     * @dev Check if address is emergency admin
     * @param admin Address to check
     * @return True if emergency admin
     */
    function isEmergencyAdmin(address admin) external view returns (bool) {
        return emergencyAdmins[admin];
    }
    
    /**
     * @dev Get Safe Harbor status
     * @return active True if Safe Harbor is active
     * @return paused True if contract is paused
     */
    function getSafeHarborStatus() external view returns (bool active, bool paused) {
        return (safeHarborActive, paused());
    }
} 

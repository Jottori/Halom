// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Blacklist
 * @dev Address blacklisting utility for token transfers
 * Implements blacklist management with reasons and timestamps
 */
library Blacklist {
    
    struct BlacklistData {
        mapping(address => bool) blacklisted;
        mapping(address => string) blacklistReasons;
        mapping(address => uint256) blacklistTimestamps;
        mapping(address => address) blacklistedBy;
        uint256 totalBlacklisted;
        bool blacklistEnabled;
    }

    // Events
    event AddressBlacklisted(address indexed account, string reason, address indexed by);
    event AddressUnBlacklisted(address indexed account, address indexed by);
    event BlacklistEnabled(bool enabled);
    event BlacklistReasonUpdated(address indexed account, string reason);

    // Errors
    error AddressAlreadyBlacklisted();
    error AddressNotBlacklisted();
    error BlacklistNotEnabled();
    error InvalidAddress();
    error UnauthorizedBlacklistOperation();

    /**
     * @dev Blacklist an address
     * @param data Blacklist data storage
     * @param account Address to blacklist
     * @param reason Reason for blacklisting
     */
    function blacklist(
        BlacklistData storage data,
        address account,
        string memory reason
    ) internal {
        if (account == address(0)) revert InvalidAddress();
        if (data.blacklisted[account]) revert AddressAlreadyBlacklisted();
        if (!data.blacklistEnabled) revert BlacklistNotEnabled();

        data.blacklisted[account] = true;
        data.blacklistReasons[account] = reason;
        data.blacklistTimestamps[account] = block.timestamp;
        data.blacklistedBy[account] = msg.sender;
        data.totalBlacklisted++;

        emit AddressBlacklisted(account, reason, msg.sender);
    }

    /**
     * @dev Remove address from blacklist
     * @param data Blacklist data storage
     * @param account Address to unblacklist
     */
    function unBlacklist(
        BlacklistData storage data,
        address account
    ) internal {
        if (account == address(0)) revert InvalidAddress();
        if (!data.blacklisted[account]) revert AddressNotBlacklisted();
        if (!data.blacklistEnabled) revert BlacklistNotEnabled();

        data.blacklisted[account] = false;
        data.blacklistReasons[account] = "";
        data.blacklistTimestamps[account] = 0;
        data.blacklistedBy[account] = address(0);
        data.totalBlacklisted--;

        emit AddressUnBlacklisted(account, msg.sender);
    }

    /**
     * @dev Enable or disable blacklist functionality
     * @param data Blacklist data storage
     * @param enabled Whether to enable blacklist
     */
    function setBlacklistEnabled(
        BlacklistData storage data,
        bool enabled
    ) internal {
        data.blacklistEnabled = enabled;
        emit BlacklistEnabled(enabled);
    }

    /**
     * @dev Update blacklist reason
     * @param data Blacklist data storage
     * @param account Address to update
     * @param reason New reason
     */
    function updateBlacklistReason(
        BlacklistData storage data,
        address account,
        string memory reason
    ) internal {
        if (account == address(0)) revert InvalidAddress();
        if (!data.blacklisted[account]) revert AddressNotBlacklisted();
        if (!data.blacklistEnabled) revert BlacklistNotEnabled();

        data.blacklistReasons[account] = reason;
        emit BlacklistReasonUpdated(account, reason);
    }

    /**
     * @dev Validate transfer with blacklist checks
     * @param data Blacklist data storage
     * @param from Sender address
     * @param to Recipient address
     */
    function validateTransfer(
        BlacklistData storage data,
        address from,
        address to
    ) internal view {
        if (!data.blacklistEnabled) return;

        if (data.blacklisted[from]) {
            revert("Sender is blacklisted");
        }

        if (data.blacklisted[to]) {
            revert("Recipient is blacklisted");
        }
    }

    /**
     * @dev Check if address is blacklisted
     * @param data Blacklist data storage
     * @param account Address to check
     * @return blacklisted Whether address is blacklisted
     */
    function isBlacklisted(
        BlacklistData storage data,
        address account
    ) internal view returns (bool blacklisted) {
        return data.blacklisted[account];
    }

    /**
     * @dev Get blacklist information for address
     * @param data Blacklist data storage
     * @param account Address to check
     * @return blacklisted Whether address is blacklisted
     * @return reason Blacklist reason
     * @return timestamp Blacklist timestamp
     * @return blacklistedBy Address that blacklisted
     */
    function getBlacklistInfo(
        BlacklistData storage data,
        address account
    ) internal view returns (
        bool blacklisted,
        string memory reason,
        uint256 timestamp,
        address blacklistedBy
    ) {
        blacklisted = data.blacklisted[account];
        reason = data.blacklistReasons[account];
        timestamp = data.blacklistTimestamps[account];
        blacklistedBy = data.blacklistedBy[account];
        
        return (blacklisted, reason, timestamp, blacklistedBy);
    }

    /**
     * @dev Get total number of blacklisted addresses
     * @param data Blacklist data storage
     * @return total Total blacklisted addresses
     */
    function getTotalBlacklisted(
        BlacklistData storage data
    ) internal view returns (uint256 total) {
        return data.totalBlacklisted;
    }

    /**
     * @dev Check if blacklist is enabled
     * @param data Blacklist data storage
     * @return enabled Whether blacklist is enabled
     */
    function isBlacklistEnabled(
        BlacklistData storage data
    ) internal view returns (bool enabled) {
        return data.blacklistEnabled;
    }

    /**
     * @dev Get blacklist duration for address
     * @param data Blacklist data storage
     * @param account Address to check
     * @return duration Duration in seconds since blacklisting
     */
    function getBlacklistDuration(
        BlacklistData storage data,
        address account
    ) internal view returns (uint256 duration) {
        if (!data.blacklisted[account]) return 0;
        
        uint256 timestamp = data.blacklistTimestamps[account];
        if (timestamp == 0) return 0;
        
        return block.timestamp - timestamp;
    }

    /**
     * @dev Check if transfer would be blocked by blacklist
     * @param data Blacklist data storage
     * @param from Sender address
     * @param to Recipient address
     * @return blocked Whether transfer would be blocked
     * @return reason Reason for blocking (if blocked)
     */
    function wouldBlockTransfer(
        BlacklistData storage data,
        address from,
        address to
    ) internal view returns (bool blocked, string memory reason) {
        if (!data.blacklistEnabled) return (false, "");

        if (data.blacklisted[from]) {
            return (true, "Sender is blacklisted");
        }

        if (data.blacklisted[to]) {
            return (true, "Recipient is blacklisted");
        }

        return (false, "");
    }

    /**
     * @dev Get blacklist statistics
     * @param data Blacklist data storage
     * @return enabled Whether blacklist is enabled
     * @return totalBlacklisted Total blacklisted addresses
     * @return totalAddresses Total addresses (if tracked)
     */
    function getBlacklistStats(
        BlacklistData storage data
    ) internal view returns (
        bool enabled,
        uint256 totalBlacklisted
    ) {
        enabled = data.blacklistEnabled;
        totalBlacklisted = data.totalBlacklisted;
        
        return (enabled, totalBlacklisted);
    }

    /**
     * @dev Check if address can be blacklisted
     * @param data Blacklist data storage
     * @param account Address to check
     * @return canBlacklist Whether address can be blacklisted
     * @return reason Reason why it cannot be blacklisted (if applicable)
     */
    function canBlacklistAddress(
        BlacklistData storage data,
        address account
    ) internal view returns (bool canBlacklist, string memory reason) {
        if (account == address(0)) {
            return (false, "Cannot blacklist zero address");
        }

        if (data.blacklisted[account]) {
            return (false, "Address is already blacklisted");
        }

        if (!data.blacklistEnabled) {
            return (false, "Blacklist is not enabled");
        }

        return (true, "");
    }

    /**
     * @dev Check if address can be unblacklisted
     * @param data Blacklist data storage
     * @param account Address to check
     * @return canUnblacklist Whether address can be unblacklisted
     * @return reason Reason why it cannot be unblacklisted (if applicable)
     */
    function canUnblacklistAddress(
        BlacklistData storage data,
        address account
    ) internal view returns (bool canUnblacklist, string memory reason) {
        if (account == address(0)) {
            return (false, "Cannot unblacklist zero address");
        }

        if (!data.blacklisted[account]) {
            return (false, "Address is not blacklisted");
        }

        if (!data.blacklistEnabled) {
            return (false, "Blacklist is not enabled");
        }

        return (true, "");
    }

    /**
     * @dev Get comprehensive blacklist status for address
     * @param data Blacklist data storage
     * @param account Address to check
     * @return blacklisted Whether address is blacklisted
     * @return reason Blacklist reason
     * @return timestamp Blacklist timestamp
     * @return duration Duration since blacklisting
     * @return blacklistedBy Address that blacklisted
     * @return canTransfer Whether address can transfer
     */
    function getBlacklistStatus(
        BlacklistData storage data,
        address account
    ) internal view returns (
        bool blacklisted,
        string memory reason,
        uint256 timestamp,
        uint256 duration,
        address blacklistedBy,
        bool canTransfer
    ) {
        blacklisted = data.blacklisted[account];
        reason = data.blacklistReasons[account];
        timestamp = data.blacklistTimestamps[account];
        duration = getBlacklistDuration(data, account);
        blacklistedBy = data.blacklistedBy[account];
        canTransfer = !blacklisted && data.blacklistEnabled;
        
        return (blacklisted, reason, timestamp, duration, blacklistedBy, canTransfer);
    }

    /**
     * @dev Emergency unblacklist all addresses (admin function)
     * @param data Blacklist data storage
     * @param accounts Array of addresses to unblacklist
     */
    function emergencyUnblacklist(
        BlacklistData storage data,
        address[] memory accounts
    ) internal {
        for (uint256 i = 0; i < accounts.length; i++) {
            if (data.blacklisted[accounts[i]]) {
                data.blacklisted[accounts[i]] = false;
                data.blacklistReasons[accounts[i]] = "";
                data.blacklistTimestamps[accounts[i]] = 0;
                data.blacklistedBy[accounts[i]] = address(0);
                data.totalBlacklisted--;

                emit AddressUnBlacklisted(accounts[i], msg.sender);
            }
        }
    }
} 
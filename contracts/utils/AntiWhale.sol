// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AntiWhale
 * @dev Anti-whale protection utility for token transfers
 * Implements maximum transaction and wallet limits with cooldown periods
 */
library AntiWhale {
    
    struct AntiWhaleData {
        uint256 maxTransactionAmount;
        uint256 maxWalletAmount;
        uint256 cooldownPeriod;
        mapping(address => uint256) lastTransactionTime;
        bool antiWhaleEnabled;
    }

    // Events
    event AntiWhaleParamsUpdated(uint256 maxTx, uint256 maxWallet, uint256 cooldown);
    event AntiWhaleEnabled(bool enabled);
    event TransactionBlocked(address indexed from, address indexed to, uint256 amount, string reason);

    // Errors
    error TransferAmountExceedsLimit();
    error WalletBalanceExceedsLimit();
    error CooldownNotExpired();
    error AntiWhaleNotEnabled();

    /**
     * @dev Set anti-whale parameters
     * @param data AntiWhale data storage
     * @param maxTx Maximum transaction amount
     * @param maxWallet Maximum wallet balance
     * @param cooldown Cooldown period between transactions
     */
    function setAntiWhaleParams(
        AntiWhaleData storage data,
        uint256 maxTx,
        uint256 maxWallet,
        uint256 cooldown
    ) internal {
        data.maxTransactionAmount = maxTx;
        data.maxWalletAmount = maxWallet;
        data.cooldownPeriod = cooldown;
        
        emit AntiWhaleParamsUpdated(maxTx, maxWallet, cooldown);
    }

    /**
     * @dev Enable or disable anti-whale protection
     * @param data AntiWhale data storage
     * @param enabled Whether to enable anti-whale protection
     */
    function setAntiWhaleEnabled(
        AntiWhaleData storage data,
        bool enabled
    ) internal {
        data.antiWhaleEnabled = enabled;
        emit AntiWhaleEnabled(enabled);
    }

    // Constants for "no limit" - following best practices from Consensys
    uint256 private constant NO_LIMIT = type(uint256).max;

    /**
     * @dev Validate transaction amount limit - pure condition check
     * Following COP: separate condition from state transition
     */
    function _validateTransactionAmount(
        AntiWhaleData storage data,
        uint256 amount
    ) internal view {
        if (data.maxTransactionAmount != NO_LIMIT && amount > data.maxTransactionAmount) {
            revert TransferAmountExceedsLimit();
        }
    }

    /**
     * @dev Validate wallet balance limit - pure condition check
     * Following COP: separate condition from state transition
     */
    function _validateWalletBalance(
        AntiWhaleData storage data,
        address from,
        uint256 amount,
        uint256 recipientBalance
    ) internal view {
        // Skip check for minting (from == address(0))
        if (from != address(0) && data.maxWalletAmount != NO_LIMIT && recipientBalance + amount > data.maxWalletAmount) {
            revert WalletBalanceExceedsLimit();
        }
    }

    /**
     * @dev Validate cooldown period - pure condition check
     * Following COP: separate condition from state transition
     */
    function _validateCooldown(
        AntiWhaleData storage data,
        address from
    ) internal view {
        if (data.cooldownPeriod > 0 && data.lastTransactionTime[from] + data.cooldownPeriod > block.timestamp) {
            revert CooldownNotExpired();
        }
    }

    /**
     * @dev Update last transaction time - pure state transition
     * Following COP: no conditions in state transition
     */
    function _updateLastTransactionTime(
        AntiWhaleData storage data,
        address from
    ) internal {
        data.lastTransactionTime[from] = block.timestamp;
    }

    /**
     * @dev Apply anti-whale checks to transfer
     * Following COP: separate validation from state updates
     * @param data AntiWhale data storage
     * @param from Sender address
     * @param amount Transfer amount
     * @param recipientBalance Current balance of recipient
     */
    function antiWhale(
        AntiWhaleData storage data,
        address from,
        uint256 amount,
        uint256 recipientBalance
    ) internal {
        if (!data.antiWhaleEnabled) return;

        // Validate all conditions first (COP principle)
        _validateTransactionAmount(data, amount);
        _validateWalletBalance(data, from, amount, recipientBalance);
        _validateCooldown(data, from);

        // Update state after all validations pass (COP principle)
        _updateLastTransactionTime(data, from);
    }

    /**
     * @dev Check if anti-whale protection is enabled
     * @param data AntiWhale data storage
     * @return enabled Whether anti-whale protection is enabled
     */
    function isAntiWhaleEnabled(AntiWhaleData storage data) internal view returns (bool enabled) {
        return data.antiWhaleEnabled;
    }

    /**
     * @dev Get anti-whale parameters
     * @param data AntiWhale data storage
     * @return maxTx Maximum transaction amount
     * @return maxWallet Maximum wallet amount
     * @return cooldown Cooldown period
     */
    function getAntiWhaleParams(
        AntiWhaleData storage data
    ) internal view returns (
        uint256 maxTx,
        uint256 maxWallet,
        uint256 cooldown
    ) {
        return (data.maxTransactionAmount, data.maxWalletAmount, data.cooldownPeriod);
    }

    /**
     * @dev Get last transaction time for address
     * @param data AntiWhale data storage
     * @param account Account address
     * @return lastTime Last transaction timestamp
     */
    function getLastTransactionTime(
        AntiWhaleData storage data,
        address account
    ) internal view returns (uint256 lastTime) {
        return data.lastTransactionTime[account];
    }

    /**
     * @dev Check if transaction would be blocked by anti-whale rules
     * @param data AntiWhale data storage
     * @param from Sender address
     * @param amount Transfer amount
     * @param recipientBalance Current balance of recipient
     * @return blocked Whether transaction would be blocked
     * @return reason Reason for blocking (if blocked)
     */
    function wouldBlockTransaction(
        AntiWhaleData storage data,
        address from,
        uint256 amount,
        uint256 recipientBalance
    ) internal view returns (bool blocked, string memory reason) {
        if (!data.antiWhaleEnabled) return (false, "");

        // Check transaction amount limit
        if (amount > data.maxTransactionAmount) {
            return (true, "Transaction amount exceeds limit");
        }

        // Check wallet balance limit
        if (from != address(0) && recipientBalance + amount > data.maxWalletAmount) {
            return (true, "Wallet balance would exceed limit");
        }

        // Check cooldown period
        if (data.lastTransactionTime[from] + data.cooldownPeriod > block.timestamp) {
            return (true, "Cooldown period not expired");
        }

        return (false, "");
    }

    /**
     * @dev Calculate remaining cooldown time for address
     * @param data AntiWhale data storage
     * @param account Account address
     * @return remainingTime Remaining cooldown time in seconds
     */
    function getRemainingCooldown(
        AntiWhaleData storage data,
        address account
    ) internal view returns (uint256 remainingTime) {
        uint256 lastTime = data.lastTransactionTime[account];
        uint256 cooldownEnd = lastTime + data.cooldownPeriod;
        
        if (block.timestamp >= cooldownEnd) {
            return 0;
        }
        
        return cooldownEnd - block.timestamp;
    }

    /**
     * @dev Check if address can make a transaction now
     * @param data AntiWhale data storage
     * @param account Account address
     * @return canTransact Whether account can make a transaction
     */
    function canTransactNow(
        AntiWhaleData storage data,
        address account
    ) internal view returns (bool canTransact) {
        if (!data.antiWhaleEnabled) return true;
        
        return getRemainingCooldown(data, account) == 0;
    }

    /**
     * @dev Reset cooldown for address (admin function)
     * @param data AntiWhale data storage
     * @param account Account address
     */
    function resetCooldown(
        AntiWhaleData storage data,
        address account
    ) internal {
        data.lastTransactionTime[account] = 0;
    }

    /**
     * @dev Calculate maximum allowed transfer amount
     * @param data AntiWhale data storage
     * @param from Sender address
     * @param currentBalance Current balance of sender
     * @param recipientBalance Current balance of recipient
     * @return maxAmount Maximum allowed transfer amount
     */
    function calculateMaxTransferAmount(
        AntiWhaleData storage data,
        address from,
        uint256 currentBalance,
        uint256 recipientBalance
    ) internal view returns (uint256 maxAmount) {
        if (!data.antiWhaleEnabled) return currentBalance;

        // Start with current balance
        maxAmount = currentBalance;

        // Limit by transaction amount
        if (maxAmount > data.maxTransactionAmount) {
            maxAmount = data.maxTransactionAmount;
        }

        // Limit by recipient wallet capacity
        if (from != address(0)) {
            uint256 availableWalletSpace = data.maxWalletAmount - recipientBalance;
            if (maxAmount > availableWalletSpace) {
                maxAmount = availableWalletSpace;
            }
        }

        return maxAmount;
    }

    /**
     * @dev Get anti-whale status for address
     * @param data AntiWhale data storage
     * @param account Account address
     * @return enabled Whether anti-whale is enabled
     * @return lastTxTime Last transaction time
     * @return remainingCooldown Remaining cooldown time
     * @return canTransact Whether account can transact now
     */
    function getAntiWhaleStatus(
        AntiWhaleData storage data,
        address account
    ) internal view returns (
        bool enabled,
        uint256 lastTxTime,
        uint256 remainingCooldown,
        bool canTransact
    ) {
        enabled = data.antiWhaleEnabled;
        lastTxTime = data.lastTransactionTime[account];
        remainingCooldown = getRemainingCooldown(data, account);
        canTransact = canTransactNow(data, account);
        
        return (enabled, lastTxTime, remainingCooldown, canTransact);
    }
} 
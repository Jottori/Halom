// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FeeOnTransfer
 * @dev Transfer fee management utility for token transfers
 * Implements configurable fee calculation and collection
 */
library FeeOnTransfer {
    
    struct FeeData {
        uint256 feeBps; // Fee in basis points (1% = 100)
        uint256 maxFee; // Maximum fee in basis points
        address feeCollector; // Address to collect fees
        mapping(address => bool) excludedFromFees;
        uint256 totalFeesCollected;
        mapping(address => uint256) feesCollectedByAddress;
        mapping(address => uint256) lastFeeCollectionTime;
        bool feeEnabled;
    }

    // Events
    event FeeParamsUpdated(uint256 feeBps, uint256 maxFee, address collector);
    event FeeCollected(address indexed from, address indexed to, uint256 amount, uint256 feeAmount);
    event AddressExcludedFromFees(address indexed account, bool excluded);
    event FeeEnabled(bool enabled);
    event FeeCollectorChanged(address indexed oldCollector, address indexed newCollector);

    // Errors
    error InvalidFeeParams();
    error FeeNotEnabled();
    error InvalidCollector();
    error FeeCalculationError();
    error TransferAmountTooSmall();

    /**
     * @dev Set fee parameters
     * @param data Fee data storage
     * @param bps Fee in basis points
     * @param maxFee Maximum fee in basis points
     * @param collector Address to collect fees
     */
    function setFeeParams(
        FeeData storage data,
        uint256 bps,
        uint256 maxFee,
        address collector
    ) internal {
        if (bps > maxFee) revert InvalidFeeParams();
        if (maxFee > 1000) revert InvalidFeeParams(); // Max 10%
        if (collector == address(0)) revert InvalidCollector();

        data.feeBps = bps;
        data.maxFee = maxFee;
        data.feeCollector = collector;
        
        emit FeeParamsUpdated(bps, maxFee, collector);
    }

    /**
     * @dev Enable or disable fee collection
     * @param data Fee data storage
     * @param enabled Whether to enable fee collection
     */
    function setFeeEnabled(
        FeeData storage data,
        bool enabled
    ) internal {
        data.feeEnabled = enabled;
        emit FeeEnabled(enabled);
    }

    /**
     * @dev Calculate fee for transfer amount
     * @param data Fee data storage
     * @param amount Transfer amount
     * @return feeAmount Calculated fee amount
     */
    function calculateFee(
        FeeData storage data,
        uint256 amount
    ) internal view returns (uint256 feeAmount) {
        if (!data.feeEnabled || amount == 0) return 0;
        
        feeAmount = (amount * data.feeBps) / 10000;
        
        // Apply maximum fee limit
        uint256 maxFeeAmount = (amount * data.maxFee) / 10000;
        if (feeAmount > maxFeeAmount) {
            feeAmount = maxFeeAmount;
        }
        
        return feeAmount;
    }

    /**
     * @dev Record fee collection for tracking
     * @param data Fee data storage
     * @param from Sender address
     * @param to Recipient address
     * @param amount Transfer amount
     * @param feeAmount Fee amount collected
     */
    function recordFeeCollection(
        FeeData storage data,
        address from,
        address to,
        uint256 amount,
        uint256 feeAmount
    ) internal {
        if (feeAmount > 0) {
            data.totalFeesCollected += feeAmount;
            data.feesCollectedByAddress[data.feeCollector] += feeAmount;
            data.lastFeeCollectionTime[data.feeCollector] = block.timestamp;
            
            emit FeeCollected(from, to, amount, feeAmount);
        }
    }

    /**
     * @dev Change fee collector address
     * @param data Fee data storage
     * @param newCollector New fee collector address
     */
    function changeFeeCollector(
        FeeData storage data,
        address newCollector
    ) internal {
        if (newCollector == address(0)) revert InvalidCollector();
        
        address oldCollector = data.feeCollector;
        data.feeCollector = newCollector;
        
        emit FeeCollectorChanged(oldCollector, newCollector);
    }

    /**
     * @dev Check if fee collection is enabled
     * @param data Fee data storage
     * @return enabled Whether fee collection is enabled
     */
    function isFeeEnabled(FeeData storage data) internal view returns (bool enabled) {
        return data.feeEnabled;
    }

    /**
     * @dev Get fee parameters
     * @param data Fee data storage
     * @return bps Fee in basis points
     * @return maxFee Maximum fee in basis points
     * @return collector Fee collector address
     */
    function getFeeParams(
        FeeData storage data
    ) internal view returns (
        uint256 bps,
        uint256 maxFee,
        address collector
    ) {
        return (data.feeBps, data.maxFee, data.feeCollector);
    }

    /**
     * @dev Get total fees collected by address
     * @param data Fee data storage
     * @param collector Fee collector address
     * @return totalFees Total fees collected
     */
    function getTotalFeesCollected(
        FeeData storage data,
        address collector
    ) internal view returns (uint256 totalFees) {
        return data.totalFeesCollected;
    }

    /**
     * @dev Get fees collected by specific address
     * @param data Fee data storage
     * @param collector Fee collector address
     * @return feesCollected Fees collected by the address
     */
    function getFeesCollectedByAddress(
        FeeData storage data,
        address collector
    ) internal view returns (uint256 feesCollected) {
        return data.feesCollectedByAddress[collector];
    }

    /**
     * @dev Get last fee collection time for address
     * @param data Fee data storage
     * @param collector Fee collector address
     * @return lastCollection Last collection timestamp
     */
    function getLastFeeCollectionTime(
        FeeData storage data,
        address collector
    ) internal view returns (uint256 lastCollection) {
        return data.lastFeeCollectionTime[collector];
    }

    /**
     * @dev Calculate effective transfer amount after fee deduction
     * @param data Fee data storage
     * @param amount Original transfer amount
     * @return effectiveAmount Amount after fee deduction
     * @return feeAmount Fee amount deducted
     */
    function calculateEffectiveAmount(
        FeeData storage data,
        uint256 amount
    ) internal view returns (uint256 effectiveAmount, uint256 feeAmount) {
        feeAmount = calculateFee(data, amount);
        effectiveAmount = amount - feeAmount;
        
        return (effectiveAmount, feeAmount);
    }

    /**
     * @dev Calculate fee percentage for amount
     * @param data Fee data storage
     * @param amount Transfer amount
     * @return feePercentage Fee as percentage (in basis points)
     */
    function calculateFeePercentage(
        FeeData storage data,
        uint256 amount
    ) internal view returns (uint256 feePercentage) {
        if (amount == 0) return 0;
        
        uint256 feeAmount = calculateFee(data, amount);
        feePercentage = (feeAmount * 10000) / amount;
        
        return feePercentage;
    }

    /**
     * @dev Check if transfer would incur fees
     * @param data Fee data storage
     * @param amount Transfer amount
     * @return hasFees Whether transfer would have fees
     * @return feeAmount Fee amount that would be charged
     */
    function wouldHaveFees(
        FeeData storage data,
        uint256 amount
    ) internal view returns (bool hasFees, uint256 feeAmount) {
        if (!data.feeEnabled || amount == 0) {
            return (false, 0);
        }
        
        feeAmount = calculateFee(data, amount);
        hasFees = feeAmount > 0;
        
        return (hasFees, feeAmount);
    }

    /**
     * @dev Get fee statistics for collector
     * @param data Fee data storage
     * @param collector Fee collector address
     * @return totalFees Total fees collected
     * @return lastCollection Last collection time
     * @return isActive Whether collector is active
     */
    function getFeeStats(
        FeeData storage data,
        address collector
    ) internal view returns (
        uint256 totalFees,
        uint256 lastCollection,
        bool isActive
    ) {
        totalFees = data.totalFeesCollected;
        lastCollection = data.lastFeeCollectionTime[collector];
        isActive = collector == data.feeCollector;
        
        return (totalFees, lastCollection, isActive);
    }

    /**
     * @dev Calculate fee for specific transfer scenario
     * @param data Fee data storage
     * @param from Sender address
     * @param to Recipient address
     * @param amount Transfer amount
     * @return feeAmount Fee amount for this transfer
     * @return shouldApply Whether fee should be applied
     */
    function calculateTransferFee(
        FeeData storage data,
        address from,
        address to,
        uint256 amount
    ) internal view returns (uint256 feeAmount, bool shouldApply) {
        // Skip fees for certain addresses (e.g., fee collector, zero address)
        if (from == data.feeCollector || to == data.feeCollector || 
            from == address(0) || to == address(0)) {
            return (0, false);
        }
        
        feeAmount = calculateFee(data, amount);
        shouldApply = feeAmount > 0;
        
        return (feeAmount, shouldApply);
    }

    /**
     * @dev Reset fee collection statistics for address
     * @param data Fee data storage
     * @param collector Fee collector address
     */
    function resetFeeStats(
        FeeData storage data,
        address collector
    ) internal {
        data.totalFeesCollected = 0;
        data.lastFeeCollectionTime[collector] = 0;
    }

    /**
     * @dev Get comprehensive fee information
     * @param data Fee data storage
     * @return enabled Whether fees are enabled
     * @return bps Current fee rate in basis points
     * @return maxFee Maximum fee rate in basis points
     * @return collector Current fee collector
     * @return totalCollected Total fees collected by current collector
     */
    function getFeeInfo(
        FeeData storage data
    ) internal view returns (
        bool enabled,
        uint256 bps,
        uint256 maxFee,
        address collector,
        uint256 totalCollected
    ) {
        enabled = data.feeEnabled;
        bps = data.feeBps;
        maxFee = data.maxFee;
        collector = data.feeCollector;
        totalCollected = data.totalFeesCollected;
        
        return (enabled, bps, maxFee, collector, totalCollected);
    }

    /**
     * @dev Check if address is excluded from fees
     * @param data Fee data storage
     * @param account Address to check
     * @return excluded Whether address is excluded from fees
     */
    function isExcludedFromFees(
        FeeData storage data,
        address account
    ) internal view returns (bool excluded) {
        return data.excludedFromFees[account];
    }

    /**
     * @dev Exclude address from fees
     * @param data Fee data storage
     * @param account Address to exclude
     * @param excluded Whether to exclude or include
     */
    function setExcludedFromFees(
        FeeData storage data,
        address account,
        bool excluded
    ) internal {
        data.excludedFromFees[account] = excluded;
        emit AddressExcludedFromFees(account, excluded);
    }

    /**
     * @dev Calculate effective fee percentage
     * @param data Fee data storage
     * @param amount Transfer amount
     * @return effectiveFeeBps Effective fee in basis points
     */
    function calculateEffectiveFeePercentage(
        FeeData storage data,
        uint256 amount
    ) internal view returns (uint256 effectiveFeeBps) {
        if (amount == 0) return 0;
        
        uint256 feeAmount = calculateFee(data, amount);
        return (feeAmount * 10000) / amount;
    }

    /**
     * @dev Check if transfer should have fees applied
     * @param data Fee data storage
     * @param from Sender address
     * @param to Recipient address
     * @return shouldApplyFees Whether fees should be applied
     */
    function shouldApplyFees(
        FeeData storage data,
        address from,
        address to
    ) internal view returns (bool shouldApplyFees) {
        // Don't apply fees if either address is excluded
        if (data.excludedFromFees[from] || data.excludedFromFees[to]) {
            return false;
        }
        
        // Don't apply fees to zero address (burning)
        if (to == address(0)) {
            return false;
        }
        
        return true;
    }

    /**
     * @dev Calculate minimum transfer amount to cover fees
     * @param data Fee data storage
     * @param desiredAmount Desired amount after fees
     * @return minimumAmount Minimum amount needed to achieve desired amount
     */
    function calculateMinimumAmountForDesiredTransfer(
        FeeData storage data,
        uint256 desiredAmount
    ) internal view returns (uint256 minimumAmount) {
        if (desiredAmount == 0) return 0;
        
        // Calculate the amount needed to get desiredAmount after fees
        // If fee is 1% (100 bps), then: amount = desiredAmount / 0.99
        uint256 feeBps = data.feeBps;
        if (feeBps == 0) return desiredAmount;
        
        uint256 denominator = 10000 - feeBps;
        if (denominator == 0) revert FeeCalculationError();
        
        minimumAmount = (desiredAmount * 10000) / denominator;
        
        // Apply maximum fee limit
        uint256 maxFeeAmount = (minimumAmount * data.maxFee) / 10000;
        uint256 actualFee = (minimumAmount * feeBps) / 10000;
        
        if (actualFee > maxFeeAmount) {
            // Recalculate with max fee
            denominator = 10000 - data.maxFee;
            if (denominator == 0) revert FeeCalculationError();
            
            minimumAmount = (desiredAmount * 10000) / denominator;
        }
        
        return minimumAmount;
    }

    /**
     * @dev Get fee statistics
     * @param data Fee data storage
     * @return totalFees Total fees collected
     * @return currentCollector Current fee collector
     * @return feeBps Current fee rate
     * @return maxFee Current maximum fee
     */
    function getFeeStatistics(
        FeeData storage data
    ) internal view returns (
        uint256 totalFees,
        address currentCollector,
        uint256 feeBps,
        uint256 maxFee
    ) {
        return (
            data.totalFeesCollected,
            data.feeCollector,
            data.feeBps,
            data.maxFee
        );
    }
} 
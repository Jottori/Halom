// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title GovernanceMath
 * @dev Mathematical functions for governance calculations
 */
library GovernanceMath {
    error InvalidInput();
    error Overflow();

    /**
     * @dev Calculate square root using Babylonian method
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        
        return y;
    }

    /**
     * @dev Calculate nth root using Newton's method
     */
    function nthRoot(uint256 x, uint256 n) internal pure returns (uint256) {
        if (x == 0) return 0;
        if (n == 0) revert InvalidInput();
        if (n == 1) return x;
        if (n == 2) return sqrt(x);
        
        uint256 z = (x + n - 1) / n;
        uint256 y = x;
        
        for (uint256 i = 0; i < 10; i++) {
            y = z;
            z = ((n - 1) * z + x / (z ** (n - 1))) / n;
            if (z >= y) break;
        }
        
        return y;
    }

    /**
     * @dev Calculate quadratic voting power
     */
    function calculateQuadraticPower(
        uint256 balance,
        uint256 quadraticFactor,
        uint256 rootPower
    ) internal pure returns (uint256) {
        if (balance == 0) return 0;
        if (rootPower == 0) revert InvalidInput();
        
        uint256 root = nthRoot(balance, rootPower);
        return (root * quadraticFactor) / 1e18;
    }

    /**
     * @dev Calculate time-weighted voting power
     */
    function calculateTimeWeightedPower(
        uint256 basePower,
        uint256 lockDuration,
        uint256 timeWeightFactor,
        uint256 minLockDuration
    ) internal pure returns (uint256) {
        if (lockDuration < minLockDuration) return basePower;
        
        uint256 timeMultiplier = (lockDuration * timeWeightFactor) / minLockDuration;
        return (basePower * timeMultiplier) / 1e18;
    }

    /**
     * @dev Safe multiplication with overflow check
     */
    function safeMul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 c = a * b;
        if (c / a != b) revert Overflow();
        return c;
    }

    /**
     * @dev Safe division with zero check
     */
    function safeDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert InvalidInput();
        return a / b;
    }

    function calculateLockBoost(
        uint256 lockDuration,
        uint256 maxLockDuration,
        uint256 maxLockBoost
    ) internal pure returns (uint256) {
        if (lockDuration > maxLockDuration) revert InvalidInput();
        if (maxLockDuration == 0) revert InvalidInput();
        
        // Prevent overflow by using safe math
        uint256 boostRange = maxLockBoost > 1e18 ? maxLockBoost - 1e18 : 0;
        uint256 boostMultiplier = (lockDuration * boostRange) / maxLockDuration;
        
        // Ensure we don't exceed maxLockBoost
        uint256 result = 1e18 + boostMultiplier;
        if (result > maxLockBoost) {
            result = maxLockBoost;
        }
        
        return result;
    }

    function calculateDeviation(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == b) return 0;
        uint256 diff = a > b ? a - b : b - a;
        uint256 maxVal = a > b ? a : b;
        if (maxVal == 0) return 0;
        return (diff * 1e18) / maxVal;
    }
} 
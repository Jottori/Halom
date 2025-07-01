// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title QuadraticVotingUtils
 * @dev Utility library for quadratic voting calculations
 * Implements quadratic voting where voting power = sqrt(tokens)
 */
library QuadraticVotingUtils {
    
    struct VotingData {
        uint256 totalVotingPower;
        mapping(address => uint256) userVotingPower;
        mapping(address => uint256) userVoteCount;
        uint256 votingPeriod;
        uint256 minVoteAmount;
        uint256 maxVoteAmount;
    }

    // Events
    event VotingPowerUpdated(address indexed user, uint256 oldPower, uint256 newPower);
    event VoteCountUpdated(address indexed user, uint256 oldCount, uint256 newCount);

    // Errors
    error InvalidVoteAmount();
    error VotingPeriodNotActive();
    error InsufficientVotingPower();
    error VoteAmountExceedsLimit();

    /**
     * @dev Calculate quadratic voting weight
     * @param voteAmount The number of tokens being voted
     * @return votingWeight The quadratic voting weight (sqrt of vote amount)
     */
    function calculateQuadraticWeight(uint256 voteAmount) internal pure returns (uint256 votingWeight) {
        if (voteAmount == 0) return 0;
        
        // Calculate square root using Babylonian method
        uint256 x = voteAmount;
        uint256 y = (x + 1) / 2;
        
        while (y < x) {
            x = y;
            y = (x + voteAmount / x) / 2;
        }
        
        return x;
    }

    /**
     * @dev Calculate total voting power for multiple votes
     * @param voteAmounts Array of vote amounts
     * @return totalWeight Total quadratic voting weight
     */
    function calculateTotalQuadraticWeight(uint256[] memory voteAmounts) internal pure returns (uint256 totalWeight) {
        for (uint256 i = 0; i < voteAmounts.length; i++) {
            totalWeight += calculateQuadraticWeight(voteAmounts[i]);
        }
        return totalWeight;
    }

    /**
     * @dev Update user's voting power
     * @param data Voting data storage
     * @param user User address
     * @param newVotingPower New voting power amount
     */
    function updateVotingPower(
        VotingData storage data,
        address user,
        uint256 newVotingPower
    ) internal {
        uint256 oldPower = data.userVotingPower[user];
        data.userVotingPower[user] = newVotingPower;
        
        // Update total voting power
        data.totalVotingPower = data.totalVotingPower - oldPower + newVotingPower;
        
        emit VotingPowerUpdated(user, oldPower, newVotingPower);
    }

    /**
     * @dev Update user's vote count
     * @param data Voting data storage
     * @param user User address
     * @param newVoteCount New vote count
     */
    function updateVoteCount(
        VotingData storage data,
        address user,
        uint256 newVoteCount
    ) internal {
        uint256 oldCount = data.userVoteCount[user];
        data.userVoteCount[user] = newVoteCount;
        
        emit VoteCountUpdated(user, oldCount, newVoteCount);
    }

    /**
     * @dev Validate vote amount against limits
     * @param data Voting data storage
     * @param voteAmount Amount to vote
     */
    function validateVoteAmount(
        VotingData storage data,
        uint256 voteAmount
    ) internal view {
        if (voteAmount < data.minVoteAmount) revert InvalidVoteAmount();
        if (voteAmount > data.maxVoteAmount) revert VoteAmountExceedsLimit();
    }

    /**
     * @dev Check if user has sufficient voting power
     * @param data Voting data storage
     * @param user User address
     * @param requiredPower Required voting power
     */
    function checkVotingPower(
        VotingData storage data,
        address user,
        uint256 requiredPower
    ) internal view {
        if (data.userVotingPower[user] < requiredPower) revert InsufficientVotingPower();
    }

    /**
     * @dev Calculate voting power from token balance
     * @param tokenBalance User's token balance
     * @param decimals Token decimals
     * @return votingPower Calculated voting power
     */
    function calculateVotingPowerFromBalance(
        uint256 tokenBalance,
        uint8 decimals
    ) internal pure returns (uint256 votingPower) {
        // Convert to standard 18 decimals for calculations
        uint256 normalizedBalance = tokenBalance;
        if (decimals < 18) {
            normalizedBalance = tokenBalance * (10 ** (18 - decimals));
        } else if (decimals > 18) {
            normalizedBalance = tokenBalance / (10 ** (decimals - 18));
        }
        
        return calculateQuadraticWeight(normalizedBalance);
    }

    /**
     * @dev Calculate effective voting power with time decay
     * @param baseVotingPower Base voting power
     * @param timeElapsed Time elapsed since voting period start
     * @param votingPeriod Total voting period
     * @return effectivePower Effective voting power with time decay
     */
    function calculateTimeDecayVotingPower(
        uint256 baseVotingPower,
        uint256 timeElapsed,
        uint256 votingPeriod
    ) internal pure returns (uint256 effectivePower) {
        if (timeElapsed >= votingPeriod) return 0;
        
        // Linear decay: power decreases linearly over time
        uint256 decayFactor = ((votingPeriod - timeElapsed) * 1e18) / votingPeriod;
        effectivePower = (baseVotingPower * decayFactor) / 1e18;
        
        return effectivePower;
    }

    /**
     * @dev Calculate voting power with quadratic scaling
     * @param voteAmount Vote amount
     * @param scalingFactor Scaling factor for quadratic calculation
     * @return scaledPower Scaled voting power
     */
    function calculateScaledQuadraticPower(
        uint256 voteAmount,
        uint256 scalingFactor
    ) internal pure returns (uint256 scaledPower) {
        if (voteAmount == 0) return 0;
        
        // Calculate quadratic power with scaling
        uint256 quadraticPower = calculateQuadraticWeight(voteAmount);
        scaledPower = (quadraticPower * scalingFactor) / 1e18;
        
        return scaledPower;
    }

    /**
     * @dev Calculate voting power with diminishing returns
     * @param voteAmount Vote amount
     * @param diminishingFactor Factor for diminishing returns (0-1e18)
     * @return diminishedPower Voting power with diminishing returns
     */
    function calculateDiminishingReturnsPower(
        uint256 voteAmount,
        uint256 diminishingFactor
    ) internal pure returns (uint256 diminishedPower) {
        if (voteAmount == 0) return 0;
        
        uint256 basePower = calculateQuadraticWeight(voteAmount);
        
        // Apply diminishing returns: power = basePower * (1 - diminishingFactor * voteAmount / maxAmount)
        // This is a simplified version - in practice you'd want more sophisticated curves
        uint256 maxAmount = 1000 * 1e18; // Example max amount
        uint256 diminishingEffect = (diminishingFactor * voteAmount) / maxAmount;
        
        if (diminishingEffect >= 1e18) {
            diminishedPower = 0;
        } else {
            diminishedPower = (basePower * (1e18 - diminishingEffect)) / 1e18;
        }
        
        return diminishedPower;
    }

    /**
     * @dev Calculate voting power with lock-up bonus
     * @param baseVotingPower Base voting power
     * @param lockDuration Duration tokens are locked
     * @param maxLockDuration Maximum lock duration for bonus
     * @param maxBonus Maximum bonus multiplier (1e18 = 100%)
     * @return totalPower Total voting power with lock-up bonus
     */
    function calculateLockUpBonusPower(
        uint256 baseVotingPower,
        uint256 lockDuration,
        uint256 maxLockDuration,
        uint256 maxBonus
    ) internal pure returns (uint256 totalPower) {
        if (lockDuration == 0) return baseVotingPower;
        
        // Calculate bonus based on lock duration
        uint256 bonusMultiplier = (lockDuration * maxBonus) / maxLockDuration;
        if (bonusMultiplier > maxBonus) bonusMultiplier = maxBonus;
        
        uint256 bonusPower = (baseVotingPower * bonusMultiplier) / 1e18;
        totalPower = baseVotingPower + bonusPower;
        
        return totalPower;
    }

    /**
     * @dev Get user voting statistics
     * @param data Voting data storage
     * @param user User address
     * @return votingPower User's voting power
     * @return voteCount User's vote count
     * @return totalPower Total system voting power
     */
    function getUserVotingStats(
        VotingData storage data,
        address user
    ) internal view returns (
        uint256 votingPower,
        uint256 voteCount,
        uint256 totalPower
    ) {
        return (
            data.userVotingPower[user],
            data.userVoteCount[user],
            data.totalVotingPower
        );
    }

    /**
     * @dev Calculate voting power percentage
     * @param userPower User's voting power
     * @param totalPower Total system voting power
     * @return percentage Voting power percentage (in basis points)
     */
    function calculateVotingPercentage(
        uint256 userPower,
        uint256 totalPower
    ) internal pure returns (uint256 percentage) {
        if (totalPower == 0) return 0;
        return (userPower * 10000) / totalPower; // Returns basis points (1% = 100)
    }
} 
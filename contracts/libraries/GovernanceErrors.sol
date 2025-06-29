// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title GovernanceErrors
 * @dev Custom errors for governance contracts
 */
library GovernanceErrors {
    // Access control errors
    error AccessControlUnauthorizedAccount(address account, bytes32 role);
    error InvalidVoter();
    error InvalidVoteReason();
    error InvalidAmount();
    error InvalidVotingPowerCap();
    error InvalidEmergencyQuorum();
    error InvalidVoteCooldown();
    error InvalidMaxVotesPerDay();
    error InvalidLockDuration();
    error InvalidQuadraticFactor();
    error InvalidTimeWeightFactor();
    error InvalidRootPower();
    
    // Voting errors
    error GovernorInsufficientProposerVotes();
    error GovernorInvalidProposalLength();
    error GovernorAlreadyCastVote();
    error FlashLoanDetected();
    error EmergencyPaused();
    error LockPeriodNotExpired();
    
    // Delegation errors
    error InvalidDelegate();
    error DelegationNotFound();
    
    // Proposal errors
    error ProposalNotFound();
    error ProposalNotActive();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyCanceled();
    
    // Timelock errors
    error TimelockInsufficientDelay();
    error TimelockOperationNotReady();
    error TimelockOperationExpired();
    error TimelockOperationNotFound();
    
    // Treasury errors
    error InsufficientTreasuryBalance();
    error InvalidAllocation();
    error RewardTokenNotSet();
    
    // Oracle errors
    error InvalidHOI();
    error StaleData();
    error InsufficientNodes();
    error InvalidTimestamp();
    
    // Token errors
    error ZeroAddress();
    error InvalidRebaseDelta();
    error RebaseDeltaTooHigh();
    error TimeNotElapsed();
    error SupplyOverflow();
    error SupplyUnderflow();
    error TransferAmountExceedsLimit();
    error WalletBalanceExceedsLimit();
    error InsufficientBalance();
    error ERC20InsufficientAllowance();
    error ERC20InsufficientBalance();
    error InvalidMaxRebaseDelta();
    error RateExceedsMaximum();
} 
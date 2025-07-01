# Halom Use Cases

## Overview

This document outlines the primary use cases and scenarios for the Halom ecosystem, demonstrating how different components work together to provide comprehensive DeFi functionality.

## Token Use Cases

### 1. Anti-Whale Protection
**Scenario**: Prevent large holders from manipulating token price through massive transfers.

**Implementation**:
```solidity
// Set anti-whale limits
await halomToken.setAntiWhaleLimits(
    ethers.utils.parseEther("10000"),  // Max transfer: 10,000 tokens
    ethers.utils.parseEther("100000")  // Max wallet: 100,000 tokens
);

// Exclude legitimate addresses (DEX pairs, treasury)
await halomToken.setExcludedFromLimits(dexPairAddress, true);
await halomToken.setExcludedFromLimits(treasuryAddress, true);
```

**Benefits**:
- Prevents price manipulation
- Protects small holders
- Maintains market stability

### 2. Rebase Mechanics
**Scenario**: Adjust token supply based on economic conditions or governance decisions.

**Implementation**:
```solidity
// Positive rebase (increase supply)
await halomToken.rebase(50000000000000000000); // +5%

// Negative rebase (decrease supply)
await halomToken.rebase(-30000000000000000000); // -3%
```

**Use Cases**:
- Inflation/deflation control
- Reward distribution
- Economic policy implementation

### 3. Emergency Controls
**Scenario**: Respond to security threats or market emergencies.

**Implementation**:
```solidity
// Emergency pause
await halomToken.emergencyPause();

// Blacklist malicious address
await blacklist.blacklistAddress(maliciousAddress, "Suspicious activity");

// Resume operations
await halomToken.emergencyUnpause();
```

## Governance Use Cases

### 1. Treasury Management
**Scenario**: Community decides on fund allocation for ecosystem development.

**Implementation**:
```solidity
// Create proposal to allocate funds
const targets = [treasuryAddress];
const values = [0];
const calldatas = [
    treasury.interface.encodeFunctionData("allocateFunds", [
        developmentWallet,
        ethers.utils.parseEther("50000")
    ])
];
const description = "Allocate 50,000 HALOM for development";

const proposalId = await governance.propose(targets, values, calldatas, description);

// Community votes
await governance.castVote(proposalId, 1); // For

// Execute after voting period
await governance.execute(targets, values, calldatas, descriptionHash);
```

### 2. Protocol Parameter Updates
**Scenario**: Adjust staking rewards, fees, or other protocol parameters.

**Implementation**:
```solidity
// Update staking reward rate
const targets = [stakingAddress];
const values = [0];
const calldatas = [
    staking.interface.encodeFunctionData("setRewardRate", [1200]) // 12% APY
];
const description = "Increase staking rewards to 12% APY";

await governance.propose(targets, values, calldatas, description);
```

### 3. Emergency Governance
**Scenario**: Rapid response to critical issues requiring immediate action.

**Implementation**:
```solidity
// Emergency proposal with shorter timelock
await timelock.setDelay(3600); // 1 hour delay

// Execute emergency action
await governance.execute(emergencyTargets, emergencyValues, emergencyCalldatas, descriptionHash);
```

## Staking Use Cases

### 1. Token Staking for Rewards
**Scenario**: Users stake tokens to earn passive income.

**Implementation**:
```solidity
// Stake tokens
await halomToken.approve(stakingAddress, stakeAmount);
await staking.stake(stakeAmount);

// Claim rewards periodically
await staking.claimRewards();

// Unstake when needed
await staking.unstake(unstakeAmount);
```

### 2. LP Staking for Enhanced Rewards
**Scenario**: Liquidity providers earn additional rewards for providing liquidity.

**Implementation**:
```solidity
// Provide liquidity to DEX
await addLiquidity(tokenAmount, ethAmount);

// Stake LP tokens
await lpToken.approve(lpStakingAddress, lpTokenAmount);
await lpStaking.stake(lpTokenAmount);

// Claim dual rewards
await lpStaking.claimRewards();
```

### 3. Emergency Withdrawal
**Scenario**: Users need to withdraw funds immediately during emergencies.

**Implementation**:
```solidity
// Emergency withdrawal bypasses normal unstaking period
await staking.emergencyWithdraw();
```

## Oracle Use Cases

### 1. Economic Data Feeds
**Scenario**: Provide real-time economic indicators for governance decisions.

**Implementation**:
```solidity
// Update economic data
await oracle.updateData(
    keccak256("GDP_GROWTH"),
    ethers.utils.parseUnits("2.5", 2) // 2.5%
);

// Use data in governance
const gdpGrowth = await oracle.getData(keccak256("GDP_GROWTH"));
if (gdpGrowth < threshold) {
    // Trigger economic stimulus measures
}
```

### 2. Market Condition Monitoring
**Scenario**: Monitor market conditions to adjust protocol parameters.

**Implementation**:
```solidity
// Update market volatility
await oracle.updateData(
    keccak256("VOLATILITY_INDEX"),
    ethers.utils.parseUnits("25", 2) // 25%
);

// Adjust anti-whale limits based on volatility
if (volatility > highThreshold) {
    await halomToken.setAntiWhaleLimits(lowerTransferLimit, lowerWalletLimit);
}
```

### 3. Emergency Data Updates
**Scenario**: Provide critical data updates during market stress.

**Implementation**:
```solidity
// Emergency update during market crash
await oracle.emergencyUpdate(
    keccak256("MARKET_CRASH_INDICATOR"),
    1 // True
);
```

## Bridge Use Cases

### 1. Cross-Chain Asset Transfer
**Scenario**: Transfer tokens between different blockchain networks.

**Implementation**:
```solidity
// Bridge tokens to another chain
await bridge.bridgeTokens(
    targetChainId,
    recipientAddress,
    tokenAmount
);

// Receive tokens on target chain
await bridge.claimTokens(bridgeId, proof);
```

### 2. Cross-Chain Governance
**Scenario**: Enable governance participation across multiple chains.

**Implementation**:
```solidity
// Bridge voting power
await bridge.bridgeVotingPower(targetChainId, votingPower);

// Vote on target chain
await governance.castVote(proposalId, support);
```

## Integration Use Cases

### 1. Complete DeFi Ecosystem
**Scenario**: Users interact with multiple components for comprehensive DeFi experience.

**Implementation**:
```solidity
// 1. Stake tokens for rewards
await staking.stake(stakeAmount);

// 2. Participate in governance
await governance.castVote(proposalId, 1);

// 3. Bridge tokens to other chains
await bridge.bridgeTokens(targetChain, recipient, amount);

// 4. Monitor economic data
const economicData = await oracle.getData(dataId);
```

### 2. Institutional Use Cases
**Scenario**: Large institutions use Halom for treasury management and governance.

**Implementation**:
```solidity
// Exclude from anti-whale limits
await halomToken.setExcludedFromLimits(institutionAddress, true);

// Delegate voting power
await governance.delegate(delegateAddress);

// Participate in governance with large holdings
await governance.castVoteWithReason(proposalId, 1, "Institutional support");
```

### 3. Emergency Response System
**Scenario**: Coordinated response to security threats or market emergencies.

**Implementation**:
```solidity
// 1. Emergency pause all operations
await halomToken.emergencyPause();
await staking.emergencyPause();

// 2. Blacklist malicious addresses
await blacklist.batchBlacklist(maliciousAddresses, reasons);

// 3. Emergency governance proposal
await governance.propose(emergencyTargets, emergencyValues, emergencyCalldatas, "Emergency response");

// 4. Execute emergency measures
await governance.execute(emergencyTargets, emergencyValues, emergencyCalldatas, descriptionHash);
```

## Advanced Use Cases

### 1. Automated Market Making
**Scenario**: Integrate with DEX protocols for automated liquidity provision.

**Implementation**:
```solidity
// Provide liquidity to DEX
await dex.addLiquidity(tokenAmount, ethAmount);

// Stake LP tokens for additional rewards
await lpStaking.stake(lpTokenAmount);

// Monitor and rebalance based on oracle data
const marketData = await oracle.getData(marketDataId);
if (marketData > rebalanceThreshold) {
    await dex.rebalanceLiquidity();
}
```

### 2. Yield Farming Strategies
**Scenario**: Optimize yield through multiple staking and farming strategies.

**Implementation**:
```solidity
// Stake in primary staking contract
await staking.stake(primaryStakeAmount);

// Provide liquidity for LP rewards
await lpStaking.stake(lpStakeAmount);

// Bridge to other chains for additional opportunities
await bridge.bridgeTokens(otherChain, recipient, bridgeAmount);

// Claim and compound rewards
await staking.claimRewards();
await lpStaking.claimRewards();
```

### 3. Governance-Driven Protocol Evolution
**Scenario**: Community-driven protocol upgrades and feature additions.

**Implementation**:
```solidity
// Propose new feature
const upgradeTargets = [upgradeableContract];
const upgradeValues = [0];
const upgradeCalldatas = [
    upgradeableContract.interface.encodeFunctionData("addNewFeature", [featureParams])
];

await governance.propose(upgradeTargets, upgradeValues, upgradeCalldatas, "Add new feature");

// Community voting and execution
// ... voting process ...
await governance.execute(upgradeTargets, upgradeValues, upgradeCalldatas, descriptionHash);
```

## Compliance Use Cases

### 1. Regulatory Compliance
**Scenario**: Implement features to meet regulatory requirements.

**Implementation**:
```solidity
// Blacklist sanctioned addresses
await blacklist.batchBlacklist(sanctionedAddresses, ["Regulatory compliance"]);

// Implement transfer limits for compliance
await halomToken.setAntiWhaleLimits(complianceTransferLimit, complianceWalletLimit);

// Emergency pause for regulatory actions
await halomToken.emergencyPause();
```

### 2. KYC/AML Integration
**Scenario**: Integrate with KYC/AML systems for compliance.

**Implementation**:
```solidity
// Whitelist KYC-verified addresses
await kycContract.whitelistAddress(verifiedAddress, kycData);

// Restrict transfers to KYC-verified addresses only
await halomToken.setTransferRestrictions(true);
```

## Future Use Cases

### 1. Layer 2 Integration
**Scenario**: Scale the ecosystem using Layer 2 solutions.

**Implementation**:
```solidity
// Bridge to Layer 2
await bridge.bridgeToL2(l2ChainId, amount);

// Participate in L2 governance
await l2Governance.castVote(proposalId, support);

// Bridge back to mainnet
await bridge.bridgeFromL2(l2ChainId, amount);
```

### 2. Cross-Chain DeFi
**Scenario**: Enable DeFi operations across multiple blockchain networks.

**Implementation**:
```solidity
// Multi-chain staking
await bridge.bridgeTokens(chain1, stakingContract1, amount1);
await bridge.bridgeTokens(chain2, stakingContract2, amount2);

// Cross-chain governance
await bridge.bridgeVotingPower(mainnet, votingPower);
await governance.castVote(proposalId, support);
```

### 3. AI-Driven Governance
**Scenario**: Integrate AI systems for automated governance decisions.

**Implementation**:
```solidity
// AI oracle provides governance recommendations
const aiRecommendation = await aiOracle.getGovernanceRecommendation(proposalId);

// Automated proposal creation based on AI analysis
if (aiRecommendation.score > threshold) {
    await governance.propose(aiTargets, aiValues, aiCalldatas, aiDescription);
}
``` 
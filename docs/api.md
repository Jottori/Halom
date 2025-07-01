# Halom API Documentation

## Overview

This document provides comprehensive API documentation for the Halom smart contracts, including function signatures, parameters, return values, and usage examples.

## Token API

### HalomToken Contract

#### Core Functions

##### `mint(address to, uint256 amount)`
Mint new tokens to a specified address.

**Parameters:**
- `to` (address): Recipient address
- `amount` (uint256): Amount to mint

**Access:** MINTER_ROLE only

**Events:** Transfer event

**Example:**
```solidity
// Mint 1000 tokens to user
await halomToken.mint(userAddress, ethers.utils.parseEther("1000"));
```

##### `burnFrom(address account, uint256 amount)`
Burn tokens from a specified account.

**Parameters:**
- `account` (address): Account to burn from
- `amount` (uint256): Amount to burn

**Access:** BURNER_ROLE only

**Events:** Transfer event

##### `rebase(int256 supplyDelta)`
Execute a rebase operation to adjust token supply.

**Parameters:**
- `supplyDelta` (int256): Supply change (positive for increase, negative for decrease)

**Access:** REBASE_CALLER role only

**Events:** RebaseExecuted

**Example:**
```solidity
// Increase supply by 5%
await halomToken.rebase(50000000000000000000); // 5% of 1e18
```

#### Anti-Whale Functions

##### `setAntiWhaleLimits(uint256 _maxTransferAmount, uint256 _maxWalletAmount)`
Set anti-whale protection limits.

**Parameters:**
- `_maxTransferAmount` (uint256): Maximum transfer amount
- `_maxWalletAmount` (uint256): Maximum wallet balance

**Access:** DEFAULT_ADMIN_ROLE only

**Events:** AntiWhaleLimitsSet

##### `setExcludedFromLimits(address account, bool excluded)`
Exclude an address from anti-whale limits.

**Parameters:**
- `account` (address): Address to exclude/include
- `excluded` (bool): Whether to exclude from limits

**Access:** DEFAULT_ADMIN_ROLE only

**Events:** ExcludedFromLimitsSet

##### `getAntiWhaleLimits()`
Get current anti-whale limits.

**Returns:**
- `maxTx` (uint256): Maximum transfer amount
- `maxWallet` (uint256): Maximum wallet amount

#### Emergency Functions

##### `emergencyPause()`
Pause all token transfers.

**Access:** EMERGENCY_ROLE only

**Events:** EmergencyPaused

##### `emergencyUnpause()`
Resume token transfers after emergency.

**Access:** EMERGENCY_ROLE only

**Events:** EmergencyUnpaused

## Governance API

### Governance Contract

#### Proposal Functions

##### `propose(address[] targets, uint256[] values, bytes[] calldatas, string description)`
Create a new governance proposal.

**Parameters:**
- `targets` (address[]): Target contracts for proposal
- `values` (uint256[]): ETH values for each target
- `calldatas` (bytes[]): Calldata for each target
- `description` (string): Proposal description

**Returns:**
- `proposalId` (uint256): Unique proposal identifier

**Events:** ProposalCreated

**Example:**
```solidity
const targets = [treasuryAddress];
const values = [0];
const calldatas = [treasury.interface.encodeFunctionData("allocateFunds", [recipient, amount])];
const description = "Allocate funds to development";

const proposalId = await governance.propose(targets, values, calldatas, description);
```

##### `castVote(uint256 proposalId, uint8 support)`
Vote on a proposal.

**Parameters:**
- `proposalId` (uint256): Proposal identifier
- `support` (uint8): Vote support (0=Against, 1=For, 2=Abstain)

**Events:** VoteCast

##### `castVoteWithReason(uint256 proposalId, uint8 support, string calldata reason)`
Vote on a proposal with a reason.

**Parameters:**
- `proposalId` (uint256): Proposal identifier
- `support` (uint8): Vote support
- `reason` (string): Vote reason

**Events:** VoteCast

##### `execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)`
Execute a successful proposal.

**Parameters:**
- `targets` (address[]): Target contracts
- `values` (uint256[]): ETH values
- `calldatas` (bytes[]): Calldata
- `descriptionHash` (bytes32): Hashed description

**Events:** ProposalExecuted

#### Delegation Functions

##### `delegate(address delegatee)`
Delegate voting power to another address.

**Parameters:**
- `delegatee` (address): Address to delegate to

**Events:** DelegateChanged

##### `delegateBySig(address delegatee, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s)`
Delegate voting power using a signature.

**Parameters:**
- `delegatee` (address): Address to delegate to
- `nonce` (uint256): Nonce for signature
- `expiry` (uint256): Signature expiry
- `v`, `r`, `s` (uint8, bytes32, bytes32): Signature components

### Timelock Contract

#### Scheduling Functions

##### `schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay)`
Schedule a transaction for execution.

**Parameters:**
- `target` (address): Target contract
- `value` (uint256): ETH value
- `data` (bytes): Transaction data
- `predecessor` (bytes32): Previous transaction hash
- `salt` (bytes32): Unique identifier
- `delay` (uint256): Execution delay

**Events:** CallScheduled

##### `execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt)`
Execute a scheduled transaction.

**Parameters:**
- `target` (address): Target contract
- `value` (uint256): ETH value
- `data` (bytes): Transaction data
- `predecessor` (bytes32): Previous transaction hash
- `salt` (bytes32): Unique identifier

**Events:** CallExecuted

##### `cancel(bytes32 id)`
Cancel a scheduled transaction.

**Parameters:**
- `id` (bytes32): Transaction identifier

**Events:** Cancelled

## Staking API

### Staking Contract

#### Core Functions

##### `stake(uint256 amount)`
Stake tokens to earn rewards.

**Parameters:**
- `amount` (uint256): Amount to stake

**Events:** Staked

**Example:**
```solidity
await staking.stake(ethers.utils.parseEther("100"));
```

##### `unstake(uint256 amount)`
Unstake tokens.

**Parameters:**
- `amount` (uint256): Amount to unstake

**Events:** Unstaked

##### `claimRewards()`
Claim accumulated rewards.

**Events:** RewardsClaimed

##### `emergencyWithdraw()`
Emergency withdrawal of all staked tokens.

**Events:** EmergencyWithdraw

#### View Functions

##### `getStakeInfo(address user)`
Get staking information for a user.

**Parameters:**
- `user` (address): User address

**Returns:**
- `stakedAmount` (uint256): Staked amount
- `pendingRewards` (uint256): Pending rewards
- `lastUpdateTime` (uint256): Last update timestamp

##### `getTotalStaked()`
Get total staked amount.

**Returns:**
- `totalStaked` (uint256): Total staked amount

## Oracle API

### Oracle Contract

#### Data Functions

##### `updateData(bytes32 dataId, uint256 value)`
Update a data feed.

**Parameters:**
- `dataId` (bytes32): Data identifier
- `value` (uint256): New data value

**Access:** Authorized providers only

**Events:** DataUpdated

##### `getData(bytes32 dataId)`
Get current data value.

**Parameters:**
- `dataId` (bytes32): Data identifier

**Returns:**
- `value` (uint256): Current data value
- `timestamp` (uint256): Last update timestamp

##### `emergencyUpdate(bytes32 dataId, uint256 value)`
Emergency data update.

**Parameters:**
- `dataId` (bytes32): Data identifier
- `value` (uint256): New data value

**Access:** EMERGENCY_ROLE only

**Events:** EmergencyDataUpdated

## Utility API

### AntiWhale Contract

##### `setAntiWhaleLimits(uint256 _maxTransferAmount, uint256 _maxWalletAmount)`
Set anti-whale limits.

**Parameters:**
- `_maxTransferAmount` (uint256): Maximum transfer amount
- `_maxWalletAmount` (uint256): Maximum wallet amount

##### `validateTransfer(address from, address to, uint256 amount, uint256 currentBalance)`
Validate transfer against anti-whale limits.

**Parameters:**
- `from` (address): Sender address
- `to` (address): Recipient address
- `amount` (uint256): Transfer amount
- `currentBalance` (uint256): Current recipient balance

### FeeOnTransfer Contract

##### `setTransferFeeRate(uint256 _feeRate)`
Set transfer fee rate.

**Parameters:**
- `_feeRate` (uint256): Fee rate in basis points

##### `calculateFee(uint256 amount, address from, address to)`
Calculate transfer fee.

**Parameters:**
- `amount` (uint256): Transfer amount
- `from` (address): Sender address
- `to` (address): Recipient address

**Returns:**
- `feeAmount` (uint256): Calculated fee
- `netAmount` (uint256): Amount after fee

### Blacklist Contract

##### `blacklistAddress(address account, string memory reason)`
Blacklist an address.

**Parameters:**
- `account` (address): Address to blacklist
- `reason` (string): Blacklist reason

##### `removeFromBlacklist(address account)`
Remove address from blacklist.

**Parameters:**
- `account` (address): Address to remove

##### `isAddressBlacklisted(address account)`
Check if address is blacklisted.

**Parameters:**
- `account` (address): Address to check

**Returns:**
- `bool`: True if blacklisted

## Error Codes

### Common Errors
- `Unauthorized`: Caller lacks required role
- `InvalidAmount`: Amount is zero or invalid
- `TransferPaused`: Transfers are paused
- `ContractPaused`: Contract is paused

### Token Errors
- `ExceedsMaxSupply`: Amount exceeds maximum supply
- `TransferAmountExceedsLimit`: Transfer exceeds anti-whale limit
- `WalletBalanceExceedsLimit`: Wallet balance exceeds limit

### Governance Errors
- `ProposalNotFound`: Proposal does not exist
- `ProposalNotActive`: Proposal is not active
- `AlreadyVoted`: User already voted

### Staking Errors
- `InsufficientBalance`: Insufficient staked balance
- `NoRewards`: No rewards to claim
- `StakingPaused`: Staking is paused

## Events Reference

### Token Events
```solidity
event RebaseExecuted(uint256 newIndex, uint256 totalSupply, uint256 timestamp);
event AntiWhaleLimitsSet(uint256 maxTransfer, uint256 maxWallet);
event EmergencyPaused(address indexed pauser);
event EmergencyUnpaused(address indexed unpauser);
```

### Governance Events
```solidity
event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description);
event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason);
event ProposalExecuted(uint256 proposalId);
```

### Staking Events
```solidity
event Staked(address indexed user, uint256 amount);
event Unstaked(address indexed user, uint256 amount);
event RewardsClaimed(address indexed user, uint256 amount);
```

## Integration Examples

### Complete Governance Flow
```javascript
// 1. Create proposal
const proposalId = await governance.propose(targets, values, calldatas, description);

// 2. Wait for voting period
await network.provider.send("evm_increaseTime", [votingPeriod]);
await network.provider.mine();

// 3. Vote on proposal
await governance.castVote(proposalId, 1); // For

// 4. Wait for execution delay
await network.provider.send("evm_increaseTime", [executionDelay]);
await network.provider.mine();

// 5. Execute proposal
await governance.execute(targets, values, calldatas, descriptionHash);
```

### Staking Integration
```javascript
// 1. Approve staking contract
await token.approve(staking.address, amount);

// 2. Stake tokens
await staking.stake(amount);

// 3. Wait for rewards
await network.provider.send("evm_increaseTime", [rewardPeriod]);
await network.provider.mine();

// 4. Claim rewards
await staking.claimRewards();
``` 
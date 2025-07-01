# Halom Contracts Documentation

## Contract Overview

This document provides detailed information about each contract in the Halom ecosystem, including their functions, events, and integration points.

## Token Contracts

### HalomToken.sol
**Location**: `contracts/token/HalomToken.sol`

**Description**: Main ERC20 token with advanced features including rebase mechanics, anti-whale protection, and governance integration.

**Key Features**:
- ERC20 standard compliance with permit functionality
- Rebase mechanics for supply adjustment
- Anti-whale protection with configurable limits
- Role-based access control
- Emergency pause functionality
- Governance voting integration

**Main Functions**:
- `mint(address to, uint256 amount)`: Mint new tokens
- `burnFrom(address account, uint256 amount)`: Burn tokens from account
- `rebase(int256 supplyDelta)`: Execute rebase operation
- `setAntiWhaleLimits(uint256 _maxTransferAmount, uint256 _maxWalletAmount)`: Set anti-whale limits
- `setExcludedFromLimits(address account, bool excluded)`: Exclude address from limits
- `emergencyPause()`: Emergency pause all transfers
- `emergencyUnpause()`: Resume transfers after emergency

**Events**:
- `RebaseExecuted(uint256 newIndex, uint256 totalSupply, uint256 timestamp)`
- `AntiWhaleLimitsSet(uint256 maxTransfer, uint256 maxWallet)`
- `EmergencyPaused(address indexed pauser)`
- `EmergencyUnpaused(address indexed unpauser)`

## Governance Contracts

### Governance.sol
**Location**: `contracts/governance/Governance.sol`

**Description**: Main governance contract implementing quadratic voting and proposal management.

**Key Features**:
- Quadratic voting mechanism
- Proposal creation and execution
- Vote delegation
- Timelock integration
- Emergency governance controls

**Main Functions**:
- `propose(address[] targets, uint256[] values, bytes[] calldatas, string description)`: Create new proposal
- `castVote(uint256 proposalId, uint8 support)`: Vote on proposal
- `castVoteWithReason(uint256 proposalId, uint8 support, string calldata reason)`: Vote with reason
- `execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)`: Execute proposal
- `delegate(address delegatee)`: Delegate voting power

**Events**:
- `ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)`
- `VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)`
- `ProposalExecuted(uint256 proposalId)`

### QuadraticVotingUtils.sol
**Location**: `contracts/governance/QuadraticVotingUtils.sol`

**Description**: Utility functions for quadratic voting calculations and vote weight computation.

**Key Functions**:
- `calculateVoteWeight(uint256 balance, uint256 voteAmount)`: Calculate quadratic vote weight
- `validateVoteAmount(uint256 balance, uint256 voteAmount)`: Validate vote amount
- `computeVotePower(uint256 balance)`: Compute maximum vote power

### Timelock.sol
**Location**: `contracts/governance/Timelock.sol`

**Description**: Time-delayed execution mechanism for governance proposals.

**Key Features**:
- Configurable delay periods
- Batch execution capabilities
- Emergency cancellation
- Role-based access control

**Main Functions**:
- `schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay)`: Schedule transaction
- `execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt)`: Execute scheduled transaction
- `cancel(bytes32 id)`: Cancel scheduled transaction
- `setDelay(uint256 newDelay)`: Set new delay period

## Staking Contracts

### Staking.sol
**Location**: `contracts/staking/Staking.sol`

**Description**: Main staking contract for token staking and reward distribution.

**Key Features**:
- Token staking with rewards
- Configurable reward rates
- Emergency withdrawal
- Rebase integration

**Main Functions**:
- `stake(uint256 amount)`: Stake tokens
- `unstake(uint256 amount)`: Unstake tokens
- `claimRewards()`: Claim accumulated rewards
- `emergencyWithdraw()`: Emergency withdrawal
- `setRewardRate(uint256 _rewardRate)`: Set reward rate

**Events**:
- `Staked(address indexed user, uint256 amount)`
- `Unstaked(address indexed user, uint256 amount)`
- `RewardsClaimed(address indexed user, uint256 amount)`

### LPStaking.sol
**Location**: `contracts/staking/LPStaking.sol`

**Description**: Liquidity provider staking with additional rewards.

**Key Features**:
- LP token staking
- Dual reward system
- Configurable reward periods
- Emergency controls

## Oracle Contracts

### Oracle.sol
**Location**: `contracts/oracle/Oracle.sol`

**Description**: Decentralized oracle providing economic data feeds.

**Key Features**:
- Multi-source data aggregation
- Configurable update intervals
- Emergency data feeds
- Access control

**Main Functions**:
- `updateData(bytes32 dataId, uint256 value)`: Update data feed
- `getData(bytes32 dataId)`: Get current data value
- `setDataProvider(address provider, bool enabled)`: Configure data providers
- `emergencyUpdate(bytes32 dataId, uint256 value)`: Emergency data update

## Utility Contracts

### AntiWhale.sol
**Location**: `contracts/utils/AntiWhale.sol`

**Description**: Anti-whale protection mechanisms.

**Key Functions**:
- `setAntiWhaleLimits(uint256 _maxTransferAmount, uint256 _maxWalletAmount)`: Set limits
- `setExcludedFromLimits(address account, bool excluded)`: Exclude addresses
- `validateTransfer(address from, address to, uint256 amount, uint256 currentBalance)`: Validate transfer

### FeeOnTransfer.sol
**Location**: `contracts/utils/FeeOnTransfer.sol`

**Description**: Transfer fee management system.

**Key Functions**:
- `setTransferFeeRate(uint256 _feeRate)`: Set fee rate
- `setFeeCollector(address _feeCollector)`: Set fee collector
- `calculateFee(uint256 amount, address from, address to)`: Calculate fees

### Blacklist.sol
**Location**: `contracts/utils/Blacklist.sol`

**Description**: Address blacklisting functionality.

**Key Functions**:
- `blacklistAddress(address account, string memory reason)`: Blacklist address
- `removeFromBlacklist(address account)`: Remove from blacklist
- `isAddressBlacklisted(address account)`: Check blacklist status

### Treasury.sol
**Location**: `contracts/utils/Treasury.sol`

**Description**: Treasury management and fund allocation.

**Key Functions**:
- `allocateFunds(address recipient, uint256 amount)`: Allocate funds
- `withdrawFunds(address token, uint256 amount)`: Withdraw funds
- `setAllocationLimit(uint256 _limit)`: Set allocation limits

## Access Control

### Roles.sol
**Location**: `contracts/access/Roles.sol`

**Description**: Role-based access control system.

**Key Roles**:
- `DEFAULT_ADMIN_ROLE`: Super admin role
- `MINTER_ROLE`: Token minting permission
- `BURNER_ROLE`: Token burning permission
- `REBASER_ROLE`: Rebase execution permission
- `EMERGENCY_ROLE`: Emergency controls permission
- `GOVERNANCE_ROLE`: Governance execution permission

## Integration Patterns

### Contract Interactions
1. **Token ↔ Governance**: Token holders participate in governance
2. **Token ↔ Staking**: Staking contracts receive rebase rewards
3. **Governance ↔ Timelock**: All governance actions go through timelock
4. **Oracle ↔ Governance**: Oracle data influences governance decisions
5. **Treasury ↔ All**: Treasury funds various ecosystem components

### Security Considerations
- All critical functions use role-based access control
- Emergency functions available for crisis situations
- Timelock delays prevent immediate execution of governance actions
- Anti-whale protection prevents market manipulation
- Blacklist functionality for compliance requirements

## Deployment Configuration

### Network-Specific Settings
- **Mainnet**: Full feature set with conservative parameters
- **Testnet**: Reduced limits for testing purposes
- **Local**: Minimal configuration for development

### Upgrade Strategy
- Proxy pattern for upgradeable contracts
- Timelock-controlled upgrades
- Emergency upgrade mechanisms
- Backward compatibility considerations 
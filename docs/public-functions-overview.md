# Halom Project Public Functions Overview

## 🏗️ Project Structure

This document provides a comprehensive overview of all public functions in the Halom protocol, organized by modules with their associated roles and permissions. Each function is categorized by its purpose and access control requirements.

---

## 🧱 Token Module - `contracts/token/HalomToken.sol`

### Core ERC20 Functions
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `transfer` | `transfer(address to, uint256 amount) public returns (bool)` | None (Public) | Transfer tokens to another address |
| `transferFrom` | `transferFrom(address from, address to, uint256 amount) public returns (bool)` | None (Public) | Transfer tokens on behalf of another address |
| `approve` | `approve(address spender, uint256 amount) public returns (bool)` | None (Public) | Approve spender to spend tokens |

### EIP-2612 Permit Functions (zkSync Gasless Support)
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `permit` | `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public` | None (Public) | Gasless approval using EIP-2612 permit |
| `nonces` | `nonces(address owner) public view returns (uint256)` | None (Public) | Get current nonce for permit signature |
| `DOMAIN_SEPARATOR` | `DOMAIN_SEPARATOR() public view returns (bytes32)` | None (Public) | Get EIP-712 domain separator |

### zkSync Paymaster Functions
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `depositToPaymaster` | `depositToPaymaster(address paymaster, uint256 amount) public` | None (Public) | Deposit tokens to paymaster for gas fee payments |
| `withdrawFromPaymaster` | `withdrawFromPaymaster(address paymaster, uint256 amount) public` | None (Public) | Withdraw tokens from paymaster |
| `getPaymasterDeposit` | `getPaymasterDeposit(address user, address paymaster) public view returns (uint256)` | None (Public) | Get user's deposit in specific paymaster |
| `getTotalPaymasterDeposits` | `getTotalPaymasterDeposits(address paymaster) public view returns (uint256)` | None (Public) | Get total deposits for paymaster |

### zkSync Full Exit Functions
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `requestFullExit` | `requestFullExit(uint32 accountId, address token) public` | None (Public) | Request full exit from zkSync L2 to L1 |
| `getFullExitReceipt` | `getFullExitReceipt(uint32 accountId, address token) public view returns (ExitInfo)` | None (Public) | Get full exit request information |
| `getExitRequestCount` | `getExitRequestCount(uint32 accountId) public view returns (uint256)` | None (Public) | Get exit request count for account |
| `completeFullExit` | `completeFullExit(uint32 accountId, address token, address recipient, uint256 amount) public` | `GOVERNOR_ROLE` | Complete full exit (called by zkSync system) |

### zkSync CREATE2 Helper
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `computeCreate2Address` | `computeCreate2Address(address sender, bytes32 salt, bytes32 bytecodeHash, bytes32 constructorInputHash) public pure returns (address)` | None (Public) | Compute CREATE2 address for zkSync deployment |

### Minting & Burning
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `mint` | `mint(address to, uint256 amount) public onlyRole(MINTER_ROLE)` | `MINTER_ROLE` | Mint new tokens to specified address |
| `burn` | `burn(uint256 amount) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Burn tokens from caller's balance |

### Emergency Controls
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `pause` | `pause() public onlyRole(PAUSER_ROLE)` | `PAUSER_ROLE` | Pause all token transfers |
| `unpause` | `unpause() public onlyRole(PAUSER_ROLE)` | `PAUSER_ROLE` | Resume all token transfers |

### Fee Management
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `setFeeParams` | `setFeeParams(uint256 bps, uint256 maxFee) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set transfer fee parameters |

### Anti-Whale Protection
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `setAntiWhaleParams` | `setAntiWhaleParams(uint256 maxTx, uint256 maxWallet, uint256 cooldown) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Configure anti-whale protection limits |

### Blacklist Management
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `blacklist` | `blacklist(address account) public onlyRole(BLACKLIST_ROLE)` | `BLACKLIST_ROLE` | Add address to blacklist |
| `unBlacklist` | `unBlacklist(address account) public onlyRole(BLACKLIST_ROLE)` | `BLACKLIST_ROLE` | Remove address from blacklist |

### Contract Upgrades
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `upgradeTo` | `upgradeTo(address newImplementation) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Upgrade contract implementation (UUPS proxy) |

### View Functions
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `getFeeParams` | `getFeeParams() public view returns (uint256, uint256, address)` | None (Public) | Get current fee parameters |
| `getAntiWhaleParams` | `getAntiWhaleParams() public view returns (uint256, uint256, uint256)` | None (Public) | Get anti-whale parameters |
| `isBlacklisted` | `isBlacklisted(address account) public view returns (bool)` | None (Public) | Check if address is blacklisted |
| `getBlacklistReason` | `getBlacklistReason(address account) public view returns (string)` | None (Public) | Get blacklist reason for address |

---

## 📈 Staking Module - `contracts/staking/Staking.sol`

### User Staking Operations
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `stake` | `stake(uint256 amount) public` | None (Public) | Stake tokens to earn rewards |
| `unstake` | `unstake(uint256 amount) public` | None (Public) | Unstake tokens and withdraw |
| `claimRewards` | `claimRewards() public` | None (Public) | Claim accumulated staking rewards |

### Governance Functions
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `setRewardRate` | `setRewardRate(uint256 rate) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set staking reward rate |
| `emergencyWithdraw` | `emergencyWithdraw() public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Emergency withdraw all staked tokens |

### Emergency Controls
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `pause` | `pause() public onlyRole(PAUSER_ROLE)` | `PAUSER_ROLE` | Pause all staking operations |
| `unpause` | `unpause() public onlyRole(PAUSER_ROLE)` | `PAUSER_ROLE` | Resume all staking operations |

### Contract Upgrades
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `upgradeTo` | `upgradeTo(address newImplementation) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Upgrade contract implementation |

---

## 🗳️ Governance Module - `contracts/governance/Governance.sol`

### Proposal Management
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `propose` | `propose(string memory title, bytes calldata payload) public returns (uint256)` | None (Public) | Create new governance proposal |
| `vote` | `vote(uint256 proposalId, uint256 votes) public` | None (Public) | Vote on proposal using quadratic voting |
| `voteAgainst` | `voteAgainst(uint256 proposalId, uint256 votes) public` | None (Public) | Vote against proposal using quadratic voting |
| `cancelProposal` | `cancelProposal(uint256 proposalId) public` | Proposer or `GOVERNOR_ROLE` | Cancel proposal |

### Proposal Execution
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `executeProposal` | `executeProposal(uint256 proposalId) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Execute successful proposal |

### Governance Parameters
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `setQuorum` | `setQuorum(uint256 newQuorum) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set minimum quorum for proposals |
| `setVotingDelay` | `setVotingDelay(uint256 delay) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set voting delay period |
| `setVotingPeriod` | `setVotingPeriod(uint256 period) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set voting period duration |

### Cross-Chain Integration
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `relayCrossChainProposal` | `relayCrossChainProposal(bytes calldata data) public onlyRole(BRIDGE_ROLE)` | `BRIDGE_ROLE` | Relay proposal from another chain |

### Emergency Controls
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `pause` | `pause() public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Pause governance operations |
| `unpause` | `unpause() public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Resume governance operations |

### Contract Upgrades
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `upgradeTo` | `upgradeTo(address newImplementation) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Upgrade contract implementation |

---

## 💱 Oracle Module - `contracts/oracle/Oracle.sol`

### Price Data Management
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `submitPrice` | `submitPrice(bytes32 key, uint256 price) public onlyRole(ORACLE_ROLE)` | `ORACLE_ROLE` | Submit price data for key |

### Oracle Management
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `addOracle` | `addOracle(address oracle) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Add new oracle address |
| `removeOracle` | `removeOracle(address oracle) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Remove oracle address |

### Configuration
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `setPriceValidityPeriod` | `setPriceValidityPeriod(uint256 period) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set price validity period |
| `setMinOracleCount` | `setMinOracleCount(uint256 count) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set minimum oracle count |
| `setPriceSubmissionCooldown` | `setPriceSubmissionCooldown(uint256 cooldown) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set price submission cooldown |

### Emergency Controls
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `pause` | `pause() public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Pause oracle operations |
| `unpause` | `unpause() public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Resume oracle operations |

### Contract Upgrades
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `upgradeTo` | `upgradeTo(address newImplementation) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Upgrade contract implementation |

---

## 🔗 Bridge Module - `contracts/bridge/Bridge.sol`

### Cross-Chain Operations
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `lockTokens` | `lockTokens(address from, uint256 amount, uint256 targetChainId) public` | None (Public) | Lock tokens for cross-chain transfer |
| `burnForRedeem` | `burnForRedeem(uint256 amount, uint256 targetChainId) public` | None (Public) | Burn tokens for cross-chain redemption |

### Bridge Operations
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `mintFromBridge` | `mintFromBridge(address to, uint256 amount, uint256 sourceChainId) public onlyRole(BRIDGE_ROLE)` | `BRIDGE_ROLE` | Mint tokens from bridge |
| `unlockTokens` | `unlockTokens(address to, uint256 amount) public onlyRole(BRIDGE_ROLE)` | `BRIDGE_ROLE` | Unlock tokens from bridge |

### Bridge Management
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `setBridge` | `setBridge(address newBridge) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set bridge address |
| `setChainSupport` | `setChainSupport(uint256 chainId, bool supported) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Enable/disable chain support |
| `setBridgeFee` | `setBridgeFee(uint256 newFee) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set bridge fee |
| `setFeeCollector` | `setFeeCollector(address newCollector) public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Set fee collector address |

### Emergency Controls
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `pause` | `pause() public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Pause bridge operations |
| `unpause` | `unpause() public onlyRole(GOVERNOR_ROLE)` | `GOVERNOR_ROLE` | Resume bridge operations |

### Contract Upgrades
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `upgradeTo` | `upgradeTo(address newImplementation) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Upgrade contract implementation |

---

## 🔐 Access Control Module - `contracts/access/Roles.sol`

### Role Management
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `grantRole` | `grantRole(bytes32 role, address account) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Grant role to account |
| `revokeRole` | `revokeRole(bytes32 role, address account) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Revoke role from account |
| `renounceRole` | `renounceRole(bytes32 role, address account) public` | Account owner | Renounce own role |

### Role Configuration
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `setRoleDescription` | `setRoleDescription(bytes32 role, string memory description) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Set role description |
| `setRoleHierarchy` | `setRoleHierarchy(bytes32 role, bytes32[] memory parentRoles) public onlyRole(DEFAULT_ADMIN_ROLE)` | `DEFAULT_ADMIN_ROLE` | Set role hierarchy |

### Emergency Functions
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `activateEmergencyRole` | `activateEmergencyRole(string memory reason) public onlyRole(EMERGENCY_ROLE)` | `EMERGENCY_ROLE` | Activate emergency role |

### Contract Upgrades
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `upgradeTo` | `upgradeTo(address newImplementation) public onlyRole(UPGRADER_ROLE)` | `UPGRADER_ROLE` | Upgrade contract implementation |

### View Functions
| Function | Signature | Role Required | Description |
|----------|-----------|---------------|-------------|
| `getRoleDescription` | `getRoleDescription(bytes32 role) public view returns (string memory)` | None (Public) | Get role description |
| `getRoleHierarchy` | `getRoleHierarchy(bytes32 role) public view returns (bytes32[] memory)` | None (Public) | Get role hierarchy |
| `hasRoleOrParent` | `hasRoleOrParent(bytes32 role, address account) public view returns (bool)` | None (Public) | Check if account has role or parent role |
| `getAccountRoles` | `getAccountRoles(address account) public view returns (bytes32[] memory)` | None (Public) | Get all roles for account |
| `getAccountRoleCount` | `getAccountRoleCount(address account) public view returns (uint256)` | None (Public) | Get role count for account |
| `hasAnyRole` | `hasAnyRole(address account) public view returns (bool)` | None (Public) | Check if account has any role |
| `getRoleMembers` | `getRoleMembers(bytes32 role) public view returns (address[] memory)` | None (Public) | Get all accounts with role |
| `getRoleConstants` | `getRoleConstants() public pure returns (bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32)` | None (Public) | Get all role constants |

---

## 📊 Function Distribution Summary

### Public Functions (No Role Required): 31
- **Core ERC20**: 3 functions (transfer, transferFrom, approve)
- **EIP-2612 Permit**: 3 functions (permit, nonces, DOMAIN_SEPARATOR)
- **zkSync Paymaster**: 4 functions (deposit, withdraw, getDeposit, getTotalDeposits)
- **zkSync Full Exit**: 3 functions (request, getReceipt, getCount)
- **zkSync CREATE2**: 1 function (computeCreate2Address)
- **Staking Operations**: 3 functions (stake, unstake, claimRewards)
- **Governance Participation**: 4 functions (propose, vote, voteAgainst, cancelProposal)
- **Bridge User Operations**: 2 functions (lockTokens, burnForRedeem)
- **Role Analytics**: 8 functions (various view functions)

### Role-Protected Functions: 45
- **DEFAULT_ADMIN_ROLE**: 8 functions (contract upgrades, role management)
- **GOVERNOR_ROLE**: 18 functions (parameter management, governance execution)
- **PAUSER_ROLE**: 4 functions (emergency pause/unpause)
- **MINTER_ROLE**: 1 function (token minting)
- **BRIDGE_ROLE**: 4 functions (cross-chain operations)
- **ORACLE_ROLE**: 1 function (price data submission)
- **BLACKLIST_ROLE**: 2 functions (address management)
- **UPGRADER_ROLE**: 1 function (contract upgrades)
- **EMERGENCY_ROLE**: 1 function (emergency activation)

---

## 🔐 Role Hierarchy and Permissions

### Role Hierarchy
```
DEFAULT_ADMIN_ROLE (Root)
├── UPGRADER_ROLE
├── GOVERNOR_ROLE
│   └── EMERGENCY_ROLE
├── MINTER_ROLE
├── PAUSER_ROLE
├── BLACKLIST_ROLE
├── BRIDGE_ROLE
└── ORACLE_ROLE
```

### Permission Matrix

| Function Category | DEFAULT_ADMIN_ROLE | GOVERNOR_ROLE | PAUSER_ROLE | MINTER_ROLE | BRIDGE_ROLE | ORACLE_ROLE | BLACKLIST_ROLE | UPGRADER_ROLE | EMERGENCY_ROLE |
|-------------------|-------------------|---------------|-------------|-------------|-------------|-------------|----------------|---------------|----------------|
| **Role Management** | ✅ Grant/Revoke | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Contract Upgrades** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Token Minting** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Emergency Pause** | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Parameter Management** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Blacklist Management** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Bridge Operations** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Oracle Operations** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Emergency Activation** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 🚀 zkSync Integration Features

### Gasless Transactions
- **EIP-2612 Permit**: Enables gasless token approvals
- **EIP-712 Domain**: Standardized signature verification
- **Nonce Management**: Prevents replay attacks

### Paymaster Support
- **Token Gas Fees**: Users can pay gas fees with tokens
- **Deposit Management**: Secure token deposits to paymasters
- **Withdrawal System**: Easy token withdrawal from paymasters

### Full Exit Support
- **L2 to L1 Bridging**: Complete exit from zkSync to Ethereum
- **Exit Tracking**: Comprehensive exit request management
- **Completion Handling**: Automated exit completion process

### CREATE2 Compatibility
- **zkSync Address Computation**: Correct address calculation for zkSync
- **Deployment Support**: Factory contract deployment compatibility

---

## 📋 Summary

The Halom protocol provides a comprehensive set of public functions organized by modules with clear role-based access control. The addition of zkSync-specific functions enhances the protocol's compatibility with zkSync Era, enabling:

- **Gasless transactions** through EIP-2612 permit
- **Token-based gas fees** via paymaster integration
- **Seamless L2 to L1 bridging** with full exit support
- **zkSync-native deployment** with CREATE2 compatibility

All functions are properly secured with role-based access control, ensuring the protocol's security and scalability while maintaining excellent user experience across multiple blockchain networks. 
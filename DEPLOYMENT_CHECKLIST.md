# Halom Deployment Checklist

## 🔧 Pre-Deployment Setup

### Environment Variables
- [ ] `RPC_URL` - Blockchain RPC endpoint
- [ ] `PRIVATE_KEY` - Deployer private key
- [ ] `CHAIN_ID` - Target chain ID
- [ ] `TIMELOCK_DELAY` - Governance timelock delay (default: 86400)
- [ ] `MULTISIG_ADDRESS` - Multisig wallet address (optional)

### Network Configuration
- [ ] Network is accessible
- [ ] Deployer has sufficient ETH for gas
- [ ] Chain ID is correct

## 🚀 Deployment Steps

### 1. Contract Deployment
- [ ] Deploy TimelockController
- [ ] Deploy HalomToken
- [ ] Deploy HalomGovernor
- [ ] Deploy HalomOracleV2
- [ ] Deploy HalomStaking
- [ ] Deploy HalomLPStaking
- [ ] Deploy HalomTreasury
- [ ] Deploy HalomRoleManager

### 2. Critical Role Assignments

#### HalomToken Roles
- [ ] `setStakingContract(staking.address)` - **CRITICAL for rebase rewards**
- [ ] Grant `REBASE_CALLER` to oracle contract
- [ ] Grant `MINTER_ROLE` to staking contract (NOT DEFAULT_ADMIN_ROLE)
- [ ] Verify `STAKING_CONTRACT_ROLE` automatically granted
- [ ] Verify `halomStakingAddress` is set correctly

#### Governance Roles
- [ ] Grant `PROPOSER_ROLE` to governor in timelock
- [ ] Grant `EXECUTOR_ROLE` to governor in timelock
- [ ] Transfer timelock `DEFAULT_ADMIN_ROLE` to multisig (if configured)

#### Oracle Roles
- [ ] Set HalomToken address in oracle
- [ ] Add oracle nodes (minimum 3)
- [ ] Grant `ORACLE_UPDATER_ROLE` to authorized nodes

#### Staking Roles
- [ ] Grant `REWARDER_ROLE` to token contract in staking
- [ ] Grant `REWARDER_ROLE` to governor in LP staking
- [ ] Verify `SLASHER_ROLE` granted to governor

#### Treasury Roles
- [ ] Set fee distribution addresses
- [ ] Grant `TREASURY_CONTROLLER` to governor

## ✅ Post-Deployment Verification

### Role Verification
- [ ] `DEFAULT_ADMIN_ROLE` only on TimelockController
- [ ] `MINTER_ROLE` only on HalomStaking contract
- [ ] `REBASE_CALLER` only on HalomOracleV2 contract
- [ ] `STAKING_CONTRACT_ROLE` only on HalomStaking contract
- [ ] `ORACLE_UPDATER_ROLE` only on authorized oracle nodes
- [ ] `GOVERNOR_ROLE` only on HalomGovernor contract
- [ ] `SLASHER_ROLE` only on governor
- [ ] `REWARDER_ROLE` only on token contract and governor
- [ ] `TREASURY_CONTROLLER` only on governor

### Functionality Tests
- [ ] Rebase rewards distribution works
- [ ] Slash functionality works
- [ ] Oracle consensus mechanism works
- [ ] Governance proposal creation works
- [ ] Emergency pause functions work

### Security Checks
- [ ] No human addresses have critical roles
- [ ] All admin functions require timelock delay
- [ ] Anti-whale limits are properly set
- [ ] Transfer limits are enforced
- [ ] Fourth root governance is working

## 🧪 Testing

### Automated Tests
```bash
# Run all security tests
npx hardhat test test/test-secure-roles.js

# Run specific functionality tests
npx hardhat test test/test-staking.js
npx hardhat test test/test-oracle.js
npx hardhat test test/test-governance.js
```

### Manual Verification
- [ ] Deploy test tokens to user accounts
- [ ] Test staking and unstaking
- [ ] Test rebase reward distribution
- [ ] Test slash functionality
- [ ] Test oracle consensus
- [ ] Test governance proposals

## 🔒 Security Finalization

### Multisig Setup
- [ ] Transfer timelock admin role to multisig
- [ ] Verify multisig can execute admin functions
- [ ] Test emergency procedures with multisig

### Monitoring Setup
- [ ] Configure offchain oracle updater
- [ ] Set up monitoring and alerting
- [ ] Test emergency notification system

### Documentation
- [ ] Update deployment addresses
- [ ] Document role assignments
- [ ] Create emergency procedures
- [ ] Update governance documentation

## ⚠️ Critical Issues to Check

### Rebase Rewards
- [ ] `halomStakingAddress` is set in HalomToken
- [ ] `MINTER_ROLE` granted to staking contract
- [ ] `REWARDER_ROLE` granted to token contract in staking

### Slash Functionality
- [ ] `STAKING_CONTRACT_ROLE` granted to staking contract
- [ ] `SLASHER_ROLE` granted to governor
- [ ] Slash percentage is properly configured

### Oracle Consensus
- [ ] Minimum 3 oracle nodes added
- [ ] Consensus threshold is 2/3
- [ ] Deviation limit is 5%
- [ ] Submission window is 5 minutes

### Governance
- [ ] Timelock delay is appropriate (24 hours minimum)
- [ ] Governor has proposer and executor roles
- [ ] Multisig has admin role (if configured)

## 🚨 Emergency Procedures

### If Rebase Rewards Not Working
1. Check `halomStakingAddress` is set
2. Verify `MINTER_ROLE` is granted to staking contract
3. Check `REWARDER_ROLE` is granted to token contract
4. Test rebase with small amount

### If Slash Not Working
1. Check `STAKING_CONTRACT_ROLE` is granted to staking contract
2. Verify `SLASHER_ROLE` is granted to governor
3. Test slash with small amount

### If Oracle Not Working
1. Check oracle nodes are authorized
2. Verify consensus parameters
3. Test oracle submission manually

### If Governance Not Working
1. Check timelock roles are properly assigned
2. Verify governor has correct permissions
3. Test proposal creation and execution

## 📋 Deployment Summary

After successful deployment, you should have:

- ✅ All contracts deployed with correct addresses
- ✅ All roles properly assigned with minimum privileges
- ✅ Rebase rewards distribution working
- ✅ Slash functionality working
- ✅ Oracle consensus mechanism working
- ✅ Governance system operational
- ✅ Emergency procedures tested
- ✅ Monitoring and alerting configured

**Remember**: Always test thoroughly on testnet before mainnet deployment! 
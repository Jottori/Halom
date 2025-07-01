# Halom Project - Manual Testing Guide

## Table of Contents
1. [Testing Environment Setup](#testing-environment-setup)
2. [Role-based Access Control Testing](#role-based-access-control-testing)
3. [Governance Testing](#governance-testing)
4. [Token Testing](#token-testing)
5. [zkSync Integration Testing](#zksync-integration-testing)
6. [Oracle Testing](#oracle-testing)
7. [Bridge Testing](#bridge-testing)
8. [Staking Testing](#staking-testing)
9. [Treasury Testing](#treasury-testing)
10. [Edge Cases and Attack Vectors](#edge-cases-and-attack-vectors)

## Testing Environment Setup

### Prerequisites
- Node.js v16+
- Hardhat development environment
- Testnet ETH (Goerli, Sepolia, or zkSync testnet)
- MetaMask or similar wallet
- Remix IDE (for interactive testing)

### Setup Commands
```bash
# Clone and setup
git clone <halom-repo>
cd Halom
npm install

# Deploy to testnet
npx hardhat run scripts/deploy/deploy_testnet.js --network goerli

# Verify contracts
npx hardhat verify --network goerli <contract-address> <constructor-args>
```

## Role-based Access Control Testing

### Test Cases

#### 1. Role Assignment/Revocation
```javascript
// Test role assignment
await roles.grantRole(DEFAULT_ADMIN_ROLE, user1.address);
expect(await roles.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.true;

// Test role revocation
await roles.revokeRole(DEFAULT_ADMIN_ROLE, user1.address);
expect(await roles.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.false;
```

#### 2. Unauthorized Access Attempts
```javascript
// Test unauthorized minting
await expect(
    halomToken.connect(user1).mint(user1.address, 1000)
).to.be.revertedWith("AccessControl");

// Test unauthorized pausing
await expect(
    halomToken.connect(user1).pause()
).to.be.revertedWith("AccessControl");
```

#### 3. Role Escalation Attempts
```javascript
// Test if non-admin can grant admin role
await expect(
    roles.connect(user1).grantRole(DEFAULT_ADMIN_ROLE, user2.address)
).to.be.revertedWith("AccessControl");

// Test if governor can grant admin role
await expect(
    roles.connect(governor).grantRole(DEFAULT_ADMIN_ROLE, user2.address)
).to.be.revertedWith("AccessControl");
```

### Attack Vectors to Test

#### Role Confusion Attack
1. **Objective**: Gain unauthorized access through role confusion
2. **Steps**:
   - Deploy malicious contract with same interface
   - Try to call functions expecting different role system
   - Check if role checks are bypassed

#### Role Inheritance Attack
1. **Objective**: Inherit roles from parent contracts
2. **Steps**:
   - Check if roles are inherited from upgradeable contracts
   - Test if inherited roles can be exploited

## Governance Testing

### Test Cases

#### 1. Proposal Creation
```javascript
// Test proposal creation with sufficient votes
const proposalId = await governance.propose(
    [target.address],
    [0],
    [calldata],
    "Test proposal"
);

// Test proposal creation without sufficient votes
await expect(
    governance.connect(user1).propose(
        [target.address],
        [0],
        [calldata],
        "Test proposal"
    )
).to.be.revertedWith("InsufficientVotes");
```

#### 2. Voting Mechanism
```javascript
// Test quadratic voting
const votes1 = await governance.getVotes(user1.address);
const votes2 = await governance.getVotes(user2.address);

// Vote with different power levels
await governance.connect(user1).castVote(proposalId, 1);
await governance.connect(user2).castVote(proposalId, 0);

// Check vote counting
const proposal = await governance.proposals(proposalId);
expect(proposal.forVotes).to.be.gt(proposal.againstVotes);
```

#### 3. Proposal Execution
```javascript
// Test successful execution
await governance.execute(
    [target.address],
    [0],
    [calldata],
    keccak256("Test proposal")
);

// Test execution without quorum
await expect(
    governance.execute(
        [target.address],
        [0],
        [calldata],
        keccak256("Failed proposal")
    )
).to.be.revertedWith("ProposalNotSuccessful");
```

### Attack Vectors to Test

#### Flash Loan Attack
1. **Objective**: Manipulate voting power using flash loans
2. **Steps**:
   - Take flash loan to get temporary voting power
   - Vote on proposal
   - Repay flash loan
   - Check if vote remains valid

#### Proposal Gaming
1. **Objective**: Create proposals that benefit attacker
2. **Steps**:
   - Create proposal with hidden malicious logic
   - Use confusing proposal description
   - Test if voters can understand the impact

#### Treasury Drain Attack
1. **Objective**: Drain treasury through governance
2. **Steps**:
   - Create proposal to transfer treasury funds
   - Use social engineering to get votes
   - Execute malicious proposal

## Token Testing

### Test Cases

#### 1. Transfer Mechanisms
```javascript
// Test normal transfer
await halomToken.transfer(user2.address, 1000);
expect(await halomToken.balanceOf(user2.address)).to.equal(1000);

// Test transfer with fees
const initialBalance = await halomToken.balanceOf(user1.address);
await halomToken.transfer(user2.address, 1000);
const finalBalance = await halomToken.balanceOf(user1.address);
expect(initialBalance.sub(finalBalance)).to.be.gt(1000); // Includes fees
```

#### 2. Anti-Whale Protection
```javascript
// Test transfer within limits
await halomToken.transfer(user2.address, 1000000); // Should work

// Test transfer exceeding limits
await expect(
    halomToken.transfer(user2.address, 1000000000)
).to.be.revertedWith("TransferExceedsLimit");
```

#### 3. Blacklist Functionality
```javascript
// Test blacklisting
await halomToken.blacklist(user1.address);
await expect(
    halomToken.transfer(user2.address, 1000)
).to.be.revertedWith("AddressBlacklisted");

// Test unblacklisting
await halomToken.unblacklist(user1.address);
await halomToken.transfer(user2.address, 1000); // Should work now
```

### Attack Vectors to Test

#### Fee Manipulation
1. **Objective**: Bypass or manipulate transfer fees
2. **Steps**:
   - Test different transfer amounts
   - Check if fees can be avoided
   - Test fee calculation precision

#### Minting Abuse
1. **Objective**: Mint tokens without authorization
2. **Steps**:
   - Try to call mint function without role
   - Test minting limits
   - Check if minting can be bypassed

## zkSync Integration Testing

### Test Cases

#### 1. EIP-2612 Permit
```javascript
// Test permit functionality
const deadline = Math.floor(Date.now() / 1000) + 3600;
const signature = await signPermit(
    halomToken.address,
    owner,
    spender,
    value,
    nonce,
    deadline
);

await halomToken.permit(
    owner.address,
    spender.address,
    value,
    deadline,
    signature.v,
    signature.r,
    signature.s
);
```

#### 2. Paymaster Integration
```javascript
// Test paymaster validation
const paymasterData = encodePaymasterData(token, amount);
await halomToken.validateAndPayForPaymasterTransaction(
    user,
    transaction,
    paymasterData
);

// Test post-transaction
await halomToken.postTransaction(
    user,
    transaction,
    paymasterData
);
```

#### 3. Exit Mechanism
```javascript
// Test full exit request
await halomToken.requestFullExit(user.address);

// Test exit completion
await halomToken.completeFullExit(user.address);
```

### Attack Vectors to Test

#### Permit Replay Attack
1. **Objective**: Reuse permit signature
2. **Steps**:
   - Create permit signature
   - Use signature multiple times
   - Check if replay protection works

#### Paymaster Abuse
1. **Objective**: Manipulate gas fee payments
2. **Steps**:
   - Test paymaster validation logic
   - Try to bypass fee payments
   - Check if validation can be tricked

#### Exit Race Condition
1. **Objective**: Exploit exit timing
2. **Steps**:
   - Request exit
   - Try to manipulate exit timing
   - Check if race conditions exist

## Oracle Testing

### Test Cases

#### 1. Data Updates
```javascript
// Test oracle update
await oracle.updateData(newData);
expect(await oracle.getLatestData()).to.equal(newData);

// Test unauthorized update
await expect(
    oracle.connect(user1).updateData(newData)
).to.be.revertedWith("AccessControl");
```

#### 2. Data Validation
```javascript
// Test valid data
await oracle.updateData(validData);

// Test invalid data
await expect(
    oracle.updateData(invalidData)
).to.be.revertedWith("InvalidData");
```

#### 3. Stale Data Protection
```javascript
// Test fresh data
await oracle.updateData(newData);
expect(await oracle.isDataFresh()).to.be.true;

// Test stale data
await time.increase(3600); // 1 hour
expect(await oracle.isDataFresh()).to.be.false;
```

### Attack Vectors to Test

#### Oracle Manipulation
1. **Objective**: Manipulate oracle data
2. **Steps**:
   - Test data validation
   - Try to inject malicious data
   - Check if manipulation is possible

#### Stale Data Attack
1. **Objective**: Use outdated data
2. **Steps**:
   - Let data become stale
   - Try to use stale data
   - Check if stale data protection works

## Bridge Testing

### Test Cases

#### 1. Cross-chain Transfers
```javascript
// Test L1 to L2 transfer
await bridge.depositToL2(user.address, amount);
expect(await bridge.getPendingDeposits(user.address)).to.equal(amount);

// Test L2 to L1 transfer
await bridge.withdrawToL1(user.address, amount);
expect(await bridge.getPendingWithdrawals(user.address)).to.equal(amount);
```

#### 2. Security Checks
```javascript
// Test withdrawal limits
await expect(
    bridge.withdrawToL1(user.address, maxAmount + 1)
).to.be.revertedWith("ExceedsLimit");

// Test unauthorized withdrawal
await expect(
    bridge.connect(user1).withdrawToL1(user2.address, amount)
).to.be.revertedWith("AccessControl");
```

### Attack Vectors to Test

#### Replay Attack
1. **Objective**: Replay cross-chain transactions
2. **Steps**:
   - Submit withdrawal request
   - Try to replay the request
   - Check if replay protection works

#### Double Spending
1. **Objective**: Spend same funds on both chains
2. **Steps**:
   - Deposit to L2
   - Try to spend on L1
   - Check if double spending is prevented

## Staking Testing

### Test Cases

#### 1. Staking Operations
```javascript
// Test staking
await staking.stake(amount);
expect(await staking.balanceOf(user.address)).to.equal(amount);

// Test unstaking
await staking.unstake(amount);
expect(await staking.balanceOf(user.address)).to.equal(0);
```

#### 2. Reward Distribution
```javascript
// Test reward calculation
const initialRewards = await staking.earned(user.address);
await time.increase(3600); // 1 hour
const finalRewards = await staking.earned(user.address);
expect(finalRewards).to.be.gt(initialRewards);
```

### Attack Vectors to Test

#### Reward Manipulation
1. **Objective**: Manipulate reward calculations
2. **Steps**:
   - Test reward calculation logic
   - Try to exploit timing
   - Check if manipulation is possible

#### Staking Exploitation
1. **Objective**: Exploit staking mechanisms
2. **Steps**:
   - Test staking limits
   - Try to bypass restrictions
   - Check if exploitation is possible

## Treasury Testing

### Test Cases

#### 1. Fund Management
```javascript
// Test fund deposit
await treasury.deposit(amount);
expect(await treasury.getBalance()).to.equal(amount);

// Test fund withdrawal
await treasury.withdraw(amount, user.address);
expect(await treasury.getBalance()).to.equal(0);
```

#### 2. Access Control
```javascript
// Test authorized withdrawal
await treasury.withdraw(amount, user.address);

// Test unauthorized withdrawal
await expect(
    treasury.connect(user1).withdraw(amount, user2.address)
).to.be.revertedWith("AccessControl");
```

### Attack Vectors to Test

#### Treasury Drain
1. **Objective**: Drain treasury funds
2. **Steps**:
   - Test withdrawal limits
   - Try to bypass access control
   - Check if drain is possible

## Edge Cases and Attack Vectors

### General Edge Cases

#### 1. Overflow/Underflow
```javascript
// Test maximum values
await expect(
    halomToken.transfer(user2.address, ethers.constants.MaxUint256)
).to.be.revertedWith("Overflow");

// Test zero values
await halomToken.transfer(user2.address, 0); // Should work
```

#### 2. Reentrancy
```javascript
// Test reentrancy protection
const maliciousContract = await MaliciousContract.deploy();
await expect(
    maliciousContract.attack()
).to.be.revertedWith("ReentrancyGuard");
```

#### 3. Gas Optimization
```javascript
// Test gas limits
const gasEstimate = await halomToken.transfer.estimateGas(
    user2.address,
    1000
);
expect(gasEstimate).to.be.lt(100000); // Should be reasonable
```

### Advanced Attack Vectors

#### 1. Front-running
1. **Objective**: Front-run transactions
2. **Steps**:
   - Monitor mempool
   - Submit higher gas transaction
   - Check if front-running is possible

#### 2. MEV Extraction
1. **Objective**: Extract MEV from transactions
2. **Steps**:
   - Analyze transaction ordering
   - Check if MEV can be extracted
   - Test protection mechanisms

#### 3. Social Engineering
1. **Objective**: Manipulate governance through social engineering
2. **Steps**:
   - Create misleading proposals
   - Use social pressure
   - Check if manipulation is possible

## Testing Checklist

### Pre-deployment Checklist
- [ ] All role-based access controls tested
- [ ] All governance mechanisms tested
- [ ] All token functions tested
- [ ] All zkSync integrations tested
- [ ] All oracle functions tested
- [ ] All bridge functions tested
- [ ] All staking functions tested
- [ ] All treasury functions tested
- [ ] All edge cases tested
- [ ] All attack vectors tested

### Security Checklist
- [ ] No unauthorized access possible
- [ ] No fund loss possible
- [ ] No governance takeover possible
- [ ] No oracle manipulation possible
- [ ] No bridge exploitation possible
- [ ] No staking exploitation possible
- [ ] No treasury drain possible

### Performance Checklist
- [ ] Gas usage within limits
- [ ] Transaction speed acceptable
- [ ] Storage usage optimized
- [ ] No infinite loops
- [ ] No excessive computations

---

*This manual testing guide ensures comprehensive security testing of the Halom project before deployment.* 
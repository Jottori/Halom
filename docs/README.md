# Halom Protocol

An innovative DeFi protocol that uses fourth root (fourth root) based voting and reward distribution systems to protect against whales.

## 🚀 Key Features

### Fourth Root Based System

The Halom Protocol consistently applies fourth root calculations in all voting and reward distribution logic:

- **Governance Voting**: `voting_power = fourthRoot(locked_tokens)`
- **Staking Rewards**: `reward_share = fourthRoot(user_stake) / sum(fourthRoot(all_stakes))`
- **LP Staking**: `reward_share = fourthRoot(user_lp_stake) / sum(fourthRoot(all_lp_stakes))`
- **Treasury Fees**: `fee_share = fourthRoot(user_fee_contribution) / sum(fourthRoot(all_fees))`

### Anti-Whale Protection

The fourth root logic significantly reduces the influence of large token holders:

- **Linear voting**: 1:1 ratio (traditional)
- **Fourth root voting**: 1:4 ratio (Halom)
- **Power reduction**: Up to 80%+ reduction for largest holders

### EURC Integration

- **Stablecoin**: EURC usage instead of DAI
- **6 decimals**: EURC standard decimal precision
- **Mainnet ready**: Real EURC address usage

## 📊 Calculation Examples

### Governance Power
```
User A: 1,000 HLM → 250.75 voting power
User B: 10,000 HLM → 1,000.00 voting power  
User C: 100,000 HLM → 10,000.00 voting power
```

### Reward Distribution
```
Pool: 10,000 HLM rewards
User A (1,000 HLM): 0.16% = 15.90 HLM
User B (10,000 HLM): 1.58% = 158.40 HLM
User C (100,000 HLM): 15.85% = 1,584.80 HLM
```

## 🏗️ Architecture

### Smart Contracts

1. **HalomToken** - ERC20 token with fourth root based rebase logic
2. **HalomGovernor** - DAO governance with fourth root voting power
3. **HalomStaking** - Staking contract with fourth root reward distribution
4. **HalomLPStaking** - LP staking with fourth root based system
5. **HalomTreasury** - Treasury with EURC integration and fourth root fee distribution
6. **HalomOracle** - Oracle system with real-time updated data
7. **HalomTimelock** - Timelock controller for governance security

### Off-chain Components

- **Oracle Updater** - Python script with real-time updated data
- **Calculator** - Fourth root based calculations for frontend use
- **Cron Jobs** - Automatic updates and monitoring

## 🛠️ Installation and Usage

### Prerequisites

```bash
npm install
pip install -r requirements.txt
```

### Deployment

```bash
# Local deployment
npx hardhat run scripts/deploy.js --network localhost

# Testnet deployment  
npx hardhat run scripts/deploy.js --network testnet

# Mainnet deployment
npx hardhat run scripts/deploy.js --network mainnet
```

### Off-chain Services

```bash
# Oracle updater
cd offchain
python updater.py

# Calculator demo
python calculator.py
```

## 📈 Governance

### Voting Power Calculation

```solidity
function getVotePower(address user) public view returns (uint256) {
    if (lockTime[user] == 0) return 0;
    if (block.timestamp < lockTime[user] + LOCK_DURATION) {
        return nthRoot(lockedTokens[user], rootPower); // Default: 4
    }
    return 0;
}
```

### Parameterizable Root Power

The root power can be modified by governance vote:

```solidity
function setRootPower(uint256 newRootPower) external onlyGovernance {
    require(newRootPower >= MIN_ROOT_POWER && newRootPower <= MAX_ROOT_POWER);
    rootPower = newRootPower;
}
```

## 🔒 Security

### Security Features

- **ReentrancyGuard**: In all critical functions
- **AccessControl**: Role-based access control
- **Pausable**: Emergency pause functionality
- **Timelock**: Governance delay protection
- **Emergency Recovery**: Token recovery functions

### Audit Coverage

- ✅ Rebase logic testing
- ✅ Slash functionality testing  
- ✅ Edge case handling
- ✅ Access control verification
- ✅ Integration testing
- ✅ Fourth root calculation accuracy

## 📊 Monitoring and Analytics

### On-chain Metrics

- Total staked amount
- Total fourth root stake
- Governance participation
- Reward distribution efficiency
- Anti-whale effect measurement

### Off-chain Analytics

- Oracle data accuracy
- System performance metrics
- User behavior analysis
- Governance efficiency scores

## 🌐 Frontend Integration

### Calculator API

```javascript
// Fourth root based reward calculation
const calculator = new HalomCalculator(4); // 4 = fourth root
const reward = calculator.calculate_expected_reward(
    userStake, 
    allStakes, 
    rewardPool
);

// Anti-whale effect analysis
const antiWhale = calculator.calculate_anti_whale_effect(stakeAmounts);
console.log(`Power reduction: ${antiWhale.power_reduction_percentage}%`);
```

### Expected Reward Display

All "My Expected Reward" panels show fourth root based calculations so users can see that small amounts with long lock periods won't be suppressed.

## 🔄 Roadmap

### Completed ✅
- [x] Fourth root based governance voting
- [x] Fourth root based staking rewards
- [x] Fourth root based LP staking
- [x] EURC integration
- [x] Parameterizable root power
- [x] Security audit and testing
- [x] Off-chain calculator
- [x] Oracle pipeline

### In Progress 🚧
- [ ] Frontend integration
- [ ] Mainnet deployment
- [ ] Community governance activation

### Planned 📋
- [ ] Cross-chain bridge support
- [ ] Advanced analytics dashboard
- [ ] Mobile app development
- [ ] Institutional features

## 📝 License

MIT License - see the [LICENSE](LICENSE) file.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

**Halom Protocol** - Democratic DeFi with the power of fourth root 🚀

## 📊 Economic Simulation

The Halom Protocol economic simulation is available in [notebooks/economic_simulation.ipynb](notebooks/economic_simulation.ipynb).

This notebook models the HOM token's inflation, reward system, and rebase mechanism using real IMF, World Bank, OECD, and Eurostat data. The required data files are located in the `offchain/data/` directory.

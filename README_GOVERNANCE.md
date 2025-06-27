# Halom Governance System

Complete decentralized governance system for the Halom protocol, including Timelock, DAO, Treasury, and enhanced oracle modules.

## 🏗️ Architecture

### 1. Timelock Controller (`HalomTimelock.sol`)
- **Purpose**: Time-delayed execution for all administrative operations
- **Min delay**: 24 hours
- **Security**: All critical operations are pre-announced with waiting period

### 2. Governance (`HalomGovernor.sol`)
- **Voting power**: Fourth root based (fourth root)
- **Token lock**: 5 year fixed lock period
- **Quorum**: 4% minimum participation
- **Voting period**: ~1 week

### 3. Treasury (`HalomTreasury.sol`)
- **Fee distribution**: 60% staking, 20% LP staking, 20% DAO reserve
- **Automatic distribution**: Triggered by operator
- **Emergency functions**: Emergency financial operations

### 4. Enhanced Oracle (`HalomOracleV2.sol`)
- **Multiple nodes**: Consensus-based HOI calculation
- **API integration**: Real-time data from Eurostat/OECD
- **Validation**: Median and deviation checking

## 🚀 Installation

### 1. Install dependencies
```bash
npm install
```

### 2. Environment setup
```bash
cp env.example .env
# Fill in the required values
```

### 3. Deploy governance system
```bash
npm run deploy:governance
```

### 4. Setup oracle scheduling
```bash
npm run oracle:setup
```

## 📋 Usage

### Governance operations

#### 1. Lock tokens for voting
```javascript
// Lock tokens for 5 years to get voting power
await halomGovernor.lockTokens(ethers.parseEther("1000"));
```

#### 2. Create proposal
```javascript
const targets = [treasuryAddress];
const values = [0];
const calldatas = [
    treasury.interface.encodeFunctionData("updateFeePercentages", [7000, 2000, 1000])
];
const description = "Update fee distribution";

await halomGovernor.propose(targets, values, calldatas, description);
```

#### 3. Vote
```javascript
// Vote with locked tokens (fourth root voting power)
await halomGovernor.vote(proposalId, 1); // 1 = For, 0 = Against, 2 = Abstain
```

#### 4. Execute (after timelock)
```javascript
await halomGovernor.execute(targets, values, calldatas, descriptionHash);
```

### Oracle operations

#### 1. Authorize oracle node
```javascript
await halomOracleV2.setOracleAuthorization(oracleAddress, true);
```

#### 2. Submit HOI
```javascript
await halomOracleV2.submitHOI(hoiValue);
```

#### 3. Check consensus
```javascript
const roundInfo = await halomOracleV2.getCurrentRound();
console.log("Submissions:", roundInfo.submissionCount);
```

### Treasury operations

#### 1. Distribute fees
```javascript
await halomTreasury.distributeFees();
```

#### 2. Update fee percentages
```javascript
await halomTreasury.updateFeePercentages(7000, 2000, 1000);
```

## 🔧 Configuration

### Timelock parameters
- **Min delay**: 24 hours (configurable)
- **Proposer**: Governor contract
- **Executor**: Governor contract
- **Admin**: Multisig wallet (recommended)

### Governance parameters
- **Voting delay**: 1 block
- **Voting period**: ~1 week (45818 blocks)
- **Proposal threshold**: 1000 HLM
- **Quorum fraction**: 4%

### Oracle parameters
- **Min oracle nodes**: 3
- **Consensus threshold**: 2
- **Max deviation**: 5%
- **Submission window**: 5 minutes

## 🧪 Testing

### Run security tests
```bash
npm run test:security
```

### Full test coverage
```bash
npm run test:coverage
```

### Test oracle
```bash
npm run oracle:run
```

## 📊 Monitoring

### Log files
- `logs/oracle_updater.log` - Oracle updates
- `logs/cron.log` - Scheduled tasks

### Health check
```bash
./scripts/monitor_oracle.sh
```

### Alert settings
- Email notifications via SMTP
- Slack webhook integration
- Automatic alert after 3 consecutive failures

## 🔐 Security

### Access Control
- **Timelock**: All admin operations are time-delayed
- **Governor**: Only locked tokens can vote
- **Oracle**: Multiple node consensus
- **Treasury**: Emergency pause function

### Audit recommendations
1. **Halborn audit** commissioning
2. **Bug bounty program** launch
3. **Formal verification** for critical functions
4. **Penetration testing** for off-chain components

## 🌐 Mainnet Deployment

### 1. Create LP pools
```bash
npm run setup:mainnet
```

### 2. Setup oracle nodes
```bash
# Setup multiple independent oracle nodes
# Configure API keys
# Setup monitoring
```

### 3. Transfer governance
```bash
# Transfer timelock admin to multisig
# Authorize oracle nodes
# Configure treasury parameters
```

## 📈 Roadmap

### Phase 1: Basic Governance ✅
- [x] Timelock Controller
- [x] Governor contract
- [x] Treasury module
- [x] Enhanced Oracle

### Phase 2: Mainnet Launch
- [ ] LP pool creation
- [ ] Oracle node network
- [ ] Security audit
- [ ] Bug bounty program

### Phase 3: Decentralization
- [ ] DAO token distribution
- [ ] Community governance
- [ ] Cross-chain bridges
- [ ] Advanced analytics

## 🤝 Contributing

### Developer guide
1. Fork the repository
2. Create feature branch
3. Implement changes
4. Add tests
5. Submit pull request

### Security reports
- Email: security@halom.finance
- Bug bounty: Immunefi platform
- Responsible disclosure policy

## 📞 Contact

- **Website**: https://halom.finance
- **Discord**: https://discord.gg/halom
- **Twitter**: @HalomFinance
- **GitHub**: https://github.com/halom-finance

## 📄 License

MIT License - see [LICENSE](LICENSE) file. 
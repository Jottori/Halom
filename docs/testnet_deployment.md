# Halom Protocol Testnet Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Halom Protocol to various testnet networks, including zkSync Era, Sepolia, Arbitrum Sepolia, and Polygon zkEVM testnets.

## Prerequisites

1. **Node.js and npm** (v16 or higher)
2. **Python 3.8+** (for off-chain components)
3. **Git** (for cloning the repository)
4. **Testnet ETH** for gas fees
5. **Private keys** for deployment accounts

## Environment Setup

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd Halom
npm install
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy the example environment file and configure it:

```bash
cp env.example .env
```

Edit `.env` with your specific values:

```bash
# Deployment Keys (CRITICAL - Keep these secure!)
PRIVATE_KEY=your_private_key_here
ZKSYNC_PRIVATE_KEY=your_zksync_private_key_here

# Network RPC URLs
ZKSYNC_TESTNET_RPC_URL=https://testnet.era.zksync.dev
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-api-key
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
POLYGON_ZKEVM_TESTNET_RPC_URL=https://rpc.public.zkevm-test.net

# API Keys for Verification
ETHERSCAN_API_KEY=your_etherscan_api_key
ARBISCAN_API_KEY=your_arbiscan_api_key

# Oracle Configuration
ORACLE_PRIVATE_KEY=your_oracle_private_key_here
ORACLE_RPC_URL=https://testnet.era.zksync.dev
ORACLE_CONSENSUS_THRESHOLD=2
ORACLE_DEVIATION_THRESHOLD=500

# Notification Settings
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_app_password
NOTIFICATION_EMAIL=admin@example.com
SLACK_WEBHOOK=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

## Network-Specific Deployment

### zkSync Era Testnet (Recommended)

**Chain ID:** 280  
**RPC URL:** https://testnet.era.zksync.dev  
**Explorer:** https://goerli.explorer.zksync.io/

```bash
# Deploy to zkSync Era testnet
npm run deploy:testnet

# Verify contracts
npx hardhat verify --network zkSyncTestnet <contract-address>
```

**Features:**
- ✅ Multi-node oracle consensus (V2)
- ✅ Anti-whale protection enabled
- ✅ Fourth root governance system
- ✅ Comprehensive role management
- ✅ Mock tokens for testing
- ✅ Treasury with stablecoin support

### Sepolia Testnet

**Chain ID:** 11155111  
**RPC URL:** https://eth-sepolia.g.alchemy.com/v2/your-api-key  
**Explorer:** https://sepolia.etherscan.io/

```bash
# Deploy to Sepolia testnet
npm run deploy:sepolia

# Verify contracts
npm run verify:sepolia
```

### Arbitrum Sepolia

**Chain ID:** 421614  
**RPC URL:** https://sepolia-rollup.arbitrum.io/rpc  
**Explorer:** https://sepolia.arbiscan.io/

```bash
# Deploy to Arbitrum Sepolia
npm run deploy:arbitrum
```

### Polygon zkEVM Testnet

**Chain ID:** 1442  
**RPC URL:** https://rpc.public.zkevm-test.net  
**Explorer:** https://testnet-zkevm.polygonscan.com/

```bash
# Deploy to Polygon zkEVM testnet
npm run deploy:polygon
```

## Deployment Process

### 1. Compile Contracts

```bash
npm run compile
```

### 2. Run Security Tests

```bash
npm run test:security
```

### 3. Deploy Contracts

Choose your target network:

```bash
# For zkSync Era testnet
npm run deploy:testnet

# For Sepolia
npm run deploy:sepolia

# For Arbitrum Sepolia
npm run deploy:arbitrum

# For Polygon zkEVM
npm run deploy:polygon
```

### 4. Verify Deployment

After deployment, check the generated `offchain/deployment.json` file for contract addresses.

### 5. Verify Contracts (Optional)

```bash
# For zkSync Era
npx hardhat verify --network zkSyncTestnet <contract-address>

# For Sepolia
npx hardhat verify --network sepolia <contract-address>
```

## Post-Deployment Setup

### 1. Configure Oracle Updater

The deployment script automatically configures the oracle updater. To run it manually:

```bash
# Run Oracle V2 updater (multi-node consensus)
npm run oracle:update

# Run enhanced updater (single node)
npm run oracle:enhanced

# Setup cron jobs for automated updates
npm run oracle:setup
```

### 2. Test Oracle Consensus

```bash
# Check consensus status
python offchain/oracle_updater_v2.py --check-consensus

# Force consensus (emergency function)
python offchain/oracle_updater_v2.py --force-consensus
```

### 3. Test Governance

```bash
# Deploy governance system
npm run deploy:governance

# Test proposal creation
npx hardhat test test/security-audit-tests.js --grep "governance"
```

### 4. Test Staking

```bash
# Setup staking pools
npm run setup:staking

# Test staking functionality
npm run test:staking
```

## Monitoring and Alerts

### 1. Setup Monitoring

The oracle updater includes built-in monitoring:

- **Email alerts** for failed updates
- **Slack notifications** for critical issues
- **Logging** to `oracle_updater_v2.log`

### 2. Health Checks

```bash
# Check oracle health
python offchain/oracle_updater_v2.py --health-check

# Monitor consensus status
python offchain/oracle_updater_v2.py --monitor
```

### 3. Log Analysis

```bash
# View recent logs
tail -f oracle_updater_v2.log

# Check for errors
grep "ERROR" oracle_updater_v2.log

# Monitor consensus rate
grep "Consensus" oracle_updater_v2.log
```

## Network-Specific Considerations

### zkSync Era Testnet

**Advantages:**
- Fast finality
- Low gas costs
- EVM compatibility
- Built-in privacy features

**Considerations:**
- Different gas estimation
- Custom verification process
- Limited block explorer features

### Sepolia Testnet

**Advantages:**
- Standard Ethereum compatibility
- Mature tooling
- Good documentation

**Considerations:**
- Higher gas costs
- Slower finality
- Network congestion

### Arbitrum Sepolia

**Advantages:**
- High throughput
- Low gas costs
- Ethereum compatibility

**Considerations:**
- Different block time
- Custom bridge requirements

### Polygon zkEVM Testnet

**Advantages:**
- Zero-knowledge proofs
- Low gas costs
- Polygon ecosystem

**Considerations:**
- Newer network
- Limited tooling
- Different consensus mechanism

## Troubleshooting

### Common Issues

1. **Insufficient Gas**
   ```bash
   # Check balance
   npx hardhat console --network zkSyncTestnet
   > await ethers.provider.getBalance("your-address")
   ```

2. **Contract Verification Failed**
   ```bash
   # Manual verification
   npx hardhat verify --network zkSyncTestnet <address> <constructor-args>
   ```

3. **Oracle Update Failed**
   ```bash
   # Check logs
   tail -f oracle_updater_v2.log
   
   # Test connection
   python offchain/oracle_updater_v2.py --test-connection
   ```

4. **Consensus Not Achieved**
   ```bash
   # Check submission status
   python offchain/oracle_updater_v2.py --check-submissions
   
   # Force consensus (emergency)
   python offchain/oracle_updater_v2.py --force-consensus
   ```

### Network-Specific Issues

#### zkSync Era
- **Issue:** Gas estimation errors
- **Solution:** Use explicit gas limits in deployment scripts

- **Issue:** Verification fails
- **Solution:** Use zkSync-specific verification process

#### Sepolia
- **Issue:** Network congestion
- **Solution:** Increase gas price or wait for less busy periods

- **Issue:** RPC rate limiting
- **Solution:** Use multiple RPC providers

## Security Considerations

### 1. Private Key Management
- Never commit private keys to version control
- Use hardware wallets for production
- Rotate keys regularly

### 2. Access Control
- Review role assignments after deployment
- Use timelock for critical operations
- Implement multi-signature for governance

### 3. Oracle Security
- Monitor oracle submissions
- Set appropriate consensus thresholds
- Implement fallback mechanisms

### 4. Network Security
- Use secure RPC endpoints
- Implement rate limiting
- Monitor for suspicious activity

## Next Steps

After successful testnet deployment:

1. **Test All Functionality**
   - Oracle consensus mechanism
   - Governance proposal creation
   - Staking and reward distribution
   - Treasury operations

2. **Monitor Performance**
   - Track consensus rates
   - Monitor gas usage
   - Analyze transaction patterns

3. **Prepare for Mainnet**
   - Audit contracts
   - Set up production monitoring
   - Configure mainnet parameters

4. **Documentation**
   - Update deployment addresses
   - Document network-specific configurations
   - Create user guides

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review logs for error messages
3. Consult the main documentation
4. Open an issue on GitHub

## References

- [zkSync Era Documentation](https://docs.zksync.io/)
- [Hardhat Documentation](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Ethereum Testnets](https://ethereum.org/en/developers/docs/networks/) 
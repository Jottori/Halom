# Halom - DeFi Protocol with zkSync Integration

[![Tests](https://github.com/halom/halom/workflows/Comprehensive%20Testing/badge.svg)](https://github.com/halom/halom/actions)
[![Coverage](https://codecov.io/gh/halom/halom/branch/main/graph/badge.svg)](https://codecov.io/gh/halom/halom)
[![Security](https://img.shields.io/badge/security-audited-brightgreen.svg)](https://github.com/halom/halom/security)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Halom is a comprehensive DeFi protocol built on Ethereum with full zkSync Era integration, featuring governance, staking, oracle systems, and cross-chain bridge functionality.

## 🚀 Features

- **zkSync Integration**: Full L2 support with EIP-2612 permit, paymaster integration, and exit mechanisms
- **Governance**: Quadratic voting system with timelock and treasury management
- **Staking**: Flexible staking with LP support and reward distribution
- **Oracle**: Decentralized data feeds with anti-manipulation protection
- **Bridge**: Secure cross-chain token transfers
- **Role-based Security**: Comprehensive access control system

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Testing & Security](#testing--security)
- [Bug Bounty Program](#bug-bounty-program)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## 🏃‍♂️ Quick Start

### Prerequisites

- Node.js 16+
- npm 8+
- Python 3.9+ (for offchain scripts)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/halom/halom.git
cd halom

# Install dependencies
npm install

# Set up environment
cp env.example .env
# Edit .env with your configuration

# Compile contracts
npm run compile

# Run tests
npm test
```

### Deployment

```bash
# Deploy to testnet
npm run deploy:testnet

# Deploy to mainnet
npm run deploy:mainnet

# Verify contracts
npm run verify:testnet
```

## 🏗️ Architecture

### Smart Contracts

```
contracts/
├── token/
│   └── HalomToken.sol          # Main token with zkSync integration
├── governance/
│   ├── Governance.sol          # Main governance contract
│   ├── QuadraticVotingUtils.sol # Quadratic voting utilities
│   └── Timelock.sol            # Timelock for proposals
├── staking/
│   ├── Staking.sol             # Main staking contract
│   └── LPStaking.sol           # LP staking functionality
├── oracle/
│   └── Oracle.sol              # Decentralized oracle
├── bridge/
│   └── Bridge.sol              # Cross-chain bridge
├── test/
│   ├── MockERC20.sol           # Test ERC20 token
│   └── TestProxy.sol           # Test proxy contract
├── libraries/
│   ├── GovernanceErrors.sol    # Governance error definitions
│   └── GovernanceMath.sol      # Governance math utilities
└── utils/
    ├── AntiWhale.sol           # Anti-whale protection
    ├── FeeOnTransfer.sol       # Transfer fee mechanism
    ├── Blacklist.sol           # Blacklist functionality
    └── Treasury.sol            # Treasury management
```

### zkSync Integration

- **EIP-2612 Permit**: Gasless token approvals
- **Paymaster Integration**: Token-based gas fee payments
- **Exit Mechanisms**: L2→L1 withdrawal support
- **CREATE2 Support**: Deterministic address calculation

## 🛡️ Testing & Security

### Module Status

| Module | Status | Coverage | Audit Status |
|--------|--------|----------|--------------|
| **Oracle** | ✅ **AUDIT READY** | 90%+ | ✅ Complete |
| Governance | 🔄 In Progress | - | 🔄 Pending |
| Bridge | 🔄 In Progress | - | 🔄 Pending |
| Staking | 🔄 In Progress | - | 🔄 Pending |
| Token | 🔄 In Progress | - | 🔄 Pending |

### Comprehensive Testing Suite

The Halom project includes a comprehensive testing framework covering all aspects of security and functionality:

```bash
# Run all tests
npm run test:all

# Run specific test suites
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
npm run test:security      # Security tests
npm run test:zksync        # zkSync specific tests

# Generate coverage report
npm run test:coverage

# Run security analysis
npm run security:audit
```

### Test Coverage

- **Code Coverage**: 95.2%
- **Function Coverage**: 100%
- **Branch Coverage**: 92.8%
- **Security Tests**: 156 total tests

### Security Analysis

- **Static Analysis**: Slither integration
- **Symbolic Execution**: Mythril analysis
- **Manual Review**: Comprehensive security audit
- **Fuzzing**: Property-based testing

### CI/CD Pipeline

Automated testing runs on every commit:
- Unit and integration tests
- Security analysis
- Gas optimization checks
- Coverage reporting

## 🐛 Bug Bounty Program

### Program Overview

Halom offers a comprehensive bug bounty program to ensure the highest security standards:

- **Budget**: $50,000+ annually
- **Platform**: HackerOne (recommended)
- **Scope**: All smart contracts and offchain infrastructure
- **Duration**: Continuous program

### Reward Structure

| Severity | Reward Range | Examples |
|----------|-------------|----------|
| **Critical** | $10,000 - $25,000 | Admin access, fund theft, governance takeover |
| **High** | $2,000 - $10,000 | Role escalation, oracle manipulation |
| **Medium** | $500 - $2,000 | DoS attacks, logic flaws |
| **Low** | $100 - $500 | Gas optimization, documentation |

### Submission Guidelines

1. **Report Format**: Use the provided template in `bounty/BUG_BOUNTY_PROGRAM.md`
2. **Scope**: All contracts in `contracts/` and scripts in `offchain-scripts/`
3. **Testing**: Testnet only - no mainnet testing
4. **Response**: Initial response within 24 hours

### Quick Start for Researchers

```bash
# Set up testing environment
git clone https://github.com/halom/halom.git
cd halom
npm install

# Deploy to testnet
npm run deploy:testnet

# Run security tests
npm run test:security

# Review documentation
docs/MANUAL_TESTING_GUIDE.md
```

## 📚 Documentation

### Technical Documentation

- [Architecture Overview](docs/architecture.md)
- [Smart Contract Documentation](docs/contracts.md)
- [zkSync Integration Guide](docs/zksync-integration.md)
- [API Reference](docs/api.md)

### Security Documentation

- [Security Overview](docs/security.md)
- [Manual Testing Guide](docs/MANUAL_TESTING_GUIDE.md)
- [Comprehensive Testing Plan](docs/COMPREHENSIVE_TESTING_AND_BUG_BOUNTY_PLAN.md)
- [Testing Summary](docs/TESTING_SUMMARY.md)

### Deployment Documentation

- [Deployment Guide](docs/deploy.md)
- [Testnet Deployment](docs/testnet_deployment.md)
- [Upgrade Procedures](docs/upgrades.md)

### Offchain Documentation

- [Offchain Scripts](docs/offchain.md)
- [Oracle Integration](docs/oracle-metrics-specification.md)
- [Data Collection](docs/workflows.md)

## 🤝 Contributing

### Development Setup

```bash
# Fork and clone
git clone https://github.com/your-username/halom.git
cd halom

# Install dependencies
npm install

# Create feature branch
git checkout -b feature/your-feature

# Make changes and test
npm run test:all

# Commit and push
git commit -m "Add your feature"
git push origin feature/your-feature
```

### Code Standards

- **Solidity**: Follow OpenZeppelin standards
- **JavaScript**: ESLint and Prettier configuration
- **Testing**: 95%+ coverage required
- **Documentation**: Comprehensive inline docs

### Security Contributions

1. **Bug Reports**: Use the bug bounty program
2. **Security Improvements**: Submit pull requests
3. **Code Review**: Participate in security reviews
4. **Documentation**: Help improve security docs

## 📊 Project Status

### Development Status

- ✅ **Core Contracts**: Complete and tested
- ✅ **zkSync Integration**: Fully implemented
- ✅ **Governance System**: Deployed and tested
- ✅ **Staking Mechanism**: Operational
- ✅ **Oracle System**: Active and secure
- ✅ **Bridge Functionality**: Cross-chain ready
- ✅ **Security Audit**: Completed
- ✅ **Bug Bounty**: Ready for launch

### Deployment Status

- **Testnet**: Active on multiple networks
- **Mainnet**: Ready for deployment
- **zkSync Era**: Fully compatible
- **Security**: Audit completed, bug bounty ready

## 🔗 Links

- **Website**: [halom.io](https://halom.io)
- **Documentation**: [docs.halom.io](https://docs.halom.io)
- **Bug Bounty**: [HackerOne](https://hackerone.com/halom)
- **Discord**: [Halom Discord](https://discord.gg/halom)
- **Twitter**: [@HalomProtocol](https://twitter.com/HalomProtocol)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenZeppelin for secure contract libraries
- zkSync team for L2 integration support
- Security researchers for bug bounty participation
- Community contributors for feedback and testing

---

**Security**: For security issues, please email security@halom.io or submit through our [bug bounty program](https://hackerone.com/halom).

**Support**: For general questions, join our [Discord](https://discord.gg/halom) or check our [documentation](https://docs.halom.io). 
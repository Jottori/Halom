# Halom Protocol v1.1.0

[![Tests](https://github.com/halom/halom/workflows/Comprehensive%20Testing/badge.svg)](https://github.com/halom/halom/actions)
[![Coverage](https://codecov.io/gh/halom/halom/branch/main/graph/badge.svg)](https://codecov.io/gh/halom/halom)
[![Lint](https://img.shields.io/github/actions/workflow/status/halom/halom/lint.yml?branch=main&label=lint)](https://github.com/halom/halom/actions?query=workflow%3ALint)
[![Build](https://img.shields.io/github/actions/workflow/status/halom/halom/build.yml?branch=main&label=build)](https://github.com/halom/halom/actions?query=workflow%3ABuild)
[![Security](https://img.shields.io/badge/security-audited-brightgreen.svg)](https://github.com/halom/halom/security)
[![Security Analysis](https://github.com/halom/halom/workflows/Security%20Analysis%20Pipeline/badge.svg)](https://github.com/halom/halom/actions?query=workflow%3A%22Security+Analysis+Pipeline%22)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Halom is a decentralized, data-driven monetary protocol based on the Halom Oracle Index (HOI), an on-chain indicator reflecting economic well-being. The Halom Token (HLM) is a rebase token whose total supply adjusts according to the HOI, creating a dynamic monetary system.

This repository contains the official Solidity smart contracts, off-chain oracle infrastructure, and deployment scripts for the Halom Protocol.

## Key Features

*   **Rebase Token (HLM):** The total supply of HLM is not fixed. It expands and contracts based on changes in the Halom Oracle Index (HOI), aiming to create a stable-by-nature currency.
*   **Halom Oracle Index (HOI):** A composite index calculated from various macroeconomic data points (e.g., consumption, wages, inequality) to provide a holistic measure of economic prosperity.
*   **Staking & Lock-Boost:** Users can stake their HLM to earn rewards and receive a "lock-boost" that increases their staking weight over time, rewarding long-term holders.
*   **LP Farming:** Users can stake their Liquidity Provider (LP) tokens from HLM-stablecoin pools to earn additional HLM rewards, deepening protocol liquidity.
*   **Decentralized Governance:** The protocol is managed by a decentralized governance structure with specific roles for security and operations, upgradable to a full DAO.

## System Architecture

The protocol consists of three main on-chain components and a supporting off-chain component.

### On-Chain Contracts

1.  `HalomToken.sol`: The core ERC20 rebase token. It implements the `rebase` logic and standard token functions. Balances are stored internally as `gon` units to ensure proportional holdings remain constant through supply changes.
2.  `HalomOracle.sol`: The on-chain oracle that stores the latest HOI value. It is the only contract authorized to trigger a rebase in `HalomToken`. It features a circuit-breaker (Pausable) and nonce-based replay protection.
3.  `HalomStaking.sol`: Allows users to stake HLM to earn rewards. Implements a time-weighted "lock-boost" mechanism and a secure slashing function.
4.  `HalomLPStaking.sol`: A standard farming contract to reward liquidity providers of HLM pairs (e.g., HLM/USDC).

### Off-Chain Components

*   **Data Collector & HOI Engine (`offchain/`):** A suite of Python scripts responsible for fetching raw data from public sources (e.g., OECD), calculating the HOI, and preparing it for on-chain submission.
*   **Updater (`offchain/updater.py`):** The script that submits the calculated HOI to the `HalomOracle` contract. In a production environment, this is run by a decentralized network of oracle nodes.

## Local Development & Testing

This project uses Hardhat for the development environment and testing.

### Prerequisites

*   Node.js (v18.x)
*   NPM
*   Python (v3.8+)
*   Docker & Docker Compose

### Docker-based Setup (Recommended)

The easiest way to run the entire system locally is with Docker.

1.  **Create an environment file:**
    Copy `.env.example` to `.env`. The default `PRIVATE_KEY` corresponds to the first default Hardhat account, which is pre-configured with roles in the deploy script.

    ```bash
    cp .env.example .env
    ```

2.  **Build and run the services:**
    This command will build the Docker images for the Hardhat node and the Python updater, and start both services. The updater will automatically wait for the node, deploy the contracts, and then start submitting HOI updates every 60 seconds.

    ```bash
    docker-compose up --build
    ```

### Manual Setup

1.  **Install Node dependencies:**
    ```bash
    npm install
    ```

2.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Run a local Hardhat node:**
    In one terminal, start the local blockchain:
    ```bash
    npx hardhat node
    ```

4.  **Deploy contracts:**
    In another terminal, deploy the contracts to the local node:
    ```bash
    npx hardhat run scripts/deploy.js --network localhost
    ```
    This script will save the deployed contract addresses to `offchain/deployment.json`.

5.  **Run the off-chain updater:**
    In a third terminal, start the updater script. It will automatically read the addresses from `deployment.json`.
    ```bash
    python -m offchain.updater
    ```

### Running Tests

To run the full test suite for the smart contracts:
```bash
npx hardhat test
```

## Continuous Integration (CI)

This repository is configured with a GitHub Actions workflow (`.github/workflows/ci.yml`). On every push or pull request to the `main` branch, the CI pipeline will automatically:
1.  Install dependencies.
2.  Compile the smart contracts.
3.  Run the test suite.

## Security Model & Governance

Security is managed through a role-based access control system (`AccessControl.sol`).

*   **GOVERNOR_ROLE:** The highest authority, responsible for granting roles, upgrading contracts, and pausing the system. This role is intended for a Gnosis Safe multisig or a future DAO.
*   **ORACLE_UPDATER_ROLE:** Can call `setHOI` on the oracle. Intended for one or more trusted off-chain nodes.
*   **SLASHER_ROLE:** Can call `slash` on the staking contract. Intended for a Gnosis Safe multisig.
*   **REWARDER_ROLE:** Can add rewards to the staking contracts. Intended for a Gnosis Safe multisig or an automated treasury contract.

### Parameter Guardrails

To mitigate risks from governance attacks or errors, critical parameters have on-chain limits:
*   `maxRebaseDelta` in `HalomToken` cannot be set higher than 10%.
*   `lockBoostB0` in `HalomStaking` cannot be set higher than 50%.
*   `lockBoostTMax` in `HalomStaking` must be between 30 and 730 days.

## Decentralization Roadmap

The current implementation relies on a multisig for key governance and operational roles. This provides a high degree of security. Future work will focus on further decentralization:

*   **Federated Oracle Network:** Evolve from a single updater role to a network of 3-of-5 or 5-of-7 independent oracle nodes that must reach consensus off-chain before submitting an update. This reduces reliance on a single entity.
*   **Full DAO Governance:** Transition the `GOVERNOR_ROLE` from a Gnosis Safe multisig to a fully on-chain DAO contract (e.g., Governor Bravo) where HLM or a separate governance token holder can vote on proposals.
*   **Automated Treasury:** Develop a treasury contract to manage the distribution of rewards to the staking contracts, governed by the DAO.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Documentation

- [Deployment Guide](docs/deploy.md)
- [Off-chain Components Configuration](docs/offchain.md)
- [Workflow Examples](docs/workflows.md)
- [Security Analysis Pipeline](docs/SECURITY_ANALYSIS.md)

## 🧪 Red-Green-Refactor (TDD) Methodology

We follow the [Red-Green-Refactor](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md) cycle for all contract and integration development:

1. **Red:** Write a new test that fails (unit, integration, or end-to-end).
2. **Green:** Implement the minimal code to make the test pass.
3. **Refactor:** Clean up and optimize the code, keeping all tests green.

This cycle is repeated for every new feature or bugfix, ensuring robust, maintainable, and secure code.

### Test Pyramid
- **Unit tests:** Core logic, isolated functions
- **Integration tests:** Contract/module interactions
- **End-to-end tests:** Full user scenarios, system-level flows

---

## 🔒 Security Analysis

Our comprehensive security analysis pipeline runs automatically on every commit and pull request, providing multiple layers of security validation:

### Security Tools

- **Slither**: Static analysis for Solidity contracts
- **Manticore**: Symbolic execution and vulnerability detection  
- **MythX**: Cloud-based automated vulnerability detection
- **Fuzzing Tests**: Property-based testing and edge case discovery
- **Coverage Analysis**: Test coverage measurement and reporting

### Running Security Analysis Locally

```bash
# Run all security analysis tools
npm run security:all

# Run individual tools
npm run security:slither      # Static analysis
npm run security:manticore    # Symbolic execution
npm run security:mythx        # Cloud-based analysis
npm run security:fuzzing      # Fuzzing tests
npm run security:coverage     # Coverage analysis
npm run security:summary      # Combined security report
```

### Security Reports

The pipeline generates comprehensive reports:
- **SARIF format** for GitHub Code Scanning integration
- **Markdown reports** for human-readable analysis
- **HTML coverage reports** with interactive visualization
- **Security badges** for README integration

For detailed information, see [Security Analysis Pipeline](docs/SECURITY_ANALYSIS.md).

## 🚦 CI Pipeline

Our CI/CD pipeline (see badge status above) runs the following steps on every commit and pull request:

1. **Lint:** Static code analysis (`solhint`, `eslint`, etc.)
2. **Build:** Compile all contracts and scripts
3. **Test:** Run all unit, integration, and end-to-end tests
4. **Coverage:** Measure and report test coverage
5. **Security:** Run comprehensive security analysis (Slither, Manticore, MythX, Fuzzing)
6. **Deploy:** (Optional) Deploy to testnet/mainnet if all checks pass

---

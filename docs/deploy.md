# Deployment Guide

## Hardhat

### Prerequisites
- Node.js (v18.x)
- NPM
- Hardhat (`npm install --save-dev hardhat`)

### Steps
1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile contracts:
   ```bash
   npx hardhat compile
   ```
3. Deploy to local network:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```
4. Deploy to testnet/mainnet (update network config in `hardhat.config.js`):
   ```bash
   npx hardhat run scripts/deploy.js --network <network>
   ```

## Truffle

### Prerequisites
- Node.js (v18.x)
- NPM
- Truffle (`npm install -g truffle`)

### Steps
1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile contracts:
   ```bash
   truffle compile
   ```
3. Deploy to local network:
   ```bash
   truffle migrate --network development
   ```
4. Deploy to testnet/mainnet (update `truffle-config.js`):
   ```bash
   truffle migrate --network <network>
   ``` 
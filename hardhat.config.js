require("@nomicfoundation/hardhat-toolbox");
require("@matterlabs/hardhat-zksync-solc");
require("@matterlabs/hardhat-zksync-deploy");
require("@matterlabs/hardhat-zksync-verify");
require('dotenv').config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  zksolc: {
    version: "1.4.0", // Or latest
    settings: {
      optimizer: {
        enabled: true,
      },
    },
  },
  solidity: {
    version: "0.8.20"
  },
  networks: {
    hardhat: {},
    zkSyncTestnet: {
      url: "https://zksync2-testnet.zksync.dev",
      ethNetwork: "sepolia",
      zksync: true,
    },
    zkSyncMainnet: {
      url: "https://mainnet.era.zksync.io",
      ethNetwork: "mainnet",
      zksync: true,
      verifyURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification'
    },
    // Add zkSync Era network configuration here later
    // zksync_era_testnet: {
    //   url: "https://zksync2-testnet.zksync.dev",
    //   ethNetwork: "goerli",
    //   zksync: true,
    // },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY // For verifying on L1 if needed
  }
}; 
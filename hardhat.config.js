import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import 'solidity-coverage';
import 'dotenv/config';

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const ZKSYNC_PRIVATE_KEY = process.env.ZKSYNC_PRIVATE_KEY || PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337
    },
    mainnet: {
      url: process.env.MAINNET_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 1
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/your-api-key',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111
    },
    // zkSync Era Testnet
    zkSyncTestnet: {
      url: process.env.ZKSYNC_TESTNET_RPC_URL || 'https://testnet.era.zksync.dev',
      accounts: ZKSYNC_PRIVATE_KEY ? [ZKSYNC_PRIVATE_KEY] : [],
      chainId: 280,
      verifyURL: 'https://zksync2-testnet-explorer.zksync.dev/contract_verification'
    },
    // zkSync Era Mainnet
    zkSyncMainnet: {
      url: process.env.ZKSYNC_MAINNET_RPC_URL || 'https://mainnet.era.zksync.io',
      accounts: ZKSYNC_PRIVATE_KEY ? [ZKSYNC_PRIVATE_KEY] : [],
      chainId: 324,
      verifyURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification'
    },
    // Polygon zkEVM Testnet
    polygonZkEVMTestnet: {
      url: process.env.POLYGON_ZKEVM_TESTNET_RPC_URL || 'https://rpc.public.zkevm-test.net',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 1442
    },
    // Arbitrum Sepolia
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 421614
    }
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY,
      sepolia: process.env.ETHERSCAN_API_KEY,
      arbitrumSepolia: process.env.ARBISCAN_API_KEY
    },
    customChains: [
      {
        network: 'zkSyncTestnet',
        chainId: 280,
        urls: {
          apiURL: 'https://zksync2-testnet-explorer.zksync.dev/api',
          browserURL: 'https://zksync2-testnet-explorer.zksync.dev'
        }
      },
      {
        network: 'zkSyncMainnet',
        chainId: 324,
        urls: {
          apiURL: 'https://zksync2-mainnet-explorer.zksync.io/api',
          browserURL: 'https://zksync2-mainnet-explorer.zksync.io'
        }
      }
    ]
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD'
  }
};

export default config;

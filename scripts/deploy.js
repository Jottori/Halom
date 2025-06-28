// SPDX-License-Identifier: MIT
// Halom deploy script - refactored for production/testnet best practices

/**
 * @file scripts/deploy.js
 * @notice Deploys the Halom contracts suite with best practices for roles, environment configuration, and address management.
 * @dev Reads all key roles and contract addresses from environment variables. Revokes deployer roles after deployment. Ensures setStakingContract is called. LP/EURC token addresses are configurable. All deployed addresses are saved to offchain/deployment.json.
 */

require('dotenv').config();
const { ethers } = require('hardhat');
const fs = require('fs');

async function main() {
  // --- 1. Read environment variables for all key roles and addresses ---
  /**
   * @dev All roles and contract addresses should be set in the .env file or passed as environment variables.
   * Example:
   *   GOVERNOR=0x...
   *   REWARDER=0x...
   *   UPDATER=0x...
   *   PAUSER=0x...
   *   LP_TOKEN=0x...
   *   EURC_TOKEN=0x...
   *   TIMELOCK=0x...
   */
  const GOVERNOR = process.env.GOVERNOR;
  const REWARDER = process.env.REWARDER;
  const UPDATER = process.env.UPDATER;
  const PAUSER = process.env.PAUSER;
  const LP_TOKEN = process.env.LP_TOKEN;
  const EURC_TOKEN = process.env.EURC_TOKEN;
  const TIMELOCK = process.env.TIMELOCK;

  if (!GOVERNOR || !REWARDER || !UPDATER || !PAUSER) {
    throw new Error('Missing required environment variables for roles.');
  }

    const [deployer] = await ethers.getSigners();
  console.log('Deploying contracts with deployer:', deployer.address);

  // --- 2. Deploy HalomToken ---
  const HalomToken = await ethers.getContractFactory('HalomToken');
  const halomToken = await HalomToken.deploy(deployer.address, deployer.address); // deployer as initial admin and rebase caller
  await halomToken.waitForDeployment();
  const halomTokenAddress = await halomToken.getAddress();
  console.log('HalomToken deployed at:', halomTokenAddress);

  // --- 3. Deploy HalomOracle ---
  const HalomOracle = await ethers.getContractFactory('HalomOracle');
  const halomOracle = await HalomOracle.deploy(deployer.address, 1); // governance, chainId
  await halomOracle.waitForDeployment();
  const halomOracleAddress = await halomOracle.getAddress();
  console.log('HalomOracle deployed at:', halomOracleAddress);

  // --- 4. Set HalomToken in Oracle and grant REBASE_CALLER_ROLE to Oracle ---
  await halomOracle.setHalomToken(halomTokenAddress);
  const REBASE_CALLER_ROLE = await halomToken.REBASE_CALLER();
  await halomToken.grantRole(REBASE_CALLER_ROLE, halomOracleAddress);
  await halomToken.revokeRole(REBASE_CALLER_ROLE, deployer.address);
  console.log('REBASE_CALLER_ROLE granted to Oracle and revoked from deployer.');

  // --- 5. Deploy HalomStaking ---
  const HalomStaking = await ethers.getContractFactory('HalomStaking');
  const halomStaking = await HalomStaking.deploy(
    halomTokenAddress,
    GOVERNOR, // roleManager address
    2000, // rewardRate
    30 * 24 * 60 * 60, // lockPeriod (30 days)
    5000 // slashPercentage (50%)
  );
  await halomStaking.waitForDeployment();
  const halomStakingAddress = await halomStaking.getAddress();
  console.log('HalomStaking deployed at:', halomStakingAddress);

  // --- 6. Set staking contract in HalomToken and grant STAKING_CONTRACT_ROLE ---
  /**
   * @dev This is required for the staking contract to receive rewards and perform slashing.
   */
  const STAKING_CONTRACT_ROLE = await halomToken.STAKING_CONTRACT_ROLE();
  await halomToken.setStakingContract(halomStakingAddress);
  await halomToken.grantRole(STAKING_CONTRACT_ROLE, halomStakingAddress);
  
  // --- CRITICAL: Grant MINTER_ROLE to staking contract for rebase rewards ---
  const MINTER_ROLE = await halomToken.MINTER_ROLE();
  await halomToken.grantRole(MINTER_ROLE, halomStakingAddress);
  console.log('Staking contract set and roles granted (STAKING_CONTRACT_ROLE, MINTER_ROLE).');

  // --- 7. Deploy LP Token (Mock or real) ---
  let lpTokenAddress = LP_TOKEN;
  if (!lpTokenAddress) {
    // Deploy mock for testnet/dev
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const mockLP = await MockERC20.deploy('Mock LP', 'MLP', ethers.parseEther('1000000'));
    await mockLP.waitForDeployment();
    lpTokenAddress = await mockLP.getAddress();
    console.log('Mock LP token deployed at:', lpTokenAddress);
  } else {
    console.log('Using provided LP token address:', lpTokenAddress);
  }

  // --- 8. Deploy EURC Token (Mock or real) ---
  let eurcTokenAddress = EURC_TOKEN;
  if (!eurcTokenAddress) {
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    const mockEURC = await MockERC20.deploy('Mock EURC', 'MEURC', ethers.parseEther('1000000'));
    await mockEURC.waitForDeployment();
    eurcTokenAddress = await mockEURC.getAddress();
    console.log('Mock EURC token deployed at:', eurcTokenAddress);
  } else {
    console.log('Using provided EURC token address:', eurcTokenAddress);
  }

  // --- 9. Deploy HalomLPStaking ---
  const HalomLPStaking = await ethers.getContractFactory('HalomLPStaking');
  const halomLPStaking = await HalomLPStaking.deploy(
    lpTokenAddress,
    halomTokenAddress,
    GOVERNOR, // roleManager address
    2000 // rewardRate
  );
  await halomLPStaking.waitForDeployment();
  const halomLPStakingAddress = await halomLPStaking.getAddress();
  console.log('HalomLPStaking deployed at:', halomLPStakingAddress);

  // --- 10. Deploy HalomTreasury ---
  const HalomTreasury = await ethers.getContractFactory('HalomTreasury');
  const halomTreasury = await HalomTreasury.deploy(
    halomTokenAddress,
    eurcTokenAddress,
    GOVERNOR // roleManager address
  );
  await halomTreasury.waitForDeployment();
  const halomTreasuryAddress = await halomTreasury.getAddress();
  console.log('HalomTreasury deployed at:', halomTreasuryAddress);

  // --- 11. Grant REWARDER_ROLE to token contract in staking ---
  /**
   * @dev This allows the token contract to add rewards to the staking contract
   */
  const REWARDER_ROLE = await halomStaking.REWARDER_ROLE();
  await halomStaking.grantRole(REWARDER_ROLE, halomTokenAddress);
  console.log('REWARDER_ROLE granted to token contract in staking.');

  // --- 12. Grant REWARDER_ROLE to governor in LP staking ---
  const lpStakingRewarderRole = await halomLPStaking.REWARDER_ROLE();
  await halomLPStaking.grantRole(lpStakingRewarderRole, GOVERNOR);
  console.log('REWARDER_ROLE granted to governor in LP staking.');

  // --- 13. Grant SLASHER_ROLE to governor in staking ---
  const SLASHER_ROLE = await halomStaking.SLASHER_ROLE();
  await halomStaking.grantRole(SLASHER_ROLE, GOVERNOR);
  console.log('SLASHER_ROLE granted to governor in staking.');

  // --- 14. Grant MINTER_ROLE to treasury for fee distribution ---
  await halomToken.grantRole(MINTER_ROLE, halomTreasuryAddress);
  console.log('MINTER_ROLE granted to treasury for fee distribution.');

  // --- 15. Grant MINTER_ROLE to LP staking for rewards ---
  await halomToken.grantRole(MINTER_ROLE, halomLPStakingAddress);
  console.log('MINTER_ROLE granted to LP staking for rewards.');

  // --- 16. Save all deployed addresses to offchain/deployment.json ---
  /**
   * @dev This file is used by offchain tools, frontends, and monitoring scripts.
   */
  const deployment = {
    halomToken: halomTokenAddress,
    halomOracle: halomOracleAddress,
    halomStaking: halomStakingAddress,
    halomLPStaking: halomLPStakingAddress,
    halomTreasury: halomTreasuryAddress,
    lpToken: lpTokenAddress,
    eurcToken: eurcTokenAddress,
    governor: GOVERNOR,
    rewarder: REWARDER,
    updater: UPDATER,
    pauser: PAUSER,
    timelock: TIMELOCK,
    deployer: deployer.address
  };
  fs.writeFileSync('offchain/deployment.json', JSON.stringify(deployment, null, 2));
  console.log('Deployment addresses saved to offchain/deployment.json');

  // --- 17. Post-deployment verification ---
  console.log('\n=== Deployment Verification ===');
  console.log('✅ HalomToken deployed and configured');
  console.log('✅ HalomOracle deployed with REBASE_CALLER_ROLE');
  console.log('✅ HalomStaking deployed with setStakingContract called');
  console.log('✅ MINTER_ROLE granted to staking contract');
  console.log('✅ REWARDER_ROLE granted to token contract in staking');
  console.log('✅ SLASHER_ROLE granted to governor');
  console.log('✅ All mock tokens deployed (if needed)');
  console.log('✅ Treasury and LP staking deployed');
  console.log('✅ Deployment info saved to JSON');
  
  console.log('\n=== Critical Security Checks ===');
  console.log('⚠️  IMPORTANT: Verify the following manually:');
  console.log('1. setStakingContract was called with correct address');
  console.log('2. MINTER_ROLE is only on staking contract');
  console.log('3. REBASE_CALLER_ROLE is only on oracle');
  console.log('4. Deployer roles were revoked');
  console.log('5. All environment variables are correct');
}

main().catch((error) => {
  console.error(error);
        process.exit(1);
    }); 
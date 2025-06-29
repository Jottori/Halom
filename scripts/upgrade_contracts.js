const { ethers, upgrades } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('=== Halom Protocol Contract Upgrade Script ===');

  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.utils.formatEther(await deployer.getBalance()), 'ETH');

  // Load deployment info
  let deploymentInfo;
  try {
    const deploymentPath = path.join(__dirname, '../offchain/deployment.json');
    const deploymentData = fs.readFileSync(deploymentPath, 'utf8');
    deploymentInfo = JSON.parse(deploymentData);
    console.log('Loaded deployment info');
  } catch {
    console.error('❌ Failed to load deployment info. Please run deploy_testnet.js first.');
    process.exit(1);
  }

  // Example: Upgrade HalomToken to a new version
  console.log('\n1. Upgrading HalomToken...');

  try {
    const HalomTokenV2 = await ethers.getContractFactory('HalomToken');

    // Upgrade the proxy to the new implementation
    const upgradedToken = await upgrades.upgradeProxy(
      deploymentInfo.contracts.halomToken,
      HalomTokenV2
    );

    await upgradedToken.deployed();
    console.log('✅ HalomToken upgraded successfully');
    console.log('New implementation address:', await upgrades.erc1967.getImplementationAddress(upgradedToken.address));

  } catch {
    console.error('\u274c Failed to upgrade HalomToken');
  }

  // Example: Upgrade HalomTreasury to a new version
  console.log('\n2. Upgrading HalomTreasury...');

  try {
    const HalomTreasuryV2 = await ethers.getContractFactory('HalomTreasury');

    // Upgrade the proxy to the new implementation
    const upgradedTreasury = await upgrades.upgradeProxy(
      deploymentInfo.contracts.treasury,
      HalomTreasuryV2
    );

    await upgradedTreasury.deployed();
    console.log('✅ HalomTreasury upgraded successfully');
    console.log('New implementation address:', await upgrades.erc1967.getImplementationAddress(upgradedTreasury.address));

  } catch {
    console.error('\u274c Failed to upgrade HalomTreasury');
  }

  // Example: Upgrade HalomOracleV2 to a new version
  console.log('\n3. Upgrading HalomOracleV2...');

  try {
    const HalomOracleV3 = await ethers.getContractFactory('HalomOracleV2');

    // Upgrade the proxy to the new implementation
    const upgradedOracle = await upgrades.upgradeProxy(
      deploymentInfo.contracts.oracle,
      HalomOracleV3
    );

    await upgradedOracle.deployed();
    console.log('✅ HalomOracleV2 upgraded successfully');
    console.log('New implementation address:', await upgrades.erc1967.getImplementationAddress(upgradedOracle.address));

  } catch {
    console.error('\u274c Failed to upgrade HalomOracleV2');
  }

  // Example: Upgrade HalomStaking to a new version
  console.log('\n4. Upgrading HalomStaking...');

  try {
    const HalomStakingV2 = await ethers.getContractFactory('HalomStaking');

    // Upgrade the proxy to the new implementation
    const upgradedStaking = await upgrades.upgradeProxy(
      deploymentInfo.contracts.staking,
      HalomStakingV2
    );

    await upgradedStaking.deployed();
    console.log('✅ HalomStaking upgraded successfully');
    console.log('New implementation address:', await upgrades.erc1967.getImplementationAddress(upgradedStaking.address));

  } catch {
    console.error('\u274c Failed to upgrade HalomStaking');
  }

  // Example: Upgrade HalomLPStaking to a new version
  console.log('\n5. Upgrading HalomLPStaking...');

  try {
    const HalomLPStakingV2 = await ethers.getContractFactory('HalomLPStaking');

    // Upgrade the proxy to the new implementation
    const upgradedLPStaking = await upgrades.upgradeProxy(
      deploymentInfo.contracts.lpStaking,
      HalomLPStakingV2
    );

    await upgradedLPStaking.deployed();
    console.log('✅ HalomLPStaking upgraded successfully');
    console.log('New implementation address:', await upgrades.erc1967.getImplementationAddress(upgradedLPStaking.address));

  } catch {
    console.error('\u274c Failed to upgrade HalomLPStaking');
  }

  console.log('\n=== Upgrade Summary ===');
  console.log('✅ All upgrade attempts completed');
  console.log('📋 Check the .openzeppelin folder for upgrade history');
  console.log('🔍 Verify contracts on block explorer if needed');

  // Save upgrade info
  const upgradeInfo = {
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    network: await ethers.provider.getNetwork().then(n => n.name),
    upgrades: {
      halomToken: deploymentInfo.contracts.halomToken,
      treasury: deploymentInfo.contracts.treasury,
      oracle: deploymentInfo.contracts.oracle,
      staking: deploymentInfo.contracts.staking,
      lpStaking: deploymentInfo.contracts.lpStaking
    }
  };

  const upgradePath = path.join(__dirname, '../upgrade-info.json');
  fs.writeFileSync(upgradePath, JSON.stringify(upgradeInfo, null, 2));
  console.log('📄 Upgrade info saved to upgrade-info.json');
}

main()
  .then(() => {
    console.log('\n\u2705 Contract upgrade script completed successfully!');
    process.exit(0);
  })
  .catch(() => {
    console.error('\u274c Contract upgrade script failed');
    process.exit(1);
  });

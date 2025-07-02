const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting Halom Protocol Core Deployment...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  console.log("💰 Account balance:", (await deployer.getBalance()).toString());

  // Deploy Token contract
  console.log("\n📦 Deploying Token contract...");
  const Token = await ethers.getContractFactory("Token");
  const token = await Token.deploy();
  await token.deployed();
  console.log("✅ Token deployed to:", token.address);

  // Deploy Treasury contract
  console.log("\n🏦 Deploying Treasury contract...");
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(token.address);
  await treasury.deployed();
  console.log("✅ Treasury deployed to:", treasury.address);

  // Deploy Oracle contract
  console.log("\n🔮 Deploying Oracle contract...");
  const Oracle = await ethers.getContractFactory("Oracle");
  const oracle = await Oracle.deploy();
  await oracle.deployed();
  console.log("✅ Oracle deployed to:", oracle.address);

  // Deploy Bridge contract
  console.log("\n🌉 Deploying Bridge contract...");
  const Bridge = await ethers.getContractFactory("Bridge");
  const bridge = await Bridge.deploy(token.address, treasury.address);
  await bridge.deployed();
  console.log("✅ Bridge deployed to:", bridge.address);

  // Deploy Staking contract
  console.log("\n🔒 Deploying Staking contract...");
  const Staking = await ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(token.address, treasury.address);
  await staking.deployed();
  console.log("✅ Staking deployed to:", staking.address);

  // Deploy LP Staking contract
  console.log("\n🏊 Deploying LP Staking contract...");
  const LPStaking = await ethers.getContractFactory("LPStaking");
  const lpStaking = await LPStaking.deploy(token.address, treasury.address);
  await lpStaking.deployed();
  console.log("✅ LP Staking deployed to:", lpStaking.address);

  // Deploy SafeHarbor contract
  console.log("\n🛡️ Deploying SafeHarbor contract...");
  const SafeHarbor = await ethers.getContractFactory("SafeHarbor");
  const safeHarbor = await SafeHarbor.deploy(token.address, treasury.address);
  await safeHarbor.deployed();
  console.log("✅ SafeHarbor deployed to:", safeHarbor.address);

  // Setup initial configurations
  console.log("\n⚙️ Setting up initial configurations...");

  // Grant roles to Treasury
  await token.grantRole(await token.MINTER_ROLE(), treasury.address);
  await token.grantRole(await token.BURNER_ROLE(), treasury.address);
  console.log("✅ Treasury roles granted");

  // Grant roles to Bridge
  await token.grantRole(await token.MINTER_ROLE(), bridge.address);
  await token.grantRole(await token.BURNER_ROLE(), bridge.address);
  console.log("✅ Bridge roles granted");

  // Grant roles to Staking contracts
  await token.grantRole(await token.MINTER_ROLE(), staking.address);
  await token.grantRole(await token.BURNER_ROLE(), staking.address);
  await token.grantRole(await token.MINTER_ROLE(), lpStaking.address);
  await token.grantRole(await token.BURNER_ROLE(), lpStaking.address);
  console.log("✅ Staking roles granted");

  // Grant roles to SafeHarbor
  await token.grantRole(await token.MINTER_ROLE(), safeHarbor.address);
  await token.grantRole(await token.BURNER_ROLE(), safeHarbor.address);
  console.log("✅ SafeHarbor roles granted");

  // Save deployment addresses
  const deploymentInfo = {
    network: hre.network.name,
    deployer: deployer.address,
    contracts: {
      token: token.address,
      treasury: treasury.address,
      oracle: oracle.address,
      bridge: bridge.address,
      staking: staking.address,
      lpStaking: lpStaking.address,
      safeHarbor: safeHarbor.address
    },
    timestamp: new Date().toISOString(),
    blockNumber: await hre.ethers.provider.getBlockNumber()
  };

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Save deployment info
  const deploymentPath = path.join(deploymentsDir, `${hre.network.name}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`📄 Deployment info saved to: ${deploymentPath}`);

  // Set outputs for GitHub Actions
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::set-output name=token_address::${token.address}`);
    console.log(`::set-output name=treasury_address::${treasury.address}`);
    console.log(`::set-output name=oracle_address::${oracle.address}`);
    console.log(`::set-output name=bridge_address::${bridge.address}`);
    console.log(`::set-output name=staking_address::${staking.address}`);
    console.log(`::set-output name=lp_staking_address::${lpStaking.address}`);
    console.log(`::set-output name=safe_harbor_address::${safeHarbor.address}`);
  }

  console.log("\n🎉 Core contracts deployment completed successfully!");
  console.log("\n📋 Contract Addresses:");
  console.log("Token:", token.address);
  console.log("Treasury:", treasury.address);
  console.log("Oracle:", oracle.address);
  console.log("Bridge:", bridge.address);
  console.log("Staking:", staking.address);
  console.log("LP Staking:", lpStaking.address);
  console.log("SafeHarbor:", safeHarbor.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }); 
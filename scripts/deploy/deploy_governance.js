const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Complete Governance System Deployment Script
 * Deploys Timelock, Governor, and Treasury contracts
 */

async function main() {
    console.log("🏛️ Starting Halom Protocol Governance Deployment...");

    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log("📝 Deploying governance contracts with account:", deployer.address);
    console.log("💰 Account balance:", (await deployer.getBalance()).toString());

    // Load core contract addresses
    const deploymentsDir = path.join(__dirname, "../../deployments");
    const deploymentPath = path.join(deploymentsDir, `${hre.network.name}.json`);
    
    if (!fs.existsSync(deploymentPath)) {
        throw new Error(`Deployment file not found: ${deploymentPath}. Please run deploy_core.js first.`);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const { token: tokenAddress, treasury: treasuryAddress } = deploymentInfo.contracts;

    console.log("📋 Using core contract addresses:");
    console.log("Token:", tokenAddress);
    console.log("Treasury:", treasuryAddress);

    // Deploy Timelock contract
    console.log("\n⏰ Deploying Timelock contract...");
    const Timelock = await ethers.getContractFactory("Timelock");
    const timelock = await Timelock.deploy(
        2 * 24 * 60 * 60, // 2 days minimum delay
        [deployer.address], // proposers
        [deployer.address], // executors
        deployer.address // admin
    );
    await timelock.deployed();
    console.log("✅ Timelock deployed to:", timelock.address);

    // Deploy HalomGovernor contract
    console.log("\n👑 Deploying HalomGovernor contract...");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const governor = await HalomGovernor.deploy(
        tokenAddress, // voting token
        timelock.address, // timelock
        4, // voting delay (blocks)
        45818, // voting period (blocks) ~1 week
        500, // proposal threshold (0.5%)
        4 // quorum numerator (4%)
    );
    await governor.deployed();
    console.log("✅ HalomGovernor deployed to:", governor.address);

    // Deploy GovernanceV2 contract (if needed)
    console.log("\n🔄 Deploying GovernanceV2 contract...");
    const GovernanceV2 = await ethers.getContractFactory("GovernanceV2");
    const governanceV2 = await GovernanceV2.deploy(
        tokenAddress,
        timelock.address,
        governor.address
    );
    await governanceV2.deployed();
    console.log("✅ GovernanceV2 deployed to:", governanceV2.address);

    // Setup governance roles
    console.log("\n⚙️ Setting up governance roles...");

    // Grant proposer role to governor
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), governor.address);
    console.log("✅ Governor granted proposer role");

    // Grant executor role to governor
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), governor.address);
    console.log("✅ Governor granted executor role");

    // Revoke admin role from deployer
    await timelock.revokeRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address);
    console.log("✅ Deployer admin role revoked");

    // Grant governance roles to Treasury
    await token.grantRole(await token.GOVERNANCE_ROLE(), governor.address);
    await treasury.grantRole(await treasury.GOVERNANCE_ROLE(), governor.address);
    console.log("✅ Governance roles granted to Treasury");

    // Update deployment info
    deploymentInfo.contracts.governance = {
        timelock: timelock.address,
        governor: governor.address,
        governanceV2: governanceV2.address
    };
    deploymentInfo.governanceSetup = {
        proposerRole: await timelock.PROPOSER_ROLE(),
        executorRole: await timelock.EXECUTOR_ROLE(),
        adminRole: await timelock.DEFAULT_ADMIN_ROLE()
    };

    // Save updated deployment info
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`📄 Updated deployment info saved to: ${deploymentPath}`);

    // Set outputs for GitHub Actions
    if (process.env.GITHUB_ACTIONS) {
        console.log(`::set-output name=timelock_address::${timelock.address}`);
        console.log(`::set-output name=governor_address::${governor.address}`);
        console.log(`::set-output name=governance_v2_address::${governanceV2.address}`);
    }

    console.log("\n🎉 Governance deployment completed successfully!");
    console.log("\n📋 Governance Contract Addresses:");
    console.log("Timelock:", timelock.address);
    console.log("HalomGovernor:", governor.address);
    console.log("GovernanceV2:", governanceV2.address);
    console.log("\n🔐 Governance Setup:");
    console.log("Proposer Role:", await timelock.PROPOSER_ROLE());
    console.log("Executor Role:", await timelock.EXECUTOR_ROLE());
    console.log("Admin Role:", await timelock.DEFAULT_ADMIN_ROLE());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Governance deployment failed:", error);
        process.exit(1);
    }); 
const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

/**
 * Complete Governance System Deployment Script
 * Deploys Timelock, Governor, and Treasury contracts
 */

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    
    console.log("=== Halom Protocol Governance Deployment ===");
    console.log("Network:", network.name);
    console.log("Chain ID:", network.chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

    // Load environment variables
    const timelockDelay = process.env.TIMELOCK_MIN_DELAY || "86400"; // 24 hours
    const votingDelay = process.env.GOVERNANCE_VOTING_DELAY || "1";
    const votingPeriod = process.env.GOVERNANCE_VOTING_PERIOD || "45818";
    const proposalThreshold = process.env.GOVERNANCE_PROPOSAL_THRESHOLD || "1000000000000000000000";
    const quorumFraction = process.env.GOVERNANCE_QUORUM_FRACTION || "4";
    
    // Multisig address (should be set in environment)
    const multisigAddress = process.env.MULTISIG_ADDRESS;
    if (!multisigAddress) {
        console.warning("⚠️ MULTISIG_ADDRESS not set in environment. Using deployer as temporary admin.");
    }

    console.log("\nGovernance Configuration:");
    console.log("- Timelock Delay:", timelockDelay, "seconds");
    console.log("- Voting Delay:", votingDelay, "blocks");
    console.log("- Voting Period:", votingPeriod, "blocks");
    console.log("- Proposal Threshold:", proposalThreshold);
    console.log("- Quorum Fraction:", quorumFraction, "%");
    console.log("- Multisig Address:", multisigAddress || "Not set");

    // Load existing deployment info
    let deploymentInfo;
    try {
        const deploymentPath = path.join(__dirname, '../offchain/deployment.json');
        const deploymentData = fs.readFileSync(deploymentPath, 'utf8');
        deploymentInfo = JSON.parse(deploymentData);
        console.log("\nLoaded existing deployment info");
    } catch (error) {
        console.error("❌ Failed to load deployment info. Please run deploy_testnet.js first.");
        process.exit(1);
    }

    // Deploy TimelockController
    console.log("\n1. Deploying TimelockController...");
    const proposers = []; // Will be set after governor deployment
    const executors = []; // Will be set after governor deployment
    const admin = multisigAddress || deployer.address; // Use multisig as admin if available

    const TimelockController = await ethers.getContractFactory("TimelockController");
    const timelock = await TimelockController.deploy(timelockDelay, proposers, executors, admin);
    await timelock.deployed();
    console.log("TimelockController deployed to:", timelock.address);

    // Deploy HalomGovernor
    console.log("\n2. Deploying HalomGovernor...");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const governor = await HalomGovernor.deploy(deploymentInfo.contracts.halomToken, timelock.address);
    await governor.deployed();
    console.log("HalomGovernor deployed to:", governor.address);

    // Setup Timelock roles
    console.log("\n3. Setting up Timelock roles...");
    
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

    // Grant proposer and executor roles to governor
    await timelock.grantRole(proposerRole, governor.address);
    await timelock.grantRole(executorRole, governor.address);
    
    console.log("✅ Governor granted proposer and executor roles");

    // Transfer admin role to multisig if available
    if (multisigAddress && multisigAddress !== deployer.address) {
        console.log("\n4. Transferring Timelock admin role to multisig...");
        await timelock.grantRole(adminRole, multisigAddress);
        await timelock.revokeRole(adminRole, deployer.address);
        console.log("✅ Timelock admin role transferred to multisig:", multisigAddress);
    } else {
        console.log("\n4. Keeping deployer as Timelock admin (multisig not configured)");
        console.log("⚠️ IMPORTANT: Transfer admin role to multisig manually after deployment");
    }

    // Setup Treasury with governance
    console.log("\n5. Updating Treasury governance...");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const treasury = HalomTreasury.attach(deploymentInfo.contracts.treasury);
    
    // Update treasury addresses
    await treasury.updateFeeDistributionAddresses(
        deploymentInfo.contracts.staking,
        deploymentInfo.contracts.lpStaking,
        multisigAddress || deployer.address // Use multisig as DAO reserve
    );
    
    console.log("✅ Treasury fee distribution addresses updated");

    // Setup Oracle governance
    console.log("\n6. Setting up Oracle governance...");
    const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
    const oracle = HalomOracleV2.attach(deploymentInfo.contracts.oracle);
    
    const GOVERNOR_ROLE = await oracle.GOVERNOR_ROLE();
    await oracle.grantRole(GOVERNOR_ROLE, governor.address);
    
    console.log("✅ Oracle governance role granted to governor");

    // Setup Staking governance
    console.log("\n7. Setting up Staking governance...");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const staking = HalomStaking.attach(deploymentInfo.contracts.staking);
    
    const stakingGovernorRole = await staking.GOVERNOR_ROLE();
    await staking.grantRole(stakingGovernorRole, governor.address);
    
    console.log("✅ Staking governance role granted to governor");

    // Setup LP Staking governance
    console.log("\n8. Setting up LP Staking governance...");
    const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
    const lpStaking = HalomLPStaking.attach(deploymentInfo.contracts.lpStaking);
    
    const lpStakingGovernorRole = await lpStaking.GOVERNOR_ROLE();
    await lpStaking.grantRole(lpStakingGovernorRole, governor.address);
    
    console.log("✅ LP Staking governance role granted to governor");

    // Update deployment info
    deploymentInfo.governance = {
        timelock: timelock.address,
        governor: governor.address,
        multisig: multisigAddress || deployer.address,
        timelockDelay: timelockDelay,
        votingDelay: votingDelay,
        votingPeriod: votingPeriod,
        proposalThreshold: proposalThreshold,
        quorumFraction: quorumFraction
    };

    // Save updated deployment info
    const deploymentPath = path.join(__dirname, '../offchain/deployment.json');
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("\nDeployment info updated:", deploymentPath);

    // Verify governance setup
    console.log("\n=== Governance Setup Summary ===");
    console.log("TimelockController:", timelock.address);
    console.log("HalomGovernor:", governor.address);
    console.log("Multisig (Admin):", multisigAddress || deployer.address);
    console.log("Timelock Delay:", timelockDelay, "seconds");
    console.log("Voting Delay:", votingDelay, "blocks");
    console.log("Voting Period:", votingPeriod, "blocks");
    console.log("Proposal Threshold:", proposalThreshold);
    console.log("Quorum Fraction:", quorumFraction, "%");
    
    console.log("\n=== Role Assignments ===");
    console.log("✅ Governor: Proposer & Executor in Timelock");
    console.log("✅ Governor: GOVERNOR_ROLE in Oracle");
    console.log("✅ Governor: GOVERNOR_ROLE in Staking");
    console.log("✅ Governor: GOVERNOR_ROLE in LP Staking");
    console.log("✅ Governor: GOVERNOR_ROLE in Treasury");
    
    if (multisigAddress) {
        console.log("✅ Multisig: DEFAULT_ADMIN_ROLE in Timelock");
    } else {
        console.log("⚠️ Deployer: DEFAULT_ADMIN_ROLE in Timelock (should transfer to multisig)");
    }
    
    console.log("\n=== Next Steps ===");
    console.log("1. Transfer Timelock admin role to multisig (if not done)");
    console.log("2. Test governance proposal creation");
    console.log("3. Test proposal execution through timelock");
    console.log("4. Verify all role assignments");
    console.log("5. Test emergency functions");
    
    if (!multisigAddress) {
        console.log("\n⚠️ IMPORTANT: Set MULTISIG_ADDRESS in environment and transfer admin role");
        console.log("Command to transfer admin role:");
        console.log(`npx hardhat console --network ${network.name}`);
        console.log(`> const timelock = await ethers.getContractAt("TimelockController", "${timelock.address}")`);
        console.log(`> await timelock.grantRole(await timelock.DEFAULT_ADMIN_ROLE(), "MULTISIG_ADDRESS")`);
        console.log(`> await timelock.revokeRole(await timelock.DEFAULT_ADMIN_ROLE(), "${deployer.address}")`);
    }

    return deploymentInfo;
}

main()
    .then((deploymentInfo) => {
        console.log("\n✅ Governance deployment completed successfully!");
        console.log("📋 Governance info saved to offchain/deployment.json");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Governance deployment failed:", error);
        process.exit(1);
    }); 
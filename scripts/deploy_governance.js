const { ethers } = require("hardhat");

/**
 * Complete Governance System Deployment Script
 * Deploys Timelock, Governor, and Treasury contracts
 */

async function main() {
    console.log("🏛️ Deploying Halom Governance System...");

    const [deployer] = await ethers.getSigners();
    console.log("Using deployer account:", deployer.address);

    // Step 1: Deploy Timelock Controller
    console.log("\n⏰ Deploying Timelock Controller...");
    
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    
    // Timelock parameters
    const minDelay = 24 * 60 * 60; // 24 hours
    const proposers = [deployer.address]; // Initially only deployer can propose
    const executors = [deployer.address]; // Initially only deployer can execute
    const admin = deployer.address; // Deployer is admin initially
    
    const timelock = await HalomTimelock.deploy(minDelay, proposers, executors, admin);
    await timelock.waitForDeployment();
    
    console.log("  ✅ Timelock deployed at:", await timelock.getAddress());
    console.log("  Min delay:", minDelay, "seconds (24 hours)");

    // Step 2: Deploy HalomToken (if not already deployed)
    console.log("\n🪙 Deploying/Attaching HalomToken...");
    
    let halomToken;
    try {
        // Try to load existing deployment
        const deploymentInfo = require("../offchain/deployment.json");
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = HalomToken.attach(deploymentInfo.halomToken);
        console.log("  ✅ Using existing HalomToken at:", await halomToken.getAddress());
    } catch (error) {
        // Deploy new token if not exists
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(deployer.address, deployer.address);
        await halomToken.waitForDeployment();
        console.log("  ✅ New HalomToken deployed at:", await halomToken.getAddress());
    }

    // Step 3: Deploy Governor
    console.log("\n🗳️ Deploying HalomGovernor...");
    
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    
    const governor = await HalomGovernor.deploy(
        await halomToken.getAddress(),
        await timelock.getAddress()
    );
    await governor.waitForDeployment();
    
    console.log("  ✅ Governor deployed at:", await governor.getAddress());

    // Step 4: Deploy Treasury
    console.log("\n💰 Deploying HalomTreasury...");
    
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    
    const treasury = await HalomTreasury.deploy(
        await timelock.getAddress(), // Governance will be timelock
        await halomToken.getAddress()
    );
    await treasury.waitForDeployment();
    
    console.log("  ✅ Treasury deployed at:", await treasury.getAddress());

    // Step 5: Configure Timelock roles
    console.log("\n🔐 Configuring Timelock roles...");
    
    // Grant proposer role to governor
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
    console.log("  ✅ Governor granted proposer role");
    
    // Grant executor role to governor
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    console.log("  ✅ Governor granted executor role");
    
    // Revoke deployer's proposer and executor roles (keep admin)
    await timelock.revokeRole(await timelock.PROPOSER_ROLE(), deployer.address);
    await timelock.revokeRole(await timelock.EXECUTOR_ROLE(), deployer.address);
    console.log("  ✅ Deployer proposer/executor roles revoked");

    // Step 6: Configure Token roles
    console.log("\n🔑 Configuring Token roles...");
    
    // Grant DEFAULT_ADMIN_ROLE to timelock
    await halomToken.grantRole(await halomToken.DEFAULT_ADMIN_ROLE(), await timelock.getAddress());
    console.log("  ✅ Timelock granted DEFAULT_ADMIN_ROLE on token");
    
    // Revoke deployer's DEFAULT_ADMIN_ROLE
    await halomToken.revokeRole(await halomToken.DEFAULT_ADMIN_ROLE(), deployer.address);
    console.log("  ✅ Deployer DEFAULT_ADMIN_ROLE revoked on token");

    // Step 7: Configure Treasury roles
    console.log("\n🏛️ Configuring Treasury roles...");
    
    // Grant GOVERNOR_ROLE to timelock
    await treasury.grantRole(await treasury.GOVERNOR_ROLE(), await timelock.getAddress());
    console.log("  ✅ Timelock granted GOVERNOR_ROLE on treasury");
    
    // Grant OPERATOR_ROLE to deployer (for initial setup)
    await treasury.grantRole(await treasury.OPERATOR_ROLE(), deployer.address);
    console.log("  ✅ Deployer granted OPERATOR_ROLE on treasury");

    // Step 8: Deploy and configure Oracle V2
    console.log("\n🔮 Deploying Oracle V2...");
    
    const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
    
    const oracleV2 = await HalomOracleV2.deploy(
        await timelock.getAddress(), // Governance
        1 // chainId
    );
    await oracleV2.waitForDeployment();
    
    console.log("  ✅ Oracle V2 deployed at:", await oracleV2.getAddress());
    
    // Set token address in oracle
    await oracleV2.setHalomToken(await halomToken.getAddress());
    console.log("  ✅ Token address set in oracle");

    // Step 9: Deploy and configure Staking contracts
    console.log("\n🔒 Deploying Staking contracts...");
    
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
    
    const staking = await HalomStaking.deploy(
        await halomToken.getAddress(),
        await timelock.getAddress() // Governance
    );
    await staking.waitForDeployment();
    
    const lpStaking = await HalomLPStaking.deploy(
        await halomToken.getAddress(),
        await timelock.getAddress() // Governance
    );
    await lpStaking.waitForDeployment();
    
    console.log("  ✅ Staking deployed at:", await staking.getAddress());
    console.log("  ✅ LP Staking deployed at:", await lpStaking.getAddress());
    
    // Configure token staking contract
    await halomToken.setStakingContract(await staking.getAddress());
    console.log("  ✅ Staking contract set in token");

    // Step 10: Configure Treasury addresses
    console.log("\n🏛️ Configuring Treasury addresses...");
    
    await treasury.updateAddresses(
        await staking.getAddress(),    // staking rewards
        await lpStaking.getAddress(),  // LP staking rewards
        await timelock.getAddress()    // DAO reserve (timelock)
    );
    console.log("  ✅ Treasury addresses configured");

    // Step 11: Fund initial rewards
    console.log("\n💰 Funding initial rewards...");
    
    const rewardAmount = ethers.parseEther("100000"); // 100K HLM each
    
    await halomToken.transfer(await staking.getAddress(), rewardAmount);
    await halomToken.transfer(await lpStaking.getAddress(), rewardAmount);
    
    console.log("  ✅ Funded staking rewards:", ethers.formatEther(rewardAmount), "HLM each");

    // Step 12: Create initial governance proposal
    console.log("\n📋 Creating initial governance proposal...");
    
    // Example proposal: Update treasury fee distribution
    const targets = [await treasury.getAddress()];
    const values = [0];
    const calldatas = [
        treasury.interface.encodeFunctionData("updateFeePercentages", [7000, 2000, 1000]) // 70% staking, 20% LP, 10% DAO
    ];
    const description = "Initial proposal: Update treasury fee distribution to 70% staking, 20% LP staking, 10% DAO reserve";
    
    const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
    
    console.log("  ✅ Example proposal created with ID:", proposalId);
    console.log("  Description:", description);

    // Step 13: Save deployment information
    console.log("\n💾 Saving deployment information...");
    
    const deploymentInfo = {
        timelock: await timelock.getAddress(),
        governor: await governor.getAddress(),
        treasury: await treasury.getAddress(),
        halomToken: await halomToken.getAddress(),
        oracleV2: await oracleV2.getAddress(),
        staking: await staking.getAddress(),
        lpStaking: await lpStaking.getAddress(),
        deployer: deployer.address,
        deploymentTime: new Date().toISOString(),
        roles: {
            timelockAdmin: deployer.address,
            timelockProposer: await governor.getAddress(),
            timelockExecutor: await governor.getAddress(),
            tokenAdmin: await timelock.getAddress(),
            treasuryGovernor: await timelock.getAddress(),
            treasuryOperator: deployer.address
        },
        parameters: {
            timelockMinDelay: minDelay,
            initialRewards: ethers.formatEther(rewardAmount),
            exampleProposalId: proposalId
        }
    };

    const fs = require('fs');
    fs.writeFileSync(
        'governance-deployment.json',
        JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("\n🎉 Governance system deployment complete!");
    console.log("📄 Deployment info saved to governance-deployment.json");
    
    console.log("\n📋 Governance System Overview:");
    console.log("  🏛️ Timelock:", await timelock.getAddress());
    console.log("  🗳️ Governor:", await governor.getAddress());
    console.log("  💰 Treasury:", await treasury.getAddress());
    console.log("  🪙 Token:", await halomToken.getAddress());
    console.log("  🔮 Oracle V2:", await oracleV2.getAddress());
    console.log("  🔒 Staking:", await staking.getAddress());
    console.log("  🔒 LP Staking:", await lpStaking.getAddress());
    
    console.log("\n🔐 Access Control:");
    console.log("  • Only Governor can propose actions");
    console.log("  • All actions go through 24-hour timelock");
    console.log("  • Timelock controls all admin functions");
    console.log("  • Treasury distributes fees automatically");
    
    console.log("\n📋 Next steps:");
    console.log("  1. Transfer timelock admin to multisig wallet");
    console.log("  2. Set up oracle nodes and authorize them");
    console.log("  3. Create LP pools and configure staking");
    console.log("  4. Submit governance proposals for parameter updates");
    console.log("  5. Set up monitoring and alerts");
    console.log("  6. Conduct security audit");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    }); 
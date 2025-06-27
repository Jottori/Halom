const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy HalomToken
    console.log("\n1. Deploying HalomToken...");
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const halomToken = await HalomToken.deploy();
    await halomToken.deployed();
    console.log("HalomToken deployed to:", halomToken.address);

    // Deploy EURC Mock (for testing - replace with real EURC address on mainnet)
    console.log("\n2. Deploying EURC Mock...");
    const MockEURC = await ethers.getContractFactory("MockERC20");
    const eurcToken = await MockEURC.deploy("EURC", "EURC", 6); // EURC has 6 decimals
    await eurcToken.deployed();
    console.log("EURC Mock deployed to:", eurcToken.address);

    // Deploy TimelockController
    console.log("\n3. Deploying TimelockController...");
    const minDelay = 86400; // 1 day
    const proposers = []; // Will be set after governor deployment
    const executors = []; // Will be set after governor deployment
    const admin = deployer.address;

    const TimelockController = await ethers.getContractFactory("TimelockController");
    const timelock = await TimelockController.deploy(minDelay, proposers, executors, admin);
    await timelock.deployed();
    console.log("TimelockController deployed to:", timelock.address);

    // Deploy HalomGovernor
    console.log("\n4. Deploying HalomGovernor...");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const governor = await HalomGovernor.deploy(halomToken.address, timelock.address);
    await governor.deployed();
    console.log("HalomGovernor deployed to:", governor.address);

    // Deploy HalomStaking with fourth root based rewards
    console.log("\n5. Deploying HalomStaking...");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const staking = await HalomStaking.deploy(
        halomToken.address,
        governor.address,
        deployer.address, // rewarder
        deployer.address  // pauser
    );
    await staking.deployed();
    console.log("HalomStaking deployed to:", staking.address);

    // Deploy HalomLPStaking with fourth root based rewards
    console.log("\n6. Deploying HalomLPStaking...");
    const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
    const lpStaking = await HalomLPStaking.deploy(
        eurcToken.address, // LP token (using EURC as example)
        halomToken.address,
        governor.address,
        deployer.address
    );
    await lpStaking.deployed();
    console.log("HalomLPStaking deployed to:", lpStaking.address);

    // Deploy HalomTreasury with EURC and fourth root based fee distribution
    console.log("\n7. Deploying HalomTreasury...");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const treasury = await HalomTreasury.deploy(
        halomToken.address,
        eurcToken.address,
        governor.address,
        deployer.address, // operator
        deployer.address  // pauser
    );
    await treasury.deployed();
    console.log("HalomTreasury deployed to:", treasury.address);

    // Deploy HalomOracle
    console.log("\n8. Deploying HalomOracle...");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const oracle = await HalomOracle.deploy(
        governor.address,
        deployer.address, // updater
        deployer.address  // pauser
    );
    await oracle.deployed();
    console.log("HalomOracle deployed to:", oracle.address);

    // Setup governance roles
    console.log("\n9. Setting up governance roles...");
    
    // Grant proposer and executor roles to governor
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

    await timelock.grantRole(proposerRole, governor.address);
    await timelock.grantRole(executorRole, governor.address);
    await timelock.revokeRole(adminRole, deployer.address);

    console.log("Governance roles configured");

    // Setup token roles
    console.log("\n10. Setting up token roles...");
    
    // Set staking contract address in token
    await halomToken.setStakingContract(staking.address);
    
    // Grant REWARDER_ROLE to token contract so it can call addRewards
    const REWARDER_ROLE = await staking.REWARDER_ROLE();
    await staking.grantRole(REWARDER_ROLE, halomToken.address);
    
    // Grant REWARDER_ROLE to LP staking as well
    const lpStakingRewarderRole = await lpStaking.REWARDER_ROLE();
    await lpStaking.grantRole(lpStakingRewarderRole, deployer.address);
    
    console.log("Token roles configured");

    // Mint initial tokens
    console.log("\n11. Minting initial tokens...");
    const initialSupply = ethers.utils.parseEther("10000000"); // 10M HLM
    await halomToken.mint(deployer.address, initialSupply);
    
    // Mint EURC for testing
    const initialEURC = ethers.utils.parseUnits("1000000", 6); // 1M EURC
    await eurcToken.mint(deployer.address, initialEURC);
    
    console.log("Initial tokens minted");

    // Fund staking contracts
    console.log("\n12. Funding staking contracts...");
    const stakingRewards = ethers.utils.parseEther("1000000"); // 1M HLM for staking rewards
    const lpStakingRewards = ethers.utils.parseEther("500000"); // 500K HLM for LP staking rewards
    
    await halomToken.transfer(staking.address, stakingRewards);
    await halomToken.transfer(lpStaking.address, lpStakingRewards);
    
    console.log("Staking contracts funded");

    // Setup treasury
    console.log("\n13. Setting up treasury...");
    const treasuryFunding = ethers.utils.parseEther("500000"); // 500K HLM for treasury
    await halomToken.transfer(treasury.address, treasuryFunding);
    
    console.log("Treasury funded");

    // Verify deployments
    console.log("\n=== Deployment Summary ===");
    console.log("HalomToken:", halomToken.address);
    console.log("EURC Token:", eurcToken.address);
    console.log("TimelockController:", timelock.address);
    console.log("HalomGovernor:", governor.address);
    console.log("HalomStaking:", staking.address);
    console.log("HalomLPStaking:", lpStaking.address);
    console.log("HalomTreasury:", treasury.address);
    console.log("HalomOracle:", oracle.address);
    
    console.log("\n=== Fourth Root System Features ===");
    console.log("✅ Governance voting power: fourth root of locked tokens");
    console.log("✅ Staking rewards: fourth root based distribution");
    console.log("✅ LP staking rewards: fourth root based distribution");
    console.log("✅ Treasury fees: fourth root based distribution");
    console.log("✅ Anti-whale protection: parameterizable root power");
    console.log("✅ EURC integration: stablecoin support");
    
    console.log("\n=== Next Steps ===");
    console.log("1. Test the fourth root calculations");
    console.log("2. Verify governance proposal creation");
    console.log("3. Test staking and reward distribution");
    console.log("4. Deploy to mainnet with real EURC address");
    console.log("5. Set up off-chain oracle updater");

    return {
        halomToken: halomToken.address,
        eurcToken: eurcToken.address,
        timelock: timelock.address,
        governor: governor.address,
        staking: staking.address,
        lpStaking: lpStaking.address,
        treasury: treasury.address,
        oracle: oracle.address
    };
}

main()
    .then((addresses) => {
        console.log("\nDeployment completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    }); 
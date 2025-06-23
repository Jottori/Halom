const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    const { ethers, network } = hre;
    const [deployer, governor, updater, slasher, rewarder] = await ethers.getSigners();
    const chainId = network.config.chainId;

    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Network:", network.name, "(chainId:", chainId, ")");
    console.log("---------------------------------");
    console.log("Role addresses:");
    console.log(`  Governor: ${governor.address}`);
    console.log(`  Updater:  ${updater.address}`);
    console.log(`  Slasher:  ${slasher.address}`);
    console.log(`  Rewarder: ${rewarder.address}`);
    console.log("---------------------------------");

    // 1. Deploy HalomToken
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const halomToken = await HalomToken.deploy(deployer.address, governor.address); // Oracle address, governor
    console.log("HalomToken deployed to:", halomToken.address);

    // 2. Deploy HalomOracle
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    // The chainId here is for replay protection, not used in the old signature scheme
    const halomOracle = await HalomOracle.deploy(governor.address, chainId);
    console.log("HalomOracle deployed to:", halomOracle.address);
    
    // 3. Deploy HalomStaking - only 2 parameters: token and governor
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const halomStaking = await HalomStaking.deploy(halomToken.address, governor.address);
    console.log("HalomStaking deployed to:", halomStaking.address);
    
    // 4. Deploy Mock LP Token (for local/testing) and HalomLPStaking
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockLpToken = await MockERC20.deploy("Mock LP", "MLP", ethers.parseUnits("1000000", 18));
    console.log("Mock LP Token deployed to:", mockLpToken.address);

    const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
    const lpStaking = await HalomLPStaking.deploy(mockLpToken.address, halomToken.address, governor.address, rewarder.address);
    console.log("HalomLPStaking deployed to:", lpStaking.address);
    
    // --- Post-deployment setup ---
    console.log("\n--- Configuring contract roles and settings ---");

    // Grant REBASE_CALLER role to the oracle
    const REBASE_CALLER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBASE_CALLER"));
    await halomToken.connect(governor).grantRole(REBASE_CALLER_ROLE, halomOracle.address);
    console.log("Granted REBASE_CALLER_ROLE to HalomOracle");

    // Grant ORACLE_UPDATER_ROLE to the updater address
    const ORACLE_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_UPDATER_ROLE"));
    await halomOracle.connect(governor).grantRole(ORACLE_UPDATER_ROLE, updater.address);
    console.log("Granted ORACLE_UPDATER_ROLE to updater address");

    // Set HalomToken address in Oracle
    await halomOracle.connect(governor).setHalomToken(halomToken.address);
    console.log("Set HalomToken address in HalomOracle");

    // Grant MINTER_ROLE to staking contracts for rewards
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEFAULT_ADMIN_ROLE"));
    await halomToken.connect(governor).grantRole(MINTER_ROLE, halomStaking.address);
    await halomToken.connect(governor).grantRole(MINTER_ROLE, lpStaking.address);
    console.log("Granted MINTER_ROLE to both staking contracts");

    console.log("\nDeployment and setup complete!");
    
    // Save addresses to a file for the off-chain service
    const addresses = {
        halomOracle: halomOracle.address,
        halomToken: halomToken.address,
        halomStaking: halomStaking.address,
        halomLPStaking: lpStaking.address,
        mockLpToken: mockLpToken.address,
        roles: {
            governor: governor.address,
            updater: updater.address,
            slasher: slasher.address,
            rewarder: rewarder.address
        }
    };
    const deploymentPath = path.join(__dirname, '..', 'offchain', 'deployment.json');
    fs.writeFileSync(deploymentPath, JSON.stringify(addresses, null, 2));
    console.log(`\nDeployment addresses saved to ${deploymentPath}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
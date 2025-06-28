const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    
    console.log("=== Halom Protocol Testnet Deployment ===");
    console.log("Network:", network.name);
    console.log("Chain ID:", network.chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

    // Load environment variables
    const deployNetwork = process.env.DEPLOY_NETWORK || "zkSyncTestnet";
    const maxRebaseDelta = process.env.MAX_REBASE_DELTA || "500";
    const rewardRate = process.env.REWARD_RATE || "2000";
    const timelockDelay = process.env.TIMELOCK_MIN_DELAY || "86400";

    console.log("\nDeployment Configuration:");
    console.log("- Target Network:", deployNetwork);
    console.log("- Max Rebase Delta:", maxRebaseDelta, "basis points");
    console.log("- Reward Rate:", rewardRate, "basis points");
    console.log("- Timelock Delay:", timelockDelay, "seconds");

    // Get testnet token addresses based on network
    const testnetTokens = getTestnetTokens(network.chainId);
    console.log("\nTestnet Tokens:", testnetTokens);

    // Deploy HalomToken
    console.log("\n1. Deploying HalomToken...");
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const halomToken = await HalomToken.deploy(deployer.address, deployer.address);
    await halomToken.waitForDeployment();
    console.log("HalomToken deployed to:", await halomToken.getAddress());

    // Deploy Mock Tokens for testing
    console.log("\n2. Deploying Mock Tokens...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const mockUSDC = await MockERC20.deploy("USDC", "USDC", 6);
    await mockUSDC.waitForDeployment();
    console.log("Mock USDC deployed to:", await mockUSDC.getAddress());

    const mockUSDT = await MockERC20.deploy("USDT", "USDT", 6);
    await mockUSDT.waitForDeployment();
    console.log("Mock USDT deployed to:", await mockUSDT.getAddress());

    const mockDAI = await MockERC20.deploy("DAI", "DAI", 18);
    await mockDAI.waitForDeployment();
    console.log("Mock DAI deployed to:", await mockDAI.getAddress());

    // Deploy TimelockController
    console.log("\n3. Deploying TimelockController...");
    const proposers = []; // Will be set after governor deployment
    const executors = []; // Will be set after governor deployment
    const admin = deployer.address;

    const TimelockController = await ethers.getContractFactory("TimelockController");
    const timelock = await TimelockController.deploy(timelockDelay, proposers, executors, admin);
    await timelock.waitForDeployment();
    console.log("TimelockController deployed to:", await timelock.getAddress());

    // Deploy HalomGovernor
    console.log("\n4. Deploying HalomGovernor...");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const governor = await HalomGovernor.deploy(await halomToken.getAddress(), await timelock.getAddress());
    await governor.waitForDeployment();
    console.log("HalomGovernor deployed to:", await governor.getAddress());

    // Deploy HalomStaking
    console.log("\n5. Deploying HalomStaking...");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const staking = await HalomStaking.deploy(
        await halomToken.getAddress(),
        await governor.getAddress(),
        2000, // rewardRate
        30 * 24 * 60 * 60, // lockPeriod (30 days)
        5000 // slashPercentage (50%)
    );
    await staking.waitForDeployment();
    console.log("HalomStaking deployed to:", await staking.getAddress());

    // Deploy HalomLPStaking
    console.log("\n6. Deploying HalomLPStaking...");
    const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
    const lpStaking = await HalomLPStaking.deploy(
        await mockUSDC.getAddress(), // LP token (using mock USDC)
        await halomToken.getAddress(),
        await governor.getAddress(),
        2000 // rewardRate
    );
    await lpStaking.waitForDeployment();
    console.log("HalomLPStaking deployed to:", await lpStaking.getAddress());

    // Deploy HalomTreasury
    console.log("\n7. Deploying HalomTreasury...");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const treasury = await HalomTreasury.deploy(
        await halomToken.getAddress(),
        await mockUSDC.getAddress(), // Using mock USDC as stablecoin
        await governor.getAddress()
    );
    await treasury.waitForDeployment();
    console.log("HalomTreasury deployed to:", await treasury.getAddress());

    // Deploy HalomOracleV2 (multi-node consensus)
    console.log("\n8. Deploying HalomOracleV2...");
    const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
    const oracle = await HalomOracleV2.deploy(
        await governor.getAddress(),
        deployer.address, // updater
        deployer.address  // pauser
    );
    await oracle.waitForDeployment();
    console.log("HalomOracleV2 deployed to:", await oracle.getAddress());

    // Setup governance roles
    console.log("\n9. Setting up governance roles...");
    
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

    await timelock.grantRole(proposerRole, governor.address);
    await timelock.grantRole(executorRole, governor.address);
    await timelock.revokeRole(adminRole, deployer.address);

    console.log("Governance roles configured");

    // Setup token roles
    console.log("\n10. Setting up token roles...");
    
    // Set staking contract address in token (CRITICAL for rebase rewards)
    await halomToken.setStakingContract(staking.address);
    console.log("✅ Staking contract address set in token");
    
    // Grant MINTER_ROLE to staking contract for rebase rewards (NOT DEFAULT_ADMIN_ROLE)
    const MINTER_ROLE = await halomToken.MINTER_ROLE();
    await halomToken.grantRole(MINTER_ROLE, staking.address);
    console.log("✅ MINTER_ROLE granted to staking contract");
    
    // Verify STAKING_CONTRACT_ROLE is automatically granted by setStakingContract
    const STAKING_CONTRACT_ROLE = await halomToken.STAKING_CONTRACT_ROLE();
    const hasStakingRole = await halomToken.hasRole(STAKING_CONTRACT_ROLE, staking.address);
    if (!hasStakingRole) {
        throw new Error("STAKING_CONTRACT_ROLE not granted to staking contract");
    }
    console.log("✅ STAKING_CONTRACT_ROLE verified for staking contract");
    
    // Grant REWARDER_ROLE to token contract so it can call addRewards
    const REWARDER_ROLE = await staking.REWARDER_ROLE();
    await staking.grantRole(REWARDER_ROLE, halomToken.address);
    console.log("✅ REWARDER_ROLE granted to token contract");
    
    // Grant REWARDER_ROLE to LP staking as well
    const lpStakingRewarderRole = await lpStaking.REWARDER_ROLE();
    await lpStaking.grantRole(lpStakingRewarderRole, deployer.address);
    console.log("✅ REWARDER_ROLE granted to LP staking");

    // Grant oracle roles
    const ORACLE_UPDATER_ROLE = await oracle.ORACLE_UPDATER_ROLE();
    await oracle.grantRole(ORACLE_UPDATER_ROLE, deployer.address);
    console.log("✅ ORACLE_UPDATER_ROLE granted to deployer");
    
    console.log("✅ Token roles configured securely");

    // Configure token parameters
    console.log("\n11. Configuring token parameters...");
    await halomToken.setMaxRebaseDelta(maxRebaseDelta);
    await halomToken.setRewardRate(rewardRate);
    
    // Set anti-whale limits (1% transfer, 2% wallet)
    const totalSupply = await halomToken.totalSupply();
    const maxTransfer = totalSupply.mul(1).div(100); // 1%
    const maxWallet = totalSupply.mul(2).div(100);   // 2%
    await halomToken.setAntiWhaleLimits(maxTransfer, maxWallet);
    
    console.log("Token parameters configured");

    // Mint initial tokens
    console.log("\n12. Minting initial tokens...");
    const initialSupply = ethers.utils.parseEther("10000000"); // 10M HLM
    await halomToken.mint(deployer.address, initialSupply);
    
    // Mint mock tokens for testing
    const mockTokenAmount = ethers.utils.parseUnits("1000000", 6); // 1M tokens
    await mockUSDC.mint(deployer.address, mockTokenAmount);
    await mockUSDT.mint(deployer.address, mockTokenAmount);
    await mockDAI.mint(deployer.address, ethers.utils.parseEther("1000000"));
    
    console.log("Initial tokens minted");

    // Fund staking contracts
    console.log("\n13. Funding staking contracts...");
    const stakingRewards = ethers.utils.parseEther("1000000"); // 1M HLM for staking rewards
    const lpStakingRewards = ethers.utils.parseEther("500000"); // 500K HLM for LP staking rewards
    
    await halomToken.transfer(staking.address, stakingRewards);
    await halomToken.transfer(lpStaking.address, lpStakingRewards);
    
    console.log("Staking contracts funded");

    // Setup treasury
    console.log("\n14. Setting up treasury...");
    const treasuryFunding = ethers.utils.parseEther("500000"); // 500K HLM for treasury
    await halomToken.transfer(treasury.address, treasuryFunding);
    
    // Fund treasury with stablecoins
    const treasuryStablecoinAmount = ethers.utils.parseUnits("100000", 6);
    await mockUSDC.transfer(treasury.address, treasuryStablecoinAmount);
    
    console.log("Treasury funded");

    // Save deployment addresses
    const deploymentInfo = {
        network: network.name,
        chainId: network.chainId,
        deployer: deployer.address,
        contracts: {
            halomToken: halomToken.address,
            mockUSDC: mockUSDC.address,
            mockUSDT: mockUSDT.address,
            mockDAI: mockDAI.address,
            timelock: timelock.address,
            governor: governor.address,
            staking: staking.address,
            lpStaking: lpStaking.address,
            treasury: treasury.address,
            oracle: oracle.address
        },
        roles: {
            deployer: deployer.address,
            governor: governor.address,
            timelock: timelock.address
        },
        parameters: {
            maxRebaseDelta: maxRebaseDelta,
            rewardRate: rewardRate,
            timelockDelay: timelockDelay,
            maxTransferAmount: maxTransfer.toString(),
            maxWalletAmount: maxWallet.toString()
        },
        deploymentTime: new Date().toISOString()
    };

    // Save to file
    const deploymentPath = path.join(__dirname, '../offchain/deployment.json');
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("\nDeployment info saved to:", deploymentPath);

    // Verify deployments
    console.log("\n=== Deployment Summary ===");
    console.log("Network:", network.name, "(Chain ID:", network.chainId, ")");
    console.log("HalomToken:", halomToken.address);
    console.log("Mock USDC:", mockUSDC.address);
    console.log("Mock USDT:", mockUSDT.address);
    console.log("Mock DAI:", mockDAI.address);
    console.log("TimelockController:", timelock.address);
    console.log("HalomGovernor:", governor.address);
    console.log("HalomStaking:", staking.address);
    console.log("HalomLPStaking:", lpStaking.address);
    console.log("HalomTreasury:", treasury.address);
    console.log("HalomOracleV2:", oracle.address);
    
    console.log("\n=== Testnet Features ===");
    console.log("✅ Multi-node oracle consensus (V2)");
    console.log("✅ Anti-whale protection enabled");
    console.log("✅ Fourth root governance system");
    console.log("✅ Comprehensive role management");
    console.log("✅ Mock tokens for testing");
    console.log("✅ Treasury with stablecoin support");
    
    console.log("\n=== Next Steps ===");
    console.log("1. Test the oracle consensus mechanism");
    console.log("2. Verify governance proposal creation");
    console.log("3. Test staking and reward distribution");
    console.log("4. Set up off-chain oracle updater");
    console.log("5. Configure monitoring and alerts");

    return deploymentInfo;
}

function getTestnetTokens(chainId) {
    const tokens = {
        280: { // zkSync Era Testnet
            USDC: "0x0faF6df7054946141264FD582c3f8524b6810e1a",
            USDT: "0x493257fD37EDB34451fEEDD6D3127D2E65a4B820",
            DAI: "0x3e7676937A7E96CFB7616f255b9AD9FF47363D4b"
        },
        11155111: { // Sepolia
            USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
            USDT: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
            DAI: "0x68194a729C2450ad26072b3D33ADaCbcef39D574"
        },
        1442: { // Polygon zkEVM Testnet
            USDC: "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035",
            USDT: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",
            DAI: "0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4"
        },
        421614: { // Arbitrum Sepolia
            USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
            USDT: "0x2fFd013A7c5A3F49c6C654F0657b4C3C0CF56152",
            DAI: "0x08Cb71192985E936C7Cd166A8b268035e400c3c3"
        }
    };
    
    return tokens[chainId] || { USDC: "MOCK", USDT: "MOCK", DAI: "MOCK" };
}

main()
    .then((deploymentInfo) => {
        console.log("\n✅ Testnet deployment completed successfully!");
        console.log("📋 Deployment info saved to offchain/deployment.json");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Testnet deployment failed:", error);
        process.exit(1);
    }); 
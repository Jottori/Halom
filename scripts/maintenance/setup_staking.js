const { ethers } = require("hardhat");

/**
 * Mainnet Staking and LP Pool Setup Script
 * This script configures the staking contracts for mainnet deployment
 */

async function main() {
    console.log("🚀 Setting up Halom Staking for Mainnet...");

    const [deployer] = await ethers.getSigners();
    console.log("Using deployer account:", deployer.address);

    // Mainnet addresses (replace with actual addresses)
    const MAINNET_ADDRESSES = {
        // Example addresses - replace with actual ones
        USDC: "0xA0b86a33E6441b8c4C8C8C8C8C8C8C8C8C8C8C8C", // USDC on mainnet
        USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT on mainnet
        DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",  // DAI on mainnet
        WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on mainnet
        
        // DEX addresses
        UNISWAP_V2_ROUTER: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        UNISWAP_V2_FACTORY: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        
        // LP token addresses (will be created)
        HLM_USDC_LP: "0x0000000000000000000000000000000000000000", // To be set after LP creation
        HLM_USDT_LP: "0x0000000000000000000000000000000000000000", // To be set after LP creation
        HLM_DAI_LP: "0x0000000000000000000000000000000000000000",  // To be set after LP creation
    };

    // Load deployed contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");

    // Get deployment info
    const deploymentInfo = require("../offchain/deployment.json");
    
    const halomToken = HalomToken.attach(deploymentInfo.halomToken);
    const halomStaking = HalomStaking.attach(deploymentInfo.halomStaking);
    const halomLPStaking = HalomLPStaking.attach(deploymentInfo.halomLPStaking);
    const halomTreasury = HalomTreasury.attach(deploymentInfo.halomTreasury);

    console.log("📋 Contract addresses:");
    console.log("  HalomToken:", await halomToken.getAddress());
    console.log("  HalomStaking:", await halomStaking.getAddress());
    console.log("  HalomLPStaking:", await halomLPStaking.getAddress());
    console.log("  HalomTreasury:", await halomTreasury.getAddress());

    // Step 1: Create LP pools on Uniswap V2
    console.log("\n🏊 Creating LP pools...");
    
    const uniswapRouter = new ethers.Contract(
        MAINNET_ADDRESSES.UNISWAP_V2_ROUTER,
        [
            "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
            "function factory() external view returns (address)"
        ],
        deployer
    );

    // Calculate amounts for LP creation
    const hlmAmount = ethers.parseEther("1000000"); // 1M HLM tokens
    const usdcAmount = ethers.parseUnits("1000000", 6); // 1M USDC
    const usdtAmount = ethers.parseUnits("1000000", 6); // 1M USDT
    const daiAmount = ethers.parseEther("1000000"); // 1M DAI

    // Approve tokens for Uniswap router
    console.log("  Approving tokens for Uniswap...");
    
    const usdc = new ethers.Contract(MAINNET_ADDRESSES.USDC, [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function balanceOf(address account) external view returns (uint256)"
    ], deployer);

    const usdt = new ethers.Contract(MAINNET_ADDRESSES.USDT, [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function balanceOf(address account) external view returns (uint256)"
    ], deployer);

    const dai = new ethers.Contract(MAINNET_ADDRESSES.DAI, [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function balanceOf(address account) external view returns (uint256)"
    ], deployer);

    // Check balances
    const hlmBalance = await halomToken.balanceOf(deployer.address);
    const usdcBalance = await usdc.balanceOf(deployer.address);
    const usdtBalance = await usdt.balanceOf(deployer.address);
    const daiBalance = await dai.balanceOf(deployer.address);

    console.log("  Balances:");
    console.log("    HLM:", ethers.formatEther(hlmBalance));
    console.log("    USDC:", ethers.formatUnits(usdcBalance, 6));
    console.log("    USDT:", ethers.formatUnits(usdtBalance, 6));
    console.log("    DAI:", ethers.formatEther(daiBalance));

    // Approve HLM tokens
    await halomToken.approve(await uniswapRouter.getAddress(), hlmAmount);
    console.log("  ✅ HLM tokens approved");

    // Create HLM/USDC pool
    if (usdcBalance >= usdcAmount) {
        await usdc.approve(await uniswapRouter.getAddress(), usdcAmount);
        
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        
        const tx = await uniswapRouter.addLiquidity(
            await halomToken.getAddress(),
            MAINNET_ADDRESSES.USDC,
            hlmAmount,
            usdcAmount,
            0, // amountAMin
            0, // amountBMin
            deployer.address,
            deadline
        );
        
        await tx.wait();
        console.log("  ✅ HLM/USDC pool created");
        
        // Get LP token address
        const factory = new ethers.Contract(
            await uniswapRouter.factory(),
            ["function getPair(address tokenA, address tokenB) external view returns (address pair)"],
            deployer
        );
        
        const hlmUsdcLp = await factory.getPair(await halomToken.getAddress(), MAINNET_ADDRESSES.USDC);
        MAINNET_ADDRESSES.HLM_USDC_LP = hlmUsdcLp;
        console.log("  HLM/USDC LP address:", hlmUsdcLp);
    }

    // Create HLM/USDT pool
    if (usdtBalance >= usdtAmount) {
        await usdt.approve(await uniswapRouter.getAddress(), usdtAmount);
        
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        
        const tx = await uniswapRouter.addLiquidity(
            await halomToken.getAddress(),
            MAINNET_ADDRESSES.USDT,
            hlmAmount,
            usdtAmount,
            0,
            0,
            deployer.address,
            deadline
        );
        
        await tx.wait();
        console.log("  ✅ HLM/USDT pool created");
        
        const factory = new ethers.Contract(
            await uniswapRouter.factory(),
            ["function getPair(address tokenA, address tokenB) external view returns (address pair)"],
            deployer
        );
        
        const hlmUsdtLp = await factory.getPair(await halomToken.getAddress(), MAINNET_ADDRESSES.USDT);
        MAINNET_ADDRESSES.HLM_USDT_LP = hlmUsdtLp;
        console.log("  HLM/USDT LP address:", hlmUsdtLp);
    }

    // Create HLM/DAI pool
    if (daiBalance >= daiAmount) {
        await dai.approve(await uniswapRouter.getAddress(), daiAmount);
        
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        
        const tx = await uniswapRouter.addLiquidity(
            await halomToken.getAddress(),
            MAINNET_ADDRESSES.DAI,
            hlmAmount,
            daiAmount,
            0,
            0,
            deployer.address,
            deadline
        );
        
        await tx.wait();
        console.log("  ✅ HLM/DAI pool created");
        
        const factory = new ethers.Contract(
            await uniswapRouter.factory(),
            ["function getPair(address tokenA, address tokenB) external view returns (address pair)"],
            deployer
        );
        
        const hlmDaiLp = await factory.getPair(await halomToken.getAddress(), MAINNET_ADDRESSES.DAI);
        MAINNET_ADDRESSES.HLM_DAI_LP = hlmDaiLp;
        console.log("  HLM/DAI LP address:", hlmDaiLp);
    }

    // Step 2: Configure LP Staking contract
    console.log("\n🔧 Configuring LP Staking contract...");
    
    // Set LP token addresses
    if (MAINNET_ADDRESSES.HLM_USDC_LP !== "0x0000000000000000000000000000000000000000") {
        await halomLPStaking.addLPToken(MAINNET_ADDRESSES.HLM_USDC_LP, "HLM-USDC LP");
        console.log("  ✅ HLM/USDC LP added to staking");
    }
    
    if (MAINNET_ADDRESSES.HLM_USDT_LP !== "0x0000000000000000000000000000000000000000") {
        await halomLPStaking.addLPToken(MAINNET_ADDRESSES.HLM_USDT_LP, "HLM-USDT LP");
        console.log("  ✅ HLM/USDT LP added to staking");
    }
    
    if (MAINNET_ADDRESSES.HLM_DAI_LP !== "0x0000000000000000000000000000000000000000") {
        await halomLPStaking.addLPToken(MAINNET_ADDRESSES.HLM_DAI_LP, "HLM-DAI LP");
        console.log("  ✅ HLM/DAI LP added to staking");
    }

    // Step 3: Fund reward pools
    console.log("\n💰 Funding reward pools...");
    
    const rewardAmount = ethers.parseEther("500000"); // 500K HLM for rewards
    
    // Fund staking rewards
    await halomToken.transfer(await halomStaking.getAddress(), rewardAmount);
    console.log("  ✅ Funded staking rewards:", ethers.formatEther(rewardAmount), "HLM");
    
    // Fund LP staking rewards
    await halomToken.transfer(await halomLPStaking.getAddress(), rewardAmount);
    console.log("  ✅ Funded LP staking rewards:", ethers.formatEther(rewardAmount), "HLM");

    // Step 4: Configure Treasury
    console.log("\n🏛️ Configuring Treasury...");
    
    await halomTreasury.updateAddresses(
        await halomStaking.getAddress(),    // staking rewards
        await halomLPStaking.getAddress(),  // LP staking rewards
        deployer.address                    // DAO reserve (temporary)
    );
    console.log("  ✅ Treasury addresses updated");

    // Step 5: Set up initial staking parameters
    console.log("\n⚙️ Setting up staking parameters...");
    
    // Set lock boost parameters
    await halomStaking.setLockBoostParams(3000, 365 * 24 * 60 * 60); // 30% max boost, 1 year max lock
    console.log("  ✅ Lock boost parameters set");
    
    // Set commission rates for validators (example)
    await halomStaking.setCommissionRate(1000); // 10% commission
    console.log("  ✅ Commission rate set");

    // Step 6: Verify setup
    console.log("\n🔍 Verifying setup...");
    
    const stakingBalance = await halomToken.balanceOf(await halomStaking.getAddress());
    const lpStakingBalance = await halomToken.balanceOf(await halomLPStaking.getAddress());
    
    console.log("  Staking contract balance:", ethers.formatEther(stakingBalance), "HLM");
    console.log("  LP Staking contract balance:", ethers.formatEther(lpStakingBalance), "HLM");
    
    const lpTokens = await halomLPStaking.getLPTokens();
    console.log("  LP tokens in staking:", lpTokens.length);

    // Save mainnet configuration
    const mainnetConfig = {
        addresses: MAINNET_ADDRESSES,
        setupTime: new Date().toISOString(),
        deployer: deployer.address,
        rewardsFunded: {
            staking: ethers.formatEther(rewardAmount),
            lpStaking: ethers.formatEther(rewardAmount)
        }
    };

    const fs = require('fs');
    fs.writeFileSync(
        'mainnet-config.json',
        JSON.stringify(mainnetConfig, null, 2)
    );

    console.log("\n🎉 Mainnet staking setup complete!");
    console.log("📄 Configuration saved to mainnet-config.json");
    console.log("\n📋 Next steps:");
    console.log("  1. Verify LP token addresses on Etherscan");
    console.log("  2. Test staking functionality");
    console.log("  3. Monitor reward distribution");
    console.log("  4. Set up monitoring and alerts");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Setup failed:", error);
        process.exit(1);
    }); 
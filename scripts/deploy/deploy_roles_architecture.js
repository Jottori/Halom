const { ethers } = require("hardhat");

/**
 * @title Halom Role-Based Architecture Deployment
 * @dev Deploys and configures the complete role-based access control system
 * for the Halom protocol with proper role assignments and hierarchy.
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying Halom Role-Based Architecture with account:", deployer.address);

    // ============ DEPLOY ROLES CONTRACT ============
    console.log("\n1. Deploying Roles Contract...");
    const Roles = await ethers.getContractFactory("Roles");
    const roles = await Roles.deploy();
    await roles.waitForDeployment();
    const rolesAddress = await roles.getAddress();
    console.log("Roles contract deployed to:", rolesAddress);

    // Initialize roles contract
    await roles.initialize(deployer.address);
    console.log("Roles contract initialized");

    // ============ DEPLOY TOKEN CONTRACT ============
    console.log("\n2. Deploying HalomToken Contract...");
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const token = await HalomToken.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("HalomToken contract deployed to:", tokenAddress);

    // Initialize token contract
    await token.initialize("Halom Token", "HALOM", deployer.address);
    console.log("HalomToken contract initialized");

    // ============ DEPLOY STAKING CONTRACT ============
    console.log("\n3. Deploying Staking Contract...");
    const Staking = await ethers.getContractFactory("Staking");
    const staking = await Staking.deploy();
    await staking.waitForDeployment();
    const stakingAddress = await staking.getAddress();
    console.log("Staking contract deployed to:", stakingAddress);

    // Initialize staking contract
    await staking.initialize(tokenAddress, deployer.address);
    console.log("Staking contract initialized");

    // ============ DEPLOY GOVERNANCE CONTRACT ============
    console.log("\n4. Deploying Governance Contract...");
    const Governance = await ethers.getContractFactory("Governance");
    const governance = await Governance.deploy();
    await governance.waitForDeployment();
    const governanceAddress = await governance.getAddress();
    console.log("Governance contract deployed to:", governanceAddress);

    // Initialize governance contract
    await governance.initialize(
        deployer.address,
        ethers.parseEther("1000000"), // 1M tokens quorum
        86400, // 1 day voting delay
        604800, // 7 days voting period
        ethers.parseEther("10000") // 10K tokens proposal threshold
    );
    console.log("Governance contract initialized");

    // ============ DEPLOY ORACLE CONTRACT ============
    console.log("\n5. Deploying Oracle Contract...");
    const Oracle = await ethers.getContractFactory("Oracle");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const oracleAddress = await oracle.getAddress();
    console.log("Oracle contract deployed to:", oracleAddress);

    // Initialize oracle contract
    await oracle.initialize(
        deployer.address,
        3, // Minimum 3 oracles
        3600, // 1 hour price validity
        300 // 5 minutes submission cooldown
    );
    console.log("Oracle contract initialized");

    // ============ DEPLOY BRIDGE CONTRACT ============
    console.log("\n6. Deploying Bridge Contract...");
    const Bridge = await ethers.getContractFactory("Bridge");
    const bridge = await Bridge.deploy();
    await bridge.waitForDeployment();
    const bridgeAddress = await bridge.getAddress();
    console.log("Bridge contract deployed to:", bridgeAddress);

    // Initialize bridge contract
    await bridge.initialize(
        tokenAddress,
        deployer.address,
        ethers.parseEther("100"), // 100 tokens min lock
        ethers.parseEther("1000000"), // 1M tokens max lock
        50 // 0.5% bridge fee
    );
    console.log("Bridge contract initialized");

    // ============ ROLE ASSIGNMENT ============
    console.log("\n7. Setting up Role Assignments...");

    // Get role constants
    const DEFAULT_ADMIN_ROLE = await roles.DEFAULT_ADMIN_ROLE();
    const UPGRADER_ROLE = await roles.UPGRADER_ROLE();
    const GOVERNOR_ROLE = await roles.GOVERNOR_ROLE();
    const EMERGENCY_ROLE = await roles.EMERGENCY_ROLE();
    const MINTER_ROLE = await roles.MINTER_ROLE();
    const PAUSER_ROLE = await roles.PAUSER_ROLE();
    const BLACKLIST_ROLE = await roles.BLACKLIST_ROLE();
    const BRIDGE_ROLE = await roles.BRIDGE_ROLE();
    const ORACLE_ROLE = await roles.ORACLE_ROLE();

    // Assign roles to deployer (initial admin)
    console.log("Assigning roles to deployer...");
    await roles.grantRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await roles.grantRole(UPGRADER_ROLE, deployer.address);
    await roles.grantRole(GOVERNOR_ROLE, deployer.address);
    await roles.grantRole(EMERGENCY_ROLE, deployer.address);
    await roles.grantRole(MINTER_ROLE, deployer.address);
    await roles.grantRole(PAUSER_ROLE, deployer.address);
    await roles.grantRole(BLACKLIST_ROLE, deployer.address);
    await roles.grantRole(BRIDGE_ROLE, deployer.address);
    await roles.grantRole(ORACLE_ROLE, deployer.address);

    // Assign bridge role to bridge contract
    console.log("Assigning bridge role to bridge contract...");
    await roles.grantRole(BRIDGE_ROLE, bridgeAddress);
    await roles.grantRole(MINTER_ROLE, bridgeAddress);

    // Assign oracle role to oracle contract (for future oracle addresses)
    console.log("Setting up oracle role management...");
    await roles.grantRole(ORACLE_ROLE, oracleAddress);

    // ============ CONTRACT CONFIGURATION ============
    console.log("\n8. Configuring Contract Parameters...");

    // Configure token parameters
    console.log("Configuring token parameters...");
    await token.setFeeParams(100, 500); // 1% fee, 5% max
    await token.setAntiWhaleParams(
        ethers.parseEther("1000"), // 1000 tokens max tx
        ethers.parseEther("10000"), // 10000 tokens max wallet
        300 // 5 minutes cooldown
    );

    // Configure staking parameters
    console.log("Configuring staking parameters...");
    await staking.setRewardRate(ethers.parseEther("0.001")); // 0.1% per second

    // Configure bridge parameters
    console.log("Configuring bridge parameters...");
    await bridge.setChainSupport(1, true); // Ethereum mainnet
    await bridge.setChainSupport(137, true); // Polygon
    await bridge.setChainSupport(56, true); // BSC

    // Configure oracle parameters
    console.log("Configuring oracle parameters...");
    await oracle.addOracle(deployer.address); // Add deployer as oracle

    // ============ VERIFICATION ============
    console.log("\n9. Verifying Role Assignments...");

    // Verify deployer roles
    const deployerRoles = await roles.getAccountRoles(deployer.address);
    console.log("Deployer roles:", deployerRoles.length);

    // Verify bridge roles
    const bridgeRoles = await roles.getAccountRoles(bridgeAddress);
    console.log("Bridge contract roles:", bridgeRoles.length);

    // Verify role hierarchy
    const governorHierarchy = await roles.getRoleHierarchy(GOVERNOR_ROLE);
    console.log("Governor role hierarchy:", governorHierarchy.length);

    // ============ DEPLOYMENT SUMMARY ============
    console.log("\n" + "=".repeat(60));
    console.log("🎉 HALOM ROLE-BASED ARCHITECTURE DEPLOYMENT COMPLETE");
    console.log("=".repeat(60));
    
    console.log("\n📋 Contract Addresses:");
    console.log(`Roles Contract: ${rolesAddress}`);
    console.log(`Token Contract: ${tokenAddress}`);
    console.log(`Staking Contract: ${stakingAddress}`);
    console.log(`Governance Contract: ${governanceAddress}`);
    console.log(`Oracle Contract: ${oracleAddress}`);
    console.log(`Bridge Contract: ${bridgeAddress}`);

    console.log("\n🔐 Role Assignments:");
    console.log(`Deployer (${deployer.address}):`);
    console.log("  - DEFAULT_ADMIN_ROLE");
    console.log("  - UPGRADER_ROLE");
    console.log("  - GOVERNOR_ROLE");
    console.log("  - EMERGENCY_ROLE");
    console.log("  - MINTER_ROLE");
    console.log("  - PAUSER_ROLE");
    console.log("  - BLACKLIST_ROLE");
    console.log("  - BRIDGE_ROLE");
    console.log("  - ORACLE_ROLE");

    console.log(`\nBridge Contract (${bridgeAddress}):`);
    console.log("  - BRIDGE_ROLE");
    console.log("  - MINTER_ROLE");

    console.log(`\nOracle Contract (${oracleAddress}):`);
    console.log("  - ORACLE_ROLE");

    console.log("\n⚙️ Initial Configuration:");
    console.log("- Token fee: 1% (max 5%)");
    console.log("- Anti-whale: 1000 tokens max tx, 10000 max wallet");
    console.log("- Staking reward rate: 0.1% per second");
    console.log("- Bridge fee: 0.5%");
    console.log("- Supported chains: Ethereum, Polygon, BSC");
    console.log("- Oracle minimum count: 3");

    console.log("\n🚀 Next Steps:");
    console.log("1. Verify contracts on block explorer");
    console.log("2. Set up additional oracle addresses");
    console.log("3. Configure governance parameters");
    console.log("4. Deploy to testnet for testing");
    console.log("5. Conduct security audit");

    // Save deployment info
    const deploymentInfo = {
        network: (await ethers.provider.getNetwork()).name,
        deployer: deployer.address,
        contracts: {
            roles: rolesAddress,
            token: tokenAddress,
            staking: stakingAddress,
            governance: governanceAddress,
            oracle: oracleAddress,
            bridge: bridgeAddress
        },
        roles: {
            DEFAULT_ADMIN_ROLE,
            UPGRADER_ROLE,
            GOVERNOR_ROLE,
            EMERGENCY_ROLE,
            MINTER_ROLE,
            PAUSER_ROLE,
            BLACKLIST_ROLE,
            BRIDGE_ROLE,
            ORACLE_ROLE
        },
        timestamp: new Date().toISOString()
    };

    console.log("\n💾 Deployment info saved to deployment-info.json");
    require('fs').writeFileSync(
        'deployment-info.json',
        JSON.stringify(deploymentInfo, null, 2)
    );

    return deploymentInfo;
}

// Execute deployment
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("Deployment failed:", error);
            process.exit(1);
        });
}

module.exports = { main }; 
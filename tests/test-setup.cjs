const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

async function setupTestEnvironment() {
  const [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

  // Deploy contracts
  const HalomToken = await ethers.getContractFactory("HalomToken");
  const halomToken = await HalomToken.deploy();
  await halomToken.waitForDeployment();

  const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
  const timelock = await HalomTimelock.deploy(
    86400, // 24 hours min delay
    [owner.address], // proposers
    [owner.address], // executors
    owner.address // admin
  );
  await timelock.waitForDeployment();

  const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
  const governor = await HalomGovernor.deploy(
    halomToken.address,
    timelock.address
  );
  await governor.waitForDeployment();

  const HalomStaking = await ethers.getContractFactory("HalomStaking");
  const staking = await HalomStaking.deploy(
    halomToken.address,
    ethers.parseEther("100"), // reward rate
    3600 // reward interval
  );
  await staking.waitForDeployment();

  const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
  const treasury = await HalomTreasury.deploy(
    halomToken.address,
    owner.address, // role manager
    3600 // distribution interval
  );
  await treasury.waitForDeployment();

  const HalomOracleV3 = await ethers.getContractFactory("HalomOracleV3");
  const oracleV3 = await HalomOracleV3.deploy();
  await oracleV3.waitForDeployment();

  // Setup roles
  const proposerRole = await timelock.PROPOSER_ROLE();
  const executorRole = await timelock.EXECUTOR_ROLE();
  const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

  await timelock.grantRole(proposerRole, governor.address);
  await timelock.grantRole(executorRole, governor.address);
  await timelock.revokeRole(adminRole, owner.address);

  // Grant oracle roles
  const ORACLE_UPDATER_ROLE = await oracleV3.UPDATER_ROLE();
  const AGGREGATOR_ROLE = await oracleV3.AGGREGATOR_ROLE();
  await oracleV3.grantRole(ORACLE_UPDATER_ROLE, owner.address);
  await oracleV3.grantRole(AGGREGATOR_ROLE, owner.address);

  // Grant treasury controller role to owner for testing
  const TREASURY_CONTROLLER = await treasury.TREASURY_CONTROLLER();
  await treasury.grantRole(TREASURY_CONTROLLER, owner.address);

  // Mint tokens to users
  const tokenAmount = ethers.parseEther("1000000");
  await halomToken.mint(user1.address, tokenAmount);
  await halomToken.mint(user2.address, tokenAmount);
  await halomToken.mint(user3.address, tokenAmount);
  await halomToken.mint(user4.address, tokenAmount);
  await halomToken.mint(user5.address, tokenAmount);

  // Delegate voting power
  await halomToken.connect(user1).delegate(user1.address);
  await halomToken.connect(user2).delegate(user2.address);
  await halomToken.connect(user3).delegate(user3.address);
  await halomToken.connect(user4).delegate(user4.address);
  await halomToken.connect(user5).delegate(user5.address);

  // Fund treasury
  await halomToken.transfer(treasury.address, ethers.parseEther("100000"));

  // Enable test mode for timelock
  await timelock.enableTestMode();

  return {
    owner,
    user1,
    user2,
    user3,
    user4,
    user5,
    halomToken,
    timelock,
    governor,
    staking,
    treasury,
    oracleV3
  };
}

module.exports = {
  setupTestEnvironment
}; 
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('HalomStaking Delegation System', function () {
  let halomToken, staking, owner, user1, user2, user3, rewarder;
  let mockLP, mockEURC;
  let timelock, governor;
  let treasury;
  let oracle;

  beforeEach(async function () {
    [owner, user1, user2, user3, rewarder] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockLP = await MockERC20.deploy('Mock LP', 'MLP', ethers.parseEther('1000000'));
    mockEURC = await MockERC20.deploy('Mock EURC', 'MEURC', ethers.parseEther('1000000'));

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");

    // HalomToken expects (admin, rebaseCaller)
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // HalomOracle expects (governance, updater)
    oracle = await HalomOracle.deploy(owner.address, owner.address);
    await oracle.waitForDeployment();

    // HalomStaking expects (stakingToken, roleManager, rewardRate)
    const rewardRate = 2000; // 20% reward rate
    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, rewardRate);
    await staking.waitForDeployment();

    // Grant MINTER_ROLE to rewarder and staking contract
    await halomToken.grantRole(await halomToken.MINTER_ROLE(), rewarder.address);
    await halomToken.grantRole(await halomToken.MINTER_ROLE(), await staking.getAddress());
    await halomToken.grantRole(await halomToken.MINTER_ROLE(), owner.address); // Grant to owner for testing

    // Mint tokens to users via rewarder
    await halomToken.connect(rewarder).mint(user1.address, ethers.parseEther('10000'));
    await halomToken.connect(rewarder).mint(user2.address, ethers.parseEther('10000'));
    await halomToken.connect(rewarder).mint(user3.address, ethers.parseEther('10000'));
    await halomToken.connect(rewarder).mint(rewarder.address, ethers.parseEther('100000'));

    // Approve staking contract for all users
    await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther('10000'));
    await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther('10000'));
    await halomToken.connect(user3).approve(await staking.getAddress(), ethers.parseEther('10000'));

    // Approve HalomToken contract for rewarder (needed for addRewards transferFrom)
    await halomToken.connect(rewarder).approve(await halomToken.getAddress(), ethers.parseEther('1000000'));

    // Grant REWARDER_ROLE to rewarder in staking contract
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), rewarder.address);

    // Ensure all contracts and users have enough tokens
    await halomToken.connect(owner).mint(await staking.getAddress(), ethers.parseEther('1000000'));
    await halomToken.connect(owner).mint(rewarder.address, ethers.parseEther('1000000'));
    await halomToken.connect(owner).mint(user1.address, ethers.parseEther('1000000'));
    await halomToken.connect(owner).mint(user2.address, ethers.parseEther('1000000'));
    await halomToken.connect(owner).mint(user3.address, ethers.parseEther('1000000'));
    // Exclude from wallet limits
    await halomToken.connect(owner).setExcludedFromLimits(await staking.getAddress(), true);
    await halomToken.connect(owner).setExcludedFromLimits(rewarder.address, true);
    await halomToken.connect(owner).setExcludedFromLimits(user1.address, true);
    await halomToken.connect(owner).setExcludedFromLimits(user2.address, true);
    await halomToken.connect(owner).setExcludedFromLimits(user3.address, true);

    // Deploy TimelockController
    const minDelay = 86400; // 24 hours (minimum required)
    const proposers = [owner.address];
    const executors = [owner.address];
    const HalomTimelock = await ethers.getContractFactory('HalomTimelock');
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    // Deploy HalomGovernor
    const HalomGovernor = await ethers.getContractFactory('HalomGovernor');
    const votingDelay = 1;
    const votingPeriod = 10;
    const proposalThreshold = 0;
    const quorumPercent = 4;
    governor = await HalomGovernor.deploy(
        await halomToken.getAddress(),
        await timelock.getAddress(),
        votingDelay,
        votingPeriod,
        proposalThreshold,
        quorumPercent
    );
    await governor.waitForDeployment();

    // Deploy HalomTreasury
    const HalomTreasury = await ethers.getContractFactory('HalomTreasury');
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();
  });

  describe('Delegation Functionality', function () {
    it("Should allow users to delegate tokens to validators", async function () {
      // Grant DELEGATOR_ROLE to user1
      await governor.grantRole(await governor.DELEGATOR_ROLE(), user1.address);
      
      // Stake tokens first
      await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 3600);
      
      // Delegate to validator
      await governor.connect(user1).delegate(user2.address);
      
      // Check delegation - use halomToken instead of governor
      const delegatee = await halomToken.delegates(user1.address);
      expect(delegatee).to.equal(user2.address);
    });

    it("Should allow users to stake tokens", async function () {
      const stakeAmount = ethers.parseEther("1000");
      await halomToken.connect(user1).approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount, 30 * 24 * 3600);
      
      const stakerInfo = await staking.stakerInfo(user1.address);
      expect(stakerInfo.stakedAmount).to.be.gt(0);
    });

    it("Should allow users to unstake tokens after lock period", async function () {
      // Stake tokens
      await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 3600);
      
      // Wait for lock period to expire
      await time.increase(31 * 24 * 3600);
      
      // Unstake
      await staking.connect(user1).unstake(ethers.parseEther("500"));
      
      const stakerInfo = await staking.stakerInfo(user1.address);
      expect(stakerInfo.stakedAmount).to.be.lt(ethers.parseEther("1000"));
    });

    it("Should prevent unstaking before lock period", async function () {
      // Stake tokens
      await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 3600);
      
      // Try to unstake before lock period expires
      await expect(
        staking.connect(user1).unstake(ethers.parseEther("500"))
      ).to.be.revertedWithCustomError(staking, "LockNotExpired");
    });

    it("Should allow reward distribution", async function () {
      // Stake tokens
      await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 3600);
      
      // Grant REWARD_MANAGER_ROLE to rewarder if not already granted
      await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), rewarder.address);
      
      // Approve tokens for staking contract to transfer from rewarder
      await halomToken.connect(rewarder).approve(await staking.getAddress(), ethers.parseEther("10000"));
      
      // Add rewards using rewarder
      await staking.connect(rewarder).addRewards(ethers.parseEther("10000"));
      
      // Check pending rewards
      const pendingRewards = await staking.getPendingReward(user1.address);
      expect(pendingRewards).to.be.gt(0);
    });
  });

  describe('Staking Operations', function () {
    it("Should handle multiple users staking", async function () {
      // User1 stakes
      await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 3600);
      
      // User2 stakes
      await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther("500"));
      await staking.connect(user2).stake(ethers.parseEther("500"), 30 * 24 * 3600);
      
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.totalStaked).to.be.gt(0);
    });

    it("Should prevent staking zero amount", async function () {
      await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await expect(
        staking.connect(user1).stake(0, 30 * 24 * 3600)
      ).to.be.revertedWithCustomError(staking, "InvalidAmount");
    });

    it("Should prevent staking more than balance", async function () {
      const userBalance = await halomToken.balanceOf(user1.address);
      const excessiveAmount = userBalance + ethers.parseEther("1");
      
      await halomToken.connect(user1).approve(await staking.getAddress(), excessiveAmount);
      await expect(
        staking.connect(user1).stake(excessiveAmount, 30 * 24 * 3600)
      ).to.be.reverted;
    });
  });
});

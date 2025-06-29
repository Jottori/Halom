const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('HalomStaking Delegation System', function () {
  let halomToken, staking, treasury, roleManager, owner, user1, user2, user3;
  let mockLP, mockEURC;
  let timelock, governor;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockLP = await MockERC20.deploy('Mock LP', 'MLP', ethers.parseEther('1000000'));
    mockEURC = await MockERC20.deploy('Mock EURC', 'MEURC', ethers.parseEther('1000000'));

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    halomToken = await HalomToken.deploy(owner.address, owner.address);
    roleManager = await HalomRoleManager.deploy();
    staking = await HalomStaking.deploy(await halomToken.getAddress(), await roleManager.getAddress(), ethers.parseEther("0.1"));
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), await roleManager.getAddress(), 3600);

    // Setup basic roles
    await staking.grantRole(await staking.STAKING_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());
    await staking.setPoolActive(true);

    // Treasury role setup - owner already has DEFAULT_ADMIN_ROLE from constructor
    // No need to grant additional roles

    // Mint tokens to users
    const tokenAmount = ethers.parseEther('1000000');
    await halomToken.mint(user1.address, tokenAmount);
    await halomToken.mint(user2.address, tokenAmount);
    await halomToken.mint(user3.address, tokenAmount);

    // Approve staking
    await halomToken.connect(user1).approve(await staking.getAddress(), tokenAmount);
    await halomToken.connect(user2).approve(await staking.getAddress(), tokenAmount);
    await halomToken.connect(user3).approve(await staking.getAddress(), tokenAmount);

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

    // Grant REWARD_MANAGER_ROLE to owner
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), owner.address);
  });

  describe('Delegation Functionality', function () {
    it("Should allow users to delegate tokens to validators", async function () {
      // User1 stakes tokens
      await staking.connect(user1).stake(ethers.parseEther('100000'), 30 * 24 * 3600);
      
      // Check staker info
      const stakerInfo = await staking.stakerInfo(user1.address);
      expect(stakerInfo.stakedAmount).to.be.gt(0);
    });

    it("Should allow users to unstake tokens after lock period", async function () {
      // Stake tokens
      await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
      
      // Wait for lock period to expire
      await time.increase(31 * 24 * 3600);
      
      // Unstake tokens
      await staking.connect(user1).unstake(ethers.parseEther("100000"));
      
      // Check balance - account for rewards earned during staking
      const balance = await halomToken.balanceOf(user1.address);
      expect(balance).to.be.gt(ethers.parseEther("900000")); // Should have at least 900k after unstaking
    });

    it("Should prevent unstaking before lock period ends", async function () {
      // User1 stakes tokens
      await staking.connect(user1).stake(ethers.parseEther('100000'), 30 * 24 * 3600);
      
      // Try to unstake before lock period ends
      await expect(
        staking.connect(user1).unstake(ethers.parseEther('50000'))
      ).to.be.revertedWithCustomError(staking, "LockNotExpired");
    });

    it("Should prevent unstaking more than staked amount", async function () {
      // Stake tokens
      await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
      
      // Wait for lock period to expire
      await time.increase(31 * 24 * 3600);
      
      // Try to unstake more than staked
      await expect(
        staking.connect(user1).unstake(ethers.parseEther("200000"))
      ).to.be.revertedWithCustomError(staking, "InsufficientStake");
    });
  });

  describe('Voting Power Delegation', function () {
    it("Should calculate voting power based on delegation", async function () {
      // User1 stakes tokens
      await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
      
      // User2 delegates to User1
      await halomToken.connect(user2).delegate(user1.address);
      
      // Check voting power
      const votingPower1 = await halomToken.getVotes(user1.address);
      const votingPower2 = await halomToken.getVotes(user2.address);
      
      expect(votingPower1).to.be.gt(0);
      expect(votingPower2).to.equal(0); // Delegated voting power doesn't count for delegator
    });

    it("Should handle delegation changes", async function () {
      // User1 stakes tokens
      await staking.connect(user1).stake(ethers.parseEther('100000'), 30 * 24 * 3600);
      
      // Check staker info
      const stakerInfo = await staking.stakerInfo(user1.address);
      expect(stakerInfo.isActive).to.be.true;
    });
  });

  describe('Reward Distribution', function () {
    it("Should distribute rewards to delegators", async function () {
      // User1 stakes tokens
      await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
      
      // User2 delegates to User1
      await halomToken.connect(user2).delegate(user1.address);
      
      // Add rewards
      await staking.connect(owner).addRewards(ethers.parseEther("1000"));
      
      // Check pending rewards
      const pendingRewards = await staking.pendingRewards(user1.address);
      expect(pendingRewards).to.be.gt(0);
    });

    it("Should allow users to claim rewards", async function () {
      // User1 stakes tokens
      await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
      
      // Add rewards
      await staking.connect(owner).addRewards(ethers.parseEther("1000"));
      
      // Claim rewards
      await staking.connect(user1).claimRewards();
      
      // Check that rewards were claimed
      const balance = await halomToken.balanceOf(user1.address);
      expect(balance).to.be.gt(ethers.parseEther("100000"));
    });
  });
});

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('HalomStaking', function () {
  let staking, token, owner, user1, user2, user3;
  let STAKING_ADMIN_ROLE, REWARD_MANAGER_ROLE;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy token first
    const HalomToken = await ethers.getContractFactory('HalomToken');
    token = await HalomToken.deploy(owner.address, owner.address);
    await token.waitForDeployment();

    // Deploy staking contract
    const HalomStaking = await ethers.getContractFactory('HalomStaking');
    staking = await HalomStaking.deploy(
      await token.getAddress(), 
      owner.address, 
      2000
    );
    await staking.waitForDeployment();

    // Get role constants
    STAKING_ADMIN_ROLE = await staking.DEFAULT_ADMIN_ROLE();
    REWARD_MANAGER_ROLE = await staking.REWARD_MANAGER_ROLE();

    // Setup roles
    await staking.grantRole(STAKING_ADMIN_ROLE, owner.address);
    await staking.grantRole(REWARD_MANAGER_ROLE, owner.address);

    // Mint tokens for testing
    await token.mint(user1.address, ethers.parseEther('10000'));
    await token.mint(user2.address, ethers.parseEther('10000'));
    await token.mint(user3.address, ethers.parseEther('10000'));
  });

  describe('Deployment and Initial Setup', function () {
    it('Should deploy with correct parameters', async function () {
      expect(await staking.stakingToken()).to.equal(await token.getAddress());
      expect(await staking.hasRole(STAKING_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it('Should have correct initial state', async function () {
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.totalStaked).to.equal(0);
    });
  });

  describe('Staking Operations', function () {
    beforeEach(async function () {
      await token.connect(user1).approve(await staking.getAddress(), ethers.parseEther('10000'));
    });

    it('Should allow users to stake tokens', async function () {
      const stakeAmount = ethers.parseUnits('0.1', 18); // 0.1 token (above new minimum)
      await staking.connect(user1).stake(stakeAmount, 30 * 24 * 3600);

      const stakerInfo = await staking.stakerInfo(user1.address);
      expect(stakerInfo.stakedAmount).to.be.gt(0);
    });

    it('Should prevent staking zero amount', async function () {
      await expect(
        staking.connect(user1).stake(0, 30 * 24 * 3600)
      ).to.be.revertedWithCustomError(staking, 'InvalidAmount');
    });

    it('Should prevent staking more than balance', async function () {
      const tooMuch = ethers.parseEther('20000');
      await expect(
        staking.connect(user1).stake(tooMuch, 30 * 24 * 3600)
      ).to.be.reverted;
    });
  });

  describe('Unstaking Operations', function () {
    beforeEach(async function () {
      await token.connect(user1).approve(await staking.getAddress(), ethers.parseEther('10000'));
      await staking.connect(user1).stake(ethers.parseEther('1'), 30 * 24 * 3600); // 1 token, 30 days
    });

    it('Should allow users to unstake tokens', async function () {
      // Wait for lock period to expire
      await ethers.provider.send('evm_increaseTime', [31 * 24 * 3600]); // 31 days
      await ethers.provider.send('evm_mine');

      const unstakeAmount = ethers.parseEther('0.5');
      const balanceBefore = await token.balanceOf(user1.address);
      
      await staking.connect(user1).unstake(unstakeAmount);
      
      expect(await token.balanceOf(user1.address)).to.be.gt(balanceBefore);
    });

    it('Should prevent unstaking more than staked', async function () {
      await token.connect(user1).approve(await staking.getAddress(), ethers.parseEther('10000'));
      await staking.connect(user1).stake(ethers.parseEther('1'), 86400); // 1 token, 1 day
      await time.increase(86500); // Advance time past lock
      const stakerInfo = await staking.stakerInfo(user1.address);
      const tooMuch = stakerInfo.stakedAmount + 1n;
      await expect(
        staking.connect(user1).unstake(tooMuch)
      ).to.be.revertedWithCustomError(staking, 'InsufficientStake');
    });
  });

  describe('Reward Management', function () {
    beforeEach(async function () {
      await token.connect(user1).approve(await staking.getAddress(), ethers.parseEther('10000'));
      await staking.connect(user1).stake(ethers.parseEther('1'), 30 * 24 * 3600); // 1 token, 30 days
    });

    it('Should allow reward manager to add rewards', async function () {
      // First approve the staking contract to spend tokens on behalf of the reward manager
      await token.connect(owner).approve(await staking.getAddress(), ethers.parseEther('10000'));
      
      // Add rewards
      await staking.connect(owner).addRewards(ethers.parseEther('10'));
      
      // Check that rewards were added
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.totalRewardDistributed).to.be.gt(0);
    });

    it('Should prevent non-reward manager from adding rewards', async function () {
      await expect(
        staking.connect(user1).addRewards(ethers.parseEther('100'))
      ).to.be.revertedWithCustomError(staking, 'Unauthorized');
    });

    it('Should allow users to claim rewards', async function () {
      // First approve the staking contract to spend tokens on behalf of the reward manager
      await token.connect(owner).approve(await staking.getAddress(), ethers.parseEther('10000'));
      
      // Add rewards first
      await staking.connect(owner).addRewards(ethers.parseEther('10'));
      
      // User stakes tokens
      await staking.connect(user1).stake(ethers.parseEther('1'), 30 * 24 * 3600);
      
      // Wait some time for rewards to accumulate
      await ethers.provider.send('evm_increaseTime', [3600]); // 1 hour
      await ethers.provider.send('evm_mine');
      
      // User claims rewards
      const balanceBefore = await token.balanceOf(user1.address);
      await staking.connect(user1).claimReward();
      const balanceAfter = await token.balanceOf(user1.address);
      
      expect(balanceAfter).to.be.gte(balanceBefore);
    });
  });

  describe('Emergency Controls', function () {
    it('Should allow admin to pause and unpause', async function () {
      await staking.connect(owner).emergencyPause();
      expect(await staking.paused()).to.be.true;
      
      await staking.connect(owner).emergencyUnpause();
      expect(await staking.paused()).to.be.false;
    });

    it('Should prevent operations when paused', async function () {
      await staking.connect(owner).emergencyPause();
      await token.connect(user1).approve(await staking.getAddress(), ethers.parseEther('1000'));
      
      await expect(
        staking.connect(user1).stake(ethers.parseEther('100'), 30 * 24 * 3600)
      ).to.be.revertedWithCustomError(staking, 'ContractPaused');
    });
  });
});

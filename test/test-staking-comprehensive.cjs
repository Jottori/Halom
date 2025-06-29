const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomStaking Comprehensive Tests", function () {
  let halomToken, staking, oracle, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5, admin, rewardManager, slasher;
  let oneDay = 86400;
  let oneWeek = 604800;
  let oneMonth = 2592000;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5, admin, rewardManager, slasher] = await ethers.getSigners();

    // Deploy contracts in correct order
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    // Deploy HalomToken first with correct parameters
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // Deploy other contracts
    oracle = await HalomOracle.deploy(owner.address, 31337);
    await oracle.waitForDeployment();
    
    roleManager = await HalomRoleManager.deploy();
    await roleManager.waitForDeployment();
    
    treasury = await HalomTreasury.deploy(
      await halomToken.getAddress(),
      await roleManager.getAddress(),
      86400 // 1 napos intervallum
    );
    await treasury.waitForDeployment();
    
    staking = await HalomStaking.deploy(
      await halomToken.getAddress(),
      await roleManager.getAddress(),
      2000 // rewardRate: 20% per second
    );
    await staking.waitForDeployment();

    // Setup roles using halomToken (owner already has all roles from constructor)
    await halomToken.connect(owner).grantRole(await halomToken.REBASER_ROLE(), await oracle.getAddress());
    await halomToken.connect(owner).grantRole(await halomToken.MINTER_ROLE(), await staking.getAddress());
    await halomToken.connect(owner).grantRole(await halomToken.MINTER_ROLE(), await treasury.getAddress());

    // Grant roles through staking contract using owner as signer (owner already has DEFAULT_ADMIN_ROLE)
    await staking.connect(owner).grantRole(await staking.STAKING_ADMIN_ROLE(), admin.address);
    await staking.connect(owner).grantRole(await staking.REWARD_MANAGER_ROLE(), rewardManager.address);
    await staking.connect(owner).grantRole(await staking.SLASHER_ROLE(), slasher.address);
    await staking.connect(owner).grantRole(await staking.EMERGENCY_ROLE(), admin.address);

    // Mint tokens to users
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));
    await halomToken.mint(rewardManager.address, ethers.parseEther("1000000"));

    // Approve staking contract
    await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await halomToken.connect(user3).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await halomToken.connect(user4).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await halomToken.connect(user5).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await halomToken.connect(rewardManager).approve(await staking.getAddress(), ethers.parseEther("1000000"));
  });

  describe("Basic Staking Functionality", function () {
    it("Should allow users to stake tokens", async function () {
      const stakeAmount = ethers.parseEther("10000");
      const lockDuration = oneWeek;

      await staking.connect(user1).stake(stakeAmount, lockDuration);

      const stakerInfo = await staking.stakerInfo(user1.address);
      // With 7 days lock (1 week), the boost should be around 1.5x to 2x
      // The exact calculation depends on the GovernanceMath.calculateLockBoost function
      expect(stakerInfo.stakedAmount).to.be.gt(stakeAmount);
      expect(stakerInfo.lockEndTime).to.be.gt(0);
      expect(stakerInfo.isActive).to.be.true;
    });

    it("Should prevent staking zero tokens", async function () {
      await expect(
        staking.connect(user1).stake(0, oneWeek)
      ).to.be.revertedWithCustomError(staking, "InvalidAmount");
    });

    it("Should prevent staking with zero lock duration", async function () {
      await expect(
        staking.connect(user1).stake(ethers.parseEther("1000"), 0)
      ).to.be.revertedWithCustomError(staking, "InvalidLockDuration");
    });

    it("Should prevent staking when pool is inactive", async function () {
      await staking.connect(admin).setPoolActive(false);
      
      await expect(
        staking.connect(user1).stake(ethers.parseEther("1000"), oneWeek)
      ).to.be.revertedWithCustomError(staking, "PoolNotActive");
    });

    it("Should prevent staking when contract is paused", async function () {
      await staking.connect(admin).emergencyPause();
      
      await expect(
        staking.connect(user1).stake(ethers.parseEther("1000"), oneWeek)
      ).to.be.revertedWithCustomError(staking, "ContractPaused");
    });
  });

  describe("Unstaking Functionality", function () {
    beforeEach(async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
    });

    it("Should allow unstaking after lock period", async function () {
      await time.increase(oneWeek + 1);
      
      const stakedAmount = await staking.stakedBalance(user1.address);
      const initialBalance = await halomToken.balanceOf(user1.address);
      await staking.connect(user1).unstake(stakedAmount);
      
      const finalBalance = await halomToken.balanceOf(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should prevent unstaking before lock period ends", async function () {
      // Wait for half the lock period to ensure lock is still active
      await time.increase(oneWeek / 2);
      
      const stakedAmount = await staking.stakedBalance(user1.address);
      await expect(
        staking.connect(user1).unstake(stakedAmount)
      ).to.be.revertedWithCustomError(staking, "LockNotExpired");
    });

    it("Should prevent unstaking when not staked", async function () {
      await expect(
        staking.connect(user2).unstake(ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(staking, "InsufficientStake");
    });

    it("Should prevent unstaking when contract is paused", async function () {
      await time.increase(oneWeek + 1);
      await staking.connect(admin).emergencyPause();
      
      const stakedAmount = await staking.stakedBalance(user1.address);
      await expect(
        staking.connect(user1).unstake(stakedAmount)
      ).to.be.revertedWithCustomError(staking, "ContractPaused");
    });
  });

  describe("Reward System", function () {
    beforeEach(async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
      await staking.connect(user2).stake(ethers.parseEther("20000"), oneWeek);
      await staking.connect(user3).stake(ethers.parseEther("15000"), oneWeek);
    });

    it("Should calculate pending rewards correctly", async function () {
      await time.increase(oneDay);
      
      const pendingReward = await staking.getPendingReward(user1.address);
      expect(pendingReward).to.be.gt(0);
    });

    it("Should allow users to claim rewards", async function () {
      await time.increase(oneDay);
      
      const initialBalance = await halomToken.balanceOf(user1.address);
      await staking.connect(user1).claimReward();
      
      const finalBalance = await halomToken.balanceOf(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should prevent claiming rewards when not staked", async function () {
      await expect(
        staking.connect(user4).claimReward()
      ).to.be.revertedWithCustomError(staking, "NoRewardsToClaim");
    });

    it("Should allow reward manager to add rewards", async function () {
      const rewardAmount = ethers.parseEther("50000");
      await halomToken.mint(await staking.getAddress(), rewardAmount);
      
      await staking.connect(rewardManager).addRewards(rewardAmount);
      
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.totalRewardDistributed).to.be.gt(0);
    });

    it("Should prevent non-reward manager from adding rewards", async function () {
      await expect(
        staking.connect(user1).addRewards(ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(staking, "Unauthorized");
    });

    it("Should allow compound rewards", async function () {
      await time.increase(oneDay);
      
      const initialStaked = (await staking.stakerInfo(user1.address)).stakedAmount;
      await staking.connect(user1).compound();
      
      const finalStaked = (await staking.stakerInfo(user1.address)).stakedAmount;
      expect(finalStaked).to.be.gt(initialStaked);
    });
  });

  describe("Slashing Mechanism", function () {
    beforeEach(async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
    });

    it("Should allow slasher to slash users", async function () {
      const slashAmount = ethers.parseEther("1000");
      const initialStaked = await staking.stakedBalance(user1.address);
      
      await staking.connect(slasher).slash(user1.address, slashAmount, "Test slash");
      
      const finalStaked = await staking.stakedBalance(user1.address);
      expect(finalStaked).to.be.lt(initialStaked);
    });

    it("Should prevent non-slasher from slashing", async function () {
      const slashAmount = ethers.parseEther("1000");
      
      await expect(
        staking.connect(user2).slash(user1.address, slashAmount, "Test slash")
      ).to.be.revertedWithCustomError(staking, "Unauthorized");
    });

    it("Should prevent slashing more than staked amount", async function () {
      const stakedAmount = await staking.stakedBalance(user1.address);
      const excessiveSlashAmount = stakedAmount + ethers.parseEther("1000");
      
      // Should not revert, but slash only the available amount
      await staking.connect(slasher).slash(user1.address, excessiveSlashAmount, "Test slash");
      expect(await staking.stakedBalance(user1.address)).to.equal(0);
    });
  });

  describe("Emergency Controls", function () {
    it("Should allow emergency role to pause contract", async function () {
      await staking.connect(admin).emergencyPause();
      expect(await staking.paused()).to.be.true;
    });

    it("Should allow emergency role to unpause contract", async function () {
      await staking.connect(admin).emergencyPause();
      await staking.connect(admin).emergencyUnpause();
      expect(await staking.paused()).to.be.false;
    });

    it("Should prevent non-emergency role from pausing", async function () {
      await expect(
        staking.connect(user1).emergencyPause()
      ).to.be.revertedWithCustomError(staking, "Unauthorized");
    });

    it("Should prevent non-emergency role from unpausing", async function () {
      await staking.connect(admin).emergencyPause();
      await expect(
        staking.connect(user1).emergencyUnpause()
      ).to.be.revertedWithCustomError(staking, "Unauthorized");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set reward rate", async function () {
      const newRate = 3000; // 30% per second
      await staking.connect(rewardManager).setRewardRate(newRate);
      
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.rewardPerSecond).to.equal(newRate);
    });

    it("Should prevent non-admin from setting reward rate", async function () {
      const newRate = 3000;
      await expect(
        staking.connect(user1).setRewardRate(newRate)
      ).to.be.revertedWithCustomError(staking, "Unauthorized");
    });

    it("Should allow admin to set pool active status", async function () {
      await staking.connect(admin).setPoolActive(false);
      
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.isActive).to.be.false;
    });

    it("Should prevent non-admin from setting pool active status", async function () {
      await expect(
        staking.connect(user1).setPoolActive(false)
      ).to.be.revertedWithCustomError(staking, "Unauthorized");
    });
  });

  describe("Edge Cases and Stress Tests", function () {
    it("Should handle multiple users staking simultaneously", async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
      await staking.connect(user2).stake(ethers.parseEther("20000"), oneWeek);
      await staking.connect(user3).stake(ethers.parseEther("15000"), oneWeek);

      const totalStaked = await staking.poolInfo();
      expect(totalStaked.totalStaked).to.be.gt(0);
    });

    it("Should handle large stake amounts", async function () {
      const largeAmount = ethers.parseEther("1000000");
      await halomToken.mint(user1.address, largeAmount);
      await halomToken.connect(user1).approve(await staking.getAddress(), largeAmount);
      
      await staking.connect(user1).stake(largeAmount, oneWeek);
      
      const stakedAmount = await staking.stakedBalance(user1.address);
      expect(stakedAmount).to.be.gt(0);
    });

    it("Should handle long lock durations", async function () {
      const longLockDuration = 365n * 24n * 3600n; // 1 year
      await staking.connect(user1).stake(ethers.parseEther("10000"), longLockDuration);
      
      const stakedAmount = await staking.stakedBalance(user1.address);
      expect(stakedAmount).to.be.gt(0);
    });

    it("Should handle reward distribution with multiple users", async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
      await staking.connect(user2).stake(ethers.parseEther("20000"), oneWeek);
      
      // Add rewards
      const rewardAmount = ethers.parseEther("50000");
      await halomToken.mint(await staking.getAddress(), rewardAmount);
      await staking.connect(rewardManager).addRewards(rewardAmount);
      
      // Fast forward time
      await time.increase(oneDay);
      
      // Both users should have pending rewards
      const user1Rewards = await staking.getPendingReward(user1.address);
      const user2Rewards = await staking.getPendingReward(user2.address);
      
      expect(user1Rewards).to.be.gt(0);
      expect(user2Rewards).to.be.gt(0);
    });
  });

  describe("Integration Tests", function () {
    it("Should integrate with token contract correctly", async function () {
      const balanceBefore = await halomToken.balanceOf(user1.address);
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
      const balanceAfter = await halomToken.balanceOf(user1.address);
      
      expect(balanceAfter).to.equal(balanceBefore - ethers.parseEther("10000"));
    });

    it("Should handle token transfers correctly", async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
      
      // Verify staking contract has the tokens
      const stakingBalance = await halomToken.balanceOf(await staking.getAddress());
      expect(stakingBalance).to.be.gte(ethers.parseEther("10000"));
    });

    it("Should work with oracle integration", async function () {
      // Test oracle view function (currently returns address(0))
      const oracleAddress = await staking.oracle();
      expect(oracleAddress).to.equal(ethers.ZeroAddress);
    });

    it("Should work with treasury integration", async function () {
      // Test treasury view function (currently returns address(0))
      const treasuryAddress = await staking.treasury();
      expect(treasuryAddress).to.equal(ethers.ZeroAddress);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"), oneWeek);
    });

    it("Should return correct staker info", async function () {
      const stakerInfo = await staking.stakerInfo(user1.address);
      expect(stakerInfo.stakedAmount).to.be.gt(0);
      expect(stakerInfo.isActive).to.be.true;
    });

    it("Should return correct pool info", async function () {
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.totalStaked).to.be.gt(0);
      expect(poolInfo.isActive).to.be.true;
    });

    it("Should return correct staked balance", async function () {
      const stakedBalance = await staking.stakedBalance(user1.address);
      expect(stakedBalance).to.be.gt(0);
    });

    it("Should return zero for non-stakers", async function () {
      const stakedBalance = await staking.stakedBalance(user4.address);
      expect(stakedBalance).to.equal(0);
    });
  });
}); 
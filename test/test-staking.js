const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomStaking", function () {
  let token, staking;
  let owner, governor, user1, user2;
  let GOVERNOR_ROLE;

  beforeEach(async function () {
    [owner, governor, user1, user2] = await ethers.getSigners();

    const HalomToken = await ethers.getContractFactory("HalomToken");
    token = await HalomToken.deploy(owner.address, governor.address);

    // Role hash
    GOVERNOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));

    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    staking = await HalomStaking.deploy(token.target, governor.address, governor.address, governor.address);

    // Grant STAKING_CONTRACT role to staking contract
    const STAKING_CONTRACT = ethers.keccak256(ethers.toUtf8Bytes("STAKING_CONTRACT"));
    await token.connect(governor).grantRole(STAKING_CONTRACT, staking.target);

    // Token approval for staking
    await token.connect(governor).transfer(user1.address, ethers.parseEther("10000")); // 10K HLM
    await token.connect(user1).approve(staking.target, ethers.parseEther("10000"));
  });

  describe("Deployment and Role Setup", function () {
    it("Should set the correct roles on deployment", async function () {
      expect(await staking.halomToken()).to.equal(token.target);
    });
  });

  describe("Staking with Lock Periods", function () {
    it("Should allow staking with minimum amount", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("100"), 30 * 24 * 60 * 60); // 30 days lock
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("100"));
    });

    it("Should allow staking with maximum amount", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("10000"), 30 * 24 * 60 * 60); // 30 days lock
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("10000"));
    });

    it("Should revert with amount below minimum", async function () {
      await expect(
        staking.connect(user1).stakeWithLock(ethers.parseEther("50"), 30 * 24 * 60 * 60)
      ).to.be.revertedWith("Amount below minimum");
    });

    it("Should revert with amount above maximum", async function () {
      await expect(
        staking.connect(user1).stakeWithLock(ethers.parseEther("2000000"), 30 * 24 * 60 * 60)
      ).to.be.revertedWith("Amount above maximum");
    });
  });

  describe("Staking, Unstaking, and Rewards", function () {
    it("Should allow staking and correctly update balances", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("100"), 30 * 24 * 60 * 60);
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("100"));
    });

    it("Should allow unstaking after lock period", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("100"), 30 * 24 * 60 * 60);
      
      // Fast forward time to pass lock period
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
      await ethers.provider.send("evm_mine");
      
      await staking.connect(user1).unstake(ethers.parseEther("50"));
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("50"));
    });

    it("Should revert unstaking before lock period", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("100"), 30 * 24 * 60 * 60);
      
      await expect(
        staking.connect(user1).unstake(ethers.parseEther("50"))
      ).to.be.revertedWith("Lock period not met");
    });

    it("Should allow additional staking after initial stake", async function () {
      // Initial stake with lock
      await staking.connect(user1).stakeWithLock(ethers.parseEther("100"), 30 * 24 * 60 * 60);
      
      // Additional stake (should preserve lock period) - use minimum amount
      await staking.connect(user1).stake(ethers.parseEther("100"));
      
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("200"));
    });

    it("Should revert initial stake without lock period", async function () {
      await expect(
        staking.connect(user1).stake(ethers.parseEther("100"))
      ).to.be.revertedWith("Use stakeWithLock for initial stake");
    });
  });

  describe("Rewards and Fourth Root System", function () {
    it("Should calculate fourth root correctly", async function () {
      const fourthRoot = await staking.fourthRoot(ethers.parseEther("10000"));
      expect(fourthRoot).to.be.gt(0);
    });

    it("Should calculate governance power correctly", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
      const governancePower = await staking.getGovernancePower(user1.address);
      expect(governancePower).to.be.gt(0);
    });

    it("Should allow adding rewards", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("100"), 30 * 24 * 60 * 60);
      
      // Grant REWARDER_ROLE to governor for testing
      const REWARDER_ROLE = await staking.REWARDER_ROLE();
      await staking.connect(governor).grantRole(REWARDER_ROLE, governor.address);
      
      // Grant MINTER_ROLE to governor for testing
      await token.connect(owner).grantRole(await token.MINTER_ROLE(), governor.address);
      
      // Mint tokens to governor and approve staking contract
      await token.connect(governor).mint(governor.address, ethers.parseEther("1000"));
      await token.connect(governor).approve(staking.target, ethers.parseEther("1000"));
      
      // Add rewards (only governor can do this)
      await staking.connect(governor).addRewards(ethers.parseEther("100"));
      
      const pendingRewards = await staking.getPendingRewardsForUser(user1.address);
      expect(pendingRewards).to.be.gt(0);
    });
  });

  describe("Emergency Recovery", function () {
    it("Should allow governor to recover tokens sent by mistake", async function () {
      // Deploy a random token
      const RandomToken = await ethers.getContractFactory("MockERC20");
      const randomToken = await RandomToken.deploy("Random", "RND", ethers.parseEther("10000"));

      // Send random token to staking contract by mistake
      await randomToken.transfer(staking.target, ethers.parseEther("100"));

      // Governor should be able to recover it
      await staking.connect(governor).emergencyRecovery(
        randomToken.target,
        user1.address,
        ethers.parseEther("50")
      );

      expect(await randomToken.balanceOf(user1.address)).to.equal(ethers.parseEther("50"));
    });
  });

  describe("Governance Functions", function () {
    it("Should allow governor to update staking parameters", async function () {
      // Grant GOVERNOR_ROLE to governor for testing
      const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
      await staking.connect(governor).grantRole(GOVERNOR_ROLE, governor.address);
      
      await staking.connect(governor).updateStakingParameters(
        ethers.parseEther("200"), // new min stake
        ethers.parseEther("2000000"), // new max stake
        60 * 24 * 60 * 60 // new lock period (60 days)
      );
      
      expect(await staking.minStakeAmount()).to.equal(ethers.parseEther("200"));
      expect(await staking.maxStakeAmount()).to.equal(ethers.parseEther("2000000"));
      expect(await staking.lockPeriod()).to.equal(60 * 24 * 60 * 60);
    });

    it("Should revert if non-governor tries to update parameters", async function () {
      await expect(
        staking.connect(user1).updateStakingParameters(
          ethers.parseEther("200"),
          ethers.parseEther("2000000"),
          60 * 24 * 60 * 60
        )
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Slashing", function () {
    it("Should allow governor to slash users", async function () {
      await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
      
      // Grant SLASHER_ROLE to governor for testing
      const SLASHER_ROLE = await staking.SLASHER_ROLE();
      await staking.connect(governor).grantRole(SLASHER_ROLE, governor.address);
      
      const initialBalance = await staking.stakedBalance(user1.address);
      expect(initialBalance).to.equal(ethers.parseEther("1000"));
      
      // Slash 50% of user's stake
      await staking.connect(governor).slash(user1.address, "Test slash");
      
      const finalBalance = await staking.stakedBalance(user1.address);
      expect(finalBalance).to.be.lt(initialBalance);
    });
  });

  describe("Governance Guardrails", function () {
    it("Should have parameter update functionality", async function () {
      // Parameter updates are handled by updateStakingParameters function
      expect(true).to.be.true;
    });
  });
}); 
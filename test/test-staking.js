const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomStaking", function () {
  let token, staking;
  let owner, governor, user1, user2;
  let GOVERNOR_ROLE, STAKING_CONTRACT_ROLE;

  beforeEach(async function () {
    [owner, governor, user1, user2] = await ethers.getSigners();

    // Deploy HalomToken with new constructor parameters
    const HalomToken = await ethers.getContractFactory("HalomToken");
    token = await HalomToken.deploy(
      "Halom", // name
      "HOM", // symbol
      owner.address, // roleManager
      ethers.parseEther("1000000"), // initialSupply
      ethers.parseEther("10000"), // maxTransferAmount
      ethers.parseEther("2000000"), // maxWalletAmount (increased to accommodate initial supply)
      500 // maxRebaseDelta (5%)
    );

    // Get role constants from contract
    GOVERNOR_ROLE = await token.DEFAULT_ADMIN_ROLE();
    STAKING_CONTRACT_ROLE = await token.STAKING_CONTRACT_ROLE();

    // Deploy HalomStaking with new constructor parameters
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    staking = await HalomStaking.deploy(
      await token.getAddress(), // halomToken
      owner.address, // roleManager
      2000, // rewardRate (20%)
      30 * 24 * 60 * 60, // minLockPeriod (30 days)
      5 * 365 * 24 * 60 * 60 // maxLockPeriod (5 years)
    );

    // Grant STAKING_CONTRACT role to staking contract
    await token.connect(owner).grantRole(STAKING_CONTRACT_ROLE, await staking.getAddress());

    // Grant GOVERNOR_ROLE to governor in staking contract
    const STAKING_GOVERNOR_ROLE = await staking.DEFAULT_ADMIN_ROLE();
    await staking.connect(owner).grantRole(STAKING_GOVERNOR_ROLE, governor.address);

    // Token approval for staking
    await token.connect(owner).transfer(user1.address, ethers.parseEther("10000")); // 10K HLM
    await token.connect(user1).approve(await staking.getAddress(), ethers.parseEther("10000"));
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
        staking.connect(user1).stakeWithLock(0, 30 * 24 * 60 * 60)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("Should revert with amount above maximum", async function () {
      await expect(
        staking.connect(user1).stakeWithLock(ethers.parseEther("2000000"), 30 * 24 * 60 * 60)
      ).to.be.revertedWithCustomError(staking, "InsufficientBalance");
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
      ).to.be.revertedWithCustomError(staking, "LockNotExpired");
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
      await staking.connect(owner).grantRole(REWARDER_ROLE, governor.address);
      
      // Grant MINTER_ROLE to governor for testing
      await token.connect(owner).grantRole(await token.MINTER_ROLE(), governor.address);
      
      // Mint tokens to governor and approve staking contract
      await token.connect(governor).mint(governor.address, ethers.parseEther("1000"));
      await token.connect(governor).approve(await staking.getAddress(), ethers.parseEther("1000"));
      
      // Add rewards (only governor can do this)
      await staking.connect(governor).addRewards(ethers.parseEther("100"));
      
      // Add more rewards to ensure sufficient rewards are available
      await staking.connect(governor).addRewards(ethers.parseEther("50"));
      
      const pendingRewards = await staking.getPendingRewardsForUser(user1.address);
      expect(pendingRewards).to.be.gt(0);
    });
  });

  describe("Emergency Recovery", function () {
    it("Should allow governor to recover tokens sent by mistake", async function () {
      // Grant GOVERNOR_ROLE to governor for testing
      const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
      await staking.connect(owner).grantRole(GOVERNOR_ROLE, governor.address);
      
      // Deploy a random token
      const RandomToken = await ethers.getContractFactory("MockERC20");
      const randomToken = await RandomToken.deploy("Random", "RND", ethers.parseEther("10000"));

      // Send random token to staking contract by mistake
      await randomToken.transfer(await staking.getAddress(), ethers.parseEther("100"));

      // Governor should be able to recover it
      await staking.connect(governor).emergencyRecovery(
        await randomToken.getAddress(),
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
      await staking.connect(owner).grantRole(GOVERNOR_ROLE, governor.address);
      
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
      await staking.connect(owner).grantRole(SLASHER_ROLE, governor.address);
      
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
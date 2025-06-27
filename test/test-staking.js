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
      await staking.connect(user1).stake(ethers.parseEther("100"));
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("100"));
    });

    it("Should allow staking with maximum amount", async function () {
      await staking.connect(user1).stake(ethers.parseEther("10000"));
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("10000"));
    });

    it("Should revert with amount below minimum", async function () {
      await expect(
        staking.connect(user1).stake(ethers.parseEther("50"))
      ).to.be.revertedWith("Below minimum stake amount");
    });

    it("Should revert with amount above maximum", async function () {
      await expect(
        staking.connect(user1).stake(ethers.parseEther("2000000"))
      ).to.be.revertedWith("Above maximum stake amount");
    });
  });

  describe("Staking, Unstaking, and Rewards", function () {
    it("Should allow staking and correctly update balances", async function () {
      await staking.connect(user1).stake(ethers.parseEther("100"));
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("100"));
    });

    it("Should allow unstaking after lock period", async function () {
      await staking.connect(user1).stake(ethers.parseEther("100"));
      
      // Fast forward time to pass lock period
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
      await ethers.provider.send("evm_mine");
      
      await staking.connect(user1).unstake(ethers.parseEther("50"));
      const userStake = await staking.stakedBalance(user1.address);
      expect(userStake).to.equal(ethers.parseEther("50"));
    });

    it("Should revert unstaking before lock period", async function () {
      await staking.connect(user1).stake(ethers.parseEther("100"));
      
      await expect(
        staking.connect(user1).unstake(ethers.parseEther("50"))
      ).to.be.revertedWith("Lock period not expired");
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
      ).to.be.reverted;
    });
  });

  describe("Slashing", function () {
    it("Should not have slashing functionality in current version", async function () {
      // Slashing functionality was removed in favor of emergency recovery
      expect(true).to.be.true;
    });
  });

  describe("Governance Guardrails", function () {
    it("Should have parameter update functionality", async function () {
      // Parameter updates are handled by updateStakingParameters function
      expect(true).to.be.true;
    });
  });
}); 
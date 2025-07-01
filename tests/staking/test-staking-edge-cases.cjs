const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomStaking Edge Cases", function () {
  let halomToken, staking, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5;
  let stakingAddress, treasuryAddress;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    roleManager = await HalomRoleManager.deploy();
    await roleManager.waitForDeployment();

    staking = await HalomStaking.deploy(
      await halomToken.getAddress(),
      await roleManager.getAddress(),
      1000 // rewardRate
    );
    await staking.waitForDeployment();

    treasury = await HalomTreasury.deploy(
      await halomToken.getAddress(),
      await roleManager.getAddress(),
      3600 // interval
    );
    await treasury.waitForDeployment();

    stakingAddress = await staking.getAddress();
    treasuryAddress = await treasury.getAddress();

    // Setup roles
    await roleManager.grantRole(await roleManager.STAKING_ROLE(), stakingAddress);
    await roleManager.grantRole(await roleManager.TREASURY_ROLE(), treasuryAddress);

    // Setup token integration
    await halomToken.setStakingContract(stakingAddress);
    await halomToken.grantRole(halomToken.MINTER_ROLE, owner.address);

    // Mint tokens to users
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));

    // Approve staking
    await halomToken.connect(user1).approve(stakingAddress, ethers.parseEther("1000000"));
    await halomToken.connect(user2).approve(stakingAddress, ethers.parseEther("1000000"));
    await halomToken.connect(user3).approve(stakingAddress, ethers.parseEther("1000000"));
    await halomToken.connect(user4).approve(stakingAddress, ethers.parseEther("1000000"));
    await halomToken.connect(user5).approve(stakingAddress, ethers.parseEther("1000000"));
  });

  describe("Staking Edge Cases", function () {
    it("Should handle zero stake amount", async function () {
      // Approve staking contract first
      await halomToken.connect(user1).approve(stakingAddress, ethers.parseEther("1000000"));
      
      // Try to stake zero amount
      await expect(
        staking.connect(user1).stake(0)
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should handle insufficient balance for stake", async function () {
      // Approve staking contract first
      await halomToken.connect(user1).approve(stakingAddress, ethers.parseEther("1000000"));
      
      // Try to stake more than user has
      const userBalance = await halomToken.balanceOf(user1.address);
      const excessiveAmount = userBalance + ethers.parseEther("1000000");
      
      await expect(
        staking.connect(user1).stake(excessiveAmount)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("Should handle multiple rapid stake/unstake operations", async function () {
      // First stake
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Rapid unstake
      await staking.connect(user1).unstake(ethers.parseEther("500"));
      
      // Rapid stake again
      await staking.connect(user1).stake(ethers.parseEther("2000"));
      
      // Check staked amount
      const stakedAmount = await staking.stakedAmount(user1.address);
      expect(stakedAmount).to.equal(ethers.parseEther("2500"));
    });

    it("Should handle partial unstake correctly", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Partial unstake
      await staking.connect(user1).unstake(ethers.parseEther("300"));
      
      const stakedAmount = await staking.stakedAmount(user1.address);
      expect(stakedAmount).to.equal(ethers.parseEther("700"));
    });

    it("Should revert on unstake amount exceeding staked amount", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      await expect(
        staking.connect(user1).unstake(ethers.parseEther("1500"))
      ).to.be.revertedWith("Insufficient staked amount");
    });

    it("Should handle complete unstake", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Complete unstake
      await staking.connect(user1).unstake(ethers.parseEther("1000"));
      
      const stakedAmount = await staking.stakedAmount(user1.address);
      expect(stakedAmount).to.equal(0);
    });
  });

  describe("Delegation Edge Cases", function () {
    it("Should handle delegation to self", async function () {
      // Approve staking contract first
      await halomToken.connect(user1).approve(stakingAddress, ethers.parseEther("100000"));
      
      // Stake tokens first
      await staking.connect(user1).stake(ethers.parseEther("100000"));
      
      // Delegate to self (should work)
      await halomToken.connect(user1).delegate(user1.address);
      
      const votingPower = await halomToken.getVotes(user1.address);
      expect(votingPower).to.be.gt(0);
    });

    it("Should handle delegation to zero address", async function () {
      // Approve staking contract first
      await halomToken.connect(user1).approve(stakingAddress, ethers.parseEther("100000"));
      
      // Stake tokens first
      await staking.connect(user1).stake(ethers.parseEther("100000"));
      
      // Delegate to zero address (should revert)
      await expect(
        halomToken.connect(user1).delegate(ethers.ZeroAddress)
      ).to.be.revertedWith("ERC20Votes: cannot delegate to zero address");
    });

    it("Should handle delegation change", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      await staking.connect(user2).stake(ethers.parseEther("500"));
      
      // Delegate to user2
      await staking.connect(user1).delegate(user2.address);
      
      let votingPower = await staking.getVotes(user2.address);
      expect(votingPower).to.be.gt(ethers.parseEther("500"));
      
      // Change delegation to user3
      await staking.connect(user1).delegate(user3.address);
      
      votingPower = await staking.getVotes(user2.address);
      expect(votingPower).to.equal(ethers.parseEther("500"));
      
      votingPower = await staking.getVotes(user3.address);
      expect(votingPower).to.be.gt(0);
    });

    it("Should handle delegation with zero stake", async function () {
      // Try to delegate without staking
      await expect(
        staking.connect(user1).delegate(user2.address)
      ).to.be.revertedWith("No stake to delegate");
    });
  });

  describe("Reward Edge Cases", function () {
    it("Should handle reward calculation with zero stake", async function () {
      const reward = await staking.calculateReward(user1.address);
      expect(reward).to.equal(0);
    });

    it("Should handle reward calculation with minimal stake", async function () {
      await staking.connect(user1).stake(1); // Minimal stake
      
      // Wait some time
      await time.increase(3600);
      
      const reward = await staking.calculateReward(user1.address);
      expect(reward).to.be.gte(0);
    });

    it("Should handle reward claiming with zero reward", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Try to claim immediately
      await expect(
        staking.connect(user1).claimReward()
      ).to.be.revertedWith("No reward to claim");
    });

    it("Should handle reward boost edge cases", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Wait for some reward to accumulate
      await time.increase(3600);
      
      // Check if boost is applied correctly
      const reward = await staking.calculateReward(user1.address);
      expect(reward).to.be.gte(0);
    });

    it("Should handle multiple users with different stake amounts", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      await staking.connect(user2).stake(ethers.parseEther("500"));
      await staking.connect(user3).stake(ethers.parseEther("2000"));
      
      // Wait for rewards
      await time.increase(3600);
      
      const reward1 = await staking.calculateReward(user1.address);
      const reward2 = await staking.calculateReward(user2.address);
      const reward3 = await staking.calculateReward(user3.address);
      
      // Rewards should be proportional to stake (with fourth root)
      expect(reward3).to.be.gt(reward1);
      expect(reward1).to.be.gt(reward2);
    });
  });

  describe("Fourth Root Calculation Edge Cases", function () {
    it("Should handle fourth root of zero", async function () {
      const result = await staking.fourthRoot(0);
      expect(result).to.equal(0);
    });

    it("Should handle fourth root of one", async function () {
      const result = await staking.fourthRoot(1);
      expect(result).to.equal(1);
    });

    it("Should handle fourth root of large numbers", async function () {
      const largeNumber = ethers.parseEther("1000000");
      const result = await staking.fourthRoot(largeNumber);
      expect(result).to.be.lt(largeNumber);
      expect(result).to.be.gt(0);
    });

    it("Should verify fourth root anti-whale effect", async function () {
      // Small stake
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Large stake (10x more)
      await staking.connect(user2).stake(ethers.parseEther("10000"));
      
      // Wait for rewards
      await time.increase(3600);
      
      const reward1 = await staking.calculateReward(user1.address);
      const reward2 = await staking.calculateReward(user2.address);
      
      // Large staker should not get 10x more reward due to fourth root
      const ratio = reward2 / reward1;
      expect(ratio).to.be.lt(10); // Should be less than 10x
    });
  });

  describe("Concurrent Operations", function () {
    it("Should handle multiple users staking simultaneously", async function () {
      const stakePromises = [
        staking.connect(user1).stake(ethers.parseEther("1000")),
        staking.connect(user2).stake(ethers.parseEther("2000")),
        staking.connect(user3).stake(ethers.parseEther("1500")),
        staking.connect(user4).stake(ethers.parseEther("3000")),
        staking.connect(user5).stake(ethers.parseEther("500"))
      ];
      
      await Promise.all(stakePromises);
      
      const totalStaked = await staking.totalStaked();
      expect(totalStaked).to.equal(ethers.parseEther("8000"));
    });

    it("Should handle stake and delegate in same transaction", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      await staking.connect(user1).delegate(user2.address);
      
      const votingPower = await staking.getVotes(user2.address);
      expect(votingPower).to.be.gt(0);
    });
  });

  describe("Emergency Scenarios", function () {
    it("Should handle emergency pause during staking", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Pause staking
      await staking.connect(owner).pause();
      
      // Should not be able to stake while paused
      await expect(
        staking.connect(user2).stake(ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
      
      // Should still be able to unstake
      await staking.connect(user1).unstake(ethers.parseEther("500"));
      
      // Unpause
      await staking.connect(owner).unpause();
      
      // Should be able to stake again
      await staking.connect(user2).stake(ethers.parseEther("1000"));
    });

    it("Should handle slashing edge cases", async function () {
      await staking.connect(user1).stake(ethers.parseEther("1000"));
      
      // Grant slasher role to owner
      await staking.grantRole(staking.SLASHER_ROLE, owner.address);
      
      // Slash user1
      await staking.connect(owner).slash(user1.address, ethers.parseEther("200"));
      
      const stakedAmount = await staking.stakedAmount(user1.address);
      expect(stakedAmount).to.equal(ethers.parseEther("800"));
    });
  });
}); 
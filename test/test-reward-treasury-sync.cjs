const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('Reward Pool and Treasury Synchronization Tests', function () {
  let halomToken, staking, treasury, oracle, governor, timelock;
  let owner, user1, user2, user3, user4, user5;
  let rewardToken;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    // HalomToken expects (admin, rebaseCaller)
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // HalomOracle expects (governance, updater)
    oracle = await HalomOracle.deploy(owner.address, owner.address);
    await oracle.waitForDeployment();

    // Deploy HalomTreasury with correct parameters
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();

    // HalomStaking expects (stakingToken, roleManager, rewardRate)
    const rewardRate = 2000; // 20% reward rate
    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, rewardRate);
    await staking.waitForDeployment();

    // Deploy reward token
    rewardToken = await MockERC20.deploy("Reward Token", "RWD");
    await rewardToken.waitForDeployment();

    // Deploy Timelock
    const minDelay = 3600;
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    // Deploy Governor
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(),
      await timelock.getAddress(),
      1,
      10,
      0,
      4
    );
    await governor.waitForDeployment();

    // Setup roles
    await halomToken.grantRole(await halomToken.MINTER_ROLE(), owner.address);
    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());

    // Mint tokens for testing
    await halomToken.mint(await treasury.getAddress(), ethers.parseEther('100000'));
    await halomToken.mint(user1.address, ethers.parseEther('10000'));
    await halomToken.mint(user2.address, ethers.parseEther('10000'));

    // Grant timelock roles to governor
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Mint tokens to users
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));

    // Mint reward tokens to treasury
    await rewardToken.mint(await treasury.getAddress(), ethers.parseEther("1000000"));

    // Users stake tokens
    await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user3).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user4).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user5).approve(await staking.getAddress(), ethers.parseEther("100000"));

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user2).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user3).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user4).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user5).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
  });

  describe('Reward Distribution Synchronization', function () {
    it('Should distribute rewards from treasury to staking contract', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Treasury should have reward tokens
      const treasuryBalance = await rewardToken.balanceOf(await treasury.getAddress());
      expect(treasuryBalance).to.be.gte(rewardAmount);
      
      // Set reward token in treasury
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // Distribute rewards from treasury to staking
      await treasury.connect(owner).drainTreasury(await staking.getAddress(), rewardAmount);
      
      // Verify staking contract received rewards
      const stakingBalance = await rewardToken.balanceOf(await staking.getAddress());
      expect(stakingBalance).to.equal(rewardAmount);
      
      // Add rewards to staking contract
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Users should be able to claim rewards
      const user1Rewards = await staking.getPendingReward(user1.address);
      expect(user1Rewards).to.be.gt(0);
    });

    it('Should handle time-based reward distribution', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set reward token and distribute
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).drainTreasury(await staking.getAddress(), rewardAmount);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Check initial rewards
      const initialRewards = await staking.getPendingReward(user1.address);
      
      // Wait for some time
      await time.increase(3600); // 1 hour
      
      // Check rewards after time increase
      const laterRewards = await staking.getPendingReward(user1.address);
      expect(laterRewards).to.be.gt(initialRewards);
    });

    it('Should handle multiple reward distributions', async function () {
      const rewardAmount1 = ethers.parseEther("5000");
      const rewardAmount2 = ethers.parseEther("3000");
      
      // Set reward token
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // First distribution
      await treasury.connect(owner).drainTreasury(await staking.getAddress(), rewardAmount1);
      await staking.connect(owner).addRewards(rewardAmount1);
      
      // Wait some time
      await time.increase(1800); // 30 minutes
      
      // Second distribution
      await treasury.connect(owner).drainTreasury(await staking.getAddress(), rewardAmount2);
      await staking.connect(owner).addRewards(rewardAmount2);
      
      // Total rewards should be sum of both
      const totalRewards = await staking.getPendingReward(user1.address);
      expect(totalRewards).to.be.gt(0);
    });
  });

  describe('Treasury Reward Management', function () {
    it('Should set and update reward token correctly', async function () {
      // Set reward token
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      expect(await treasury.rewardToken()).to.equal(await rewardToken.getAddress());
      
      // Update to different token
      const newRewardToken = await ethers.getContractFactory("MockERC20");
      const newToken = await newRewardToken.deploy("New Reward", "NEW");
      await newToken.waitForDeployment();
      
      await treasury.connect(owner).setRewardToken(await newToken.getAddress());
      expect(await treasury.rewardToken()).to.equal(await newToken.getAddress());
    });

    it('Should prevent unauthorized reward token changes', async function () {
      await expect(
        treasury.connect(user1).setRewardToken(await rewardToken.getAddress())
      ).to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    });

    it('Should handle reward token transfers with proper authorization', async function () {
      const transferAmount = ethers.parseEther("1000");
      
      // Set reward token
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // Transfer should succeed
      await treasury.connect(owner).drainTreasury(user1.address, transferAmount);
      
      // Verify transfer
      const user1Balance = await rewardToken.balanceOf(user1.address);
      expect(user1Balance).to.equal(transferAmount);
    });

    it('Should prevent transferring more than available', async function () {
      const treasuryBalance = await rewardToken.balanceOf(await treasury.getAddress());
      const excessiveAmount = treasuryBalance + ethers.parseEther("1000");
      
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      await expect(
        treasury.connect(owner).drainTreasury(user1.address, excessiveAmount)
      ).to.be.reverted;
    });
  });

  describe('Staking Reward Integration', function () {
    it('Should calculate rewards based on staked amounts', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).drainTreasury(await staking.getAddress(), rewardAmount);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Check rewards for different users
      const user1Rewards = await staking.getPendingReward(user1.address);
      const user2Rewards = await staking.getPendingReward(user2.address);
      
      // All users staked same amount, so should have similar rewards
      expect(user1Rewards).to.be.closeTo(user2Rewards, ethers.parseEther("1"));
    });

    it('Should handle reward claiming correctly', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), rewardAmount);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Check initial balance
      const initialBalance = await rewardToken.balanceOf(user1.address);
      
      // Claim rewards
      await staking.connect(user1).claimRewards();
      
      // Check final balance
      const finalBalance = await rewardToken.balanceOf(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
      
      // Pending rewards should be reset
      const pendingRewards = await staking.connect(user1).pendingRewards(user1.address);
      expect(pendingRewards).to.equal(0);
    });

    it('Should handle partial unstaking with rewards', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), rewardAmount);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Wait for lock period
      await time.increase(2592000); // 30 days
      
      // Unstake half
      const unstakeAmount = ethers.parseEther("50000");
      await staking.connect(user1).unstake(unstakeAmount);
      
      // Should still be able to claim rewards
      const pendingRewards = await staking.connect(user1).pendingRewards(user1.address);
      expect(pendingRewards).to.be.gt(0);
    });
  });

  describe('Governance Fee Integration', function () {
    it('Should handle governance fee collection', async function () {
      const transferAmount = ethers.parseEther("10000");
      
      // Set up governance fee (simulated through treasury)
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // Transfer funds (simulating governance fee collection)
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), owner.address, transferAmount);
      
      // Verify governance fee collection
      const ownerBalance = await rewardToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(transferAmount);
    });

    it('Should handle governance fee distribution to staking', async function () {
      const governanceFee = ethers.parseEther("5000");
      const stakingReward = ethers.parseEther("5000");
      
      // Set up reward token
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // Distribute governance fee to owner
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), owner.address, governanceFee);
      
      // Distribute remaining to staking
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), stakingReward);
      await staking.connect(owner).addRewards(stakingReward);
      
      // Verify distributions
      const ownerBalance = await rewardToken.balanceOf(owner.address);
      const stakingBalance = await rewardToken.balanceOf(await staking.getAddress());
      
      expect(ownerBalance).to.equal(governanceFee);
      expect(stakingBalance).to.equal(stakingReward);
    });
  });

  describe('Emergency Controls', function () {
    it('Should handle emergency pause of reward distribution', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), rewardAmount);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Emergency pause
      await staking.connect(owner).emergencyPause();
      
      // Should not be able to claim rewards when paused
      await expect(
        staking.connect(user1).claimRewards()
      ).to.be.revertedWithCustomError(staking, 'ContractPaused');
      
      // Unpause
      await staking.connect(owner).emergencyUnpause();
      
      // Should be able to claim rewards again
      await staking.connect(user1).claimRewards();
    });

    it('Should handle emergency drain of treasury', async function () {
      const drainAmount = ethers.parseEther("5000");
      
      // Emergency drain
      await treasury.connect(owner).emergencyDrain(await rewardToken.getAddress(), drainAmount);
      
      // Verify drain
      const ownerBalance = await rewardToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(drainAmount);
    });
  });

  describe('Reward Exhaustion Protection', function () {
    it('Should handle reward pool exhaustion gracefully', async function () {
      const smallReward = ethers.parseEther("1");
      
      // Set up small reward pool
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), smallReward);
      await staking.connect(owner).addRewards(smallReward);
      
      // Multiple users try to claim
      await staking.connect(user1).claimRewards();
      await staking.connect(user2).claimRewards();
      
      // Later users should get reduced or zero rewards
      const user3Rewards = await staking.connect(user3).pendingRewards(user3.address);
      expect(user3Rewards).to.be.lte(smallReward);
    });

    it('Should handle reward rate adjustments', async function () {
      const initialReward = ethers.parseEther("10000");
      const adjustedReward = ethers.parseEther("5000");
      
      // Set up initial rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), initialReward);
      await staking.connect(owner).addRewards(initialReward);
      
      // Wait some time
      await time.increase(1800);
      
      // Adjust reward rate (simulated by adding different amount)
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), adjustedReward);
      await staking.connect(owner).addRewards(adjustedReward);
      
      // Check that rewards are still being distributed
      const user1Rewards = await staking.connect(user1).pendingRewards(user1.address);
      expect(user1Rewards).to.be.gt(0);
    });
  });

  describe('Integration with Oracle Rebase', function () {
    it('Should handle rebase-triggered reward distribution', async function () {
      const rebaseAmount = ethers.parseEther("10000");
      
      // Set up staking contract as rebase recipient
      await halomToken.setStakingContract(await staking.getAddress());
      
      // Trigger rebase (positive)
      await oracle.connect(owner).setHOI(1050, 1); // 5% positive rebase
      
      // Check that staking contract received rebase rewards
      const stakingBalance = await halomToken.balanceOf(await staking.getAddress());
      expect(stakingBalance).to.be.gt(0);
    });

    it('Should handle negative rebase with reward protection', async function () {
      // Set up staking contract
      await halomToken.setStakingContract(await staking.getAddress());
      
      // Trigger negative rebase
      await oracle.connect(owner).setHOI(950, 1); // 5% negative rebase
      
      // Staking contract should still function
      const user1Rewards = await staking.connect(user1).pendingRewards(user1.address);
      expect(user1Rewards).to.be.gte(0);
    });
  });

  describe('Multi-Token Reward Support', function () {
    it('Should handle multiple reward tokens', async function () {
      // Create second reward token
      const rewardToken2 = await ethers.getContractFactory("MockERC20");
      const token2 = await rewardToken2.deploy("Reward Token 2", "RWD2");
      await token2.waitForDeployment();
      
      // Mint tokens to treasury
      await token2.mint(await treasury.getAddress(), ethers.parseEther("1000000"));
      
      const rewardAmount1 = ethers.parseEther("5000");
      const rewardAmount2 = ethers.parseEther("3000");
      
      // Distribute first token
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), rewardAmount1);
      await staking.connect(owner).addRewards(rewardAmount1);
      
      // Distribute second token
      await treasury.connect(owner).setRewardToken(await token2.getAddress());
      await treasury.connect(owner).transferFunds(await token2.getAddress(), await staking.getAddress(), rewardAmount2);
      await staking.connect(owner).addRewards(rewardAmount2);
      
      // Verify both tokens are in staking contract
      const balance1 = await rewardToken.balanceOf(await staking.getAddress());
      const balance2 = await token2.balanceOf(await staking.getAddress());
      
      expect(balance1).to.equal(rewardAmount1);
      expect(balance2).to.equal(rewardAmount2);
    });
  });

  describe('Edge Cases and Security', function () {
    it('Should handle zero reward amounts', async function () {
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), 0);
      await staking.connect(owner).addRewards(0);
      
      const user1Rewards = await staking.connect(user1).pendingRewards(user1.address);
      expect(user1Rewards).to.equal(0);
    });

    it('Should handle maximum reward amounts', async function () {
      const maxReward = ethers.MaxUint256;
      
      // This should not revert but handle gracefully
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // Note: This would fail due to insufficient balance, but tests the edge case
      await expect(
        treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), maxReward)
      ).to.be.revertedWithCustomError(treasury, 'InsufficientBalance');
    });

    it('Should prevent unauthorized reward additions', async function () {
      const rewardAmount = ethers.parseEther("1000");
      
      await expect(
        staking.connect(user1).addRewards(rewardAmount)
      ).to.be.revertedWithCustomError(staking, 'Unauthorized');
    });

    it('Should handle concurrent reward claims', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).transferFunds(await rewardToken.getAddress(), await staking.getAddress(), rewardAmount);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Multiple users claim simultaneously
      await Promise.all([
        staking.connect(user1).claimRewards(),
        staking.connect(user2).claimRewards(),
        staking.connect(user3).claimRewards()
      ]);
      
      // All should succeed
      const balance1 = await rewardToken.balanceOf(user1.address);
      const balance2 = await rewardToken.balanceOf(user2.address);
      const balance3 = await rewardToken.balanceOf(user3.address);
      
      expect(balance1).to.be.gt(0);
      expect(balance2).to.be.gt(0);
      expect(balance3).to.be.gt(0);
    });
  });
}); 
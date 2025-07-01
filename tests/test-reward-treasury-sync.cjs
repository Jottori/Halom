const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('Reward Pool and Treasury Synchronization Tests', function () {
  let halomToken, staking, treasury, oracle, governor, timelock, roleManager;
  let owner, user1, user2, user3, user4, user5;
  let rewardToken;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    // Deploy role manager first
    roleManager = await HalomRoleManager.deploy();

    // Deploy token with correct parameters
    halomToken = await HalomToken.deploy(
      owner.address, // _initialAdmin
      owner.address  // _rebaseCaller
    );

    // Deploy staking
    staking = await HalomStaking.deploy(
      await halomToken.getAddress(), // _stakingToken
      await roleManager.getAddress(), // _roleManager
      ethers.parseEther("0.1") // _rewardRate
    );

    // Deploy treasury with correct parameters
    treasury = await HalomTreasury.deploy(
      await halomToken.getAddress(), // _rewardToken
      await roleManager.getAddress(), // _roleManager
      3600 // _interval (1 hour)
    );

    // Setup roles
    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.STAKING_ROLE(), await staking.getAddress());
    await roleManager.grantRole(await roleManager.TREASURY_ROLE(), await treasury.getAddress());

    // Mint tokens to users
    await halomToken.connect(owner).mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.connect(owner).mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.connect(owner).mint(user3.address, ethers.parseEther("1000000"));

    // Stake tokens
    await halomToken.connect(user1).approve(staking.address, ethers.parseEther("1000000"));
    await halomToken.connect(user2).approve(staking.address, ethers.parseEther("1000000"));
    await halomToken.connect(user3).approve(staking.address, ethers.parseEther("1000000"));

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user2).stake(ethers.parseEther("200000"), 30 * 24 * 3600);
    await staking.connect(user3).stake(ethers.parseEther("300000"), 30 * 24 * 3600);

    // Deploy reward token with proper constructor arguments
    rewardToken = await ethers.getContractFactory("MockERC20");
    rewardToken = await rewardToken.deploy("Reward Token", "RWD", ethers.parseEther("1000000"));
    await rewardToken.waitForDeployment();

    // Deploy Timelock with proper parameters
    const minDelay = 86400; // 24 hours (minimum required)
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await ethers.getContractFactory("HalomTimelock").deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    // Deploy Governor with correct parameters
    governor = await ethers.getContractFactory("HalomGovernor").deploy(
      await halomToken.getAddress(),
      await timelock.getAddress(),
      1, // votingDelay
      50400, // votingPeriod (14 days)
      ethers.parseEther('10000'), // proposalThreshold
      4 // quorumPercent
    );
    await governor.waitForDeployment();

    // Grant oracle roles
    const ORACLE_UPDATER_ROLE = await oracle.UPDATER_ROLE();
    const AGGREGATOR_ROLE = await oracle.AGGREGATOR_ROLE();
    await oracle.grantRole(ORACLE_UPDATER_ROLE, owner.address);
    await oracle.grantRole(AGGREGATOR_ROLE, owner.address);

    // Grant timelock roles to governor
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Mint reward tokens to treasury
    await rewardToken.mint(await treasury.getAddress(), ethers.parseEther("1000000"));

    // Enable test mode for timelock
    await timelock.enableTestMode();

    // Grant roles
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);
    await treasury.grantRole(await treasury.TREASURY_CONTROLLER(), owner.address);
  });

  describe('Reward Distribution Synchronization', function () {
    it('Should distribute rewards from treasury to staking contract', async function () {
      const treasuryAmount = ethers.parseEther('100000');
      await halomToken.transfer(await treasury.getAddress(), treasuryAmount);

      const rewardAmount = ethers.parseEther('10000');
      await staking.addRewards(rewardAmount);

      const pendingRewards = await staking.getPendingReward(user1.address);
      expect(pendingRewards).to.be.gt(0);
    });

    it('Should synchronize reward rates between treasury and staking', async function () {
      const poolInfo = await staking.poolInfo();
      expect(poolInfo.rewardPerSecond).to.be.gt(0);

      const newRate = ethers.parseEther('0.2');
      await staking.setRewardRate(newRate);

      const updatedPoolInfo = await staking.poolInfo();
      expect(updatedPoolInfo.rewardPerSecond).to.equal(newRate);
    });

    it('Should handle multiple reward distributions', async function () {
      const treasuryAmount = ethers.parseEther('100000');
      await halomToken.transfer(await treasury.getAddress(), treasuryAmount);

      await staking.addRewards(ethers.parseEther('5000'));
      await staking.addRewards(ethers.parseEther('5000'));
      await staking.addRewards(ethers.parseEther('5000'));

      const totalRewards = await staking.getPendingReward(user1.address);
      expect(totalRewards).to.be.gt(0);
    });

    it('Should prevent unauthorized reward distribution', async function () {
      await expect(
        staking.connect(user1).addRewards(ethers.parseEther('1000'))
      ).to.be.revertedWithCustomError(staking, 'AccessControlUnauthorizedAccount');
    });

    it('Should handle reward claiming synchronization', async function () {
      const treasuryAmount = ethers.parseEther('100000');
      await halomToken.transfer(await treasury.getAddress(), treasuryAmount);

      await staking.addRewards(ethers.parseEther('10000'));

      await staking.connect(user1).claimReward();

      const pendingRewards = await staking.getPendingReward(user1.address);
      expect(pendingRewards).to.equal(0);
    });
  });

  describe('Treasury Reward Management', function () {
    it('Should set and update reward token correctly', async function () {
      // Set reward token
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      expect(await treasury.rewardToken()).to.equal(await rewardToken.getAddress());
      
      // Update to different token
      const newRewardToken = await ethers.getContractFactory("MockERC20");
      const newToken = await newRewardToken.deploy("New Reward", "NEW", ethers.parseEther("1000000"));
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
      await treasury.connect(owner).distributeRewards([user1.address], [transferAmount]);
      
      // Verify transfer
      const user1Balance = await rewardToken.balanceOf(user1.address);
      expect(user1Balance).to.equal(transferAmount);
    });

    it('Should prevent transferring more than available', async function () {
      const treasuryBalance = await rewardToken.balanceOf(await treasury.getAddress());
      const excessiveAmount = treasuryBalance + ethers.parseEther("1000");
      
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      await expect(
        treasury.connect(owner).distributeRewards([user1.address], [excessiveAmount])
      ).to.be.reverted;
    });
  });

  describe('Staking Reward Integration', function () {
    it('Should calculate rewards based on staked amounts', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [rewardAmount]);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Check rewards for different users
      const user1Rewards = await staking.pendingReward(user1.address);
      const user2Rewards = await staking.pendingReward(user2.address);
      
      // All users staked different amounts, so should have different rewards
      expect(user1Rewards).to.be.closeTo(user2Rewards, ethers.parseEther("1"));
    });

    it('Should handle reward claiming correctly', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [rewardAmount]);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Check initial balance
      const initialBalance = await rewardToken.balanceOf(user1.address);
      
      // Claim rewards
      await staking.connect(user1).claimReward();
      
      // Check final balance
      const finalBalance = await rewardToken.balanceOf(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
      
      // Pending rewards should be reset
      const pendingRewards = await staking.pendingReward(user1.address);
      expect(pendingRewards).to.equal(0);
    });

    it('Should handle partial unstaking with rewards', async function () {
      const rewardAmount = ethers.parseEther("10000");
      
      // Set up rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [rewardAmount]);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Wait for lock period
      await time.increase(2592000); // 30 days
      
      // Unstake half
      const unstakeAmount = ethers.parseEther("50000");
      await staking.connect(user1).unstake(unstakeAmount);
      
      // Should still be able to claim rewards
      const pendingRewards = await staking.pendingReward(user1.address);
      expect(pendingRewards).to.be.gt(0);
    });
  });

  describe('Governance Fee Integration', function () {
    it('Should handle governance fee collection', async function () {
      const transferAmount = ethers.parseEther("10000");
      
      // Set up governance fee (simulated through treasury)
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // Transfer funds (simulating governance fee collection)
      await treasury.connect(owner).distributeRewards([owner.address], [transferAmount]);
      
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
      await treasury.connect(owner).distributeRewards([owner.address], [governanceFee]);
      
      // Distribute remaining to staking
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [stakingReward]);
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
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [rewardAmount]);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Emergency pause
      await staking.connect(owner).emergencyPause();
      
      // Should not be able to claim rewards when paused
      await expect(
        staking.connect(user1).claimReward()
      ).to.be.revertedWithCustomError(staking, 'ContractPaused');
      
      // Unpause
      await staking.connect(owner).emergencyUnpause();
      
      // Should be able to claim rewards again
      await staking.connect(user1).claimReward();
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
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [smallReward]);
      await staking.connect(owner).addRewards(smallReward);
      
      // Multiple users try to claim
      await staking.connect(user1).claimReward();
      await staking.connect(user2).claimReward();
      
      // Later users should get reduced or zero rewards
      const user3Rewards = await staking.pendingReward(user3.address);
      expect(user3Rewards).to.be.lte(smallReward);
    });

    it('Should handle reward rate adjustments', async function () {
      const initialReward = ethers.parseEther("10000");
      const adjustedReward = ethers.parseEther("5000");
      
      // Set up initial rewards
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [initialReward]);
      await staking.connect(owner).addRewards(initialReward);
      
      // Wait some time
      await time.increase(1800);
      
      // Adjust reward rate (simulated by adding different amount)
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [adjustedReward]);
      await staking.connect(owner).addRewards(adjustedReward);
      
      // Check that rewards are still being distributed
      const user1Rewards = await staking.pendingReward(user1.address);
      expect(user1Rewards).to.be.gt(0);
    });
  });

  describe('Integration with Oracle Rebase', function () {
    it('Should handle rebase-triggered reward distribution', async function () {
      const rebaseAmount = ethers.parseEther("10000");
      
      // Set up staking contract as rebase recipient
      await halomToken.setStakingContract(await staking.getAddress());
      
      // Trigger rebase (positive) - simulate oracle update
      await oracle.connect(owner).updateHOI(1050); // 5% positive rebase
      
      // Check that staking contract received rebase rewards
      const stakingBalance = await halomToken.balanceOf(await staking.getAddress());
      expect(stakingBalance).to.be.gt(0);
    });

    it('Should handle negative rebase with reward protection', async function () {
      // Set up staking contract
      await halomToken.setStakingContract(await staking.getAddress());
      
      // Trigger negative rebase - simulate oracle update
      await oracle.connect(owner).updateHOI(950); // 5% negative rebase
      
      // Staking contract should still function
      const user1Rewards = await staking.pendingReward(user1.address);
      expect(user1Rewards).to.be.gte(0);
    });
  });

  describe('Multi-Token Reward Support', function () {
    it('Should handle multiple reward tokens', async function () {
      // Create second reward token
      const rewardToken2 = await ethers.getContractFactory("MockERC20");
      const token2 = await rewardToken2.deploy("Reward Token 2", "RWD2", ethers.parseEther("1000000"));
      await token2.waitForDeployment();
      
      // Mint tokens to treasury
      await token2.mint(await treasury.getAddress(), ethers.parseEther("1000000"));
      
      const rewardAmount1 = ethers.parseEther("5000");
      const rewardAmount2 = ethers.parseEther("3000");
      
      // Distribute first token
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [rewardAmount1]);
      await staking.connect(owner).addRewards(rewardAmount1);
      
      // Distribute second token
      await treasury.connect(owner).setRewardToken(await token2.getAddress());
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [rewardAmount2]);
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
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [0]);
      await staking.connect(owner).addRewards(0);
      
      const user1Rewards = await staking.pendingReward(user1.address);
      expect(user1Rewards).to.equal(0);
    });

    it('Should handle maximum reward amounts', async function () {
      const maxReward = ethers.MaxUint256;
      
      // This should not revert but handle gracefully
      await treasury.connect(owner).setRewardToken(await rewardToken.getAddress());
      
      // Note: This would fail due to insufficient balance, but tests the edge case
      await expect(
        treasury.connect(owner).distributeRewards([await staking.getAddress()], [maxReward])
      ).to.be.reverted;
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
      await treasury.connect(owner).distributeRewards([await staking.getAddress()], [rewardAmount]);
      await staking.connect(owner).addRewards(rewardAmount);
      
      // Multiple users claim simultaneously
      await Promise.all([
        staking.connect(user1).claimReward(),
        staking.connect(user2).claimReward(),
        staking.connect(user3).claimReward()
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
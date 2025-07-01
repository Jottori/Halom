const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('HalomLPStaking', function () {
  let HalomToken, halomToken, MockERC20, lpToken, HalomLPStaking, lpStaking;
  let owner, governor, rewarder, user1;
  let REWARDER_ROLE, MINTER_ROLE;

  async function deployLPStakingFixture() {
    [owner, governor, rewarder, user1] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    // HalomToken expects (admin, rebaseCaller)
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // MockERC20 for LP token
    lpToken = await MockERC20.deploy("LP Token", "LP", ethers.parseEther("1000000"));
    await lpToken.waitForDeployment();

    // MockERC20 for reward token
    rewardToken = await MockERC20.deploy("Reward Token", "RWD", ethers.parseEther("1000000"));
    await rewardToken.waitForDeployment();

    // HalomLPStaking expects (lpToken, rewardToken, roleManager, rewardRate)
    const rewardRate = 2000; // 20% reward rate
    lpStaking = await HalomLPStaking.deploy(await lpToken.getAddress(), await halomToken.getAddress(), owner.address, rewardRate);
    await lpStaking.waitForDeployment();

    // Get role constants
    REWARDER_ROLE = await lpStaking.REWARD_MANAGER_ROLE();
    MINTER_ROLE = await halomToken.MINTER_ROLE();

    // Grant MINTER_ROLE to owner and governor for testing
    await halomToken.connect(owner).grantRole(MINTER_ROLE, owner.address);
    await halomToken.connect(owner).grantRole(MINTER_ROLE, governor.address);

    // Grant DEFAULT_ADMIN_ROLE to owner for testing
    await halomToken.connect(owner).grantRole(await halomToken.DEFAULT_ADMIN_ROLE(), owner.address);

    // Mint tokens to owner for testing
    await halomToken.connect(owner).mint(owner.address, ethers.parseEther('1000000'));

    // Exclude from wallet limits
    await halomToken.connect(owner).setExcludedFromLimits(await lpStaking.getAddress(), true);
    await halomToken.connect(owner).setExcludedFromLimits(owner.address, true);

    // Grant REWARD_MANAGER_ROLE to rewarder in LP staking contract
    await lpStaking.connect(owner).grantRole(REWARDER_ROLE, rewarder.address);

    // Grant MINTER_ROLE to rewarder (not LP staking contract)
    await halomToken.connect(owner).grantRole(MINTER_ROLE, rewarder.address);

    // Prepare tokens for user
    const lpAmount = ethers.parseUnits('1000', 18);
    await lpToken.transfer(user1.address, lpAmount);
    await lpToken.connect(user1).approve(await lpStaking.getAddress(), lpAmount);

    // Prepare reward tokens - mint to rewarder
    const rewardAmount = ethers.parseUnits('5000', 18);
    await halomToken.connect(rewarder).mint(rewarder.address, rewardAmount);
    await halomToken.connect(rewarder).approve(await lpStaking.getAddress(), rewardAmount);

    // Emergency recovery teszt előtt:
    await halomToken.connect(rewarder).approve(await halomToken.getAddress(), ethers.parseEther('1000000'));

    // Grant MINTER_ROLE to LP staking contract for rewards
    await halomToken.connect(owner).grantRole(await halomToken.MINTER_ROLE(), await lpStaking.getAddress());

    return { halomToken, halomTokenAddress: await halomToken.getAddress(), lpToken, lpStaking, rewarder, user1, lpAmount, rewardAmount, owner };
  }

  it("Should allow a user to stake and receive rewards", async function () {
    const { halomToken, lpToken, lpStaking, user1, owner } = await deployLPStakingFixture();
    
    // User stakes LP tokens
    await lpToken.connect(user1).approve(await lpStaking.getAddress(), ethers.parseEther("1000"));
    await lpStaking.connect(user1).stakeLP(ethers.parseEther("1000"), 86400);
    
    // Check staked amount - account for lock boost
    const stakedAmount = await lpStaking.stakedBalance(user1.address);
    expect(stakedAmount).to.be.gt(ethers.parseEther("1000")); // Should be greater due to lock boost
    
    // Add rewards - owner needs to have tokens and approve the LP staking contract
    await halomToken.connect(owner).approve(await lpStaking.getAddress(), ethers.parseEther("100"));
    await lpStaking.connect(owner).addRewards(ethers.parseEther("100"));
    
    // Wait some time
    await time.increase(3600); // 1 hour
    
    // Check pending rewards
    const pendingRewards = await lpStaking.getPendingRewardsForUser(user1.address);
    expect(pendingRewards).to.be.gt(0);
    
    // Wait for lock period to expire
    await time.increase(86400); // 24 hours (lock period)
    
    // User unstakes
    await lpStaking.connect(user1).unstakeLP(ethers.parseEther("500"));
    
    // Check remaining staked amount
    const remainingStaked = await lpStaking.stakedBalance(user1.address);
    expect(remainingStaked).to.be.lt(stakedAmount); // Should be less than original staked amount
  });

  it('Should revert if a non-rewarder tries to add rewards', async function () {
    const { lpStaking, user1, rewardAmount } = await deployLPStakingFixture();
    await expect(lpStaking.connect(user1).addRewards(rewardAmount))
      .to.be.reverted;
  });

  it('Should handle fourth root calculations correctly', async function () {
    const { lpStaking, user1, lpAmount } = await deployLPStakingFixture();

    // Stake tokens
    await lpStaking.connect(user1).stakeLP(lpAmount, 86400);

    // Check fourth root calculation
    const fourthRoot = await lpStaking.fourthRoot(lpAmount);
    expect(fourthRoot).to.be.gt(0);

    // Check governance power
    const governancePower = await lpStaking.getGovernancePower(user1.address);
    expect(governancePower).to.be.gt(0);
  });

  it('Should handle pending rewards correctly', async function () {
    const { halomToken, lpStaking, rewarder, user1, lpAmount, rewardAmount } = await deployLPStakingFixture();

    // Stake tokens
    await lpStaking.connect(user1).stakeLP(lpAmount, 86400);

    // Add rewards - rewarder needs to approve the LP staking contract
    await halomToken.connect(rewarder).approve(await lpStaking.getAddress(), rewardAmount);
    await lpStaking.connect(rewarder).addRewards(rewardAmount);

    // Increase time to generate rewards
    await time.increase(3600); // 1 hour

    // Check pending rewards
    const pendingRewards = await lpStaking.getPendingRewardsForUser(user1.address);
    expect(pendingRewards).to.be.gt(0);
  });

  it('Should handle emergency recovery correctly', async function () {
    const { halomToken, lpStaking, owner } = await deployLPStakingFixture();

    // Send tokens to LP staking contract by mistake
    await halomToken.connect(owner).transfer(await lpStaking.getAddress(), ethers.parseEther('10'));

    // Emergency recovery should work
    const halomTokenAddress = await halomToken.getAddress();
    console.log('HalomToken address:', halomTokenAddress);
    await lpStaking.connect(owner).emergencyRecovery(halomTokenAddress, owner.address, ethers.parseEther('10'));

    // Check that tokens were recovered
    const ownerBalance = await halomToken.balanceOf(owner.address);
    expect(ownerBalance).to.be.gt(ethers.parseEther('1000000')); // Should have recovered the 10 tokens plus original balance
  });

  it('Should handle compound rewards correctly', async function () {
    const { lpStaking, user1, lpAmount } = await deployLPStakingFixture();

    // Stake tokens
    await lpStaking.connect(user1).stakeLP(lpAmount, 86400);

    // Add rewards - owner needs to approve the LP staking contract
    await halomToken.connect(owner).approve(await lpStaking.getAddress(), ethers.parseEther("100"));
    await lpStaking.connect(owner).addRewards(ethers.parseEther("100"));

    // Wait some time
    await time.increase(3600);

    // Compound rewards
    await lpStaking.connect(user1).compoundLPReward();

    // Check that staked amount increased
    const stakedAmount = await lpStaking.stakedBalance(user1.address);
    expect(stakedAmount).to.be.gt(lpAmount);
  });

  it('Should handle LP pool activation/deactivation', async function () {
    const { lpStaking, user1, lpAmount } = await deployLPStakingFixture();

    // Deactivate pool
    await lpStaking.connect(owner).setLPPoolActive(false);

    // Should not allow staking when pool is inactive
    await expect(
      lpStaking.connect(user1).stakeLP(lpAmount, 86400)
    ).to.be.reverted;

    // Reactivate pool
    await lpStaking.connect(owner).setLPPoolActive(true);

    // Should allow staking when pool is active
    await lpStaking.connect(user1).stakeLP(lpAmount, 86400);
    const stakedAmount = await lpStaking.stakedBalance(user1.address);
    expect(stakedAmount).to.be.gt(lpAmount); // Account for lock boost
  });

  it('Should handle emergency pause correctly', async function () {
    const { lpStaking, user1, lpAmount } = await deployLPStakingFixture();

    // Emergency pause
    await lpStaking.connect(owner).emergencyPause();

    // Should not allow staking when paused
    await expect(
      lpStaking.connect(user1).stakeLP(lpAmount, 86400)
    ).to.be.reverted;

    // Emergency unpause
    await lpStaking.connect(owner).emergencyUnpause();

    // Should allow staking when unpaused
    await lpStaking.connect(user1).stakeLP(lpAmount, 86400);
    const stakedAmount = await lpStaking.stakedBalance(user1.address);
    expect(stakedAmount).to.be.gt(lpAmount); // Account for lock boost
  });

  it('Should handle reward rate updates correctly', async function () {
    const { lpStaking } = await deployLPStakingFixture();

    const newRewardRate = 3000; // 30%
    await lpStaking.connect(owner).setLPRewardRate(newRewardRate);

    // Verify reward rate was updated
    const poolInfo = await lpStaking.lpPoolInfo();
    expect(poolInfo.rewardPerSecond).to.equal(newRewardRate);
  });

  it('Should handle multiple users staking', async function () {
    const { lpToken, lpStaking, user1 } = await deployLPStakingFixture();
    const [user2] = await ethers.getSigners();

    // Prepare tokens for user2
    await lpToken.transfer(user2.address, ethers.parseEther("1000"));
    await lpToken.connect(user2).approve(await lpStaking.getAddress(), ethers.parseEther("1000"));

    // Both users stake
    await lpStaking.connect(user1).stakeLP(ethers.parseEther("1000"), 86400);
    await lpStaking.connect(user2).stakeLP(ethers.parseEther("500"), 86400);

    // Add rewards - owner needs to approve the LP staking contract
    await halomToken.connect(owner).approve(await lpStaking.getAddress(), ethers.parseEther("100"));
    await lpStaking.connect(owner).addRewards(ethers.parseEther("100"));

    // Wait some time
    await time.increase(3600);

    // Both users should have pending rewards
    const user1Rewards = await lpStaking.getPendingRewardsForUser(user1.address);
    const user2Rewards = await lpStaking.getPendingRewardsForUser(user2.address);

    expect(user1Rewards).to.be.gt(0);
    expect(user2Rewards).to.be.gt(0);
    expect(user1Rewards).to.be.gt(user2Rewards); // User1 staked more, should get more rewards
  });
});

// A simple mock ERC20 token for testing purposes
const { ContractFactory } = require('ethers');
const { artifacts } = require('hardhat');
const MockERC20Artifact = artifacts.readArtifactSync('contracts/test/MockERC20.sol:MockERC20');

// This is a bit of a hack to get a factory for a contract in a subdirectory
// Hardhat doesn't make this easy out of the box.
const MockERC20Factory = new ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode);

const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('LPStaking', function () {
  async function deployLPStakingFixture() {
    const [admin, governor, pauser, user1, user2] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    const lpToken = await Token.deploy('LPToken', 'LPT', ethers.parseEther('1000000'));
    const rewardToken = await Token.deploy('RewardToken', 'RWT', ethers.parseEther('1000000'));
    await lpToken.waitForDeployment();
    await rewardToken.waitForDeployment();
    const LPStaking = await ethers.getContractFactory('LPStaking');
    const lpstaking = await upgrades.deployProxy(LPStaking, [lpToken.target, rewardToken.target, admin.address], { initializer: 'initialize' });
    await lpstaking.waitForDeployment();
    // Grant roles
    await lpstaking.connect(admin).grantRole(await lpstaking.GOVERNOR_ROLE(), governor.address);
    await lpstaking.connect(admin).grantRole(await lpstaking.PAUSER_ROLE(), pauser.address);
    // Distribute tokens
    await lpToken.transfer(user1.address, ethers.parseEther('10000'));
    await lpToken.transfer(user2.address, ethers.parseEther('10000'));
    await rewardToken.transfer(lpstaking.target, ethers.parseEther('100000'));
    return { lpstaking, lpToken, rewardToken, admin, governor, pauser, user1, user2 };
  }

  describe('Deployment', function () {
    it('should deploy and initialize with correct parameters', async function () {
      const { lpstaking, lpToken, rewardToken } = await loadFixture(deployLPStakingFixture);
      expect(await lpstaking.lpToken()).to.equal(lpToken.target);
      expect(await lpstaking.rewardToken()).to.equal(rewardToken.target);
    });
  });

  describe('LP Staking', function () {
    it('should allow user to stake LP tokens with valid lock', async function () {
      const { lpstaking, lpToken, user1 } = await loadFixture(deployLPStakingFixture);
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await expect(lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400)).to.emit(lpstaking, 'LPStaked');
      expect(await lpstaking.lpStakedAmount(user1.address)).to.be.gt(0);
      expect(await lpstaking.totalLPStaked()).to.be.gt(0);
    });
    it('should revert if staking below minimum', async function () {
      const { lpstaking, user1 } = await loadFixture(deployLPStakingFixture);
      await expect(lpstaking.connect(user1).stakeLP(0, 86400)).to.be.revertedWithCustomError(lpstaking, 'ZeroAmount');
    });
    it('should revert if lock duration invalid', async function () {
      const { lpstaking, lpToken, user1 } = await loadFixture(deployLPStakingFixture);
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await expect(lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 100)).to.be.revertedWithCustomError(lpstaking, 'InvalidLPLockDuration');
    });
  });

  describe('LP Unstaking', function () {
    it('should allow user to unstake after lock', async function () {
      const { lpstaking, lpToken, user1 } = await loadFixture(deployLPStakingFixture);
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400);
      await time.increase(86400 + 1);
      const staked = await lpstaking.lpStakedAmount(user1.address);
      await expect(lpstaking.connect(user1).unstakeLP(staked)).to.emit(lpstaking, 'LPUnstaked');
      expect(await lpstaking.lpStakedAmount(user1.address)).to.equal(0);
    });
    it('should revert if unstaking before lock expires', async function () {
      const { lpstaking, lpToken, user1 } = await loadFixture(deployLPStakingFixture);
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400);
      await expect(lpstaking.connect(user1).unstakeLP(await lpstaking.lpStakedAmount(user1.address))).to.be.revertedWithCustomError(lpstaking, 'LPLockNotExpired');
    });
  });

  describe('LP Rewards', function () {
    it('should allow governor to set LP reward rate', async function () {
      const { lpstaking, governor } = await loadFixture(deployLPStakingFixture);
      await expect(lpstaking.connect(governor).setLPRewardRate(100)).to.emit(lpstaking, 'LPRewardRateSet');
      expect(await lpstaking.lpRewardRate()).to.equal(100);
    });
    it('should accumulate and claim LP rewards', async function () {
      const { lpstaking, lpToken, rewardToken, user1, governor } = await loadFixture(deployLPStakingFixture);
      await lpstaking.connect(governor).setLPRewardRate(ethers.parseEther('1'));
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400);
      await time.increase(100);
      await lpstaking.updateLPRewardPerToken();
      
      // Debug: Check reward per token and reward debt
      const poolInfo = await lpstaking.getLPPoolInfo();
      const userInfo = await lpstaking.getLPStakingInfo(user1.address);
      console.log('Reward per token stored:', poolInfo.rewardPerTokenStored.toString());
      console.log('User reward debt:', userInfo.rewardDebt.toString());
      console.log('User staked amount:', userInfo.stakedAmount.toString());
      console.log('Pending rewards:', userInfo.pendingRewards.toString());
      
      await expect(lpstaking.connect(user1).claimLPRewards()).to.emit(lpstaking, 'LPRewardClaimed');
      const info = await lpstaking.getLPStakingInfo(user1.address);
      expect(info.pendingRewards).to.equal(0);
    });
    it('should revert if no LP rewards to claim', async function () {
      const { lpstaking, user1 } = await loadFixture(deployLPStakingFixture);
      await expect(lpstaking.connect(user1).claimLPRewards()).to.be.revertedWithCustomError(lpstaking, 'NoLPRewardsToClaim');
    });
    it('should allow user to compound LP rewards', async function () {
      const { lpstaking, lpToken, rewardToken, user1, governor } = await loadFixture(deployLPStakingFixture);
      await lpstaking.connect(governor).setLPRewardRate(ethers.parseEther('1'));
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400);
      await time.increase(100);
      await lpstaking.updateLPRewardPerToken();
      await expect(lpstaking.connect(user1).compoundLPRewards()).to.emit(lpstaking, 'LPRewardCompounded');
    });
  });

  describe('Emergency LP Withdraw', function () {
    it('should allow governor to emergency withdraw for user', async function () {
      const { lpstaking, lpToken, user1, governor } = await loadFixture(deployLPStakingFixture);
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400);
      await expect(lpstaking.connect(governor).emergencyLPWithdraw(user1.address)).to.emit(lpstaking, 'EmergencyLPWithdrawn');
      expect(await lpstaking.lpStakedAmount(user1.address)).to.equal(0);
      expect(await lpstaking.totalLPStaked()).to.equal(0);
    });
    it('should revert if user has nothing to withdraw', async function () {
      const { lpstaking, governor, user1 } = await loadFixture(deployLPStakingFixture);
      await expect(lpstaking.connect(governor).emergencyLPWithdraw(user1.address)).to.be.revertedWithCustomError(lpstaking, 'ZeroAmount');
    });
  });

  describe('Pause/Unpause', function () {
    it('should allow pauser to pause and unpause', async function () {
      const { lpstaking, pauser, lpToken, user1 } = await loadFixture(deployLPStakingFixture);
      await lpstaking.connect(pauser).pause();
      await lpToken.connect(user1).approve(lpstaking.target, ethers.parseEther('1000'));
      await expect(lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400)).to.be.revertedWithCustomError(lpstaking, 'EnforcedPause');
      await lpstaking.connect(pauser).unpause();
      await expect(lpstaking.connect(user1).stakeLP(ethers.parseEther('1000'), 86400)).to.emit(lpstaking, 'LPStaked');
    });
  });
}); 
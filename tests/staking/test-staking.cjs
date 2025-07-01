const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('Staking', function () {
  async function deployStakingFixture() {
    const [admin, governor, pauser, user1, user2] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('MockERC20');
    const token = await Token.deploy('TestToken', 'TT', ethers.parseEther('1000000'));
    await token.waitForDeployment();
    const Staking = await ethers.getContractFactory('Staking');
    const staking = await upgrades.deployProxy(Staking, [token.target, admin.address], { initializer: 'initialize' });
    await staking.waitForDeployment();
    // Grant roles
    await staking.connect(admin).grantRole(await staking.GOVERNOR_ROLE(), governor.address);
    await staking.connect(admin).grantRole(await staking.PAUSER_ROLE(), pauser.address);
    // Distribute tokens
    await token.transfer(user1.address, ethers.parseEther('10000'));
    await token.transfer(user2.address, ethers.parseEther('10000'));
    return { staking, token, admin, governor, pauser, user1, user2 };
  }

  describe('Deployment', function () {
    it('should deploy and initialize with correct parameters', async function () {
      const { staking, token } = await loadFixture(deployStakingFixture);
      expect(await staking.stakingToken()).to.equal(token.target);
    });
  });

  describe('Staking', function () {
    it('should allow user to stake tokens', async function () {
      const { staking, token, user1 } = await loadFixture(deployStakingFixture);
      await token.connect(user1).approve(staking.target, ethers.parseEther('1000'));
      await expect(staking.connect(user1).stake(ethers.parseEther('1000'))).to.emit(staking, 'Staked');
      expect(await staking.stakedAmount(user1.address)).to.equal(ethers.parseEther('1000'));
      expect(await staking.totalStaked()).to.equal(ethers.parseEther('1000'));
    });
    it('should revert if staking zero', async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(0)).to.be.revertedWithCustomError(staking, 'ZeroAmount');
    });
    it('should revert if not enough balance', async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(ethers.parseEther('100000'))).to.be.revertedWithCustomError(staking, 'InsufficientBalance');
    });
  });

  describe('Unstaking', function () {
    it('should allow user to unstake tokens', async function () {
      const { staking, token, user1 } = await loadFixture(deployStakingFixture);
      await token.connect(user1).approve(staking.target, ethers.parseEther('1000'));
      await staking.connect(user1).stake(ethers.parseEther('1000'));
      await expect(staking.connect(user1).unstake(ethers.parseEther('500'))).to.emit(staking, 'Unstaked');
      expect(await staking.stakedAmount(user1.address)).to.equal(ethers.parseEther('500'));
      expect(await staking.totalStaked()).to.equal(ethers.parseEther('500'));
    });
    it('should revert if unstaking zero', async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).unstake(0)).to.be.revertedWithCustomError(staking, 'ZeroAmount');
    });
    it('should revert if unstaking more than staked', async function () {
      const { staking, token, user1 } = await loadFixture(deployStakingFixture);
      await token.connect(user1).approve(staking.target, ethers.parseEther('1000'));
      await staking.connect(user1).stake(ethers.parseEther('1000'));
      await expect(staking.connect(user1).unstake(ethers.parseEther('2000'))).to.be.revertedWithCustomError(staking, 'InsufficientBalance');
    });
  });

  describe('Rewards', function () {
    it('should allow governor to set reward rate', async function () {
      const { staking, governor } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(governor).setRewardRate(100)).to.emit(staking, 'RewardRateSet');
      expect(await staking.rewardRate()).to.equal(100);
    });
    it('should accumulate and claim rewards', async function () {
      const { staking, token, user1, governor } = await loadFixture(deployStakingFixture);
      await staking.connect(governor).setRewardRate(ethers.parseEther('0.01')); // More reasonable rate
      await token.connect(user1).approve(staking.target, ethers.parseEther('1000'));
      await staking.connect(user1).stake(ethers.parseEther('1000'));
      await time.increase(100);
      await expect(staking.connect(user1).claimRewards()).to.emit(staking, 'RewardClaimed');
      const info = await staking.getStakeInfo(user1.address);
      expect(info[1]).to.equal(0);
    });
    it('should revert if no rewards to claim', async function () {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).claimRewards()).to.be.revertedWithCustomError(staking, 'NoRewardsToClaim');
    });
  });

  describe('Emergency Withdraw', function () {
    it('should allow governor to emergency withdraw for user', async function () {
      const { staking, token, user1, governor } = await loadFixture(deployStakingFixture);
      await token.connect(user1).approve(staking.target, ethers.parseEther('1000'));
      await staking.connect(user1).stake(ethers.parseEther('1000'));
      await expect(staking.connect(governor).emergencyWithdraw(user1.address)).to.emit(staking, 'EmergencyWithdrawn');
      expect(await staking.stakedAmount(user1.address)).to.equal(0);
      expect(await staking.totalStaked()).to.equal(0);
    });
    it('should revert if user has nothing to withdraw', async function () {
      const { staking, governor, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(governor).emergencyWithdraw(user1.address)).to.be.revertedWithCustomError(staking, 'ZeroAmount');
    });
  });

  describe('Pause/Unpause', function () {
    it('should allow pauser to pause and unpause', async function () {
      const { staking, pauser, token, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(pauser).pause();
      await token.connect(user1).approve(staking.target, ethers.parseEther('1000'));
      await expect(staking.connect(user1).stake(ethers.parseEther('1000'))).to.be.revertedWithCustomError(staking, 'EnforcedPause');
      await staking.connect(pauser).unpause();
      await expect(staking.connect(user1).stake(ethers.parseEther('1000'))).to.emit(staking, 'Staked');
    });
  });
}); 
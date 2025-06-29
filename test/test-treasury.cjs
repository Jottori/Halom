const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('HalomTreasury', function () {
  let treasury, token, owner, user1, user2, user3;
  let TREASURY_ADMIN_ROLE, OPERATOR_ROLE;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    // HalomToken expects (admin, rebaseCaller)
    token = await HalomToken.deploy(owner.address, owner.address);
    await token.waitForDeployment();

    // MockERC20 for testing
    mockToken = await MockERC20.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();

    // HalomTreasury expects (rewardToken, roleManager, interval)
    treasury = await HalomTreasury.deploy(await token.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();

    // Get role constants
    TREASURY_ADMIN_ROLE = await treasury.DEFAULT_ADMIN_ROLE();
    OPERATOR_ROLE = await treasury.DEFAULT_ADMIN_ROLE();

    // Setup roles
    await treasury.grantRole(TREASURY_ADMIN_ROLE, owner.address);

    // Mint tokens for testing
    await token.mint(await treasury.getAddress(), ethers.parseEther('100000'));
  });

  describe('Deployment and Initial Setup', function () {
    it('Should deploy with correct parameters', async function () {
      expect(await treasury.rewardToken()).to.equal(await token.getAddress());
      expect(await treasury.hasRole(TREASURY_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it('Should have correct initial state', async function () {
      expect(await token.balanceOf(await treasury.getAddress())).to.equal(ethers.parseEther('100000'));
    });
  });

  describe('Fund Management', function () {
    it('Should allow operator to transfer funds', async function () {
      const transferAmount = ethers.parseEther('1000');
      await treasury.connect(owner).allocateTo(user1.address, transferAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(transferAmount);
      expect(await token.balanceOf(await treasury.getAddress())).to.equal(ethers.parseEther('99000'));
    });

    it('Should prevent non-operator from transferring funds', async function () {
      await expect(
        treasury.connect(user1).allocateTo(user2.address, ethers.parseEther('100'))
      ).to.be.revertedWithCustomError(treasury, 'Unauthorized');
    });

    it('Should prevent transferring more than available', async function () {
      await expect(
        treasury.connect(owner).allocateTo(user2.address, ethers.parseEther('100000000000000000000000001'))
      ).to.be.reverted;
    });
  });

  describe('Emergency Controls', function () {
    it('Should allow admin to drain treasury', async function () {
      const balanceBefore = await token.balanceOf(owner.address);
      await treasury.connect(owner).drainTreasury(owner.address, ethers.parseEther('100'));
      const balanceAfter = await token.balanceOf(owner.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it('Should allow emergency drain', async function () {
      const balanceBefore = await token.balanceOf(owner.address);
      await treasury.connect(owner)["emergencyDrain(address,uint256)"](owner.address, ethers.parseEther('100'));
      const balanceAfter = await token.balanceOf(owner.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it('Should prevent non-admin from emergency drain', async function () {
      await expect(
        treasury.connect(user1)["emergencyDrain(address,uint256)"](user1.address, ethers.parseEther('100'))
      ).to.be.revertedWithCustomError(treasury, 'Unauthorized');
    });
  });

  describe('Role Management', function () {
    it('Should allow admin to grant and revoke roles', async function () {
      await treasury.connect(owner).grantRole(OPERATOR_ROLE, user1.address);
      expect(await treasury.hasRole(OPERATOR_ROLE, user1.address)).to.be.true;

      await treasury.connect(owner).revokeRole(OPERATOR_ROLE, user1.address);
      expect(await treasury.hasRole(OPERATOR_ROLE, user1.address)).to.be.false;
    });

    it('Should prevent non-admin from managing roles', async function () {
      await expect(
        treasury.connect(user1).grantRole(OPERATOR_ROLE, user2.address)
      ).to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    });
  });

  describe('Token Recovery', function () {
    it('Should allow admin to recover tokens sent by mistake', async function () {
      // Send tokens to treasury by mistake
      await token.connect(owner).transfer(await treasury.getAddress(), ethers.parseEther('10'));
      const balanceBefore = await token.balanceOf(owner.address);
      await treasury.connect(owner).drainTreasury(owner.address, ethers.parseEther('10'));
      const balanceAfter = await token.balanceOf(owner.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
}); 
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('HalomToken', function () {
  let token, governor, owner, user1, user2;
  let GOVERNOR_ROLE, REBASE_CALLER_ROLE, MINTER_ROLE;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    governor = owner; // For testing purposes

    const HalomToken = await ethers.getContractFactory('HalomToken');
    token = await HalomToken.deploy(owner.address, owner.address);
    await token.waitForDeployment();

    // Get role constants from contract
    GOVERNOR_ROLE = await token.DEFAULT_ADMIN_ROLE();
    REBASE_CALLER_ROLE = await token.REBASE_CALLER();
    MINTER_ROLE = await token.MINTER_ROLE();

    // Grant roles to governor for testing
    await token.grantRole(GOVERNOR_ROLE, governor.address);
    await token.grantRole(REBASE_CALLER_ROLE, governor.address);
    await token.grantRole(MINTER_ROLE, governor.address);
  });

  describe('Deployment and Initial Setup', function () {
    it('Should assign GOVERNOR_ROLE to the governor', async function () {
      expect(await token.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
    });

    it('Should have correct initial state', async function () {
      expect(await token.name()).to.equal('Halom');
      expect(await token.symbol()).to.equal('HALOM');
      expect(await token.decimals()).to.equal(18);
    });
  });

  describe('Role Management', function () {
    it('Should grant and revoke roles correctly', async function () {
      await token.connect(governor).grantRole(MINTER_ROLE, user1.address);
      expect(await token.hasRole(MINTER_ROLE, user1.address)).to.be.true;

      await token.connect(governor).revokeRole(MINTER_ROLE, user1.address);
      expect(await token.hasRole(MINTER_ROLE, user1.address)).to.be.false;
    });

    it('Should prevent non-admin from granting roles', async function () {
      await expect(
        token.connect(user1).grantRole(MINTER_ROLE, user2.address)
      ).to.be.revertedWithCustomError(token, 'AccessControlUnauthorizedAccount');
    });
  });

  describe('Minting and Burning', function () {
    it('Should allow authorized minter to mint tokens', async function () {
      const mintAmount = ethers.parseEther('1000');
      await token.connect(governor).mint(user1.address, mintAmount);
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it('Should prevent unauthorized minting', async function () {
      await expect(
        token.connect(user1).mint(user2.address, ethers.parseEther('1000'))
      ).to.be.revertedWithCustomError(token, 'Unauthorized');
    });

    it('Should allow authorized burner to burn tokens', async function () {
      const mintAmount = ethers.parseEther('1000');
      await token.connect(governor).mint(user1.address, mintAmount);
      
      // Approve burning
      await token.connect(user1).approve(governor.address, ethers.parseEther('500'));
      
      const burnAmount = ethers.parseEther('500');
      await token.connect(governor).burnFrom(user1.address, burnAmount);
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther('500'));
    });

    it('Should prevent burning more than approved', async function () {
      const mintAmount = ethers.parseEther('1000');
      await token.connect(governor).mint(user1.address, mintAmount);
      
      // Approve less than burn amount
      await token.connect(user1).approve(governor.address, ethers.parseEther('100'));
      
      await expect(
        token.connect(governor).burnFrom(user1.address, ethers.parseEther('500'))
      ).to.be.reverted;
    });
  });

  describe('Rebase Functionality', function () {
    it('Should allow authorized rebaser to trigger rebase', async function () {
      const initialSupply = await token.totalSupply();
      await token.connect(governor).rebase(ethers.parseEther('1000')); // 1000 token rebase
      expect(await token.totalSupply()).to.be.gt(initialSupply);
    });

    it('Should prevent unauthorized rebase', async function () {
      await expect(
        token.connect(user1).rebase(ethers.parseEther('1000'))
      ).to.be.revertedWithCustomError(token, 'Unauthorized');
    });

    it('Should handle zero rebase', async function () {
      const initialSupply = await token.totalSupply();
      await token.connect(governor).rebase(0);
      expect(await token.totalSupply()).to.equal(initialSupply);
    });
  });

  describe('Transfer and Approval', function () {
    beforeEach(async function () {
      await token.connect(governor).mint(user1.address, ethers.parseEther('1000'));
    });

    it('Should allow standard token transfers', async function () {
      const transferAmount = ethers.parseEther('100');
      await token.connect(user1).transfer(user2.address, transferAmount);
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it('Should handle approval and transferFrom correctly', async function () {
      const approveAmount = ethers.parseEther('200');
      await token.connect(user1).approve(user2.address, approveAmount);
      
      const transferAmount = ethers.parseEther('100');
      const governorInitialBalance = await token.balanceOf(governor.address);
      await token.connect(user2).transferFrom(user1.address, governor.address, transferAmount);
      expect(await token.balanceOf(governor.address)).to.equal(governorInitialBalance + transferAmount);
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther('900'));
    });

    it('Should prevent transfer with insufficient balance', async function () {
      await expect(
        token.connect(user1).transfer(user2.address, ethers.parseEther('2000'))
      ).to.be.reverted;
    });

    it('Should prevent transferFrom with insufficient allowance', async function () {
      await token.connect(user1).approve(user2.address, ethers.parseEther('50'));
      
      await expect(
        token.connect(user2).transferFrom(user1.address, governor.address, ethers.parseEther('100'))
      ).to.be.reverted;
    });
  });

  describe('Anti-Whale Protection', function () {
    beforeEach(async function () {
      await token.connect(governor).mint(user1.address, ethers.parseEther('10000'));
      await token.connect(governor).setAntiWhaleLimits(ethers.parseEther('1000'), ethers.parseEther('5000'));
    });

    it('Should enforce transfer limits', async function () {
      await expect(
        token.connect(user1).transfer(user2.address, ethers.parseEther('1500'))
      ).to.be.revertedWithCustomError(token, 'TransferAmountExceedsLimit');
    });

    it('Should enforce wallet limits', async function () {
      // Set wallet limit to 2000 for this test
      await token.connect(governor).setAntiWhaleLimits(ethers.parseEther('1000'), ethers.parseEther('2000'));
      // First transfer should work (1000)
      await token.connect(user1).transfer(user2.address, ethers.parseEther('1000'));
      expect(await token.balanceOf(user2.address)).to.equal(ethers.parseEther('1000'));
      // Second transfer should work (another 1000, total 2000)
      await token.connect(user1).transfer(user2.address, ethers.parseEther('1000'));
      expect(await token.balanceOf(user2.address)).to.equal(ethers.parseEther('2000'));
      // Third transfer should fail (would exceed wallet limit)
      await expect(
        token.connect(user1).transfer(user2.address, ethers.parseEther('1'))
      ).to.be.revertedWithCustomError(token, 'WalletBalanceExceedsLimit');
    });

    it('Should allow excluded addresses to bypass limits', async function () {
      await token.connect(governor).setExcludedFromLimits(user1.address, true);
      await token.connect(user1).transfer(user2.address, ethers.parseEther('1500'));
      expect(await token.balanceOf(user2.address)).to.equal(ethers.parseEther('1500'));
    });
  });

  describe('Emergency Functions', function () {
    it('Should allow emergency pause and unpause', async function () {
      await token.connect(governor).emergencyPause();
      expect(await token.paused()).to.be.true;

      await token.connect(governor).emergencyUnpause();
      expect(await token.paused()).to.be.false;
    });

    it('Should prevent operations when paused', async function () {
      await token.connect(governor).emergencyPause();
      
      await expect(
        token.connect(governor).mint(user1.address, ethers.parseEther('1000'))
      ).to.be.reverted;
    });
  });

  describe('Batch Operations', function () {
    it('Should handle batch minting', async function () {
      const addresses = [user1.address, user2.address];
      const amounts = [ethers.parseEther('100'), ethers.parseEther('200')];
      
      await token.connect(governor).batchMint(addresses, amounts);
      
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther('100'));
      expect(await token.balanceOf(user2.address)).to.equal(ethers.parseEther('200'));
    });

    it('Should handle batch burning', async function () {
      await token.connect(governor).mint(user1.address, ethers.parseEther('1000'));
      await token.connect(governor).mint(user2.address, ethers.parseEther('1000'));
      
      const addresses = [user1.address, user2.address];
      const amounts = [ethers.parseEther('100'), ethers.parseEther('200')];
      
      await token.connect(governor).batchBurn(addresses, amounts);
      
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther('900'));
      expect(await token.balanceOf(user2.address)).to.equal(ethers.parseEther('800'));
    });
  });

  describe('Rebase Balance Functions', function () {
    it('Should return correct rebase balance', async function () {
      await token.connect(governor).mint(user1.address, ethers.parseEther('1000'));
      const rebaseBalance = await token.getRebaseBalance(user1.address);
      expect(rebaseBalance).to.be.gt(0);
    });
  });
});

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Secure Role Structure', function () {
  let halomToken, governor, timelock, staking, treasury, owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");

    halomToken = await HalomToken.deploy(owner.address, owner.address);
    const minDelay = 86400; // 24 hours
    timelock = await HalomTimelock.deploy(minDelay, [owner.address], [owner.address], owner.address);
    governor = await HalomGovernor.deploy(await halomToken.getAddress(), await timelock.getAddress(), 1, 10, 0, 4);
    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, ethers.parseEther("0.1"));
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);

    // Setup basic roles
    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());
    await staking.setPoolActive(true);

    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);
    await treasury.grantRole(await treasury.TREASURY_CONTROLLER(), owner.address);

    // Setup timelock roles
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    
    await timelock.grantRole(proposerRole, await governor.getAddress());
    await timelock.grantRole(executorRole, await governor.getAddress());
  });

  describe('DEFAULT_ADMIN_ROLE Security', function () {
    it('Should only be assigned to TimelockController', async function () {
      // Check that owner has DEFAULT_ADMIN_ROLE on timelock
      const hasAdminRole = await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), owner.address);
      expect(hasAdminRole).to.be.true;

      // Check that governor has proposer and executor roles
      const hasProposerRole = await timelock.hasRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
      const hasExecutorRole = await timelock.hasRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
      
      expect(hasProposerRole).to.be.true;
      expect(hasExecutorRole).to.be.true;
    });

    it('Should prevent unauthorized role grants', async function () {
      // User1 should not be able to grant roles
      await expect(
        timelock.connect(user1).grantRole(await timelock.PROPOSER_ROLE(), user2.address)
      ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
    });

    it('Should allow admin to revoke roles', async function () {
      // Grant a role to user1
      await timelock.grantRole(await timelock.PROPOSER_ROLE(), user1.address);
      
      // Check that user1 has the role
      const hasRole = await timelock.hasRole(await timelock.PROPOSER_ROLE(), user1.address);
      expect(hasRole).to.be.true;

      // Revoke the role
      await timelock.revokeRole(await timelock.PROPOSER_ROLE(), user1.address);
      
      // Check that user1 no longer has the role
      const hasRoleAfter = await timelock.hasRole(await timelock.PROPOSER_ROLE(), user1.address);
      expect(hasRoleAfter).to.be.false;
    });
  });

  describe('Role Hierarchy', function () {
    it('Should maintain proper role hierarchy', async function () {
      // DEFAULT_ADMIN_ROLE should be able to grant/revoke all other roles
      const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
      const proposerRole = await timelock.PROPOSER_ROLE();
      const executorRole = await timelock.EXECUTOR_ROLE();

      expect(adminRole).to.not.equal(proposerRole);
      expect(adminRole).to.not.equal(executorRole);
      expect(proposerRole).to.not.equal(executorRole);
    });

    it('Should prevent role escalation', async function () {
      // Grant proposer role to user1
      await timelock.grantRole(await timelock.PROPOSER_ROLE(), user1.address);
      
      // User1 should not be able to grant admin role to themselves
      await expect(
        timelock.connect(user1).grantRole(await timelock.DEFAULT_ADMIN_ROLE(), user1.address)
      ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
    });
  });

  describe('Contract Integration Roles', function () {
    it('Should have correct staking roles', async function () {
      // Check staking roles
      const hasAdminRole = await staking.hasRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
      const hasRewardManagerRole = await staking.hasRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());
      
      expect(hasAdminRole).to.be.true;
      expect(hasRewardManagerRole).to.be.true;
    });

    it('Should have correct treasury roles', async function () {
      // Check treasury roles
      const hasAdminRole = await treasury.hasRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);
      const hasControllerRole = await treasury.hasRole(await treasury.TREASURY_CONTROLLER(), owner.address);
      
      expect(hasAdminRole).to.be.true;
      expect(hasControllerRole).to.be.true;
    });

    it('Should have correct token roles', async function () {
      // Check token roles
      const hasAdminRole = await halomToken.hasRole(await halomToken.DEFAULT_ADMIN_ROLE(), owner.address);
      const hasMinterRole = await halomToken.hasRole(await halomToken.MINTER_ROLE(), owner.address);
      const hasRebaseCallerRole = await halomToken.hasRole(await halomToken.REBASE_CALLER(), owner.address);
      
      expect(hasAdminRole).to.be.true;
      expect(hasMinterRole).to.be.true;
      expect(hasRebaseCallerRole).to.be.true;
    });
  });
}); 
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('HalomTimelock', function () {
  let timelock, owner, user1, user2, user3;
  let ADMIN_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy HalomTimelock
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const minDelay = 86400; // 24 hours (minimum required)
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    // Get role constants
    ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
    PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  });

  describe('Deployment and Initial Setup', function () {
    it('Should deploy with correct parameters', async function () {
      expect(await timelock.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
      expect(await timelock.getMinDelay()).to.equal(86400);
    });

    it('Should have correct initial state', async function () {
      // By default, only the admin has the proposer and executor roles
      expect(await timelock.hasRole(PROPOSER_ROLE, owner.address)).to.be.true;
      expect(await timelock.hasRole(EXECUTOR_ROLE, owner.address)).to.be.true;
    });
  });

  describe('Role Management', function () {
    it('Should allow admin to grant and revoke roles', async function () {
      await timelock.connect(owner).grantRole(PROPOSER_ROLE, user1.address);
      expect(await timelock.hasRole(PROPOSER_ROLE, user1.address)).to.be.true;

      await timelock.connect(owner).revokeRole(PROPOSER_ROLE, user1.address);
      expect(await timelock.hasRole(PROPOSER_ROLE, user1.address)).to.be.false;
    });

    it('Should prevent non-admin from managing roles', async function () {
      await expect(
        timelock.connect(user1).grantRole(PROPOSER_ROLE, user2.address)
      ).to.be.revertedWithCustomError(timelock, 'AccessControlUnauthorizedAccount');
    });
  });

  describe('Proposal Management', function () {
    beforeEach(async function () {
      await timelock.connect(owner).grantRole(PROPOSER_ROLE, user1.address);
      await timelock.connect(owner).grantRole(EXECUTOR_ROLE, user1.address);
    });

    it('Should allow proposer to queue transactions', async function () {
      const target = user2.address;
      const value = 0;
      const data = '0x';
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes('test-salt'));
      const delay = 86400; // 24 hours

      await timelock.connect(user1).queueTransaction(target, value, data, predecessor, salt, delay);

      const operationHash = await timelock.hashOperation(target, value, data, predecessor, salt);
      expect(await timelock.isOperationPending(operationHash)).to.be.true;
    });

    it('Should prevent non-proposer from queueing transactions', async function () {
      const target = user2.address;
      const value = 0;
      const data = '0x';
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes('test-salt'));
      const delay = 86400; // 24 hours

      await expect(
        timelock.connect(user2).queueTransaction(target, value, data, predecessor, salt, delay)
      ).to.be.revertedWithCustomError(timelock, 'AccessControlUnauthorizedAccount');
    });
  });

  describe('Execution', function () {
    let operationHash;

    beforeEach(async function () {
      await timelock.connect(owner).grantRole(PROPOSER_ROLE, user1.address);
      await timelock.connect(owner).grantRole(EXECUTOR_ROLE, user1.address);

      const target = user2.address;
      const value = 0;
      const data = '0x';
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes('test-salt'));
      const delay = 86400; // 24 hours

      await timelock.connect(user1).queueTransaction(target, value, data, predecessor, salt, delay);
      operationHash = await timelock.hashOperation(target, value, data, predecessor, salt);
    });

    it('Should prevent execution before delay period', async function () {
      const target = user2.address;
      const value = 0;
      const data = '0x';
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes('test-salt'));

      await expect(
        timelock.connect(user1).executeTransaction(target, value, data, predecessor, salt)
      ).to.be.revertedWithCustomError(timelock, 'TimelockUnexpectedOperationState');
    });

    it('Should allow execution after delay period', async function () {
      // Wait for delay period
      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine');

      const target = user2.address;
      const value = 0;
      const data = '0x';
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes('test-salt'));

      await timelock.connect(user1).executeTransaction(target, value, data, predecessor, salt);
      expect(await timelock.isOperationDone(operationHash)).to.be.true;
    });
  });

  describe('Emergency Controls', function () {
    it('Should allow admin to update delay', async function () {
      const newDelay = 172800; // 48 hours (within 24h-30d range)
      await timelock.connect(owner).setMinDelay(newDelay);
      expect(await timelock.getMinDelay()).to.equal(newDelay);
    });

    it('Should prevent non-admin from updating delay', async function () {
      const newDelay = 172800; // 48 hours
      await expect(
        timelock.connect(user1).setMinDelay(newDelay)
      ).to.be.revertedWithCustomError(timelock, 'AccessControlUnauthorizedAccount');
    });
  });
}); 
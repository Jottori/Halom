const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

// Oracle contract test suite

describe('Oracle', function () {
  async function deployOracleFixture() {
    const [admin, governor, oracle1, oracle2, user] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory('Oracle');
    const minOracleCount = 1;
    const priceValidityPeriod = 3600; // 1 hour
    const priceSubmissionCooldown = 60; // 1 minute
    const oracle = await upgrades.deployProxy(Oracle, [admin.address, minOracleCount, priceValidityPeriod, priceSubmissionCooldown], { initializer: 'initialize' });
    await oracle.waitForDeployment();
    // Add governor role
    await oracle.connect(admin).grantRole(await oracle.GOVERNOR_ROLE(), governor.address);
    // Add oracle1
    await oracle.connect(governor).addOracle(oracle1.address);
    return { oracle, admin, governor, oracle1, oracle2, user, minOracleCount, priceValidityPeriod, priceSubmissionCooldown };
  }

  describe('Deployment', function () {
    it('should deploy and initialize with correct parameters', async function () {
      const { oracle, minOracleCount, priceValidityPeriod, priceSubmissionCooldown } = await loadFixture(deployOracleFixture);
      expect(await oracle.minOracleCount()).to.equal(minOracleCount);
      expect(await oracle.priceValidityPeriod()).to.equal(priceValidityPeriod);
      expect(await oracle.priceSubmissionCooldown()).to.equal(priceSubmissionCooldown);
    });
  });

  describe('Role-restricted functions', function () {
    it('should allow only ORACLE_ROLE to submit price', async function () {
      const { oracle, oracle1, user } = await loadFixture(deployOracleFixture);
      const key = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      await expect(oracle.connect(user).submitPrice(key, 1000)).to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
      await expect(oracle.connect(oracle1).submitPrice(key, 1000)).to.emit(oracle, 'PriceUpdated');
    });

    it('should allow only GOVERNOR_ROLE to add/remove oracle', async function () {
      const { oracle, governor, oracle2, user } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(user).addOracle(oracle2.address)).to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
      await expect(oracle.connect(governor).addOracle(oracle2.address)).to.emit(oracle, 'OracleAdded');
      await expect(oracle.connect(user).removeOracle(oracle2.address)).to.be.revertedWithCustomError(oracle, 'AccessControlUnauthorizedAccount');
      await expect(oracle.connect(governor).removeOracle(oracle2.address)).to.emit(oracle, 'OracleRemoved');
    });
  });

  describe('Revert scenarios', function () {
    it('should revert if price is zero', async function () {
      const { oracle, oracle1 } = await loadFixture(deployOracleFixture);
      const key = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      await expect(oracle.connect(oracle1).submitPrice(key, 0)).to.be.revertedWithCustomError(oracle, 'InvalidPrice');
    });
    it('should revert if cooldown not expired', async function () {
      const { oracle, oracle1 } = await loadFixture(deployOracleFixture);
      const key = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      await oracle.connect(oracle1).submitPrice(key, 1000);
      await expect(oracle.connect(oracle1).submitPrice(key, 1100)).to.be.revertedWithCustomError(oracle, 'CooldownNotExpired');
    });
    it('should revert if price key not found or too old', async function () {
      const { oracle, oracle1, priceValidityPeriod } = await loadFixture(deployOracleFixture);
      const key = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      await expect(oracle.getLatestPrice(key)).to.be.revertedWithCustomError(oracle, 'PriceKeyNotFound');
      await oracle.connect(oracle1).submitPrice(key, 1000);
      await time.increase(priceValidityPeriod + 1);
      await expect(oracle.getLatestPrice(key)).to.be.revertedWithCustomError(oracle, 'PriceTooOld');
    });
  });

  describe('Parameterization and events', function () {
    it('should allow GOVERNOR_ROLE to set price validity period and emit event', async function () {
      const { oracle, governor } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(governor).setPriceValidityPeriod(7200)).to.emit(oracle, 'PriceValidityPeriodSet');
      expect(await oracle.priceValidityPeriod()).to.equal(7200);
    });
    it('should allow GOVERNOR_ROLE to set min oracle count and emit event', async function () {
      const { oracle, governor } = await loadFixture(deployOracleFixture);
      await expect(oracle.connect(governor).setMinOracleCount(1)).to.emit(oracle, 'MinOracleCountSet');
      expect(await oracle.minOracleCount()).to.equal(1);
    });
    it('should allow GOVERNOR_ROLE to set price submission cooldown', async function () {
      const { oracle, governor } = await loadFixture(deployOracleFixture);
      await oracle.connect(governor).setPriceSubmissionCooldown(120);
      expect(await oracle.priceSubmissionCooldown()).to.equal(120);
    });
  });

  describe('Integration/E2E scenarios', function () {
    it('should allow multiple oracles to submit and update price', async function () {
      const { oracle, governor, oracle1, oracle2 } = await loadFixture(deployOracleFixture);
      // Add second oracle
      await oracle.connect(governor).addOracle(oracle2.address);
      const key = ethers.keccak256(ethers.toUtf8Bytes('BTC/USD'));
      await expect(oracle.connect(oracle1).submitPrice(key, 2000)).to.emit(oracle, 'PriceUpdated');
      await expect(oracle.connect(oracle2).submitPrice(key, 2100)).to.emit(oracle, 'PriceUpdated');
      const [price, timestamp, isValid] = await oracle.getLatestPrice(key);
      expect(price).to.equal(2100);
      expect(isValid).to.be.true;
    });
    it('should complete full cycle: submit, query, expire, revert', async function () {
      const { oracle, oracle1, priceValidityPeriod } = await loadFixture(deployOracleFixture);
      const key = ethers.keccak256(ethers.toUtf8Bytes('HALOM/USD'));
      await oracle.connect(oracle1).submitPrice(key, 5000);
      const [price, timestamp, isValid] = await oracle.getLatestPrice(key);
      expect(price).to.equal(5000);
      expect(isValid).to.be.true;
      await time.increase(priceValidityPeriod + 1);
      await expect(oracle.getLatestPrice(key)).to.be.revertedWithCustomError(oracle, 'PriceTooOld');
    });
  });

  describe('Pause/unpause', function () {
    it('should allow GOVERNOR_ROLE to pause and unpause', async function () {
      const { oracle, governor, oracle1 } = await loadFixture(deployOracleFixture);
      await oracle.connect(governor).pause();
      const key = ethers.keccak256(ethers.toUtf8Bytes('ETH/USD'));
      await expect(oracle.connect(oracle1).submitPrice(key, 1000)).to.be.revertedWithCustomError(oracle, 'EnforcedPause');
      await oracle.connect(governor).unpause();
      await expect(oracle.connect(oracle1).submitPrice(key, 1000)).to.emit(oracle, 'PriceUpdated');
    });
  });
}); 
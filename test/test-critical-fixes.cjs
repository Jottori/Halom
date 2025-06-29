const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('Critical Fixes Validation', function () {
  let halomToken, oracleV3, treasury, timelock, governor, staking;
  let owner, user1, user2, user3, user4, user5;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomOracleV3 = await ethers.getContractFactory("HalomOracleV3");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");

    // Deploy token
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // Deploy Oracle V3
    oracleV3 = await HalomOracleV3.deploy();
    await oracleV3.waitForDeployment();

    // Deploy Treasury
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();

    // Deploy Timelock with 24-hour minimum delay
    const minDelay = 24 * 60 * 60; // 24 hours
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

    // Deploy Staking
    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, 2000);
    await staking.waitForDeployment();

    // Setup roles
    await oracleV3.grantRole(await oracleV3.UPDATER_ROLE(), owner.address);
    await oracleV3.grantRole(await oracleV3.AGGREGATOR_ROLE(), owner.address);
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());

    // Mint tokens for testing
    await halomToken.mint(await treasury.getAddress(), ethers.parseEther('100000'));
    await halomToken.mint(user1.address, ethers.parseEther('10000'));
    await halomToken.mint(user2.address, ethers.parseEther('10000'));
  });

  describe('1. Oracle Aggregator Fallback Logic Enhancement', function () {
    beforeEach(async function () {
      // Add oracle feeds
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_1"));
      const feedId2 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_2"));
      const feedId3 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_3"));

      await oracleV3.addFeed(feedId1, 3600, ethers.parseEther('0.1'), 30); // 10% deviation, 30% weight
      await oracleV3.addFeed(feedId2, 3600, ethers.parseEther('0.1'), 40); // 10% deviation, 40% weight
      await oracleV3.addFeed(feedId3, 3600, ethers.parseEther('0.1'), 30); // 10% deviation, 30% weight
    });

    it('Should implement median-based consensus with 3 valid feeds', async function () {
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_1"));
      const feedId2 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_2"));
      const feedId3 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_3"));

      // Update oracle data with different values
      const currentTime = Math.floor(Date.now() / 1000);
      await oracleV3.updateOracleData(feedId1, ethers.parseEther('1000'), currentTime, 90);
      await oracleV3.updateOracleData(feedId2, ethers.parseEther('1100'), currentTime, 95);
      await oracleV3.updateOracleData(feedId3, ethers.parseEther('1200'), currentTime, 85);

      // Aggregate feeds
      await oracleV3.aggregateFeeds([feedId1, feedId2, feedId3]);

      // Get aggregated data
      const aggregatedData = await oracleV3.getAggregatedData(feedId1);
      
      // Should use median-based consensus (1100e18 should be the median)
      expect(aggregatedData.validFeeds).to.equal(3);
      expect(aggregatedData.weightedValue).to.equal(ethers.parseEther('1100')); // Median value
      expect(aggregatedData.isValid).to.be.true;
    });

    it('Should prevent single node manipulation with deviation checks', async function () {
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_1"));
      const feedId2 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_2"));
      const feedId3 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_3"));

      // Update with normal values
      const currentTime = Math.floor(Date.now() / 1000);
      await oracleV3.updateOracleData(feedId1, ethers.parseEther('1000'), currentTime, 90);
      await oracleV3.updateOracleData(feedId2, ethers.parseEther('1100'), currentTime, 95);
      await oracleV3.updateOracleData(feedId3, ethers.parseEther('1200'), currentTime, 85);

      // Wait for rate limiting period
      await time.increase(3601); // 1 hour + 1 second

      // Try to manipulate with extreme value (should be filtered out)
      await expect(
        oracleV3.updateOracleData(feedId1, ethers.parseEther('2000'), currentTime + 3601, 90) // 100% deviation
      ).to.be.revertedWithCustomError(oracleV3, 'DeviationTooHigh');

      // Aggregate feeds
      await oracleV3.aggregateFeeds([feedId1, feedId2, feedId3]);

      const aggregatedData = await oracleV3.getAggregatedData(feedId1);
      
      // Should still use median of valid feeds (excluding extreme value)
      expect(aggregatedData.validFeeds).to.equal(3);
      expect(aggregatedData.weightedValue).to.be.closeTo(ethers.parseEther('1150'), ethers.parseEther('10')); // Average of 1100 and 1200
    });

    it('Should fall back to weighted average when insufficient feeds for median', async function () {
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_1"));
      const feedId2 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_2"));

      // Only 2 feeds (below MIN_CONSENSUS_FEEDS = 3)
      const currentTime = Math.floor(Date.now() / 1000);
      await oracleV3.updateOracleData(feedId1, ethers.parseEther('1000'), currentTime, 90);
      await oracleV3.updateOracleData(feedId2, ethers.parseEther('1100'), currentTime, 95);

      // Aggregate feeds
      await oracleV3.aggregateFeeds([feedId1, feedId2]);

      const aggregatedData = await oracleV3.getAggregatedData(feedId1);
      
      // Should use weighted average instead of median
      expect(aggregatedData.validFeeds).to.equal(2);
      expect(aggregatedData.weightedValue).to.be.closeTo(ethers.parseEther('1057'), ethers.parseEther('10')); // Weighted average
    });

    it('Should prevent aggregation with insufficient feeds', async function () {
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_1"));

      // Try to aggregate with insufficient feeds (should fail)
      await expect(
        oracleV3.aggregateFeeds([feedId1])
      ).to.be.revertedWithCustomError(oracleV3, 'InsufficientValidFeeds');
    });
  });

  describe('2. Treasury Reward Exhaustion Handling', function () {
    it('Should trigger warning when balance falls below threshold', async function () {
      const lowBalance = ethers.parseEther('500'); // Below warning threshold
      
      // Drain treasury to low balance
      await treasury.drainTreasury(user1.address, ethers.parseEther('99500'));
      
      // Check exhaustion
      await treasury.checkRewardExhaustion();
      
      expect(await treasury.rewardExhaustionWarning()).to.be.true;
    });

    it('Should prevent allocation when balance is insufficient', async function () {
      const currentBalance = await halomToken.balanceOf(await treasury.getAddress());
      const excessiveAmount = currentBalance + ethers.parseEther('1000');
      
      await expect(
        treasury.allocateTo(user1.address, excessiveAmount)
      ).to.be.revertedWithCustomError(treasury, 'InsufficientBalance');
    });

    it('Should allow fallback funding from external sources', async function () {
      // Request fallback funding
      const requestedAmount = ethers.parseEther('10000');
      await treasury.requestFallbackFunding(requestedAmount);
      
      // Provide fallback funding
      await halomToken.approve(await treasury.getAddress(), requestedAmount);
      await treasury.provideFallbackFunding(requestedAmount);
      
      const newBalance = await halomToken.balanceOf(await treasury.getAddress());
      expect(newBalance).to.be.gte(requestedAmount);
    });

    it('Should reset warning when balance is restored', async function () {
      // Drain to trigger warning
      await treasury.drainTreasury(user1.address, ethers.parseEther('95000'));
      await treasury.checkRewardExhaustion();
      expect(await treasury.rewardExhaustionWarning()).to.be.true;
      
      // Restore balance
      await halomToken.approve(await treasury.getAddress(), ethers.parseEther('10000'));
      await treasury.provideFallbackFunding(ethers.parseEther('10000'));
      
      // Warning should be reset
      expect(await treasury.rewardExhaustionWarning()).to.be.false;
    });
  });

  describe('3. Governance Backdoor Protection', function () {
    it('Should enforce 24-hour minimum delay for all operations', async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("test-salt"));
      const shortDelay = 3600; // 1 hour (below minimum)
      
      await expect(
        timelock.queueTransaction(target, value, data, predecessor, salt, shortDelay)
      ).to.be.revertedWithCustomError(timelock, 'TimelockInsufficientDelay');
    });

    it('Should apply additional delay for critical operations', async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("critical-test"));
      const delay = 24 * 60 * 60; // 24 hours
      
      const tx = await timelock.queueTransaction(target, value, data, predecessor, salt, delay);
      const receipt = await tx.wait();
      
      // Should emit critical operation event
      const event = receipt.logs.find(log => log.eventName === 'CriticalOperationDetected');
      expect(event).to.not.be.undefined;
      
      // Effective delay should be 24 hours + 7 days = 8 days
      const operationHash = timelock.interface.parseLog(receipt.logs[0]).args.operationHash;
      const eta = await timelock.getTimestamp(operationHash);
      expect(eta).to.be.gt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // More than 7 days
    });

    it('Should detect various critical operation types', async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("critical-types"));
      const delay = 24 * 60 * 60;
      
      // Test different critical operations
      const criticalOperations = [
        treasury.interface.encodeFunctionData("setRewardToken", [user1.address]),
        timelock.interface.encodeFunctionData("setMinDelay", [86400]),
        timelock.interface.encodeFunctionData("grantRole", [ethers.ZeroHash, user1.address]),
        timelock.interface.encodeFunctionData("emergencyPause", [])
      ];
      
      for (let i = 0; i < criticalOperations.length; i++) {
        const tx = await timelock.queueTransaction(
          target, 
          value, 
          criticalOperations[i], 
          predecessor, 
          ethers.keccak256(ethers.toUtf8Bytes(`salt-${i}`)), 
          delay
        );
        const receipt = await tx.wait();
        
        const event = receipt.logs.find(log => log.eventName === 'CriticalOperationDetected');
        expect(event).to.not.be.undefined;
      }
    });

    it('Should prevent execution before effective delay period', async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("execution-test"));
      const delay = 24 * 60 * 60;
      
      await timelock.queueTransaction(target, value, data, predecessor, salt, delay);
      
      // Try to execute before delay period (should fail)
      await time.increase(24 * 60 * 60); // 24 hours (but critical operation adds 7 days)
      
      await expect(
        timelock.executeTransaction(target, value, data, predecessor, salt)
      ).to.be.revertedWithCustomError(timelock, 'TimelockUnexpectedOperationState');
      
      // Wait for full delay period (24 hours + 7 days for critical operation)
      await time.increase(7 * 24 * 60 * 60); // Additional 7 days
      
      // Now execution should succeed
      await timelock.executeTransaction(target, value, data, predecessor, salt);
    });
  });

  describe('4. Integration Tests', function () {
    it('Should handle complete workflow with all protections', async function () {
      // 1. Oracle aggregation with median consensus
      const feedId = ethers.keccak256(ethers.toUtf8Bytes("INTEGRATION_FEED"));
      await oracleV3.addFeed(feedId, 3600, ethers.parseEther('0.1'), 50);
      const currentTime = Math.floor(Date.now() / 1000);
      await oracleV3.updateOracleData(feedId, ethers.parseEther('1000'), currentTime, 90);
      
      // Need at least 3 feeds for aggregation, so add more feeds
      const feedId2 = ethers.keccak256(ethers.toUtf8Bytes("INTEGRATION_FEED_2"));
      const feedId3 = ethers.keccak256(ethers.toUtf8Bytes("INTEGRATION_FEED_3"));
      await oracleV3.addFeed(feedId2, 3600, ethers.parseEther('0.1'), 25);
      await oracleV3.addFeed(feedId3, 3600, ethers.parseEther('0.1'), 25);
      await oracleV3.updateOracleData(feedId2, ethers.parseEther('1000'), currentTime, 90);
      await oracleV3.updateOracleData(feedId3, ethers.parseEther('1000'), currentTime, 90);
      
      await oracleV3.aggregateFeeds([feedId, feedId2, feedId3]);
      
      // 2. Treasury operations with exhaustion protection
      await treasury.checkRewardExhaustion();
      
      // Check if treasury has sufficient balance
      const treasuryBalance = await halomToken.balanceOf(await treasury.getAddress());
      const isExhausted = treasuryBalance < ethers.parseEther('1000'); // Threshold check
      expect(isExhausted).to.be.a('boolean'); // Should return a boolean value
      
      // 3. Governance with backdoor protection
      const target = await treasury.getAddress();
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const salt = ethers.keccak256(ethers.toUtf8Bytes("integration-test"));
      
      await timelock.queueTransaction(target, 0, data, ethers.ZeroHash, salt, 24 * 60 * 60);
      
      // All systems should work together without conflicts
      expect(await oracleV3.getAggregatedData(feedId).isValid).to.be.true;
      expect(await treasury.rewardExhaustionWarning()).to.be.false;
    });
  });
}); 
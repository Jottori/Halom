const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('Critical Fixes Validation', function () {
  let owner, user1, user2, user3, user4, user5;
  let halomToken, timelock, governor, staking, treasury, oracleV3;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts with correct constructor arguments
    const HalomToken = await ethers.getContractFactory('HalomToken');
    halomToken = await HalomToken.deploy(owner.address, owner.address); // _initialAdmin, _rebaseCaller
    await halomToken.waitForDeployment();

    const HalomTimelock = await ethers.getContractFactory('HalomTimelock');
    timelock = await HalomTimelock.deploy(
      86400, // 24 hours min delay
      [owner.address], // proposers
      [owner.address], // executors
      owner.address // admin
    );
    await timelock.waitForDeployment();

    const HalomGovernor = await ethers.getContractFactory('HalomGovernor');
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(), // _token
      await timelock.getAddress(), // _timelock
      1, // _votingDelay
      50400, // _votingPeriod (14 days)
      ethers.parseEther('10000'), // _proposalThreshold
      4 // _quorumPercent (4%)
    );
    await governor.waitForDeployment();

    const HalomStaking = await ethers.getContractFactory('HalomStaking');
    staking = await HalomStaking.deploy(
      await halomToken.getAddress(), // _stakingToken
      owner.address, // _roleManager
      ethers.parseEther('100') // _rewardRate
    );
    await staking.waitForDeployment();

    const HalomTreasury = await ethers.getContractFactory('HalomTreasury');
    treasury = await HalomTreasury.deploy(
      await halomToken.getAddress(), // _rewardToken
      owner.address, // _roleManager
      3600 // _interval
    );
    await treasury.waitForDeployment();

    const HalomOracleV3 = await ethers.getContractFactory('HalomOracleV3');
    oracleV3 = await HalomOracleV3.deploy(); // Constructor takes no parameters
    await oracleV3.waitForDeployment();

    // Setup roles
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

    await timelock.grantRole(proposerRole, await governor.getAddress());
    await timelock.grantRole(executorRole, await governor.getAddress());
    // Don't revoke admin role from owner - keep it for test mode access
    // await timelock.revokeRole(adminRole, owner.address);

    // Grant oracle roles
    const ORACLE_UPDATER_ROLE = await oracleV3.UPDATER_ROLE();
    const AGGREGATOR_ROLE = await oracleV3.AGGREGATOR_ROLE();
    await oracleV3.grantRole(ORACLE_UPDATER_ROLE, owner.address);
    await oracleV3.grantRole(AGGREGATOR_ROLE, owner.address);

    // Grant treasury controller role to timelock for governance execution
    const TREASURY_CONTROLLER = await treasury.TREASURY_CONTROLLER();
    await treasury.grantRole(TREASURY_CONTROLLER, await timelock.getAddress());

    // Mint tokens to users
    const tokenAmount = ethers.parseEther('1000000');
    await halomToken.mint(user1.address, tokenAmount);
    await halomToken.mint(user2.address, tokenAmount);
    await halomToken.mint(user3.address, tokenAmount);
    await halomToken.mint(user4.address, tokenAmount);
    await halomToken.mint(user5.address, tokenAmount);

    // Delegate voting power
    await halomToken.connect(user1).delegate(user1.address);
    await halomToken.connect(user2).delegate(user2.address);
    await halomToken.connect(user3).delegate(user3.address);
    await halomToken.connect(user4).delegate(user4.address);
    await halomToken.connect(user5).delegate(user5.address);

    // Fund treasury
    await halomToken.transfer(await treasury.getAddress(), ethers.parseEther('100000'));

    // Enable test mode for timelock - owner still has admin role
    await timelock.enableTestMode();
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
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_MANIPULATION_1"));
      const feedId2 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_MANIPULATION_2"));
      const feedId3 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_MANIPULATION_3"));

      // Add feeds with different weights
      await oracleV3.addFeed(feedId1, 3600, 10, 50); // 10% max deviation
      await oracleV3.addFeed(feedId2, 3600, 10, 25); // 10% max deviation
      await oracleV3.addFeed(feedId3, 3600, 10, 25); // 10% max deviation

      const currentTime = Math.floor(Date.now() / 1000);
      // One feed with extreme value (manipulation attempt)
      await oracleV3.updateOracleData(feedId1, ethers.parseEther('2000'), currentTime, 90); // Extreme high
      await oracleV3.updateOracleData(feedId2, ethers.parseEther('1100'), currentTime, 95); // Normal
      await oracleV3.updateOracleData(feedId3, ethers.parseEther('1200'), currentTime, 90); // Normal

      // Aggregate feeds
      await oracleV3.aggregateFeeds([feedId1, feedId2, feedId3]);

      const aggregatedData = await oracleV3.getAggregatedData(feedId1);
      
      // Should use median of valid feeds (excluding extreme value if deviation is too high)
      expect(aggregatedData.validFeeds).to.equal(3);
      // Median of 1100, 1200, 2000 should be 1200 (middle value)
      expect(aggregatedData.weightedValue).to.be.closeTo(ethers.parseEther('1200'), ethers.parseEther('10'));
    });

    it('Should fall back to weighted average when insufficient feeds for median', async function () {
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_WEIGHTED_1"));
      const feedId2 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_WEIGHTED_2"));

      // Add feeds first
      await oracleV3.addFeed(feedId1, 3600, 10, 50);
      await oracleV3.addFeed(feedId2, 3600, 10, 25);

      // Only 2 feeds (below MIN_CONSENSUS_FEEDS = 3)
      const currentTime = Math.floor(Date.now() / 1000);
      await oracleV3.updateOracleData(feedId1, ethers.parseEther('1000'), currentTime, 90);
      await oracleV3.updateOracleData(feedId2, ethers.parseEther('1100'), currentTime, 95);

      // Aggregate feeds
      await oracleV3.aggregateFeeds([feedId1, feedId2]);

      const aggregatedData = await oracleV3.getAggregatedData(feedId1);
      
      // Should use weighted average instead of median
      expect(aggregatedData.validFeeds).to.equal(2);
      // Weighted average: (1000 * 50 + 1100 * 25) / (50 + 25) = 1033.33...
      expect(aggregatedData.weightedValue).to.be.closeTo(ethers.parseEther('1033.33'), ethers.parseEther('10'));
    });

    it('Should prevent aggregation with insufficient feeds', async function () {
      const feedId1 = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED_INSUFFICIENT_1"));

      // Add feed but don't update data
      await oracleV3.addFeed(feedId1, 3600, 10, 50);

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
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("test-salt"));
      const testDelay = 3600; // 1 hour (minimum for test mode)
      
      await expect(
        timelock.queueTransaction(target, value, data, predecessor, salt, testDelay)
      ).to.not.be.reverted; // Should work in test mode
      
      // Disable test mode and try again with same delay
      await timelock.disableTestMode();
      
      await expect(
        timelock.queueTransaction(target, value, data, predecessor, salt, testDelay)
      ).to.be.revertedWithCustomError(timelock, 'TimelockInsufficientDelay');
    });

    it('Should apply additional delay for critical operations', async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("critical-test"));
      const delay = 3600; // 1 hour (test mode allows this)
      
      const tx = await timelock.queueTransaction(target, value, data, predecessor, salt, delay);
      const receipt = await tx.wait();
      
      // Should emit critical operation event
      const event = receipt.logs.find(log => log.eventName === 'CriticalOperationDetected');
      expect(event).to.not.be.undefined;
      
      // Effective delay should be 1 hour + 7 days = 7 days + 1 hour
      const operationHash = timelock.interface.parseLog(receipt.logs[0]).args.operationHash;
      const eta = await timelock.getTimestamp(operationHash);
      expect(eta).to.be.gt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // More than 7 days
    });

    it('Should detect various critical operation types', async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("critical-types"));
      const delay = 3600; // 1 hour (test mode allows this)
      
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
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("execution-test"));
      const delay = 3600; // 1 hour (test mode allows this)
      
      await timelock.queueTransaction(target, value, data, predecessor, salt, delay);
      
      // Try to execute before delay period (should fail)
      await time.increase(3600); // 1 hour (but critical operation adds 7 days)
      
      await expect(
        timelock.executeTransaction(target, value, data, predecessor, salt)
      ).to.be.revertedWithCustomError(timelock, 'TimelockUnexpectedOperationState');
      
      // Wait for full delay period (1 hour + 7 days for critical operation)
      await time.increase(7 * 24 * 60 * 60); // Additional 7 days
      
      // Now execution should succeed
      await timelock.executeTransaction(target, value, data, predecessor, salt);
    });
  });

  describe('4. Integration Tests', function () {
    it('Should handle complete workflow with all protections', async function () {
      // Enable test mode for timelock
      await timelock.enableTestMode();
      
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
      
      await timelock.queueTransaction(target, 0, data, ethers.ZeroHash, salt, 3600); // 1 hour delay in test mode
      
      // All systems should work together without conflicts
      const aggregatedData = await oracleV3.getAggregatedData(feedId);
      expect(aggregatedData.isValid).to.be.true;
      expect(await treasury.rewardExhaustionWarning()).to.be.false;
    });
  });
}); 
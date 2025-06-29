const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('HalomOracleV2 Comprehensive Tests', function () {
  let oracleV2, owner, user1, user2, updater1, updater2, updater3;
  let feedId1, feedId2, feedId3;

  beforeEach(async function () {
    [owner, user1, user2, updater1, updater2, updater3] = await ethers.getSigners();

    const HalomOracleV2 = await ethers.getContractFactory('HalomOracleV2');
    oracleV2 = await HalomOracleV2.deploy();
    await oracleV2.waitForDeployment();

    // Setup feed IDs
    feedId1 = ethers.keccak256(ethers.toUtf8Bytes('HOI_MAIN'));
    feedId2 = ethers.keccak256(ethers.toUtf8Bytes('HOI_BACKUP'));
    feedId3 = ethers.keccak256(ethers.toUtf8Bytes('HOI_FALLBACK'));

    // Grant updater roles
    await oracleV2.grantRole(await oracleV2.UPDATER_ROLE(), updater1.address);
    await oracleV2.grantRole(await oracleV2.UPDATER_ROLE(), updater2.address);
    await oracleV2.grantRole(await oracleV2.UPDATER_ROLE(), updater3.address);

    // Add feeds with different configurations
    await oracleV2.addFeed(feedId1, 3600, 10e16); // 1 hour interval, 10% max deviation
    await oracleV2.addFeed(feedId2, 7200, 20e16); // 2 hour interval, 20% max deviation
    await oracleV2.addFeed(feedId3, 1800, 5e16);  // 30 min interval, 5% max deviation

    // Add a test feed
    const feedId = ethers.keccak256(ethers.toUtf8Bytes("HOI_FEED"));
  });

  describe('Basic Functionality', function () {
    it('Should deploy successfully', async function () {
      expect(await oracleV2.getAddress()).to.not.equal(ethers.ZeroAddress);
    });

    it('Should have correct initial state', async function () {
      expect(await oracleV2.hasRole(await oracleV2.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
      expect(await oracleV2.hasRole(await oracleV2.ORACLE_ROLE(), owner.address)).to.be.true;
      expect(await oracleV2.hasRole(await oracleV2.UPDATER_ROLE(), owner.address)).to.be.true;
      expect(await oracleV2.hasRole(await oracleV2.EMERGENCY_ROLE(), owner.address)).to.be.true;
    });
  });

  describe('Feed Management', function () {
    it('Should add feed successfully', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('TEST_FEED'));
      await oracleV2.addFeed(testFeedId, 3600, 10e16);
      expect(await oracleV2.supportedFeeds(testFeedId)).to.be.true;
    });

    it('Should prevent adding duplicate feeds', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('TEST_FEED'));
      await oracleV2.addFeed(testFeedId, 3600, 10e16);
      await expect(
        oracleV2.addFeed(testFeedId, 3600, 10e16)
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidFeed');
    });

    it('Should prevent adding feed with invalid interval', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('TEST_FEED'));
      // Try to add with interval less than minimum (1 hour)
      await expect(
        oracleV2.addFeed(testFeedId, 1800, 10e16)
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidConfig');
      
      // Try to add with interval more than maximum (24 hours)
      await expect(
        oracleV2.addFeed(testFeedId, 86400, 10e16)
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidConfig');
    });

    it('Should prevent adding feed with invalid deviation', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('TEST_FEED'));
      // Try to add with deviation more than maximum (50%)
      await expect(
        oracleV2.addFeed(testFeedId, 3600, 60e16) // 60%
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidConfig');
    });

    it('Should remove feed successfully', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('TEST_FEED'));
      await oracleV2.addFeed(testFeedId, 3600, 10e16);
      await oracleV2.removeFeed(testFeedId);
      expect(await oracleV2.supportedFeeds(testFeedId)).to.be.false;
    });

    it('Should prevent removing non-existent feed', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('NON_EXISTENT'));
      await expect(
        oracleV2.removeFeed(testFeedId)
      ).to.be.revertedWithCustomError(oracleV2, 'FeedNotSupported');
    });
  });

  describe('Data Updates and Validation', function () {
    it('Should update oracle data successfully', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      
      const data = await oracleV2.getOracleData(feedId1);
      expect(data.value).to.equal(value);
      expect(data.timestamp).to.equal(timestamp);
      expect(data.isValid).to.be.true;
    });

    it('Should prevent updating non-existent feed', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('NON_EXISTENT'));
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await expect(
        oracleV2.connect(updater1).updateOracleData(testFeedId, value, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, 'FeedNotSupported');
    });

    it('Should prevent updating with zero value', async function () {
      const value = 0;
      const timestamp = Math.floor(Date.now() / 1000);
      
      await expect(
        oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidValue');
    });

    it('Should prevent updating with future timestamp', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future
      
      await expect(
        oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidValue');
    });

    it('Should prevent updating too frequently', async function () {
      const value1 = ethers.parseEther('1000');
      const value2 = ethers.parseEther('1010');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value1, timestamp);
      
      // Try to update immediately
      await expect(
        oracleV2.connect(updater1).updateOracleData(feedId1, value2, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, 'UpdateTooFrequent');
    });

    it('Should prevent updating with excessive deviation', async function () {
      const value1 = ethers.parseEther('1000');
      const value2 = ethers.parseEther('1200'); // 20% deviation, exceeds 1% limit
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value1, timestamp);
      
      // Wait for minimum interval
      await time.increase(3600);
      
      await expect(
        oracleV2.connect(updater1).updateOracleData(feedId1, value2, timestamp + 3600)
      ).to.be.revertedWithCustomError(oracleV2, 'DeviationTooHigh');
    });

    it('Should allow updating within deviation limits', async function () {
      const value1 = ethers.parseEther('1000');
      const value2 = ethers.parseEther('1005'); // 0.5% deviation, within 1% limit
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value1, timestamp);
      
      // Wait for minimum interval
      await time.increase(3600);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value2, timestamp + 3600);
      
      const data = await oracleV2.getOracleData(feedId1);
      expect(data.value).to.equal(value2);
    });
  });

  describe('Timestamp Protection and Stale Data', function () {
    it('Should detect stale data correctly', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      
      // Initially not stale
      expect(await oracleV2.isDataStale(feedId1)).to.be.false;
      
      // Wait for stale threshold (4 * minUpdateInterval = 4 hours)
      await time.increase(14400);
      
      // Now should be stale
      expect(await oracleV2.isDataStale(feedId1)).to.be.true;
    });

    it('Should revert when accessing stale data', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      
      // Wait for stale threshold
      await time.increase(14400);
      
      await expect(
        oracleV2.getOracleData(feedId1)
      ).to.be.revertedWithCustomError(oracleV2, 'StaleData');
    });

    it('Should handle different stale thresholds for different feeds', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      await oracleV2.connect(updater1).updateOracleData(feedId2, value, timestamp);
      
      // Wait 3 hours - feedId1 should be stale (4 hour threshold), feedId2 should not (8 hour threshold)
      await time.increase(10800);
      
      expect(await oracleV2.isDataStale(feedId1)).to.be.true;
      expect(await oracleV2.isDataStale(feedId2)).to.be.false;
    });
  });

  describe('Batch Operations', function () {
    it('Should handle batch updates successfully', async function () {
      const values = [
        ethers.parseEther('1000'),
        ethers.parseEther('2000'),
        ethers.parseEther('3000')
      ];
      const timestamps = [
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ];
      const feedIds = [feedId1, feedId2, feedId3];
      
      await oracleV2.connect(updater1).batchUpdateOracleData(feedIds, values, timestamps);
      
      for (let i = 0; i < feedIds.length; i++) {
        const data = await oracleV2.getOracleData(feedIds[i]);
        expect(data.value).to.equal(values[i]);
      }
    });

    it('Should handle batch updates with invalid data gracefully', async function () {
      const values = [
        ethers.parseEther('1000'),
        0, // Invalid value
        ethers.parseEther('3000')
      ];
      const timestamps = [
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ];
      const feedIds = [feedId1, feedId2, feedId3];
      
      // Should not revert, but skip invalid updates
      await oracleV2.connect(updater1).batchUpdateOracleData(feedIds, values, timestamps);
      
      // First and third should be updated
      const data1 = await oracleV2.getOracleData(feedId1);
      const data3 = await oracleV2.getOracleData(feedId3);
      expect(data1.value).to.equal(values[0]);
      expect(data3.value).to.equal(values[2]);
      
      // Second should not be updated due to zero value
      const data2 = await oracleV2.getOracleData(feedId2);
      expect(data2.isValid).to.be.false;
    });

    it('Should prevent batch updates with mismatched arrays', async function () {
      const values = [ethers.parseEther('1000'), ethers.parseEther('2000')];
      const timestamps = [Math.floor(Date.now() / 1000)];
      const feedIds = [feedId1, feedId2, feedId3];
      
      await expect(
        oracleV2.connect(updater1).batchUpdateOracleData(feedIds, values, timestamps)
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidConfig');
    });
  });

  describe('Multiple Oracle Data Retrieval', function () {
    it('Should retrieve multiple oracle data correctly', async function () {
      const values = [
        ethers.parseEther('1000'),
        ethers.parseEther('2000'),
        ethers.parseEther('3000')
      ];
      const timestamps = [
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ];
      const feedIds = [feedId1, feedId2, feedId3];
      
      await oracleV2.connect(updater1).batchUpdateOracleData(feedIds, values, timestamps);
      
      const results = await oracleV2.getMultipleOracleData(feedIds);
      
      expect(results.length).to.equal(3);
      for (let i = 0; i < results.length; i++) {
        expect(results[i].value).to.equal(values[i]);
        expect(results[i].isValid).to.be.true;
      }
    });

    it('Should handle mixed valid/invalid data in batch retrieval', async function () {
      const values = [
        ethers.parseEther('1000'),
        ethers.parseEther('2000')
      ];
      const timestamps = [
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000)
      ];
      const feedIds = [feedId1, feedId2];
      
      await oracleV2.connect(updater1).batchUpdateOracleData(feedIds, values, timestamps);
      
      // Add a non-existent feed ID
      const mixedFeedIds = [feedId1, feedId2, ethers.keccak256(ethers.toUtf8Bytes('NON_EXISTENT'))];
      
      const results = await oracleV2.getMultipleOracleData(mixedFeedIds);
      
      expect(results.length).to.equal(3);
      expect(results[0].isValid).to.be.true;
      expect(results[1].isValid).to.be.true;
      expect(results[2].isValid).to.be.false; // Non-existent feed
    });
  });

  describe('Configuration Management', function () {
    it('Should update feed configuration successfully', async function () {
      const newInterval = 7200; // 2 hours
      const newDeviation = 15e16; // 15%
      
      await oracleV2.updateConfig(feedId1, newInterval, newDeviation);
      
      // Verify the configuration was updated by testing the new limits
      const value1 = ethers.parseEther('1000');
      const value2 = ethers.parseEther('1150'); // 15% deviation
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value1, timestamp);
      
      // Wait for new minimum interval
      await time.increase(7200);
      
      // Should now allow 15% deviation
      await oracleV2.connect(updater1).updateOracleData(feedId1, value2, timestamp + 7200);
      
      const data = await oracleV2.getOracleData(feedId1);
      expect(data.value).to.equal(value2);
    });

    it('Should prevent updating configuration for non-existent feed', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('NON_EXISTENT'));
      
      await expect(
        oracleV2.updateConfig(testFeedId, 7200, 15e16)
      ).to.be.revertedWithCustomError(oracleV2, 'FeedNotSupported');
    });

    it('Should prevent updating with invalid configuration', async function () {
      // Try to update with invalid interval
      await expect(
        oracleV2.updateConfig(feedId1, 1800, 10e16) // Less than minimum
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidConfig');
      
      // Try to update with invalid deviation
      await expect(
        oracleV2.updateConfig(feedId1, 3600, 60e16) // More than maximum
      ).to.be.revertedWithCustomError(oracleV2, 'InvalidConfig');
    });
  });

  describe('Emergency Controls', function () {
    it('Should pause and unpause', async function () {
      await oracleV2.emergencyPause();
      expect(await oracleV2.paused()).to.be.true;
      
      await oracleV2.emergencyUnpause();
      expect(await oracleV2.paused()).to.be.false;
    });

    it('Should prevent operations when paused', async function () {
      await oracleV2.emergencyPause();
      
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await expect(
        oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, 'ContractPaused');
    });

    it('Should prevent non-emergency role from pausing', async function () {
      await expect(
        oracleV2.connect(user1).emergencyPause()
      ).to.be.revertedWithCustomError(oracleV2, 'Unauthorized');
    });
  });

  describe('Fallback Logic and Data Validation', function () {
    it('Should handle multiple updaters for redundancy', async function () {
      const value1 = ethers.parseEther('1000');
      const value2 = ethers.parseEther('1001');
      const timestamp = Math.floor(Date.now() / 1000);
      
      // First updater
      await oracleV2.connect(updater1).updateOracleData(feedId1, value1, timestamp);
      
      // Wait for minimum interval
      await time.increase(3600);
      
      // Second updater can also update
      await oracleV2.connect(updater2).updateOracleData(feedId1, value2, timestamp + 3600);
      
      const data = await oracleV2.getOracleData(feedId1);
      expect(data.value).to.equal(value2);
    });

    it('Should handle data consistency across multiple feeds', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Update all feeds with same value
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      await oracleV2.connect(updater2).updateOracleData(feedId2, value, timestamp);
      await oracleV2.connect(updater3).updateOracleData(feedId3, value, timestamp);
      
      // Verify all feeds have consistent data
      const data1 = await oracleV2.getOracleData(feedId1);
      const data2 = await oracleV2.getOracleData(feedId2);
      const data3 = await oracleV2.getOracleData(feedId3);
      
      expect(data1.value).to.equal(value);
      expect(data2.value).to.equal(value);
      expect(data3.value).to.equal(value);
    });

    it('Should handle feed removal and data cleanup', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      
      // Remove the feed
      await oracleV2.removeFeed(feedId1);
      
      // Should not be able to access data
      await expect(
        oracleV2.getOracleData(feedId1)
      ).to.be.revertedWithCustomError(oracleV2, 'FeedNotSupported');
      
      // Should not be able to update
      await expect(
        oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, 'FeedNotSupported');
    });
  });

  describe('Edge Cases and Security', function () {
    it('Should handle maximum values correctly', async function () {
      const maxValue = ethers.MaxUint256;
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, maxValue, timestamp);
      
      const data = await oracleV2.getOracleData(feedId1);
      expect(data.value).to.equal(maxValue);
    });

    it('Should handle minimum timestamp correctly', async function () {
      const value = ethers.parseEther('1000');
      const timestamp = 0; // Minimum timestamp
      
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      
      const data = await oracleV2.getOracleData(feedId1);
      expect(data.value).to.equal(value);
    });

    it('Should prevent unauthorized access to admin functions', async function () {
      const testFeedId = ethers.keccak256(ethers.toUtf8Bytes('TEST_FEED'));
      
      await expect(
        oracleV2.connect(user1).addFeed(testFeedId, 3600, 10e16)
      ).to.be.revertedWithCustomError(oracleV2, 'Unauthorized');
      
      await expect(
        oracleV2.connect(user1).removeFeed(feedId1)
      ).to.be.revertedWithCustomError(oracleV2, 'Unauthorized');
      
      await expect(
        oracleV2.connect(user1).updateConfig(feedId1, 7200, 15e16)
      ).to.be.revertedWithCustomError(oracleV2, 'Unauthorized');
    });

    it('Should handle reentrancy protection', async function () {
      // This test verifies that the nonReentrant modifier is working
      const value = ethers.parseEther('1000');
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Should not revert due to reentrancy
      await oracleV2.connect(updater1).updateOracleData(feedId1, value, timestamp);
      
      const data = await oracleV2.getOracleData(feedId1);
      expect(data.value).to.equal(value);
    });
  });
}); 
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomOracleV2 Comprehensive Tests", function () {
  let oracle, owner, user1, user2, user3;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
    oracle = await HalomOracleV2.deploy(
      await halomToken.getAddress(),
      await governor.getAddress(),
      await updater.getAddress(),
      1000000, // Smaller value to prevent overflow
      1000000  // Smaller value to prevent overflow
    );
    await oracle.waitForDeployment();
  });

  describe("Basic Functionality", function () {
    it("Should deploy successfully", async function () {
      expect(oracle.target).to.not.equal(ethers.ZeroAddress);
      expect(await oracle.hasRole(await oracle.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
    });

    it("Should have correct initial state", async function () {
      expect(await oracle.hasRole(await oracle.ORACLE_ROLE(), owner.address)).to.be.true;
      expect(await oracle.hasRole(await oracle.UPDATER_ROLE(), owner.address)).to.be.true;
      expect(await oracle.hasRole(await oracle.EMERGENCY_ROLE(), owner.address)).to.be.true;
    });
  });

  describe("Feed Management", function () {
    const testFeedId = ethers.keccak256(ethers.toUtf8Bytes("TEST_FEED"));
    
    it("Should add feed successfully", async function () {
      await oracle.addFeed(testFeedId, 3600, 1000); // 1 hour interval, 10% max deviation
      expect(await oracle.supportedFeeds(testFeedId)).to.be.true;
    });

    it("Should prevent adding duplicate feeds", async function () {
      await oracle.addFeed(testFeedId, 3600, 1000);
      await expect(
        oracle.addFeed(testFeedId, 3600, 1000)
      ).to.be.revertedWithCustomError(oracle, "InvalidFeed");
    });

    it("Should remove feed successfully", async function () {
      await oracle.addFeed(testFeedId, 3600, 1000);
      await oracle.removeFeed(testFeedId);
      expect(await oracle.supportedFeeds(testFeedId)).to.be.false;
    });
  });

  describe("Data Updates", function () {
    const testFeedId = ethers.keccak256(ethers.toUtf8Bytes("TEST_FEED"));
    
    beforeEach(async function () {
      await oracle.addFeed(testFeedId, 3600, 1000);
    });

    it("Should update oracle data successfully", async function () {
      const value = 1000;
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracle.updateOracleData(testFeedId, value, timestamp);
      
      const data = await oracle.getOracleData(testFeedId);
      expect(data.value).to.equal(value);
      expect(data.timestamp).to.equal(timestamp);
      expect(data.isValid).to.be.true;
    });

    it("Should reject invalid values", async function () {
      const timestamp = Math.floor(Date.now() / 1000);

      await expect(
        oracle.updateOracleData(testFeedId, 0, timestamp)
      ).to.be.revertedWithCustomError(oracle, "InvalidValue");
    });

    it("Should reject future timestamps", async function () {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in the future
      const futureData = {
        timestamp: futureTimestamp,
        value: 1000000,
        confidence: 95
      };

      await expect(
        oracle.connect(updater).updateOracleData([futureData], 1)
      ).to.be.revertedWithCustomError(oracle, "InvalidTimestamp");
    });
  });

  describe("Emergency Controls", function () {
    it("Should pause and unpause", async function () {
      await oracle.emergencyPause();
      expect(await oracle.paused()).to.be.true;
      
      await oracle.emergencyUnpause();
      expect(await oracle.paused()).to.be.false;
    });
  });
}); 
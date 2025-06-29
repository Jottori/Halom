const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomOracleV2 Comprehensive Tests", function () {
  let oracleV2, halomToken, governor, updater, owner, user1, user2, user3;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy required contracts first
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    const minDelay = 86400; // 24 hours (minimum required)
    const timelock = await HalomTimelock.deploy(minDelay, [owner.address], [owner.address], owner.address);
    governor = await HalomGovernor.deploy(await halomToken.getAddress(), await timelock.getAddress(), 1, 10, 0, 4);
    updater = user1; // Use user1 as updater

    const HalomOracleV2 = await ethers.getContractFactory('HalomOracleV2');
    oracleV2 = await HalomOracleV2.deploy(); // No constructor arguments
    await oracleV2.waitForDeployment();
  });

  describe("Basic Functionality", function () {
    it("Should deploy successfully", async function () {
      expect(oracleV2.target).to.not.equal(ethers.ZeroAddress);
      expect(await oracleV2.hasRole(await oracleV2.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
    });

    it("Should have correct initial state", async function () {
      expect(await oracleV2.hasRole(await oracleV2.ORACLE_ROLE(), owner.address)).to.be.true;
      expect(await oracleV2.hasRole(await oracleV2.UPDATER_ROLE(), owner.address)).to.be.true;
      expect(await oracleV2.hasRole(await oracleV2.EMERGENCY_ROLE(), owner.address)).to.be.true;
    });
  });

  describe("Feed Management", function () {
    const testFeedId = ethers.keccak256(ethers.toUtf8Bytes("TEST_FEED"));
    
    it("Should add feed successfully", async function () {
      await oracleV2.addFeed(testFeedId, 3600, 1000); // 1 hour interval, 10% max deviation
      expect(await oracleV2.supportedFeeds(testFeedId)).to.be.true;
    });

    it("Should prevent adding duplicate feeds", async function () {
      await oracleV2.addFeed(testFeedId, 3600, 1000);
      await expect(
        oracleV2.addFeed(testFeedId, 3600, 1000)
      ).to.be.revertedWithCustomError(oracleV2, "InvalidFeed");
    });

    it("Should remove feed successfully", async function () {
      await oracleV2.addFeed(testFeedId, 3600, 1000);
      await oracleV2.removeFeed(testFeedId);
      expect(await oracleV2.supportedFeeds(testFeedId)).to.be.false;
    });
  });

  describe("Data Updates", function () {
    const testFeedId = ethers.keccak256(ethers.toUtf8Bytes("TEST_FEED"));
    
    beforeEach(async function () {
      await oracleV2.addFeed(testFeedId, 3600, 1000);
    });

    it("Should update oracle data successfully", async function () {
      const value = 1000;
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.updateOracleData(testFeedId, value, timestamp);
      
      const data = await oracleV2.getOracleData(testFeedId);
      expect(data.value).to.equal(value);
      expect(data.timestamp).to.equal(timestamp);
      expect(data.isValid).to.be.true;
    });

    it("Should reject invalid values", async function () {
      const timestamp = Math.floor(Date.now() / 1000);

      await expect(
        oracleV2.updateOracleData(testFeedId, 0, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, "InvalidValue");
    });

    it("Should reject future timestamps", async function () {
      const futureData = {
        feedId: testFeedId,
        value: ethers.parseEther("1000"),
        timestamp: Math.floor(Date.now() / 1000) + 3600 // 1 hour in future
      };

      await expect(
        oracleV2.connect(updater).updateOracleData([futureData], 1)
      ).to.be.revertedWithCustomError(oracleV2, "InvalidValue");
    });
  });

  describe("Emergency Controls", function () {
    it("Should pause and unpause", async function () {
      await oracleV2.emergencyPause();
      expect(await oracleV2.paused()).to.be.true;
      
      await oracleV2.emergencyUnpause();
      expect(await oracleV2.paused()).to.be.false;
    });
  });
}); 
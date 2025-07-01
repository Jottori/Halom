const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomOracleV2 Comprehensive Tests", function () {
  let oracleV2, halomToken, governor, updater, owner, user1, user2, user3;
  let testFeedId;

  beforeEach(async function () {
    [owner, updater, user1, user2, user3] = await ethers.getSigners();

    // Deploy required contracts first
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    const minDelay = 86400; // 24 hours (minimum required)
    const timelock = await HalomTimelock.deploy(minDelay, [owner.address], [owner.address], owner.address);
    governor = await HalomGovernor.deploy(await halomToken.getAddress(), await timelock.getAddress(), 1, 10, 0, 4);

    // Deploy OracleV2 (no constructor arguments needed)
    const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
    oracleV2 = await HalomOracleV2.deploy();
    
    // Grant UPDATER_ROLE to user1 for testing
    await oracleV2.grantRole(oracleV2.UPDATER_ROLE, updater.address);
    
    // Add a test feed
    const feedId = ethers.keccak256(ethers.toUtf8Bytes("TEST"));
    const minUpdateInterval = 3600; // 1 hour
    const maxDeviationPercent = 10e16; // 10%
    
    await oracleV2.connect(owner).addFeed(feedId, minUpdateInterval, maxDeviationPercent);
  });

  describe("Basic Functionality", function () {
    it("Should deploy successfully", async function () {
      expect(await oracleV2.getAddress()).to.not.equal(ethers.ZeroAddress);
    });

    it("Should have correct initial state", async function () {
      expect(await oracleV2.PRECISION()).to.equal(ethers.parseEther("1"));
      expect(await oracleV2.MAX_DEVIATION()).to.equal(ethers.parseEther("0.5"));
    });
  });

  describe("Feed Management", function () {
    it("Should add new feed", async function () {
      // Add a new feed with correct parameters
      const feedId = ethers.keccak256(ethers.toUtf8Bytes("TEST"));
      const minUpdateInterval = 3600; // 1 hour
      const maxDeviationPercent = 10e16; // 10%
      
      await oracleV2.connect(owner).addFeed(feedId, minUpdateInterval, maxDeviationPercent);
      
      // Verify feed was added
      const isSupported = await oracleV2.supportedFeeds(feedId);
      expect(isSupported).to.be.true;
    });

    it("Should update feed data", async function () {
      // Add a feed first
      const feedId = ethers.keccak256(ethers.toUtf8Bytes("TEST2"));
      const minUpdateInterval = 3600; // 1 hour
      const maxDeviationPercent = 10e16; // 10%
      
      await oracleV2.connect(owner).addFeed(feedId, minUpdateInterval, maxDeviationPercent);
      
      // Update the feed
      const newValue = 2000000000;
      await oracleV2.connect(user1).updateOracleData(feedId, newValue, Math.floor(Date.now() / 1000));
      
      // Verify update
      const updatedData = await oracleV2.getOracleData(feedId);
      expect(updatedData.value).to.equal(newValue);
    });

    it("Should remove feed successfully", async function () {
      const feedId = ethers.keccak256(ethers.toUtf8Bytes("TEST"));
      await oracleV2.removeFeed(feedId);
      expect(await oracleV2.supportedFeeds(feedId)).to.be.false;
    });
  });

  describe("Data Updates", function () {
    it("Should update oracle data successfully", async function () {
      const feedId = ethers.keccak256(ethers.toUtf8Bytes("TEST"));
      const value = 2000000000; // Smaller value to avoid overflow
      const timestamp = Math.floor(Date.now() / 1000);
      
      await oracleV2.connect(user1).updateOracleData(feedId, value, timestamp);
      
      const data = await oracleV2.getOracleData(feedId);
      expect(data.value).to.equal(value);
    });

    it("Should reject invalid values", async function () {
      const timestamp = Math.floor(Date.now() / 1000);
      const feedId = ethers.keccak256(ethers.toUtf8Bytes("TEST"));

      await expect(
        oracleV2.connect(updater).updateOracleData(feedId, 0, timestamp)
      ).to.be.revertedWithCustomError(oracleV2, "InvalidValue");
    });

    it("Should reject future timestamps", async function () {
      const feedId = ethers.keccak256(ethers.toUtf8Bytes("FUTURE"));
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future
      const value = 1000000000; // Use a smaller value to avoid overflow
      
      await expect(
        oracleV2.connect(user1).updateOracleData(feedId, value, futureTimestamp)
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
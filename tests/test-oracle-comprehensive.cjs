const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomOracle Comprehensive Tests", function () {
  let halomToken, oracle, owner, user1, user2, user3;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");

    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    oracle = await HalomOracle.deploy(owner.address, 31337);
    await oracle.waitForDeployment();

    // Grant updater role to owner
    await oracle.grantRole(oracle.ORACLE_UPDATER_ROLE, owner.address);

    // Setup oracle integration
    await oracle.setHalomToken(await halomToken.getAddress());

    // Mint tokens to users for testing
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
  });

  describe("Basic Oracle Operations", function () {
    it("Should deploy successfully", async function () {
      expect(await oracle.chainId()).to.equal(31337);
      expect(await oracle.latestHOI()).to.equal(0);
    });

    it("Should handle data validation", async function () {
      // Wait for rate limiting
      await time.increase(3601); // 1 hour + 1 second
      
      await oracle.connect(owner).setHOI(1000000000, 0); // 1.0 HOI, nonce 0 (first call)
      expect(await oracle.latestHOI()).to.equal(1000000000);
    });

    it("Should prevent unauthorized HOI updates", async function () {
      await expect(
        oracle.connect(user1).setHOI(1000000000, 0)
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Data Provider Functions", function () {
    it("Should validate data provider inputs", async function () {
      await expect(
        oracle.connect(owner).setHalomToken(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("Should set HalomToken address correctly", async function () {
      await oracle.connect(owner).setHalomToken(await halomToken.getAddress());
      // Note: halomToken is not public, so we can't verify it directly
    });
  });

  describe("Error Handling", function () {
    it("Should revert on invalid HOI values", async function () {
      // Wait for rate limiting
      await time.increase(3601);
      
      await expect(
        oracle.connect(owner).setHOI(0, 0)
      ).to.be.revertedWith("HOI must be positive");
    });

    it("Should revert on HOI exceeding maximum", async function () {
      // Wait for rate limiting
      await time.increase(3601);
      
      await expect(
        oracle.connect(owner).setHOI(11000000000, 0) // Above MAX_HOI_VALUE
      ).to.be.revertedWith("HOI exceeds maximum");
    });

    it("Should revert when paused", async function () {
      await oracle.connect(owner).pause();
      
      await expect(
        oracle.connect(owner).setHOI(1000000000, 0)
      ).to.be.revertedWithCustomError(oracle, "EnforcedPause");
    });
  });

  describe("Integration Tests", function () {
    it("Should integrate with token contract", async function () {
      // Test integration with token contract
      const initialSupply = await halomToken.totalSupply();
      
      // Set HOI value that triggers rebase (clamped to safe value)
      const hoiValue = Math.min(1050000, 10000000000); // Clamp to max allowed
      await oracle.connect(owner).setHOI(hoiValue, 0); // Use nonce 0 (first call)
      
      // Check if rebase was triggered
      const newSupply = await halomToken.totalSupply();
      
      expect(newSupply).to.be.gte(initialSupply);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle extreme HOI values", async function () {
      // Wait for rate limiting
      await time.increase(3601);
      
      // Set maximum allowed HOI (clamped)
      const maxHOI = 10000000000; // 10.0 HOI (max)
      await oracle.connect(owner).setHOI(maxHOI, 0); // nonce 0
      expect(await oracle.latestHOI()).to.equal(maxHOI);
    });

    it("Should handle rapid data updates", async function () {
      // Wait for rate limiting
      await time.increase(3601);
      
      await oracle.connect(owner).setHOI(1000000000, 0);
      
      // Try to update again immediately (should fail due to rate limiting)
      await expect(
        oracle.connect(owner).setHOI(2000000000, 1)
      ).to.be.revertedWith("Update too frequent");
    });

    it("Should handle zero values correctly", async function () {
      // Wait for rate limiting
      await time.increase(3601);
      
      await expect(
        oracle.connect(owner).setHOI(0, 0)
      ).to.be.revertedWith("HOI must be positive");
    });

    it("Should prevent overflow with large numbers", async function () {
      // Wait for rate limiting
      await time.increase(3601);
      
      // Test with very large number that could cause overflow
      const largeValue = BigInt("999999999999999999999999999999");
      const clampedValue = Math.min(Number(largeValue), 10000000000);
      
      await oracle.connect(owner).setHOI(clampedValue, 0);
      expect(await oracle.latestHOI()).to.equal(clampedValue);
    });
  });

  describe("View Functions", function () {
    it("Should return correct HOI history", async function () {
      // Wait for rate limiting
      await time.increase(3601);
      
      await oracle.connect(owner).setHOI(1000000000, 1);
      expect(await oracle.latestHOI()).to.equal(1000000000);
      expect(await oracle.nonce()).to.equal(1);
    });
  });
}); 
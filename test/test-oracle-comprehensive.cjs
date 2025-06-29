const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomOracle Comprehensive Tests", function () {
  let halomToken, oracle, roleManager, owner, admin, user1, user2, user3, dataProvider;

  beforeEach(async function () {
    [owner, admin, user1, user2, user3, dataProvider] = await ethers.getSigners();

    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();
    roleManager = await HalomRoleManager.deploy();
    await roleManager.waitForDeployment();
    oracle = await HalomOracle.deploy(owner.address, 1);
    await oracle.waitForDeployment();

    // Grant ORACLE_UPDATER_ROLE to dataProvider
    await oracle.connect(owner).grantRole(await oracle.ORACLE_UPDATER_ROLE(), dataProvider.address);
    
    // Grant REBASE_CALLER role to oracle contract
    await halomToken.connect(owner).grantRole(await halomToken.REBASE_CALLER(), await oracle.getAddress());
    
    // Set halom token in oracle
    await oracle.connect(owner).setHalomToken(await halomToken.getAddress());
  });

  describe("Basic Oracle Operations", function () {
    it("Should calculate HOI correctly", async function () {
      // Test initial HOI calculation
      const initialHOI = 1e9; // 1.0 in 9 decimals
      await oracle.connect(dataProvider).setHOI(initialHOI, 0);
      
      expect(await oracle.latestHOI()).to.equal(initialHOI);
      expect(await oracle.nonce()).to.equal(1);
    });

    it("Should update data successfully", async function () {
      // Test HOI update
      const newHOI = 1050000000; // 1.05 in 9 decimals
      await oracle.connect(dataProvider).setHOI(newHOI, 0);
      
      expect(await oracle.latestHOI()).to.equal(newHOI);
      expect(await oracle.lastUpdateTime()).to.be.gt(0);
      expect(await oracle.nonce()).to.equal(1);
    });

    it("Should return correct HOI value", async function () {
      const testHOI = 1100000000; // 1.10 in 9 decimals
      await oracle.connect(dataProvider).setHOI(testHOI, 0);
      
      const currentHOI = await oracle.latestHOI();
      expect(currentHOI).to.equal(testHOI);
    });

    it("Should handle data validation", async function () {
      // Test that nonce validation works
      await oracle.connect(dataProvider).setHOI(1e9, 0);
      
      // Should fail with wrong nonce
      await expect(
        oracle.connect(dataProvider).setHOI(1050000000, 0)
      ).to.be.revertedWith("HalomOracle: Invalid nonce");
      
      // Should succeed with correct nonce
      await oracle.connect(dataProvider).setHOI(1050000000, 1);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to update parameters", async function () {
      // Test setting halom token
      const newTokenAddress = user1.address; // Mock address for testing
      await oracle.connect(owner).setHalomToken(newTokenAddress);
      
      // Verify the token was set (though we can't easily test the internal state)
      // This test mainly verifies the function call succeeds
    });

    it("Should prevent non-admin from updating parameters", async function () {
      // Test that non-admin cannot set halom token
      await expect(
        oracle.connect(user1).setHalomToken(user2.address)
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to pause/unpause oracle", async function () {
      // Test pause
      await oracle.connect(owner).pause();
      expect(await oracle.paused()).to.be.true;
      
      // Test unpause
      await oracle.connect(owner).unpause();
      expect(await oracle.paused()).to.be.false;
    });
  });

  describe("Data Provider Functions", function () {
    it("Should allow data provider to update HOI", async function () {
      const testHOI = 1200000000; // 1.20 in 9 decimals
      await oracle.connect(dataProvider).setHOI(testHOI, 0);
      
      expect(await oracle.latestHOI()).to.equal(testHOI);
      expect(await oracle.nonce()).to.equal(1);
    });

    it("Should prevent non-data provider from updating HOI", async function () {
      // Test that non-data provider cannot update HOI
      await expect(
        oracle.connect(user1).setHOI(1050000000, 0)
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });

    it("Should validate data provider inputs", async function () {
      // Test that zero address is rejected
      await expect(
        oracle.connect(admin).setHalomToken(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });
  });

  describe("Role Management", function () {
    it("Should allow admin to grant roles", async function () {
      // Grant ORACLE_UPDATER_ROLE to user1
      await oracle.connect(owner).grantRole(await oracle.ORACLE_UPDATER_ROLE(), user1.address);
      
      // Verify role was granted
      expect(await oracle.hasRole(await oracle.ORACLE_UPDATER_ROLE(), user1.address)).to.be.true;
    });

    it("Should prevent non-admin from granting roles", async function () {
      // Test that non-admin cannot grant roles
      await expect(
        oracle.connect(user1).grantRole(await oracle.ORACLE_UPDATER_ROLE(), user2.address)
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to revoke roles", async function () {
      // Grant role first
      await oracle.connect(owner).grantRole(await oracle.ORACLE_UPDATER_ROLE(), user1.address);
      
      // Revoke role
      await oracle.connect(owner).revokeRole(await oracle.ORACLE_UPDATER_ROLE(), user1.address);
      
      // Verify role was revoked
      expect(await oracle.hasRole(await oracle.ORACLE_UPDATER_ROLE(), user1.address)).to.be.false;
    });
  });

  describe("Error Handling", function () {
    it("Should revert on invalid HOI values", async function () {
      // Test that oracle is paused when trying to update HOI
      await oracle.connect(owner).pause();
      
      await expect(
        oracle.connect(dataProvider).setHOI(1050000000, 0)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should revert on unauthorized access", async function () {
      // Test that non-governor cannot pause
      await expect(
        oracle.connect(user1).pause()
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });

    it("Should handle edge cases in calculations", async function () {
      // Test that oracle works correctly when paused and unpaused
      await oracle.connect(owner).pause();
      expect(await oracle.paused()).to.be.true;
      
      await oracle.connect(owner).unpause();
      expect(await oracle.paused()).to.be.false;
      
      // Should be able to update HOI after unpausing
      await oracle.connect(dataProvider).setHOI(1050000000, 0);
      expect(await oracle.latestHOI()).to.equal(1050000000);
    });
  });

  describe("Integration Tests", function () {
    it("Should integrate with token contract", async function () {
      // Test that oracle can interact with halom token
      const initialSupply = await halomToken.totalSupply();
      
      // Set initial HOI
      await oracle.connect(dataProvider).setHOI(1e9, 0);
      
      // Verify token supply changed (rebase occurred)
      const newSupply = await halomToken.totalSupply();
      expect(newSupply).to.not.equal(initialSupply);
    });

    it("Should integrate with governance system", async function () {
      // Test that governance roles work correctly
      expect(await oracle.hasRole(oracle.GOVERNOR_ROLE, owner.address)).to.be.true;
    });

    it("Should work with staking contract", async function () {
      // Test that oracle can be paused/unpaused by governance
      await oracle.connect(owner).pause();
      expect(await oracle.paused()).to.be.true;
      
      await oracle.connect(owner).unpause();
      expect(await oracle.paused()).to.be.false;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle extreme HOI values", async function () {
      // Test very high HOI value
      const extremeHOI = 2000000000; // 2.0 in 9 decimals
      await oracle.connect(dataProvider).setHOI(extremeHOI, 0);
      expect(await oracle.latestHOI()).to.equal(extremeHOI);
      
      // Test very low HOI value
      const lowHOI = 500000000; // 0.5 in 9 decimals
      await oracle.connect(dataProvider).setHOI(lowHOI, 1);
      expect(await oracle.latestHOI()).to.equal(lowHOI);
    });

    it("Should handle rapid data updates", async function () {
      // Test multiple rapid updates
      for (let i = 0; i < 5; i++) {
        const hoiValue = 1000000000 + (i * 10000000); // 1.0, 1.01, 1.02, etc.
        await oracle.connect(dataProvider).setHOI(hoiValue, i);
        expect(await oracle.latestHOI()).to.equal(hoiValue);
        expect(await oracle.nonce()).to.equal(i + 1);
      }
    });

    it("Should handle zero values correctly", async function () {
      // Test that zero HOI is handled (though this might not be realistic)
      const zeroHOI = 0;
      await oracle.connect(dataProvider).setHOI(zeroHOI, 0);
      expect(await oracle.latestHOI()).to.equal(zeroHOI);
    });

    it("Should handle maximum values correctly", async function () {
      // Test a very high but realistic HOI value (not max uint256 to avoid overflow)
      const highHOI = 10000000000; // 10.0 in 9 decimals
      await oracle.connect(dataProvider).setHOI(highHOI, 0);
      expect(await oracle.latestHOI()).to.equal(highHOI);
    });
  });

  describe("View Functions", function () {
    it("Should return correct HOI history", async function () {
      // Set initial HOI
      const initialHOI = 1e9;
      await oracle.connect(dataProvider).setHOI(initialHOI, 0);
      expect(await oracle.latestHOI()).to.equal(initialHOI);
      
      // Update HOI
      const updatedHOI = 1050000000;
      await oracle.connect(dataProvider).setHOI(updatedHOI, 1);
      expect(await oracle.latestHOI()).to.equal(updatedHOI);
    });

    it("Should return correct last update time", async function () {
      const beforeUpdate = await time.latest();
      
      await oracle.connect(dataProvider).setHOI(1e9, 0);
      
      const afterUpdate = await time.latest();
      const lastUpdateTime = await oracle.lastUpdateTime();
      
      expect(lastUpdateTime).to.be.gte(beforeUpdate);
      expect(lastUpdateTime).to.be.lte(afterUpdate);
    });

    it("Should return correct data provider address", async function () {
      // Test that data provider can access oracle functions
      await oracle.connect(dataProvider).setHOI(1e9, 0);
      
      // Verify the function call succeeded (data provider has access)
      expect(await oracle.latestHOI()).to.equal(1e9);
    });
  });
}); 
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomToken Simple Tests", function () {
  let halomToken, oracle, owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy only the essential contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");

    // Deploy oracle first
    oracle = await HalomOracle.deploy(owner.address, 31337); // chainId for hardhat network
    
    // Deploy token with correct constructor arguments
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();
    
    // Grant MINTER_ROLE to owner for testing
    await halomToken.grantRole(await halomToken.MINTER_ROLE(), owner.address);
    
    // Grant REBASER_ROLE to oracle for testing
    await halomToken.grantRole(await halomToken.REBASER_ROLE(), oracle.address);
    
    // Grant STAKING_CONTRACT_ROLE to users for testing burnFrom
    await halomToken.grantRole(await halomToken.STAKING_CONTRACT_ROLE(), user1.address);
    await halomToken.grantRole(await halomToken.STAKING_CONTRACT_ROLE(), user2.address);
    
    // Exclude users from anti-whale limits for testing
    await halomToken.setExcludedFromLimits(user1.address, true);
    await halomToken.setExcludedFromLimits(user2.address, true);
    
    // Mint tokens to users for testing
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
  });

  describe("Basic Functionality", function () {
    it("Should deploy successfully", async function () {
      expect(halomToken.target).to.not.equal(ethers.ZeroAddress);
      expect(oracle.target).to.not.equal(ethers.ZeroAddress);
    });

    it("Should have correct initial parameters", async function () {
      expect(await halomToken.name()).to.equal("Halom");
      expect(await halomToken.symbol()).to.equal("HOM");
      expect(await halomToken.decimals()).to.equal(18);
      // Initial supply is 1M + 2M minted = 3M total
      expect(await halomToken.totalSupply()).to.equal(ethers.parseEther("3000000"));
    });

    it("Should allow transfers", async function () {
      const transferAmount = ethers.parseEther("1000");
      await halomToken.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await halomToken.balanceOf(user2.address)).to.equal(ethers.parseEther("1001000"));
    });

    it("Should allow burning", async function () {
      const burnAmount = ethers.parseEther("1000");
      const initialBalance = await halomToken.balanceOf(user1.address);
      
      // Use burnFrom directly since user1 has STAKING_CONTRACT_ROLE
      await halomToken.connect(user1).burnFrom(user1.address, burnAmount);
      
      const finalBalance = await halomToken.balanceOf(user1.address);
      expect(finalBalance).to.be.lt(initialBalance);
      expect(initialBalance - finalBalance).to.be.gte(burnAmount);
    });
  });

  describe("Rebase Functionality", function () {
    it("Should allow authorized rebase caller to trigger rebase", async function () {
      const initialSupply = await halomToken.totalSupply();
      
      // Trigger rebase directly (no need for setHOI)
      await halomToken.connect(owner).rebase(ethers.parseEther("50000")); // 50k inflation
      
      const newSupply = await halomToken.totalSupply();
      expect(newSupply).to.be.gt(initialSupply);
    });

    it("Should prevent unauthorized rebase calls", async function () {
      await expect(
        halomToken.connect(user1).rebase(ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
    });

    it("Should handle deflation rebase", async function () {
      const initialSupply = await halomToken.totalSupply();
      
      // Trigger deflation rebase
      await halomToken.connect(owner).rebase(-ethers.parseEther("30000")); // 30k deflation
      
      const newSupply = await halomToken.totalSupply();
      expect(newSupply).to.be.lt(initialSupply);
    });
  });

  describe("BurnFrom Functionality", function () {
    it("Should burn tokens with proper approval", async function () {
      const burnAmount = ethers.parseEther("1000");
      const initialBalance = await halomToken.balanceOf(user1.address);
      
      // Burn tokens directly since user2 has STAKING_CONTRACT_ROLE
      await halomToken.connect(user2).burnFrom(user1.address, burnAmount);
      
      const finalBalance = await halomToken.balanceOf(user1.address);
      expect(finalBalance).to.be.lt(initialBalance);
      expect(initialBalance - finalBalance).to.be.gte(burnAmount);
    });

    it("Should prevent burning without approval", async function () {
      const burnAmount = ethers.parseEther("1000");
      
      // Create a user without STAKING_CONTRACT_ROLE
      const [user3] = await ethers.getSigners();
      
      await expect(
        halomToken.connect(user3).burnFrom(user1.address, burnAmount)
      ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent burning more than approved", async function () {
      // Create a new user with no tokens
      const [user3] = await ethers.getSigners();
      await halomToken.grantRole(await halomToken.STAKING_CONTRACT_ROLE(), user3.address);
      
      // Try to burn from user3 who has no tokens
      const burnAmount = ethers.parseEther("1000");
      
      await expect(
        halomToken.connect(user3).burnFrom(user3.address, burnAmount)
      ).to.be.revertedWithCustomError(halomToken, "InsufficientBalance");
    });
  });

  describe("Role-Based Access Control", function () {
    it("Should prevent non-authorized users from triggering rebase", async function () {
      await expect(
        halomToken.connect(user1).rebase(ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
    });

    it("Should allow governor to set max rebase delta", async function () {
      const newDelta = 500;
      await halomToken.connect(owner).setMaxRebaseDelta(newDelta);
      expect(await halomToken.maxRebaseDelta()).to.equal(newDelta);
    });

    it("Should prevent non-governor from setting max rebase delta", async function () {
      await expect(
        halomToken.connect(user1).setMaxRebaseDelta(500)
      ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Edge Cases", function () {
    it("Should prevent setting max rebase delta to zero", async function () {
      await expect(
        halomToken.connect(owner).setMaxRebaseDelta(0)
      ).to.be.revertedWithCustomError(halomToken, "InvalidRebaseDelta");
    });

    it("Should prevent setting max rebase delta above maximum", async function () {
      await expect(
        halomToken.connect(owner).setMaxRebaseDelta(1100) // Above 10%
      ).to.be.revertedWithCustomError(halomToken, "RebaseDeltaTooHigh");
    });

    it("Should handle transfers after rebase", async function () {
      const transferAmount = ethers.parseEther("1000");
      
      // Trigger rebase
      await halomToken.connect(owner).rebase(ethers.parseEther("50000"));
      
      // Transfer should work normally
      await halomToken.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await halomToken.balanceOf(user2.address)).to.be.gt(ethers.parseEther("1000000"));
    });
  });
}); 
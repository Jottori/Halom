const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomToken Comprehensive Tests", function () {
  let halomToken, governor, oracle, staking, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");

    // HalomToken expects (admin, rebaseCaller)
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // HalomTimelock expects (minDelay, proposers, executors, admin)
    const minDelay = 3600;
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    // HalomTreasury expects (rewardToken, roleManager, interval)
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();

    // HalomGovernor expects (token, timelock, votingDelay, votingPeriod, proposalThreshold, quorumPercent)
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(),
      await timelock.getAddress(),
      1, // votingDelay
      45818, // votingPeriod
      ethers.parseEther("1000000"), // proposalThreshold
      3 // quorumPercent
    );
    await governor.waitForDeployment();

    // Setup roles
    await halomToken.grantRole(halomToken.GOVERNOR_ROLE, owner.address);
    await halomToken.grantRole(await halomToken.REBASER_ROLE(), owner.address);
    await halomToken.grantRole(halomToken.MINTER_ROLE, owner.address);

    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());

    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);

    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);

    // Mint tokens to users for testing
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));
  });

  describe("Rebase Functionality - Different HOI Directions", function () {
    it("Should handle inflation rebase (positive HOI)", async function () {
      const initialSupply = await halomToken.totalSupply();
      const user1Balance = await halomToken.balanceOf(user1.address);
      
      // Set positive HOI (inflation)
      await oracle.connect(owner).setHOI(500); // 5% inflation
      
      // Trigger rebase
      await halomToken.connect(owner).rebase();
      
      const newSupply = await halomToken.totalSupply();
      const newUser1Balance = await halomToken.balanceOf(user1.address);
      
      expect(newSupply).to.be.gt(initialSupply);
      expect(newUser1Balance).to.be.gt(user1Balance);
    });

    it("Should handle deflation rebase (negative HOI)", async function () {
      const initialSupply = await halomToken.totalSupply();
      const user1Balance = await halomToken.balanceOf(user1.address);
      
      // Set negative HOI (deflation)
      await oracle.connect(owner).setHOI(-300); // -3% deflation
      
      // Trigger rebase
      await halomToken.connect(owner).rebase();
      
      const newSupply = await halomToken.totalSupply();
      const newUser1Balance = await halomToken.balanceOf(user1.address);
      
      expect(newSupply).to.be.lt(initialSupply);
      expect(newUser1Balance).to.be.lt(user1Balance);
    });

    it("Should handle zero HOI (no change)", async function () {
      const initialSupply = await halomToken.totalSupply();
      const user1Balance = await halomToken.balanceOf(user1.address);
      
      // Set zero HOI
      await oracle.connect(owner).setHOI(0);
      
      // Trigger rebase
      await halomToken.connect(owner).rebase();
      
      const newSupply = await halomToken.totalSupply();
      const newUser1Balance = await halomToken.balanceOf(user1.address);
      
      expect(newSupply).to.equal(initialSupply);
      expect(newUser1Balance).to.equal(user1Balance);
    });

    it("Should handle extreme inflation HOI", async function () {
      const initialSupply = await halomToken.totalSupply();
      
      // Set extreme positive HOI (10% - max allowed)
      await oracle.connect(owner).setHOI(1000);
      
      // Trigger rebase
      await halomToken.connect(owner).rebase();
      
      const newSupply = await halomToken.totalSupply();
      expect(newSupply).to.be.gt(initialSupply);
    });

    it("Should handle extreme deflation HOI", async function () {
      const initialSupply = await halomToken.totalSupply();
      
      // Set extreme negative HOI (-10% - max allowed)
      await oracle.connect(owner).setHOI(-1000);
      
      // Trigger rebase
      await halomToken.connect(owner).rebase();
      
      const newSupply = await halomToken.totalSupply();
      expect(newSupply).to.be.lt(initialSupply);
    });

    it("Should prevent rebase with HOI above maximum", async function () {
      // Set HOI above maximum (10%)
      await oracle.connect(owner).setHOI(1100);
      
      await expect(
        halomToken.connect(owner).rebase()
      ).to.be.revertedWithCustomError(halomToken, "InvalidHOI");
    });

    it("Should prevent rebase with HOI below minimum", async function () {
      // Set HOI below minimum (-10%)
      await oracle.connect(owner).setHOI(-1100);
      
      await expect(
        halomToken.connect(owner).rebase()
      ).to.be.revertedWithCustomError(halomToken, "InvalidHOI");
    });
  });

  describe("BurnFrom Functionality - Edge Cases", function () {
    it("Should burn tokens with proper approval", async function () {
      const burnAmount = ethers.parseEther("1000");
      const initialBalance = await halomToken.balanceOf(user1.address);
      
      // Approve burning
      await halomToken.connect(user1).approve(user2.address, burnAmount);
      
      // Burn tokens
      await halomToken.connect(user2).burnFrom(user1.address, burnAmount);
      
      const newBalance = await halomToken.balanceOf(user1.address);
      expect(newBalance).to.equal(initialBalance - burnAmount);
    });

    it("Should prevent burning without approval", async function () {
      const burnAmount = ethers.parseEther("1000");
      
      await expect(
        halomToken.connect(user2).burnFrom(user1.address, burnAmount)
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("Should prevent burning more than approved", async function () {
      const approveAmount = ethers.parseEther("1000");
      const burnAmount = ethers.parseEther("1500");
      
      await halomToken.connect(user1).approve(user2.address, approveAmount);
      
      await expect(
        halomToken.connect(user2).burnFrom(user1.address, burnAmount)
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("Should prevent burning more than balance", async function () {
      const userBalance = await halomToken.balanceOf(user1.address);
      const burnAmount = userBalance + ethers.parseEther("1000");
      
      await halomToken.connect(user1).approve(user2.address, burnAmount);
      
      await expect(
        halomToken.connect(user2).burnFrom(user1.address, burnAmount)
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("Should prevent burning zero amount", async function () {
      await halomToken.connect(user1).approve(user2.address, ethers.parseEther("1000"));
      
      await expect(
        halomToken.connect(user2).burnFrom(user1.address, 0)
      ).to.be.revertedWithCustomError(halomToken, "InvalidAmount");
    });

    it("Should prevent burning from zero address", async function () {
      await expect(
        halomToken.connect(user2).burnFrom(ethers.ZeroAddress, ethers.parseEther("1000"))
      ).to.be.revertedWith("ERC20: burn from the zero address");
    });
  });

  describe("_gonBalances Internal Logic Integrity", function () {
    it("Should maintain correct gon balance ratios after rebase", async function () {
      const initialBalance = await halomToken.balanceOf(user1.address);
      const initialGons = await halomToken.gonsOf(user1.address);
      
      // Trigger rebase
      await oracle.connect(owner).setHOI(500);
      await halomToken.connect(owner).rebase();
      
      const newBalance = await halomToken.balanceOf(user1.address);
      const newGons = await halomToken.gonsOf(user1.address);
      
      // Gon balance should remain the same
      expect(newGons).to.equal(initialGons);
      // Token balance should increase
      expect(newBalance).to.be.gt(initialBalance);
    });

    it("Should handle multiple rebases correctly", async function () {
      const initialBalance = await halomToken.balanceOf(user1.address);
      
      // First rebase - inflation
      await oracle.connect(owner).setHOI(500);
      await halomToken.connect(owner).rebase();
      
      const balanceAfterFirst = await halomToken.balanceOf(user1.address);
      expect(balanceAfterFirst).to.be.gt(initialBalance);
      
      // Second rebase - deflation
      await oracle.connect(owner).setHOI(-300);
      await halomToken.connect(owner).rebase();
      
      const balanceAfterSecond = await halomToken.balanceOf(user1.address);
      expect(balanceAfterSecond).to.be.lt(balanceAfterFirst);
    });

    it("Should maintain proportional balances across users", async function () {
      const user1Initial = await halomToken.balanceOf(user1.address);
      const user2Initial = await halomToken.balanceOf(user2.address);
      const ratio = user1Initial / user2Initial;
      
      // Trigger rebase
      await oracle.connect(owner).setHOI(500);
      await halomToken.connect(owner).rebase();
      
      const user1New = await halomToken.balanceOf(user1.address);
      const user2New = await halomToken.balanceOf(user2.address);
      const newRatio = user1New / user2New;
      
      // Ratio should remain approximately the same (within rounding error)
      expect(newRatio).to.be.closeTo(ratio, ratio * 0.001); // 0.1% tolerance
    });
  });

  describe("Post-Rebase Transfer Behavior", function () {
    it("Should allow transfers after inflation rebase", async function () {
      const transferAmount = ethers.parseEther("1000");
      
      // Trigger inflation rebase
      await oracle.connect(owner).setHOI(500);
      await halomToken.connect(owner).rebase();
      
      // Transfer should work normally
      await halomToken.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await halomToken.balanceOf(user2.address)).to.be.gt(ethers.parseEther("1000000"));
    });

    it("Should allow transfers after deflation rebase", async function () {
      const transferAmount = ethers.parseEther("1000");
      
      // Trigger deflation rebase
      await oracle.connect(owner).setHOI(-300);
      await halomToken.connect(owner).rebase();
      
      // Transfer should work normally
      await halomToken.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await halomToken.balanceOf(user2.address)).to.be.gt(ethers.parseEther("1000000"));
    });

    it("Should maintain transfer accuracy after rebase", async function () {
      const transferAmount = ethers.parseEther("1000");
      const user1Initial = await halomToken.balanceOf(user1.address);
      const user2Initial = await halomToken.balanceOf(user2.address);
      
      // Trigger rebase
      await oracle.connect(owner).setHOI(500);
      await halomToken.connect(owner).rebase();
      
      // Transfer
      await halomToken.connect(user1).transfer(user2.address, transferAmount);
      
      const user1Final = await halomToken.balanceOf(user1.address);
      const user2Final = await halomToken.balanceOf(user2.address);
      
      // Check that transfer amount is correct
      expect(user1Final).to.equal(user1Initial - transferAmount);
      expect(user2Final).to.equal(user2Initial + transferAmount);
    });

    it("Should handle multiple transfers after rebase", async function () {
      const transferAmount = ethers.parseEther("100");
      
      // Trigger rebase
      await oracle.connect(owner).setHOI(500);
      await halomToken.connect(owner).rebase();
      
      // Multiple transfers
      await halomToken.connect(user1).transfer(user2.address, transferAmount);
      await halomToken.connect(user1).transfer(user3.address, transferAmount);
      await halomToken.connect(user1).transfer(user4.address, transferAmount);
      
      expect(await halomToken.balanceOf(user2.address)).to.be.gt(ethers.parseEther("1000000"));
      expect(await halomToken.balanceOf(user3.address)).to.be.gt(ethers.parseEther("1000000"));
      expect(await halomToken.balanceOf(user4.address)).to.be.gt(ethers.parseEther("1000000"));
    });
  });

  describe("Role-Based Access Control", function () {
    it("Should prevent non-authorized users from triggering rebase", async function () {
      await expect(
        halomToken.connect(user1).rebase()
      ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent non-governor from setting max rebase delta", async function () {
      await expect(
        halomToken.connect(user1).setMaxRebaseDelta(500)
      ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent non-governor from setting staking contract", async function () {
      await expect(
        halomToken.connect(user1).setStakingContract(staking.target)
      ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
    });

    it("Should allow governor to set max rebase delta", async function () {
      const newDelta = 500;
      await halomToken.connect(owner).setMaxRebaseDelta(newDelta);
      expect(await halomToken.maxRebaseDelta()).to.equal(newDelta);
    });

    it("Should allow governor to set staking contract", async function () {
      await halomToken.connect(owner).setStakingContract(staking.target);
      expect(await halomToken.stakingContract()).to.equal(staking.target);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle rebase with very small HOI values", async function () {
      const initialSupply = await halomToken.totalSupply();
      
      // Set very small HOI
      await oracle.connect(owner).setHOI(1); // 0.01%
      
      await halomToken.connect(owner).rebase();
      
      const newSupply = await halomToken.totalSupply();
      expect(newSupply).to.be.gte(initialSupply);
    });

    it("Should handle rebase with users having zero balance", async function () {
      // Create user with zero balance
      const [zeroUser] = await ethers.getSigners();
      
      // Trigger rebase
      await oracle.connect(owner).setHOI(500);
      await halomToken.connect(owner).rebase();
      
      // Should not revert
      expect(await halomToken.balanceOf(zeroUser.address)).to.equal(0);
    });

    it("Should prevent setting max rebase delta to zero", async function () {
      await expect(
        halomToken.connect(owner).setMaxRebaseDelta(0)
      ).to.be.revertedWithCustomError(halomToken, "InvalidMaxRebaseDelta");
    });

    it("Should prevent setting max rebase delta above maximum", async function () {
      await expect(
        halomToken.connect(owner).setMaxRebaseDelta(1100) // Above 10%
      ).to.be.revertedWithCustomError(halomToken, "InvalidMaxRebaseDelta");
    });
  });
}); 
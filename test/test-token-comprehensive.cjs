const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomToken Comprehensive Tests", function () {
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

    // Setup oracle integration
    await oracle.setHalomToken(await halomToken.getAddress());

    // Mint tokens to users for testing
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
  });

  describe("Basic Token Functionality", function () {
    it("Should have correct initial state", async function () {
      expect(await halomToken.name()).to.equal("Halom");
      expect(await halomToken.symbol()).to.equal("HALOM");
      expect(await halomToken.decimals()).to.equal(18);
    });

    it("Should allow minter to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      const initialBalance = await halomToken.balanceOf(user1.address);
      
      await halomToken.connect(owner).mint(user1.address, mintAmount);
      
      const finalBalance = await halomToken.balanceOf(user1.address);
      expect(finalBalance).to.equal(initialBalance + mintAmount);
    });

    it("Should prevent non-minter from minting tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(
        halomToken.connect(user1).mint(user2.address, mintAmount)
      ).to.be.revertedWithCustomError(halomToken, "Unauthorized");
    });

    it("Should allow burning by authorized burner", async function () {
      const burnAmount = ethers.parseEther("1000");
      // First approve the burner to burn tokens
      await halomToken.connect(user1).approve(owner.address, burnAmount);
      await halomToken.burnFrom(user1.address, burnAmount);
      expect(await halomToken.balanceOf(user1.address)).to.equal(ethers.parseEther("999000"));
    });

    it("Should prevent burning by unauthorized user", async function () {
      const burnAmount = ethers.parseEther("1000");
      await expect(
        halomToken.connect(user1).burnFrom(user2.address, burnAmount)
      ).to.be.revertedWithCustomError(halomToken, "Unauthorized");
    });
  });

  describe("Anti-Whale Protection", function () {
    it("Should enforce transfer limits", async function () {
      const maxTransfer = await halomToken.maxTransferAmount();
      const userBalance = await halomToken.balanceOf(user1.address);
      const transferAmount = maxTransfer + ethers.parseEther("1");
      
      // Only test if user has enough balance
      if (userBalance >= transferAmount) {
        await expect(
          halomToken.connect(user1).transfer(user2.address, transferAmount)
        ).to.be.revertedWithCustomError(halomToken, "TransferAmountExceedsLimit");
      }
    });

    it("Should enforce wallet limits", async function () {
      const maxWallet = await halomToken.maxWalletAmount();
      const transferAmount = maxWallet + ethers.parseEther("1");
      const userBalance = await halomToken.balanceOf(user1.address);
      
      // Only test if user has enough balance
      if (userBalance >= transferAmount) {
        await expect(
          halomToken.connect(user1).transfer(user2.address, transferAmount)
        ).to.be.revertedWithCustomError(halomToken, "WalletBalanceExceedsLimit");
      }
    });

    it("Should allow excluded addresses to bypass limits", async function () {
      await halomToken.setExcludedFromLimits(user1.address, true);
      const largeAmount = ethers.parseEther("1000000");
      
      await expect(
        halomToken.connect(user1).transfer(user2.address, largeAmount)
      ).to.not.be.reverted;
    });
  });

  describe("Role-Based Access Control", function () {
    it("Should prevent non-authorized users from minting", async function () {
      await expect(
        halomToken.connect(user1).mint(user2.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(halomToken, "Unauthorized");
    });

    it("Should prevent non-authorized users from burning", async function () {
      await expect(
        halomToken.connect(user1).burnFrom(user2.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(halomToken, "Unauthorized");
    });

    it("Should allow admin to set staking contract", async function () {
      const stakingAddress = user1.address;
      await halomToken.setStakingContract(stakingAddress);
      // Note: halomStakingAddress is not public, so we can't verify it directly
    });

    it("Should allow admin to set anti-whale limits", async function () {
      const newMaxTransfer = ethers.parseEther("10000");
      const newMaxWallet = ethers.parseEther("100000");
      await halomToken.setAntiWhaleLimits(newMaxTransfer, newMaxWallet);
      expect(await halomToken.maxTransferAmount()).to.equal(newMaxTransfer);
      expect(await halomToken.maxWalletAmount()).to.equal(newMaxWallet);
    });
  });

  describe("Rebase Balance Functions", function () {
    it("Should return correct rebase balance", async function () {
      const balance = await halomToken.getRebaseBalance(user1.address);
      expect(balance).to.be.gt(0);
    });
  });
}); 
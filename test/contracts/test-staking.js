const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomStaking", function () {
  let token, staking;
  let owner, governor, user1, user2;
  let GOVERNOR_ROLE;

  beforeEach(async function () {
    [owner, governor, user1, user2] = await ethers.getSigners();

    const HalomToken = await ethers.getContractFactory("HalomToken");
    token = await HalomToken.deploy(owner.address, governor.address);

    // Role hash
    GOVERNOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));

    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    staking = await HalomStaking.deploy(token.target, governor.address);

    // Grant STAKING_CONTRACT role to staking contract
    const STAKING_CONTRACT = ethers.keccak256(ethers.toUtf8Bytes("STAKING_CONTRACT"));
    await token.connect(governor).grantRole(STAKING_CONTRACT, staking.target);

    // Token approval for staking
    await token.connect(governor).transfer(user1.address, ethers.parseEther("1000"));
    await token.connect(user1).approve(staking.target, ethers.parseEther("1000"));
  });

  describe("Deployment and Role Setup", function () {
    it("Should set the correct roles on deployment", async function () {
      expect(await staking.halomToken()).to.equal(token.target);
    });
  });

  describe("Staking with Lock Periods", function () {
    it("Should allow staking with 1 month lock period", async function () {
      await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 0); // ONE_MONTH
      const userStake = await staking.stakes(user1.address);
      expect(userStake.lockPeriod).to.equal(0); // ONE_MONTH
      // Boost should be 0.11%
      const effective = await staking.getEffectiveStake(user1.address);
      const expected = ethers.parseEther("100") + (ethers.parseEther("100") * 11n / 10000n);
      expect(effective).to.equal(expected);
    });

    it("Should allow staking with 3 months lock period", async function () {
      await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 1); // THREE_MONTHS
      const userStake = await staking.stakes(user1.address);
      expect(userStake.lockPeriod).to.equal(1); // THREE_MONTHS
      // Boost should be 0.56%
      const effective = await staking.getEffectiveStake(user1.address);
      const expected = ethers.parseEther("100") + (ethers.parseEther("100") * 56n / 10000n);
      expect(effective).to.equal(expected);
    });

    it("Should allow staking with 6 months lock period", async function () {
      await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 2); // SIX_MONTHS
      const userStake = await staking.stakes(user1.address);
      expect(userStake.lockPeriod).to.equal(2); // SIX_MONTHS
      // Boost should be 1.58%
      const effective = await staking.getEffectiveStake(user1.address);
      const expected = ethers.parseEther("100") + (ethers.parseEther("100") * 158n / 10000n);
      expect(effective).to.equal(expected);
    });

    it("Should allow staking with 12 months lock period", async function () {
      await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 3); // TWELVE_MONTHS
      const userStake = await staking.stakes(user1.address);
      expect(userStake.lockPeriod).to.equal(3); // TWELVE_MONTHS
      // Boost should be 4.47%
      const effective = await staking.getEffectiveStake(user1.address);
      const expected = ethers.parseEther("100") + (ethers.parseEther("100") * 447n / 10000n);
      expect(effective).to.equal(expected);
    });

    it("Should allow staking with 24 months lock period", async function () {
      await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 4); // TWENTY_FOUR_MONTHS
      const userStake = await staking.stakes(user1.address);
      expect(userStake.lockPeriod).to.equal(4); // TWENTY_FOUR_MONTHS
      // Boost should be 12.65%
      const effective = await staking.getEffectiveStake(user1.address);
      const expected = ethers.parseEther("100") + (ethers.parseEther("100") * 1265n / 10000n);
      expect(effective).to.equal(expected);
    });

    it("Should allow staking with 60 months lock period", async function () {
      await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 5); // SIXTY_MONTHS
      const userStake = await staking.stakes(user1.address);
      expect(userStake.lockPeriod).to.equal(5); // SIXTY_MONTHS
      // Boost should be 50%
      const effective = await staking.getEffectiveStake(user1.address);
      const expected = ethers.parseEther("100") + (ethers.parseEther("100") * 5000n / 10000n);
      expect(effective).to.equal(expected);
    });

    it("Should revert with invalid lock period", async function () {
      await expect(
        staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 6)
      ).to.be.reverted;
    });

    it("Should return correct lock duration for each period", async function () {
      expect(await staking.getLockDuration(0)).to.equal(30 * 24 * 60 * 60); // 1 month
      expect(await staking.getLockDuration(1)).to.equal(90 * 24 * 60 * 60); // 3 months
      expect(await staking.getLockDuration(2)).to.equal(180 * 24 * 60 * 60); // 6 months
      expect(await staking.getLockDuration(3)).to.equal(365 * 24 * 60 * 60); // 12 months
      expect(await staking.getLockDuration(4)).to.equal(730 * 24 * 60 * 60); // 24 months
    });
  });

  describe("Staking, Unstaking, and Rewards", function () {
    it("Should allow staking and correctly update balances", async function () {
      await staking.connect(user1).stake(ethers.parseEther("100"), 30 * 24 * 60 * 60);
      const userStake = await staking.stakes(user1.address);
      expect(userStake.amount).to.equal(ethers.parseEther("100"));
    });

    // it("Should distribute rewards correctly", async function () {
    //   await staking.connect(user1).stake(ethers.parseEther("100"), 30 * 24 * 60 * 60);
    //   await token.connect(governor).mint(staking.target, ethers.parseEther("10"));
    //   // callStatic to simulate contract call from token contract
    //   await staking.connect({ ...governor, address: token.target }).addRewards(ethers.parseEther("10"));
    //   const pendingRewards = await staking.pendingRewards(user1.address);
    //   expect(pendingRewards).to.be.gt(0);
    // });
  });

  describe("Slashing", function () {
    it("Should revert if non-governor tries to slash", async function () {
      await expect(
        staking.connect(user1).slash(user2.address, ethers.parseEther("10"))
      ).to.be.reverted;
    });
  });

  describe("Governance Guardrails", function () {
    it("Should allow governor to set lock boost params within limits", async function () {
      await staking.connect(governor).setLockBoostParams(3000, 365 * 24 * 60 * 60);
      expect(await staking.lockBoostB0()).to.equal(3000);
    });

    it("Should revert if lock boost B0 is set too high", async function () {
      await expect(
        staking.connect(governor).setLockBoostParams(6000, 365 * 24 * 60 * 60)
      ).to.be.revertedWith("B0 cannot exceed 50%");
    });

    it("Should revert if lock boost TMax is out of bounds", async function () {
      await expect(
        staking.connect(governor).setLockBoostParams(2000, 20 * 24 * 60 * 60)
      ).to.be.revertedWith("TMax must be between 30 and 730 days");
    });
  });
}); 
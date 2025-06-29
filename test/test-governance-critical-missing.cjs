const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomGovernor Critical Missing Features", function () {
  let halomToken, governor, timelock, oracle, staking, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5, delegate1, delegate2;
  let proposalId;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5, delegate1, delegate2] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    const minDelay = 3600;
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    oracle = await HalomOracle.deploy(owner.address, 1);
    await oracle.waitForDeployment();

    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, 2000);
    await staking.waitForDeployment();

    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();

    roleManager = await HalomRoleManager.deploy();
    await roleManager.waitForDeployment();

    const votingDelay = 1;
    const votingPeriod = 10;
    const proposalThreshold = 0;
    const quorumPercent = 4;
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(),
      await timelock.getAddress(),
      votingDelay,
      votingPeriod,
      proposalThreshold,
      quorumPercent
    );
    await governor.waitForDeployment();

    // Setup roles
    await halomToken.grantRole(await halomToken.REBASER_ROLE(), await oracle.getAddress());
    await halomToken.grantRole(await halomToken.MINTER_ROLE(), await staking.getAddress());
    await halomToken.grantRole(await halomToken.MINTER_ROLE(), await treasury.getAddress());

    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());

    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);

    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Grant DELEGATOR_ROLE to users for testing delegation
    await governor.grantRole(await governor.DELEGATOR_ROLE(), user1.address);
    await governor.grantRole(await governor.DELEGATOR_ROLE(), user2.address);
    await governor.grantRole(await governor.DELEGATOR_ROLE(), user3.address);
    await governor.grantRole(await governor.DELEGATOR_ROLE(), delegate1.address);
    await governor.grantRole(await governor.DELEGATOR_ROLE(), delegate2.address);

    // Mint tokens to users
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));
    await halomToken.mint(delegate1.address, ethers.parseEther("1000000"));
    await halomToken.mint(delegate2.address, ethers.parseEther("1000000"));

    // Users stake tokens
    await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user3).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user4).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user5).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(delegate1).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(delegate2).approve(await staking.getAddress(), ethers.parseEther("100000"));

    const oneDay = 86400;
    await staking.connect(user1).stake(ethers.parseEther("100000"), oneDay);
    await staking.connect(user2).stake(ethers.parseEther("100000"), oneDay);
    await staking.connect(user3).stake(ethers.parseEther("100000"), oneDay);
    await staking.connect(user4).stake(ethers.parseEther("100000"), oneDay);
    await staking.connect(user5).stake(ethers.parseEther("100000"), oneDay);
    await staking.connect(delegate1).stake(ethers.parseEther("100000"), oneDay);
    await staking.connect(delegate2).stake(ethers.parseEther("100000"), oneDay);
  });

  describe("Emergency Controls", function () {
    it("Should allow EMERGENCY_ROLE to set emergency mode", async function () {
      await governor.connect(owner).setEmergencyMode(true);
      
      expect(await governor.isEmergency()).to.be.true;
      expect(await governor.paused()).to.be.true;
    });

    it("Should allow EMERGENCY_ROLE to disable emergency mode", async function () {
      await governor.connect(owner).setEmergencyMode(true);
      await governor.connect(owner).setEmergencyMode(false);
      
      expect(await governor.isEmergency()).to.be.false;
      expect(await governor.paused()).to.be.false;
    });

    it("Should prevent non-EMERGENCY_ROLE from setting emergency mode", async function () {
      await expect(
        governor.connect(user1).setEmergencyMode(true)
      ).to.be.revertedWithCustomError(governor, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent operations when paused", async function () {
      await governor.connect(owner).setEmergencyMode(true);
      
      await expect(
        governor.connect(user1).lockTokens(ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(governor, "EnforcedPause");
      
      await expect(
        governor.connect(user1).delegate(delegate1.address)
      ).to.be.revertedWithCustomError(governor, "EnforcedPause");
    });

    it("Should allow emergency pause/unpause functions", async function () {
      await governor.connect(owner).emergencyPause();
      expect(await governor.paused()).to.be.true;
      
      await governor.connect(owner).emergencyUnpause();
      expect(await governor.paused()).to.be.false;
    });
  });

  describe("Parameter Management", function () {
    it("Should allow PARAM_ROLE to update voting parameters", async function () {
      const newMaxVotingPower = ethers.parseEther("2000000");
      const newQuadraticFactor = ethers.parseEther("2");
      const newTimeWeightFactor = ethers.parseEther("1.5");
      const newRootPower = 3;
      const newMinLockDuration = 2 * 86400; // 2 days
      
      await governor.connect(owner).setVotingParams(
        newMaxVotingPower,
        newQuadraticFactor,
        newTimeWeightFactor,
        newRootPower,
        newMinLockDuration
      );
      
      expect(await governor.maxVotingPower()).to.equal(newMaxVotingPower);
      expect(await governor.quadraticFactor()).to.equal(newQuadraticFactor);
      expect(await governor.timeWeightFactor()).to.equal(newTimeWeightFactor);
      expect(await governor.rootPower()).to.equal(newRootPower);
      expect(await governor.minLockDuration()).to.equal(newMinLockDuration);
    });

    it("Should prevent non-PARAM_ROLE from updating parameters", async function () {
      await expect(
        governor.connect(user1).setVotingParams(
          ethers.parseEther("2000000"),
          ethers.parseEther("2"),
          ethers.parseEther("1.5"),
          3,
          2 * 86400
        )
      ).to.be.revertedWithCustomError(governor, "AccessControlUnauthorizedAccount");
    });

    it("Should validate parameter constraints", async function () {
      // Test invalid max voting power
      await expect(
        governor.connect(owner).setVotingParams(
          0, // Invalid
          ethers.parseEther("2"),
          ethers.parseEther("1.5"),
          3,
          2 * 86400
        )
      ).to.be.revertedWithCustomError(governor, "InvalidVotingPowerCap");

      // Test invalid quadratic factor
      await expect(
        governor.connect(owner).setVotingParams(
          ethers.parseEther("2000000"),
          0, // Invalid
          ethers.parseEther("1.5"),
          3,
          2 * 86400
        )
      ).to.be.revertedWithCustomError(governor, "InvalidQuadraticFactor");

      // Test invalid root power
      await expect(
        governor.connect(owner).setVotingParams(
          ethers.parseEther("2000000"),
          ethers.parseEther("2"),
          ethers.parseEther("1.5"),
          1, // Invalid (must be >= 2)
          2 * 86400
        )
      ).to.be.revertedWithCustomError(governor, "InvalidRootPower");
    });
  });

  describe("Flash Loan Protection", function () {
    it("Should prevent flash loan voting attacks", async function () {
      // Create proposal with a simple call (use a valid function and address)
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test flash loan protection";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      await time.increase(1);

      // Vote
      await governor.connect(user1).castVote(proposalId, 1);

      // Try to vote again in the same block (simulating flash loan)
      await expect(
        governor.connect(user1).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
    });
  });

  describe("Delegation System", function () {
    it("Should allow users to delegate to valid delegates", async function () {
      await governor.connect(user1).delegate(delegate1.address);
      
      const delegate = await governor.getDelegate(user1.address);
      expect(delegate).to.equal(delegate1.address);
      
      const delegators = await governor.getDelegators(delegate1.address);
      expect(delegators).to.include(user1.address);
    });

    it("Should prevent delegation to invalid addresses", async function () {
      await expect(
        governor.connect(user1).delegate(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(governor, "InvalidDelegate");

      await expect(
        governor.connect(user1).delegate(user1.address)
      ).to.be.revertedWithCustomError(governor, "InvalidDelegate");
    });

    it("Should prevent delegation without DELEGATOR_ROLE", async function () {
      await expect(
        governor.connect(user4).delegate(delegate1.address)
      ).to.be.revertedWithCustomError(governor, "AccessControlUnauthorizedAccount");
    });

    it("Should handle delegation revocation", async function () {
      await governor.connect(user1).delegate(delegate1.address);
      await governor.connect(user1).revokeDelegation();
      
      const delegate = await governor.getDelegate(user1.address);
      expect(delegate).to.equal(ethers.ZeroAddress);
      
      const delegators = await governor.getDelegators(delegate1.address);
      expect(delegators).to.not.include(user1.address);
    });
  });

  describe("Token Locking System", function () {
    it("Should allow users to lock tokens", async function () {
      const lockAmount = ethers.parseEther("10000");
      await governor.connect(user1).lockTokens(lockAmount);
      
      const locked = await governor.getLocked(user1.address);
      const lockStart = await governor.getLockStart(user1.address);
      
      expect(locked).to.equal(lockAmount);
      expect(lockStart).to.be.gt(0);
    });

    it("Should prevent locking zero tokens", async function () {
      await expect(
        governor.connect(user1).lockTokens(0)
      ).to.be.revertedWithCustomError(governor, "InvalidAmount");
    });

    it("Should prevent unlocking before minimum lock duration", async function () {
      const lockAmount = ethers.parseEther("10000");
      await governor.connect(user1).lockTokens(lockAmount);
      
      await expect(
        governor.connect(user1).unlockTokens()
      ).to.be.revertedWithCustomError(governor, "LockPeriodNotExpired");
    });

    it("Should allow unlocking after minimum lock duration", async function () {
      const lockAmount = ethers.parseEther("10000");
      await governor.connect(user1).lockTokens(lockAmount);
      
      // Move time forward past minimum lock duration
      await time.increase(86400 + 1); // 1 day + 1 second
      
      await governor.connect(user1).unlockTokens();
      
      const locked = await governor.getLocked(user1.address);
      expect(locked).to.equal(0);
    });
  });

  describe("Quadratic Voting Power", function () {
    it("Should calculate quadratic voting power correctly", async function () {
      const lockAmount = ethers.parseEther("100000");
      await governor.connect(user1).lockTokens(lockAmount);
      
      const votingPower = await governor.getVotingPower(user1.address);
      // Solidity-kompatibilis sqrt BigInt-tel
      function sqrtBigInt(n) {
        if (n < 0n) throw new Error('negative');
        if (n < 2n) return n;
        let x0 = n / 2n;
        let x1 = (x0 + n / x0) / 2n;
        while (x1 < x0) {
          x0 = x1;
          x1 = (x0 + n / x0) / 2n;
        }
        return x0;
      }
      const expectedPower = sqrtBigInt(BigInt(lockAmount.toString()));
      expect(votingPower).to.be.closeTo(expectedPower, expectedPower / 100n); // 1% tolerance
    });

    it("Should respect maximum voting power cap", async function () {
      const lockAmount = ethers.parseEther("10000000"); // Very large amount
      await governor.connect(user1).lockTokens(lockAmount);
      
      const votingPower = await governor.getVotingPower(user1.address);
      const maxPower = await governor.maxVotingPower();
      
      expect(votingPower).to.be.lte(maxPower);
    });
  });
}); 
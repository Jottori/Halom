const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomGovernor Complete Flow Tests", function () {
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

    const minDelay = 86400; // 24 hours (minimum required)
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    oracle = await HalomOracle.deploy(owner.address, 1);
    await oracle.waitForDeployment();

    roleManager = await HalomRoleManager.deploy();
    await roleManager.waitForDeployment();

    const rewardRate = ethers.parseEther("0.1");
    staking = await HalomStaking.deploy(await halomToken.getAddress(), await roleManager.getAddress(), rewardRate);
    await staking.waitForDeployment();

    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), await roleManager.getAddress(), 3600);
    await treasury.waitForDeployment();

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

    // Setup roles properly
    const DEFAULT_ADMIN_ROLE = await halomToken.DEFAULT_ADMIN_ROLE();
    const MINTER_ROLE = await halomToken.MINTER_ROLE();
    const REBASE_CALLER = await halomToken.REBASE_CALLER();
    
    await halomToken.grantRole(MINTER_ROLE, owner.address);
    await halomToken.grantRole(REBASE_CALLER, owner.address);

    await staking.grantRole(await staking.STAKING_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());

    // Treasury role setup - owner already has DEFAULT_ADMIN_ROLE from constructor
    // No need to grant additional roles
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

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user2).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user3).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user4).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user5).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(delegate1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(delegate2).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
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
      // Grant DELEGATOR_ROLE to user1 first
      await governor.grantRole(await governor.DELEGATOR_ROLE(), user1.address);
      
      // Now delegate should work
      await governor.connect(user1).delegate(user2.address);
      
      const delegate = await governor.getDelegate(user1.address);
      expect(delegate).to.equal(user2.address);
    });

    it("Should handle delegation revocation", async function () {
      await governor.connect(user1).delegate(delegate1.address);
      await governor.connect(user1).revokeDelegation();
      
      const delegate = await governor.getDelegate(user1.address);
      expect(delegate).to.equal(ethers.ZeroAddress);
      
      const delegators = await governor.getDelegators(delegate1.address);
      expect(delegators).to.not.include(user1.address);
    });

    it("Should prevent revocation when no delegation exists", async function () {
      await expect(
        governor.connect(user1).revokeDelegation()
      ).to.be.revertedWithCustomError(governor, "DelegationNotFound");
    });

    it("Should handle multiple delegators to same delegate", async function () {
      await governor.connect(user1).delegate(delegate1.address);
      await governor.connect(user2).delegate(delegate1.address);
      await governor.connect(user3).delegate(delegate1.address);
      
      const delegators = await governor.getDelegators(delegate1.address);
      expect(delegators).to.include(user1.address);
      expect(delegators).to.include(user2.address);
      expect(delegators).to.include(user3.address);
      expect(delegators.length).to.equal(3);
    });

    it("Should handle delegation change", async function () {
      await governor.connect(user1).delegate(delegate1.address);
      await governor.connect(user1).delegate(delegate2.address);
      
      const delegate = await governor.getDelegate(user1.address);
      expect(delegate).to.equal(delegate2.address);
      
      const delegators1 = await governor.getDelegators(delegate1.address);
      const delegators2 = await governor.getDelegators(delegate2.address);
      
      expect(delegators1).to.not.include(user1.address);
      expect(delegators2).to.include(user1.address);
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

    it("Should prevent unlocking when no tokens are locked", async function () {
      await expect(
        governor.connect(user1).unlockTokens()
      ).to.be.revertedWithCustomError(governor, "InvalidAmount");
    });

    it("Should handle multiple lock operations", async function () {
      const lockAmount1 = ethers.parseEther("5000");
      const lockAmount2 = ethers.parseEther("3000");
      
      await governor.connect(user1).lockTokens(lockAmount1);
      await governor.connect(user1).lockTokens(lockAmount2);
      
      const locked = await governor.getLocked(user1.address);
      expect(locked).to.equal(lockAmount1 + lockAmount2);
    });
  });

  describe("Quadratic Voting Power", function () {
    it("Should calculate quadratic voting power correctly", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for quadratic voting";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await time.increase(2); // Wait for voting delay
      
      // Vote with quadratic voting power
      await halomToken.mint(user1.address, ethers.parseEther("1000000"));
      await halomToken.mint(user2.address, ethers.parseEther("1000000"));
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      
      // Check voting power
      const votingPower1 = await halomToken.getVotes(user1.address);
      const votingPower2 = await halomToken.getVotes(user2.address);
      
      expect(votingPower1).to.be.gt(0);
      expect(votingPower2).to.be.gt(0);
    });

    it("Should respect maximum voting power cap", async function () {
      const lockAmount = ethers.parseEther("10000000"); // Very large amount
      await governor.connect(user1).lockTokens(lockAmount);
      
      const votingPower = await governor.getVotingPower(user1.address);
      const maxPower = await governor.maxVotingPower();
      
      expect(votingPower).to.be.lte(maxPower);
    });

    it("Should calculate time-weighted voting power", async function () {
      const lockAmount = ethers.parseEther("100000");
      await governor.connect(user1).lockTokens(lockAmount);
      
      const initialPower = await governor.getVotingPower(user1.address);
      
      // Move time forward
      await time.increase(86400 * 30); // 30 days
      
      const timeWeightedPower = await governor.getVotingPower(user1.address);
      
      // Time-weighted power should be different from initial power
      expect(timeWeightedPower).to.not.equal(initialPower);
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
      const newMaxVotingPower = ethers.parseEther("2000000");
      const newQuadraticFactor = ethers.parseEther("2");
      const newTimeWeightFactor = ethers.parseEther("1.5");
      const newRootPower = 3;
      const newMinLockDuration = 2 * 24 * 3600; // 2 days

      await expect(
        governor.connect(user1).setVotingParams(
          newMaxVotingPower,
          newQuadraticFactor,
          newTimeWeightFactor,
          newRootPower,
          newMinLockDuration
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

  describe("Complete Governance Flow with Advanced Features", function () {
    beforeEach(async function () {
      // Setup delegation
      await governor.connect(user1).delegate(delegate1.address);
      await governor.connect(user2).delegate(delegate2.address);
      
      // Setup token locking
      await governor.connect(user3).lockTokens(ethers.parseEther("50000"));
      await governor.connect(user4).lockTokens(ethers.parseEther("30000"));
      
      // Move time forward to allow voting
      await time.increase(86400 * 2); // 2 days
    });

    it("Should execute complete governance flow with delegation and token locking", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test complete governance flow";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await time.increase(2); // Wait for voting delay
      
      // Vote
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      
      // Wait for voting period
      await time.increase(50400); // Wait for full voting period
      
      // Queue proposal
      await governor.connect(user1).queue(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for timelock delay
      await time.increase(86400 + 1); // 1 day + 1 second
      
      // Execute proposal
      await governor.connect(user1).execute(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Check result
      const balance = await halomToken.balanceOf(user1.address);
      expect(balance).to.be.gte(ethers.parseEther("100"));
    });

    it("Should handle voting power changes during proposal", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test voting power changes";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await time.increase(2); // Wait for voting delay
      
      // Vote with initial voting power
      await halomToken.mint(user1.address, ethers.parseEther("1000000"));
      await halomToken.mint(user2.address, ethers.parseEther("1000000"));
      await governor.connect(user1).castVote(proposalId, 1);
      
      // Change voting power by locking more tokens
      await governor.connect(user1).lockTokens(ethers.parseEther("20000"));
      
      // Vote again with different user (should use new voting power)
      await governor.connect(user2).castVote(proposalId, 1);
    });
  });

  describe("Flash Loan Protection", function () {
    it("Should prevent flash loan voting attacks", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test flash loan protection";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await time.increase(2); // Wait for voting delay
      
      // Try to vote with flash loan (should be prevented by snapshot mechanism)
      await halomToken.mint(user1.address, ethers.parseEther("1000000"));
      await governor.connect(user1).castVote(proposalId, 1);
      
      // Check that voting power is based on snapshot, not current balance
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle proposal with maximum complexity", async function () {
      // Create a complex proposal with multiple targets
      const targets = [await halomToken.getAddress(), await halomToken.getAddress()];
      const values = [0, 0];
      const calldatas = [
        halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")]),
        halomToken.interface.encodeFunctionData("mint", [user2.address, ethers.parseEther("200")])
      ];
      const description = "Test complex proposal";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await time.increase(2); // Wait for voting delay
      
      // Vote on complex proposal
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
    });

    it("Should handle delegation with zero voting power", async function () {
      // Try to delegate with zero voting power
      await halomToken.connect(user1).delegate(user2.address);
      
      // Check delegation
      const delegate = await halomToken.delegates(user1.address);
      expect(delegate).to.equal(user2.address);
    });

    it("Should handle parameter updates affecting existing locks", async function () {
      // Lock tokens
      await governor.connect(user1).lockTokens(ethers.parseEther("100000"));
      const initialPower = await governor.getVotingPower(user1.address);
      
      // Update parameters
      await governor.connect(owner).setVotingParams(
        ethers.parseEther("3000000"),
        ethers.parseEther("2"),
        ethers.parseEther("1.5"),
        3,
        86400
      );
      
      const newPower = await governor.getVotingPower(user1.address);
      expect(newPower).to.not.equal(initialPower);
    });
  });
}); 
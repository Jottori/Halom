const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomGovernor Comprehensive Tests", function () {
  let halomToken, governor, timelock, oracle, staking, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5;
  let proposalId, proposalId2;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    // HalomToken expects (admin, rebaseCaller)
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // HalomTimelock expects (minDelay, proposers, executors, admin)
    const minDelay = 3600;
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    // HalomOracle expects (governance, chainId)
    oracle = await HalomOracle.deploy(owner.address, 1); // chainId = 1 for testing
    await oracle.waitForDeployment();

    // HalomStaking expects (stakingToken, roleManager, rewardRate)
    const rewardRate = ethers.parseEther("0.1"); // 0.1 tokens per second
    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, 2000);
    await staking.waitForDeployment();

    // HalomTreasury expects (rewardToken, roleManager, interval)
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();

    // HalomRoleManager expects ()
    roleManager = await HalomRoleManager.deploy();
    await roleManager.waitForDeployment();

    // HalomGovernor expects (token, timelock, votingDelay, votingPeriod, proposalThreshold, quorumPercent)
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
    await halomToken.grantRole(halomToken.GOVERNOR_ROLE, await governor.getAddress());
    await halomToken.grantRole(await halomToken.REBASER_ROLE(), await oracle.getAddress());
    await halomToken.grantRole(halomToken.MINTER_ROLE, await staking.getAddress());
    await halomToken.grantRole(halomToken.MINTER_ROLE, await treasury.getAddress());

    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());

    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);

    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);

    // Grant timelock executor role
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Mint tokens to users for testing
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));

    // Users stake tokens to get voting power
    await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user3).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user4).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user5).approve(await staking.getAddress(), ethers.parseEther("100000"));

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user2).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user3).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user4).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user5).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
  });

  describe("Proposal Creation", function () {
    it("Should create proposal with valid parameters", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      
      // Get proposal ID from event
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      expect(proposalId).to.not.equal(0);
      
      // Check proposal state
      const state = await governor.state(proposalId);
      expect(state).to.equal(0); // Pending
    });

    it("Should prevent proposal creation with invalid parameters", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      // Test with empty targets
      await expect(
        governor.connect(user1).propose([], values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, "GovernorInvalidProposalLength");

      // Test with mismatched arrays
      await expect(
        governor.connect(user1).propose(targets, [0, 0], calldatas, description)
      ).to.be.revertedWithCustomError(governor, "GovernorInvalidProposalLength");
    });

    it("Should prevent proposal creation without sufficient voting power", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      // User without staked tokens
      await expect(
        governor.connect(owner).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, "GovernorInsufficientProposerVotes");
    });
  });

  describe("Voting Mechanism", function () {
    beforeEach(async function () {
      // Create a proposal first
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Move to voting period
      await time.increase(1);
    });

    it("Should allow casting votes", async function () {
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain

      const hasVoted1 = await governor.hasVoted(proposalId, user1.address);
      const hasVoted2 = await governor.hasVoted(proposalId, user2.address);
      const hasVoted3 = await governor.hasVoted(proposalId, user3.address);

      expect(hasVoted1).to.be.true;
      expect(hasVoted2).to.be.true;
      expect(hasVoted3).to.be.true;
    });

    it("Should allow casting votes with reason", async function () {
      const reason = "I support this proposal because it benefits the community";
      
      await governor.connect(user1).castVoteWithReason(proposalId, 1, reason);
      await governor.connect(user2).castVoteWithReason(proposalId, 0, "I oppose this proposal");

      const hasVoted1 = await governor.hasVoted(proposalId, user1.address);
      const hasVoted2 = await governor.hasVoted(proposalId, user2.address);

      expect(hasVoted1).to.be.true;
      expect(hasVoted2).to.be.true;
    });

    it("Should prevent double voting", async function () {
      await governor.connect(user1).castVote(proposalId, 1);
      
      await expect(
        governor.connect(user1).castVote(proposalId, 0)
      ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
    });

    it("Should prevent voting with invalid option", async function () {
      await expect(
        governor.connect(user1).castVote(proposalId, 3)
      ).to.be.revertedWithCustomError(governor, "GovernorCountingSettingsInvalidVoteType");
    });

    it("Should calculate quadratic voting power correctly", async function () {
      // User with 100,000 tokens staked should have sqrt(100000) * lockMultiplier voting power
      const votingPower = await governor.getVotes(user1.address, await time.latest());
      
      // Calculate expected voting power: sqrt(100000) * 1.5 (30-day lock multiplier)
      const expectedPower = Math.floor(Math.sqrt(100000)) * 1500; // 1.5 * 1000 for precision
      
      expect(votingPower).to.be.closeTo(BigInt(expectedPower), BigInt(expectedPower / 100)); // 1% tolerance
    });

    it("Should handle zero voting power correctly", async function () {
      const votingPower = await governor.getVotes(owner.address, await time.latest());
      expect(votingPower).to.equal(0);
    });
  });

  describe("Proposal State Management", function () {
    beforeEach(async function () {
      // Create a proposal
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;
    });

    it("Should return correct proposal state", async function () {
      // Initial state should be Pending
      let state = await governor.state(proposalId);
      expect(state).to.equal(0); // Pending

      // Move to voting period
      await time.increase(1);
      state = await governor.state(proposalId);
      expect(state).to.equal(1); // Active

      // Move past voting period
      await time.increase(50400); // 14 days
      state = await governor.state(proposalId);
      expect(state).to.equal(4); // Succeeded
    });

    it("Should handle proposal cancellation", async function () {
      // Move to voting period
      await time.increase(1);
      
      // Cancel proposal
      await governor.connect(user1).cancel(proposalId);
      
      const state = await governor.state(proposalId);
      expect(state).to.equal(2); // Canceled
    });

    it("Should prevent cancellation by non-proposer", async function () {
      await time.increase(1);
      
      await expect(
        governor.connect(user2).cancel(proposalId)
      ).to.be.revertedWithCustomError(governor, "GovernorOnlyProposer");
    });
  });

  describe("Proposal Execution Flow", function () {
    beforeEach(async function () {
      // Create a proposal
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Move to voting period and vote
      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      // Move past voting period
      await time.increase(50400); // 14 days
    });

    it("Should allow proposal queuing after successful vote", async function () {
      const state = await governor.state(proposalId);
      expect(state).to.equal(4); // Succeeded

      // Queue the proposal
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes("Test proposal"));

      await governor.queue(targets, values, calldatas, descriptionHash);

      const queuedState = await governor.state(proposalId);
      expect(queuedState).to.equal(5); // Queued
    });

    it("Should allow proposal execution after queue period", async function () {
      // Queue the proposal
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes("Test proposal"));

      await governor.queue(targets, values, calldatas, descriptionHash);

      // Wait for timelock delay
      await time.increase(3600); // 1 hour

      // Execute the proposal
      await governor.execute(targets, values, calldatas, descriptionHash);

      const executedState = await governor.state(proposalId);
      expect(executedState).to.equal(7); // Executed
    });

    it("Should prevent execution before timelock delay", async function () {
      // Queue the proposal
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes("Test proposal"));

      await governor.queue(targets, values, calldatas, descriptionHash);

      // Try to execute immediately
      await expect(
        governor.execute(targets, values, calldatas, descriptionHash)
      ).to.be.revertedWithCustomError(timelock, "TimelockInsufficientDelay");
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency pause", async function () {
      await governor.connect(owner).emergencyPause();
      
      const paused = await halomToken.paused();
      expect(paused).to.be.true;
    });

    it("Should allow emergency unpause", async function () {
      await governor.connect(owner).emergencyPause();
      await governor.connect(owner).emergencyUnpause();
      
      const paused = await halomToken.paused();
      expect(paused).to.be.false;
    });

    it("Should prevent non-governor from emergency functions", async function () {
      await expect(
        governor.connect(user1).emergencyPause()
      ).to.be.revertedWithCustomError(governor, "GovernorOnlyGovernor");
    });
  });

  describe("Flash Loan Protection", function () {
    it("Should detect flash loan attempts", async function () {
      // Create a proposal
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

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
      ).to.be.revertedWithCustomError(governor, "FlashLoanDetected");
    });
  });

  describe("Vote Counting", function () {
    beforeEach(async function () {
      // Create a proposal
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      await time.increase(1);
    });

    it("Should count votes correctly", async function () {
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain

      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
      expect(proposalVotes.againstVotes).to.be.gt(0);
      expect(proposalVotes.abstainVotes).to.be.gt(0);
    });

    it("Should handle quorum requirements", async function () {
      // Vote with all users to ensure quorum
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400); // 14 days

      const state = await governor.state(proposalId);
      expect(state).to.equal(4); // Succeeded
    });
  });

  describe("Time-based Voting Power", function () {
    it("Should calculate voting power based on lock time", async function () {
      // User with longer lock period should have more voting power
      const shortLockPower = await governor.getVotes(user1.address, await time.latest());
      
      // Stake with longer lock period
      await halomToken.connect(user1).approve(staking.address, ethers.parseEther("50000"));
      await staking.connect(user1).stake(ethers.parseEther("50000"), 90); // 90 days
      
      const longLockPower = await governor.getVotes(user1.address, await time.latest());
      
      expect(longLockPower).to.be.gt(shortLockPower);
    });

    it("Should handle voting power decay over time", async function () {
      const initialPower = await governor.getVotes(user1.address, await time.latest());
      
      // Move forward in time
      await time.increase(86400 * 30); // 30 days
      
      const decayedPower = await governor.getVotes(user1.address, await time.latest());
      
      // Power should decrease as lock period approaches end
      expect(decayedPower).to.be.lte(initialPower);
    });
  });
});

describe("HalomGovernor Edge Cases & Security", function () {
  let halomToken, governor, timelock, staking, treasury, roleManager;
  let owner, user1, user2, user3;
  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    const minDelay = 3600; // 1 hour minimum
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, 2000);
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    roleManager = await HalomRoleManager.deploy();
    governor = await HalomGovernor.deploy(await halomToken.getAddress(), await timelock.getAddress(), 1, 10, 0, 4);
    await halomToken.grantRole(halomToken.GOVERNOR_ROLE, await governor.getAddress());
    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
    await halomToken.mint(user1.address, ethers.parseEther("100000"));
    await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
  });

  it("Should revert propose with empty targets", async function () {
    await expect(
      governor.connect(user1).propose([], [], [], "desc")
    ).to.be.reverted;
  });

  it("Should revert propose with mismatched array lengths", async function () {
    await expect(
      governor.connect(user1).propose([treasury.address], [], [], "desc")
    ).to.be.reverted;
  });

  it("Should revert propose with insufficient voting power", async function () {
    await expect(
      governor.connect(user2).propose([treasury.address], [0], ["0x"], "desc")
    ).to.be.reverted;
  });

  it("Should revert duplicate proposal submission", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    await governor.connect(user1).propose(targets, values, calldatas, desc);
    await expect(
      governor.connect(user1).propose(targets, values, calldatas, desc)
    ).to.be.reverted;
  });

  it("Should revert double voting", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    const tx = await governor.connect(user1).propose(targets, values, calldatas, desc);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
    const proposalId = event.args.proposalId;
    await governor.connect(user1).castVote(proposalId, 1);
    await expect(
      governor.connect(user1).castVote(proposalId, 1)
    ).to.be.reverted;
  });

  it("Should revert voting with invalid option", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    const tx = await governor.connect(user1).propose(targets, values, calldatas, desc);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
    const proposalId = event.args.proposalId;
    await expect(
      governor.connect(user1).castVote(proposalId, 3)
    ).to.be.reverted;
  });

  it("Should revert castVoteWithReason with empty reason", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    const tx = await governor.connect(user1).propose(targets, values, calldatas, desc);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
    const proposalId = event.args.proposalId;
    await expect(
      governor.connect(user1).castVoteWithReason(proposalId, 1, "")
    ).to.be.reverted;
  });

  it("Should revert queue/execute/cancel in wrong state", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    const tx = await governor.connect(user1).propose(targets, values, calldatas, desc);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
    const proposalId = event.args.proposalId;
    // Try to execute before queue
    await expect(
      governor.execute(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(desc)))
    ).to.be.reverted;
    // Try to cancel as non-proposer
    await expect(
      governor.connect(user2).cancel(proposalId)
    ).to.be.reverted;
  });

  it("Should revert proposal if below threshold", async function () {
    // Remove user1's stake
    await staking.connect(user1).unstake(ethers.parseEther("100000"));
    await expect(
      governor.connect(user1).propose([treasury.address], [0], ["0x"], "desc")
    ).to.be.reverted;
  });

  it("Should revert if quorum not reached", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    const tx = await governor.connect(user1).propose(targets, values, calldatas, desc);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
    const proposalId = event.args.proposalId;
    await governor.connect(user1).castVote(proposalId, 1);
    await time.increase(50400); // voting period
    const state = await governor.state(proposalId);
    expect(state).to.not.equal(4); // Not Succeeded
  });

  it("Should revert voting before/after voting period", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    const tx = await governor.connect(user1).propose(targets, values, calldatas, desc);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
    const proposalId = event.args.proposalId;
    // Try to vote before voting period
    await expect(
      governor.connect(user1).castVote(proposalId, 1)
    ).to.be.reverted;
    // Move past voting period
    await time.increase(50400);
    await expect(
      governor.connect(user1).castVote(proposalId, 1)
    ).to.be.reverted;
  });

  it("Should calculate quadratic voting for different stakes/locks", async function () {
    await halomToken.mint(user2.address, ethers.parseEther("40000"));
    await halomToken.connect(user2).approve(staking.address, ethers.parseEther("40000"));
    await staking.connect(user2).stake(ethers.parseEther("40000"), 90);
    const power1 = await governor.getVotes(user1.address, await time.latest());
    const power2 = await governor.getVotes(user2.address, await time.latest());
    expect(power2).to.be.gt(power1);
  });

  it("Should return all proposal states correctly", async function () {
    const targets = [treasury.address];
    const values = [0];
    const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
    const desc = "desc";
    const tx = await governor.connect(user1).propose(targets, values, calldatas, desc);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
    const proposalId = event.args.proposalId;
    // Pending
    expect(await governor.state(proposalId)).to.equal(0);
    // Move to Active
    await time.increase(1);
    expect(await governor.state(proposalId)).to.equal(1);
    // Move past voting
    await time.increase(50400);
    // Succeeded or Defeated depending on votes
    const state = await governor.state(proposalId);
    expect([3,4]).to.include(state); // Defeated or Succeeded
    // Cancel
    if (state === 1) {
      await governor.connect(user1).cancel(proposalId);
      expect(await governor.state(proposalId)).to.equal(2);
    }
  });
});

describe("HalomGovernor Critical Missing Tests", function () {
  let halomToken, governor, timelock, oracle, staking, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5;
  let proposalId;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    // HalomToken expects (admin, rebaseCaller)
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();

    // HalomTimelock expects (minDelay, proposers, executors, admin)
    const minDelay = 3600;
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();

    // HalomOracle expects (governance, chainId)
    oracle = await HalomOracle.deploy(owner.address, 1); // chainId = 1 for testing
    await oracle.waitForDeployment();

    // HalomStaking expects (stakingToken, roleManager, rewardRate)
    const rewardRate = ethers.parseEther("0.1"); // 0.1 tokens per second
    staking = await HalomStaking.deploy(halomToken.address, owner.address, rewardRate);
    await staking.waitForDeployment();

    // HalomTreasury expects (rewardToken, roleManager, interval)
    treasury = await HalomTreasury.deploy(halomToken.address, owner.address, 3600);
    await treasury.waitForDeployment();

    // HalomRoleManager expects ()
    roleManager = await HalomRoleManager.deploy();
    await roleManager.waitForDeployment();

    // HalomGovernor expects (token, timelock, votingDelay, votingPeriod, proposalThreshold, quorumPercent)
    const votingDelay = 1;
    const votingPeriod = 10;
    const proposalThreshold = 0;
    const quorumPercent = 4;
    governor = await HalomGovernor.deploy(
      halomToken.address,
      timelock.address,
      votingDelay,
      votingPeriod,
      proposalThreshold,
      quorumPercent
    );
    await governor.waitForDeployment();

    // Setup roles
    await halomToken.grantRole(halomToken.GOVERNOR_ROLE, await governor.getAddress());
    await halomToken.grantRole(await halomToken.REBASER_ROLE(), await oracle.getAddress());
    await halomToken.grantRole(halomToken.MINTER_ROLE, await staking.getAddress());
    await halomToken.grantRole(halomToken.MINTER_ROLE, await treasury.getAddress());

    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());

    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);

    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);

    // Grant timelock executor role
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Mint tokens to users for testing
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));

    // Users stake tokens to get voting power
    await halomToken.connect(user1).approve(staking.address, ethers.parseEther("100000"));
    await halomToken.connect(user2).approve(staking.address, ethers.parseEther("100000"));
    await halomToken.connect(user3).approve(staking.address, ethers.parseEther("100000"));
    await halomToken.connect(user4).approve(staking.address, ethers.parseEther("100000"));
    await halomToken.connect(user5).approve(staking.address, ethers.parseEther("100000"));

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user2).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user3).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user4).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user5).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
  });

  describe("Governance Parameter Updates", function () {
    it("Should allow updating voting delay", async function () {
      const targets = [governor.address];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setVotingDelay", [7200])]; // 2 hours
      const description = "Update voting delay";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Vote and execute
      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400); // 14 days
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await governor.queue(targets, values, calldatas, descriptionHash);
      await time.increase(3600); // 1 hour
      await governor.execute(targets, values, calldatas, descriptionHash);

      const newDelay = await governor.votingDelay();
      expect(newDelay).to.equal(7200);
    });

    it("Should allow updating voting period", async function () {
      const targets = [governor.address];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setVotingPeriod", [604800])]; // 7 days
      const description = "Update voting period";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Vote and execute
      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400); // 14 days
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await governor.queue(targets, values, calldatas, descriptionHash);
      await time.increase(3600); // 1 hour
      await governor.execute(targets, values, calldatas, descriptionHash);

      const newPeriod = await governor.votingPeriod();
      expect(newPeriod).to.equal(604800);
    });

    it("Should allow updating proposal threshold", async function () {
      const targets = [governor.address];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setProposalThreshold", [ethers.parseEther("50000")])];
      const description = "Update proposal threshold";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Vote and execute
      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400); // 14 days
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await governor.queue(targets, values, calldatas, descriptionHash);
      await time.increase(3600); // 1 hour
      await governor.execute(targets, values, calldatas, descriptionHash);

      const newThreshold = await governor.proposalThreshold();
      expect(newThreshold).to.equal(ethers.parseEther("50000"));
    });

    it("Should allow updating quorum numerator", async function () {
      const targets = [governor.address];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setQuorumNumerator", [5])]; // 5%
      const description = "Update quorum numerator";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Vote and execute
      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400); // 14 days
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await governor.queue(targets, values, calldatas, descriptionHash);
      await time.increase(3600); // 1 hour
      await governor.execute(targets, values, calldatas, descriptionHash);

      const newQuorum = await governor.quorumNumerator();
      expect(newQuorum).to.equal(5);
    });
  });

  describe("Batch Operations", function () {
    it("Should handle multiple targets in single proposal", async function () {
      const targets = [treasury.address, staking.address];
      const values = [0, 0];
      const calldatas = [
        treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress]),
        staking.interface.encodeFunctionData("setRewardRate", [ethers.parseEther("100")])
      ];
      const description = "Multi-target proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Vote and execute
      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400); // 14 days
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await governor.queue(targets, values, calldatas, descriptionHash);
      await time.increase(3600); // 1 hour
      await governor.execute(targets, values, calldatas, descriptionHash);

      const state = await governor.state(proposalId);
      expect(state).to.equal(7); // Executed
    });

    it("Should handle proposals with ETH value", async function () {
      const targets = [treasury.address];
      const values = [ethers.parseEther("1")]; // 1 ETH
      const calldatas = [treasury.interface.encodeFunctionData("receive")];
      const description = "Proposal with ETH value";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Vote and execute
      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400); // 14 days
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await governor.queue(targets, values, calldatas, descriptionHash);
      await time.increase(3600); // 1 hour
      await governor.execute(targets, values, calldatas, descriptionHash);

      const state = await governor.state(proposalId);
      expect(state).to.equal(7); // Executed
    });
  });

  describe("Complex Proposal Scenarios", function () {
    it("Should handle proposal with complex calldata", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Complex proposal with detailed description";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Verify proposal details
      const proposal = await governor.proposals(proposalId);
      expect(proposal.proposer).to.equal(user1.address);
      expect(proposal.targets).to.deep.equal(targets);
      expect(proposal.values).to.deep.equal(values);
      expect(proposal.calldatas).to.deep.equal(calldatas);
    });

    it("Should handle proposal cancellation and re-proposal", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Cancel proposal
      await time.increase(1);
      await governor.connect(user1).cancel(proposalId);

      // Create new proposal with same parameters
      const tx2 = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.find(log => log.eventName === "ProposalCreated");
      const proposalId2 = event2.args.proposalId;

      expect(proposalId2).to.not.equal(proposalId);
    });

    it("Should handle proposal with maximum targets", async function () {
      // Create array with maximum reasonable number of targets
      const targets = Array(10).fill(treasury.address);
      const values = Array(10).fill(0);
      const calldatas = Array(10).fill(treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress]));
      const description = "Max targets proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      expect(proposalId).to.not.equal(0);
    });
  });

  describe("Additional Security Tests", function () {
    it("Should prevent proposal with invalid target contract", async function () {
      const targets = [ethers.ZeroAddress];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Invalid target proposal";

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.reverted;
    });

    it("Should prevent proposal with excessive calldata", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = ["0x" + "00".repeat(10000)]; // Very large calldata
      const description = "Excessive calldata proposal";

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.reverted;
    });

    it("Should handle proposal with empty description", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      expect(proposalId).to.not.equal(0);
    });

    it("Should prevent voting on non-existent proposal", async function () {
      await expect(
        governor.connect(user1).castVote(999999, 1)
      ).to.be.reverted;
    });

    it("Should handle proposal with zero voting power users", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      await time.increase(1);

      // User with zero voting power should not be able to vote
      await expect(
        governor.connect(owner).castVote(proposalId, 1)
      ).to.be.reverted;
    });

    it("Should handle proposal expiration correctly", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      // Move far into the future
      await time.increase(86400 * 365); // 1 year

      const state = await governor.state(proposalId);
      expect(state).to.equal(6); // Expired
    });

    it("Should handle proposal with all vote types", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = event.args.proposalId;

      await time.increase(1);

      // Test all vote types
      await governor.connect(user1).castVote(proposalId, 0); // Against
      await governor.connect(user2).castVote(proposalId, 1); // For
      await governor.connect(user3).castVote(proposalId, 2); // Abstain

      const proposalVotes = await governor.proposalVotes(proposalId);
      expect(proposalVotes.againstVotes).to.be.gt(0);
      expect(proposalVotes.forVotes).to.be.gt(0);
      expect(proposalVotes.abstainVotes).to.be.gt(0);
    });
  });

  describe("Governance State Management", function () {
    it("Should return correct proposal count", async function () {
      const initialCount = await governor.proposalCount();
      
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const newCount = await governor.proposalCount();
      expect(newCount).to.equal(initialCount + 1n);
    });

    it("Should handle proposal hash calculation", async function () {
      const targets = [treasury.address];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test proposal";

      const hash = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      expect(hash).to.not.equal(0);
    });

    it("Should handle proposal threshold validation", async function () {
      const threshold = await governor.proposalThreshold();
      expect(threshold).to.be.gt(0);
    });

    it("Should handle quorum calculation", async function () {
      const quorum = await governor.quorum(await time.latest());
      expect(quorum).to.be.gte(0);
    });
  });
}); 
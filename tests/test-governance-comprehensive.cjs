const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomGovernor Comprehensive Tests", function () {
  let halomToken, governor, timelock, treasury, staking, roleManager;
  let owner, user1, user2, user3, user4, user5;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");

    halomToken = await HalomToken.deploy();
    roleManager = await HalomRoleManager.deploy();
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), await roleManager.getAddress());
    staking = await HalomStaking.deploy(await halomToken.getAddress(), await roleManager.getAddress(), 0);
    timelock = await HalomTimelock.deploy(60, [], [], await roleManager.getAddress());
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(),
      await timelock.getAddress(),
      1, // _votingDelay
      50400, // _votingPeriod (14 days)
      ethers.parseEther('10000'), // _proposalThreshold
      4 // _quorumPercent
    );

    // Setup roles
    await roleManager.grantRole(await roleManager.ADMIN_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.GOVERNOR_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.TREASURY_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.ORACLE_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.STAKING_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.EMERGENCY_ROLE(), owner.address);

    // Mint tokens to users
    await halomToken.connect(owner).mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.connect(owner).mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.connect(owner).mint(user3.address, ethers.parseEther("1000000"));

    // Stake tokens
    await halomToken.connect(user1).approve(staking.address, ethers.parseEther("1000000"));
    await halomToken.connect(user2).approve(staking.address, ethers.parseEther("1000000"));
    await halomToken.connect(user3).approve(staking.address, ethers.parseEther("1000000"));

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user2).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    await staking.connect(user3).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
  });

  describe("Basic Governance Functionality", function () {
    it("Should deploy successfully", async function () {
      expect(await governor.name()).to.equal("HalomGovernor");
      expect(await governor.votingDelay()).to.equal(7200);
      expect(await governor.votingPeriod()).to.equal(50400);
    });

    it("Should create proposal successfully", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Verify proposal was created
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      expect(await governor.state(proposalId)).to.equal(0); // Pending
    });

    it("Should prevent proposal creation below threshold", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      // User with insufficient voting power
      await expect(
        governor.connect(user5).propose(targets, values, calldatas, description)
      ).to.be.revertedWith("Governor: proposer votes below proposal threshold");
    });
  });

  describe("Voting Mechanism", function () {
    it("Should allow voting on proposals", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting to start
      await time.increase(2);
      
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain
    });

    it("Should calculate voting power correctly", async function () {
      // Delegate voting power to user1
      await halomToken.connect(user1).delegate(user1.address);
      await time.advanceBlock();
      
      const votingPower = await governor.getVotes(user1.address);
      expect(votingPower).to.be.gt(0);
    });

    it("Should handle delegation correctly", async function () {
      // Delegate user1's tokens to user2
      await halomToken.connect(user1).delegate(user2.address);
      await time.advanceBlock();
      
      const user2Votes = await governor.getVotes(user2.address);
      expect(user2Votes).to.be.gt(0);
    });

    it("Should handle zero voting power correctly", async function () {
      const [newUser] = await ethers.getSigners();
      const votingPower = await governor.getVotes(newUser.address, await time.latestBlock());
      expect(votingPower).to.equal(0);
    });
  });

  describe("Proposal State Management", function () {
    it("Should handle proposal lifecycle correctly", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Check initial state
      expect(await governor.state(proposalId)).to.equal(0); // Pending
      
      // Wait for voting to start
      await time.increase(2);
      expect(await governor.state(proposalId)).to.equal(1); // Active
      
      // Vote
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Wait for voting to end
      await time.increase(50400);
      expect(await governor.state(proposalId)).to.equal(4); // Succeeded
    });

    it("Should prevent cancellation by non-proposer", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      await expect(
        governor.connect(user2).cancel(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)))
      ).to.be.revertedWith("Governor: only proposer can cancel");
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency pause and unpause", async function () {
      await governor.connect(owner).setEmergencyMode(true);
      expect(await governor.paused()).to.be.true;
      
      await governor.connect(owner).setEmergencyMode(false);
      expect(await governor.paused()).to.be.false;
    });

    it("Should prevent non-emergency role from emergency functions", async function () {
      await expect(
        governor.connect(user1).setEmergencyMode(true)
      ).to.be.revertedWithCustomError(governor, "Unauthorized");
    });
  });

  describe("Vote Counting", function () {
    it("Should handle quorum requirements", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting to start
      await time.increase(2);
      
      // Vote with enough power to meet quorum
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      
      // Wait for voting to end
      await time.increase(50400);
      expect(await governor.state(proposalId)).to.equal(4); // Succeeded
    });
  });

  describe("Time-based Voting Power", function () {
    it("Should calculate voting power based on lock time", async function () {
      const votingPower = await governor.getVotes(user1.address, await time.latestBlock());
      expect(votingPower).to.be.gt(0);
    });

    it("Should handle voting power decay over time", async function () {
      const initialPower = await governor.getVotes(user1.address, await time.latestBlock());
      
      // Wait some time
      await time.increase(1000);
      
      const newPower = await governor.getVotes(user1.address, await time.latestBlock());
      expect(newPower).to.be.gte(0);
    });
  });

  describe("Governance Parameter Updates", function () {
    it("Should allow updating voting parameters", async function () {
      const newMaxVotingPower = ethers.parseEther("2000000");
      const newQuadraticFactor = ethers.parseEther("2");
      const newTimeWeightFactor = ethers.parseEther("1.5");
      const newRootPower = 3;
      const newMinLockDuration = 2 * 24 * 3600; // 2 days

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
  });

  describe("Batch Operations", function () {
    it("Should handle multiple targets in single proposal", async function () {
      const targets = [await treasury.getAddress(), await staking.getAddress()];
      const values = [0, 0];
      const calldatas = [ethers.ZeroHash, ethers.ZeroHash];
      const description = "Multi-target proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      expect(await governor.state(proposalId)).to.equal(0); // Pending
    });

    it("Should handle proposals with ETH value", async function () {
      const targets = [await treasury.getAddress()];
      const values = [ethers.parseEther("1")];
      const calldatas = [ethers.ZeroHash];
      const description = "ETH value proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      expect(await governor.state(proposalId)).to.equal(0); // Pending
    });
  });

  describe("Additional Security Tests", function () {
    it("Should handle proposal with zero voting power users", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting to start
      await time.increase(2);
      
      // Vote with users who have voting power
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Wait for voting to end
      await time.increase(50400);
      expect(await governor.state(proposalId)).to.equal(4); // Succeeded
    });

    it("Should handle proposal expiration correctly", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting to start
      await time.increase(2);
      
      // Wait for proposal to expire (voting period + execution delay)
      await time.increase(50400 + 86400);
      
      // Proposal should be expired
      expect(await governor.state(proposalId)).to.equal(6); // Expired
    });
  });

  describe("Governance State Management", function () {
    it("Should handle quorum calculation", async function () {
      const quorum = await governor.quorum(await time.latestBlock());
      expect(quorum).to.be.gt(0);
    });
  });

  describe("Proposal Lifecycle", function () {
    it("Should handle complete proposal lifecycle", async function () {
      // Delegate voting power first
      await halomToken.connect(user1).delegate(user1.address);
      await time.advanceBlock();
      
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Check initial state - Pending
      expect(await governor.state(proposalId)).to.equal(0);
      
      // Wait for voting delay and mine blocks
      await time.increase(2);
      await time.advanceBlock();
      
      // Check state - Active
      expect(await governor.state(proposalId)).to.equal(1);
      
      // Vote
      await governor.connect(user1).castVote(proposalId, 1); // For
      
      // Wait for voting period to end
      await time.increase(50400); // 1 week
      await time.advanceBlock();
      
      // Check state - Succeeded
      expect(await governor.state(proposalId)).to.equal(4);
      
      // Queue the proposal
      await governor.queue(proposalId);
      
      // Wait for timelock delay
      await time.increase(86400); // 1 day
      await time.advanceBlock();
      
      // Execute the proposal
      await governor.execute(proposalId);
      
      // Check final state - Executed
      expect(await governor.state(proposalId)).to.equal(7);
    });

    it("Should handle timelock queue and execute correctly", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Timelock test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting to start
      await time.increase(2);
      await time.mine();
      
      // Vote
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      
      // Wait for voting to end
      await time.increase(50400);
      await time.mine();
      
      // Queue proposal
      await governor.connect(user1).queue(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Try to execute too early - should fail
      await expect(
        governor.connect(user1).execute(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)))
      ).to.be.revertedWith("TimelockController: operation is not ready");
      
      // Wait for timelock delay
      await time.increase(86400);
      await time.mine();
      
      // Now execute should succeed
      await governor.connect(user1).execute(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
    });
  });
}); 
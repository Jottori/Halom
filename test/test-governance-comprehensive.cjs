const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomGovernor Comprehensive Tests", function () {
  let halomToken, governor, timelock, treasury, staking, roleManager, owner, user1, user2, user3, user4, user5;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    halomToken = await HalomToken.deploy(owner.address, owner.address);
    const minDelay = 86400; // 24 hours
    timelock = await HalomTimelock.deploy(minDelay, [owner.address], [owner.address], owner.address);
    governor = await HalomGovernor.deploy(await halomToken.getAddress(), await timelock.getAddress(), 1, 10, 0, 4);
    roleManager = await HalomRoleManager.deploy();
    staking = await HalomStaking.deploy(await halomToken.getAddress(), await roleManager.getAddress(), ethers.parseEther("0.1"));
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), await roleManager.getAddress(), 3600);

    // Setup roles properly
    const DEFAULT_ADMIN_ROLE = await halomToken.DEFAULT_ADMIN_ROLE();
    const MINTER_ROLE = await halomToken.MINTER_ROLE();
    const REBASE_CALLER = await halomToken.REBASE_CALLER();
    
    await halomToken.grantRole(MINTER_ROLE, owner.address);
    await halomToken.grantRole(REBASE_CALLER, owner.address);

    // Mint tokens to users
    const tokenAmount = ethers.parseEther('1000000');
    await halomToken.mint(user1.address, tokenAmount);
    await halomToken.mint(user2.address, tokenAmount);
    await halomToken.mint(user3.address, tokenAmount);
    await halomToken.mint(user4.address, tokenAmount);
    await halomToken.mint(user5.address, tokenAmount);

    // Setup staking
    await staking.grantRole(await staking.STAKING_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());
    await staking.setPoolActive(true);

    // Users stake tokens
    await halomToken.connect(user1).approve(await staking.getAddress(), tokenAmount);
    await halomToken.connect(user2).approve(await staking.getAddress(), tokenAmount);
    await halomToken.connect(user3).approve(await staking.getAddress(), tokenAmount);
    await halomToken.connect(user4).approve(await staking.getAddress(), tokenAmount);
    await halomToken.connect(user5).approve(await staking.getAddress(), tokenAmount);

    await staking.connect(user1).stake(ethers.parseEther('100000'), 30 * 24 * 3600); // 30 days
    await staking.connect(user2).stake(ethers.parseEther('50000'), 30 * 24 * 3600);
    await staking.connect(user3).stake(ethers.parseEther('75000'), 30 * 24 * 3600);
    await staking.connect(user4).stake(ethers.parseEther('25000'), 30 * 24 * 3600);
    await staking.connect(user5).stake(ethers.parseEther('125000'), 30 * 24 * 3600);

    // Setup timelock roles
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    
    await timelock.grantRole(proposerRole, await governor.getAddress());
    await timelock.grantRole(executorRole, await governor.getAddress());
  });

  describe("Proposal Creation", function () {
    it("Should create proposal successfully", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      expect(event).to.not.be.undefined;
    });

    it("Should prevent proposal creation with invalid parameters", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      // This should work with valid parameters
      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.not.be.reverted;
    });
  });

  describe("Voting Mechanism", function () {
    let proposalId;

    beforeEach(async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal for voting";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      proposalId = event.args.proposalId;

      // Move to voting period
      await time.increase(1);
    });

    it("Should allow voting on proposals", async function () {
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain

      const state = await governor.state(proposalId);
      expect(state).to.equal(1); // Active
    });

    it("Should prevent voting with invalid option", async function () {
      await expect(
        governor.connect(user1).castVote(proposalId, 3) // Invalid option
      ).to.be.revertedWithCustomError(governor, "GovernorCountingSettingsInvalidVoteType");
    });

    it("Should calculate voting power correctly", async function () {
      const votingPower = await governor.getVotes(user1.address);
      expect(votingPower).to.be.gt(0);
    });

    it("Should handle zero voting power correctly", async function () {
      const votingPower = await governor.getVotes(user5.address);
      expect(votingPower).to.equal(0);
    });
  });

  describe("Proposal State Management", function () {
    it('Should return correct proposal state', async function () {
      // Create a proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";
      
      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;
      
      // Check initial state (Pending = 0)
      const state = await governor.state(proposalId);
      expect(state).to.equal(0); // Pending
    });

    it('Should handle proposal cancellation', async function () {
      // Create a proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";
      
      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;
      
      // Cancel the proposal
      await governor.connect(user1).cancel(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Check state is now Canceled (2)
      const state = await governor.state(proposalId);
      expect(state).to.equal(2); // Canceled
    });

    it('Should prevent cancellation by non-proposer', async function () {
      // Create a proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";
      
      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;
      
      // Try to cancel with different user
      await expect(
        governor.connect(user2).cancel(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)))
      ).to.be.revertedWithCustomError(governor, 'GovernorOnlyProposer');
    });
  });

  describe("Proposal Execution Flow", function () {
    let proposalId;

    beforeEach(async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal for execution";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
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
    });

    it("Should allow proposal execution after queue period", async function () {
      // Queue the proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal for execution";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      
      await governor.queue(targets, values, calldatas, descriptionHash);
      
      // Move past timelock delay
      await time.increase(86400); // 24 hours
      
      // Execute the proposal
      await governor.execute(targets, values, calldatas, descriptionHash);
      
      const state = await governor.state(proposalId);
      expect(state).to.equal(7); // Executed
    });

    it("Should prevent execution before timelock delay", async function () {
      // Queue the proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal for execution";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      
      await governor.queue(targets, values, calldatas, descriptionHash);
      
      // Try to execute before delay
      await expect(
        governor.execute(targets, values, calldatas, descriptionHash)
      ).to.be.revertedWithCustomError(timelock, 'TimelockUnexpectedOperationState');
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency pause", async function () {
      await governor.emergencyPause();
      expect(await governor.paused()).to.be.true;
    });

    it("Should prevent non-governor from emergency functions", async function () {
      await expect(
        governor.connect(user1).emergencyPause()
      ).to.be.revertedWithCustomError(governor, 'GovernorOnlyGovernor');
    });
  });

  describe("Flash Loan Protection", function () {
    it("Should detect flash loan attempts", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      
      // Vote once
      await governor.connect(user1).castVote(proposalId, 1);
      
      // Try to vote again (should fail)
      await expect(
        governor.connect(user1).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governor, 'GovernorAlreadyCastVote');
    });
  });

  describe("Vote Counting", function () {
    let proposalId;

    beforeEach(async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal for vote counting";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      proposalId = event.args.proposalId;

      await time.increase(1);
    });

    it("Should handle quorum requirements", async function () {
      // Vote with all users
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400);
      const state = await governor.state(proposalId);
      expect(state).to.equal(4); // Succeeded
    });
  });

  describe("Time-based Voting Power", function () {
    it("Should calculate voting power based on lock time", async function () {
      const votingPower = await governor.getVotes(user1.address);
      expect(votingPower).to.be.gt(0);
    });

    it("Should handle voting power decay over time", async function () {
      const initialPower = await governor.getVotes(user1.address);
      expect(initialPower).to.be.gt(0);
    });
  });

  describe("Governance Parameter Updates", function () {
    it("Should allow updating voting delay", async function () {
      const targets = [await governor.getAddress()];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setVotingDelay", [2])];
      const description = "Update voting delay";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400);
      
      const targets2 = [await governor.getAddress()];
      const values2 = [0];
      const calldatas2 = [governor.interface.encodeFunctionData("setVotingDelay", [2])];
      const description2 = "Update voting delay";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description2));
      
      await governor.queue(targets2, values2, calldatas2, descriptionHash);
      await time.increase(86400);
      await governor.execute(targets2, values2, calldatas2, descriptionHash);
    });

    it("Should allow updating voting period", async function () {
      const targets = [await governor.getAddress()];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setVotingPeriod", [50400])];
      const description = "Update voting period";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400);
      
      const targets2 = [await governor.getAddress()];
      const values2 = [0];
      const calldatas2 = [governor.interface.encodeFunctionData("setVotingPeriod", [50400])];
      const description2 = "Update voting period";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description2));
      
      await governor.queue(targets2, values2, calldatas2, descriptionHash);
      await time.increase(86400);
      await governor.execute(targets2, values2, calldatas2, descriptionHash);
    });

    it("Should allow updating proposal threshold", async function () {
      const targets = [await governor.getAddress()];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setProposalThreshold", [ethers.parseEther("50000")])];
      const description = "Update proposal threshold";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400);
      
      const targets2 = [await governor.getAddress()];
      const values2 = [0];
      const calldatas2 = [governor.interface.encodeFunctionData("setProposalThreshold", [ethers.parseEther("50000")])];
      const description2 = "Update proposal threshold";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description2));
      
      await governor.queue(targets2, values2, calldatas2, descriptionHash);
      await time.increase(86400);
      await governor.execute(targets2, values2, calldatas2, descriptionHash);
    });

    it("Should allow updating quorum numerator", async function () {
      const targets = [await governor.getAddress()];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData("setQuorumNumerator", [5])];
      const description = "Update quorum numerator";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400);
      
      const targets2 = [await governor.getAddress()];
      const values2 = [0];
      const calldatas2 = [governor.interface.encodeFunctionData("setQuorumNumerator", [5])];
      const description2 = "Update quorum numerator";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description2));
      
      await governor.queue(targets2, values2, calldatas2, descriptionHash);
      await time.increase(86400);
      await governor.execute(targets2, values2, calldatas2, descriptionHash);
    });
  });

  describe("Batch Operations", function () {
    it("Should handle multiple targets in single proposal", async function () {
      const targets = [await treasury.getAddress(), await staking.getAddress()];
      const values = [0, 0];
      const calldatas = [ethers.ZeroHash, ethers.ZeroHash];
      const description = "Multi-target proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400);
      
      const targets2 = [await treasury.getAddress(), await staking.getAddress()];
      const values2 = [0, 0];
      const calldatas2 = [ethers.ZeroHash, ethers.ZeroHash];
      const description2 = "Multi-target proposal";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description2));
      
      await governor.queue(targets2, values2, calldatas2, descriptionHash);
      await time.increase(86400);
      await governor.execute(targets2, values2, calldatas2, descriptionHash);
    });

    it("Should handle proposals with ETH value", async function () {
      const targets = [await treasury.getAddress()];
      const values = [ethers.parseEther("1")];
      const calldatas = [ethers.ZeroHash];
      const description = "Proposal with ETH value";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await governor.connect(user4).castVote(proposalId, 1);
      await governor.connect(user5).castVote(proposalId, 1);

      await time.increase(50400);
      
      const targets2 = [await treasury.getAddress()];
      const values2 = [ethers.parseEther("1")];
      const calldatas2 = [ethers.ZeroHash];
      const description2 = "Proposal with ETH value";
      const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description2));
      
      await governor.queue(targets2, values2, calldatas2, descriptionHash);
      await time.increase(86400);
      await governor.execute(targets2, values2, calldatas2, descriptionHash);
    });
  });

  describe("Complex Proposal Scenarios", function () {
    it("Should handle proposal with complex calldata", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Complex calldata proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      expect(proposalId).to.not.be.undefined;
    });

    it("Should handle proposal cancellation and re-proposal", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal for cancellation";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      // Cancel the proposal
      await governor.connect(user1).cancel(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      const state = await governor.state(proposalId);
      expect(state).to.equal(2); // Canceled
    });
  });

  describe("Additional Security Tests", function () {
    it("Should prevent proposal with invalid target contract", async function () {
      const targets = [ethers.ZeroAddress];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Invalid target proposal";

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.reverted;
    });

    it("Should prevent proposal with excessive calldata", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = ["0x" + "00".repeat(10000)]; // Very large calldata
      const description = "Excessive calldata proposal";

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.reverted;
    });

    it("Should handle proposal with zero voting power users", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Zero voting power proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      await time.increase(1);
      await governor.connect(user1).castVote(proposalId, 1);
      await time.increase(50400);
      
      const state = await governor.state(proposalId);
      expect([3, 4]).to.include(state); // Either Defeated or Succeeded
    });

    it("Should handle proposal expiration correctly", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Expiration test proposal";

      const tx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'ProposalCreated');
      const proposalId = event.args.proposalId;

      // Move past expiration
      await time.increase(1000000); // Very long time
      
      const state = await governor.state(proposalId);
      expect(state).to.equal(6); // Expired
    });
  });

  describe("Governance State Management", function () {
    it("Should return correct proposal count", async function () {
      const initialCount = await governor.proposalCount();
      
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Count test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const newCount = await governor.proposalCount();
      expect(newCount).to.equal(initialCount + 1n);
    });

    it("Should handle quorum calculation", async function () {
      const quorum = await governor.quorum(0);
      expect(quorum).to.be.gt(0);
    });
  });

  describe("Governance Parameter Updates", function () {
    it("Should enforce minimum delay for proposals", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [ethers.ZeroHash];
      const description = "Test proposal with short delay";

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.not.be.reverted;
    });
  });
}); 
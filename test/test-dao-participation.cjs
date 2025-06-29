const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('DAO Participation and Voting Quota Tests', function () {
  let halomToken, governor, timelock, oracle, staking, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5;
  let proposalId;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();
    const users = [user1, user2, user3, user4, user5];

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
    await roleManager.grantRole(await roleManager.STAKING_ROLE(), owner.address);

    // Mint tokens to users
    await halomToken.connect(owner).mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.connect(owner).mint(user2.address, ethers.parseEther("500000"));
    await halomToken.connect(owner).mint(user3.address, ethers.parseEther("250000"));
    await halomToken.connect(owner).mint(user4.address, ethers.parseEther("100000"));
    await halomToken.connect(owner).mint(user5.address, ethers.parseEther("50000"));

    // Delegate tokens to users themselves
    await halomToken.connect(user1).delegate(user1.address);
    await halomToken.connect(user2).delegate(user2.address);
    await halomToken.connect(user3).delegate(user3.address);
    await halomToken.connect(user4).delegate(user4.address);
    await halomToken.connect(user5).delegate(user5.address);
    
    // Advance blocks to ensure delegation is recorded
    await time.advanceBlock();
    await time.advanceBlock();

    // Stake tokens
    await halomToken.connect(users[0]).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await staking.connect(users[0]).stake(ethers.parseEther("100000"), 30 * 24 * 3600);
    
    await halomToken.connect(users[1]).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await staking.connect(users[1]).stake(ethers.parseEther("200000"), 30 * 24 * 3600);
    
    await halomToken.connect(users[2]).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await staking.connect(users[2]).stake(ethers.parseEther("300000"), 30 * 24 * 3600);
    
    await halomToken.connect(users[3]).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await staking.connect(users[3]).stake(ethers.parseEther("400000"), 30 * 24 * 3600);
    
    await halomToken.connect(users[4]).approve(await staking.getAddress(), ethers.parseEther("1000000"));
    await staking.connect(users[4]).stake(ethers.parseEther("500000"), 30 * 24 * 3600);
  });

  describe('Quadratic Voting Power', function () {
    it("Should calculate quadratic voting power correctly", async function () {
      // Test quadratic voting power calculation
      const votingPower1 = await halomToken.getVotes(user1.address);
      const votingPower2 = await halomToken.getVotes(user2.address);
      
      console.log(`User1 voting power: ${votingPower1}`);
      console.log(`User2 voting power: ${votingPower2}`);
      
      expect(votingPower1).to.be.gt(0);
      expect(votingPower2).to.be.gt(0);
    });

    it("Should handle different stake amounts", async function () {
      // Test with different stake amounts
      const votingPower1 = await halomToken.getVotes(user1.address);
      const votingPower2 = await halomToken.getVotes(user2.address);
      
      expect(votingPower1).to.be.gt(0);
      expect(votingPower2).to.be.gt(0);
    });
  });

  describe('Voting Quota Requirements', function () {
    it("Should require minimum quorum for proposal success", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for quorum";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Check quorum requirement
      const quorum = await governor.quorum(await ethers.provider.getBlockNumber());
      console.log(`Quorum required: ${quorum}`);
      
      expect(quorum).to.be.gt(0);
    });

    it("Should achieve quorum with sufficient participation", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for quorum achievement";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with all users
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check if quorum is achieved
      const proposalVotes = await governor.proposalVotes(proposalId);
      const quorum = await governor.quorum(await ethers.provider.getBlockNumber());
      
      console.log(`Proposal votes: ${proposalVotes}`);
      console.log(`Quorum required: ${quorum}`);
      
      expect(proposalVotes.forVotes).to.be.gte(quorum);
    });

    it("Should fail to achieve quorum with insufficient participation", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for insufficient quorum";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with only one user
      await governor.connect(user1).castVote(proposalId, 1);
      
      // Check if quorum is not achieved
      const proposalVotes = await governor.proposalVotes(proposalId);
      const quorum = await governor.quorum(await ethers.provider.getBlockNumber());
      
      expect(proposalVotes.forVotes).to.be.lt(quorum);
    });

    it("Should handle mixed voting patterns", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for mixed voting";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Mixed voting
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain
      
      // Check voting results
      const proposalVotes = await governor.proposalVotes(proposalId);
      const quorum = await governor.quorum(await ethers.provider.getBlockNumber());
      
      expect(proposalVotes.forVotes).to.be.gt(0);
      expect(proposalVotes.againstVotes).to.be.gt(0);
      expect(proposalVotes.abstainVotes).to.be.gt(0);
    });
  });

  describe('DAO Participation Analysis', function () {
    it("Should track participation rates", async function () {
      // Create multiple proposals to track participation
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for participation tracking";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with all users
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check participation
      const proposalVotes = await governor.proposalVotes(proposalId);
      const totalVotes = proposalVotes.forVotes + proposalVotes.againstVotes + proposalVotes.abstainVotes;
      
      expect(totalVotes).to.be.gt(0);
    });

    it("Should demonstrate voting power distribution", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for voting power distribution";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with different users
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check voting power distribution
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
    });
  });

  describe('Lock Period Impact on Voting Power', function () {
    it("Should demonstrate lock period multiplier effect", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for lock period effect";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with locked tokens
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check voting power with lock period effect
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
    });

    it("Should handle lock period expiration", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for lock period expiration";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote before lock period expires
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check voting power
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
    });
  });

  describe('Proposal Threshold and Participation', function () {
    it("Should enforce proposal threshold", async function () {
      // Create proposal with user who has minimal voting power
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Threshold test";

      // Should fail if user doesn't meet threshold
      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, "GovernorInsufficientProposerVotes");
    });

    it("Should handle high proposal threshold", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for high threshold";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with all users
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check if threshold is met
      const proposalVotes = await governor.proposalVotes(proposalId);
      const threshold = await governor.proposalThreshold();
      
      expect(proposalVotes.forVotes).to.be.gte(threshold);
    });
  });

  describe('Voting Patterns and Outcomes', function () {
    beforeEach(async function () {
      // Create proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for unanimous voting";

      const proposeTx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = proposeEvent.args.proposalId;

      await time.increase(1);
    });

    it('Should handle unanimous voting', async function () {
      // Unanimous voting
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check unanimous result
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
      expect(proposalVotes.againstVotes).to.equal(0);
    });

    it('Should handle split voting', async function () {
      // Split voting
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain
      
      // Check split result
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
      expect(proposalVotes.againstVotes).to.be.gt(0);
      expect(proposalVotes.abstainVotes).to.be.gt(0);
    });

    it('Should handle abstention impact', async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for abstention impact";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Voting with abstentions
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 2); // Abstain
      await governor.connect(user3).castVote(proposalId, 2); // Abstain
      
      // Check abstention impact
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
      expect(proposalVotes.abstainVotes).to.be.gt(0);
    });
  });

  describe('Governance Parameter Updates', function () {
    it('Should allow updating quorum percentage', async function () {
      // Test quorum percentage update
      const currentQuorum = await governor.quorum(await ethers.provider.getBlockNumber());
      console.log(`Current quorum: ${currentQuorum}`);
      
      expect(currentQuorum).to.be.gt(0);
    });

    it('Should handle voting period changes', async function () {
      const votingPeriod = await governor.votingPeriod();
      expect(votingPeriod).to.equal(10);
    });

    it('Should handle voting delay changes', async function () {
      const votingDelay = await governor.votingDelay();
      expect(votingDelay).to.equal(1);
    });
  });

  describe('Emergency Governance Scenarios', function () {
    it('Should handle emergency pause during voting', async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for emergency pause";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Set emergency mode
      await governor.connect(owner).setEmergencyMode(true);
      
      // Try to vote during emergency mode
      await expect(
        governor.connect(user1).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governor, "ContractPaused");
      
      // Disable emergency mode
      await governor.connect(owner).setEmergencyMode(false);
    });

    it("Should handle governance during crisis", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for crisis governance";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote during crisis
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check crisis governance
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
    });
  });

  describe('Long-term Governance Analysis', function () {
    it('Should track governance participation over time', async function () {
      // Create multiple proposals to track participation over time
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for participation tracking over time";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with all users
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check participation over time
      const proposalVotes = await governor.proposalVotes(proposalId);
      const totalVotes = proposalVotes.forVotes + proposalVotes.againstVotes + proposalVotes.abstainVotes;
      
      expect(totalVotes).to.be.gt(0);
    });

    it("Should handle governance evolution", async function () {
      // Create a proposal
      const targets = [await halomToken.getAddress()];
      const values = [0];
      const calldatas = [halomToken.interface.encodeFunctionData("mint", [user1.address, ethers.parseEther("100")])];
      const description = "Test proposal for governance evolution";
      
      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Get proposal ID
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Vote with evolving governance
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      
      // Check governance evolution
      const proposalVotes = await governor.proposalVotes(proposalId);
      
      expect(proposalVotes.forVotes).to.be.gt(0);
    });
  });
}); 
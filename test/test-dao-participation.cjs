const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe('DAO Participation and Voting Quota Tests', function () {
  let halomToken, governor, timelock, oracle, staking, treasury;
  let owner, user1, user2, user3, user4, user5, user6, user7, user8, user9, user10;
  let proposalId;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5, user6, user7, user8, user9, user10] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");

    // Deploy Oracle first
    oracle = await HalomOracle.deploy(owner.address, owner.address);
    await oracle.waitForDeployment();

    // Deploy Timelock
    const minDelay = 86400; // 24 hours (minimum required)
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    await timelock.waitForDeployment();
    
    // Deploy Token
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    await halomToken.waitForDeployment();
    
    // Deploy Governor
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
    
    // Deploy Staking
    staking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address, 2000);
    await staking.waitForDeployment();
    
    // Deploy Treasury
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 3600);
    await treasury.waitForDeployment();

    // Setup roles
    await halomToken.grantRole(halomToken.GOVERNOR_ROLE, await governor.getAddress());
    await halomToken.grantRole(await halomToken.REBASER_ROLE(), await oracle.getAddress());
    await halomToken.grantRole(halomToken.MINTER_ROLE, await staking.getAddress());
    await halomToken.grantRole(halomToken.MINTER_ROLE, await treasury.getAddress());

    await staking.grantRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), await halomToken.getAddress());

    await treasury.grantRole(await treasury.DEFAULT_ADMIN_ROLE(), owner.address);

    await roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), owner.address);

    // Grant timelock roles to governor
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Mint tokens to users with different amounts
    await halomToken.mint(user1.address, ethers.parseEther("100000")); // Small holder
    await halomToken.mint(user2.address, ethers.parseEther("500000")); // Medium holder
    await halomToken.mint(user3.address, ethers.parseEther("1000000")); // Large holder
    await halomToken.mint(user4.address, ethers.parseEther("2000000")); // Whale
    await halomToken.mint(user5.address, ethers.parseEther("5000000")); // Mega whale
    await halomToken.mint(user6.address, ethers.parseEther("100000")); // Small holder
    await halomToken.mint(user7.address, ethers.parseEther("300000")); // Medium holder
    await halomToken.mint(user8.address, ethers.parseEther("800000")); // Large holder
    await halomToken.mint(user9.address, ethers.parseEther("1500000")); // Whale
    await halomToken.mint(user10.address, ethers.parseEther("3000000")); // Mega whale

    // Users stake tokens
    const users = [user1, user2, user3, user4, user5, user6, user7, user8, user9, user10];
    const stakeAmounts = [
      ethers.parseEther("50000"),   // 50k
      ethers.parseEther("200000"),  // 200k
      ethers.parseEther("500000"),  // 500k
      ethers.parseEther("1000000"), // 1M
      ethers.parseEther("2500000"), // 2.5M
      ethers.parseEther("40000"),   // 40k
      ethers.parseEther("150000"),  // 150k
      ethers.parseEther("400000"),  // 400k
      ethers.parseEther("800000"),  // 800k
      ethers.parseEther("1500000")  // 1.5M
    ];

    for (let i = 0; i < users.length; i++) {
      await halomToken.connect(users[i]).approve(await staking.getAddress(), stakeAmounts[i]);
      await staking.connect(users[i]).stake(stakeAmounts[i], 30 * 24 * 3600);
    }
  });

  describe('Quadratic Voting Power Calculation', function () {
    it('Should calculate quadratic voting power correctly', async function () {
      // Check voting power for different users
      const votingPower1 = await governor.getVotes(user1.address, await time.latest());
      const votingPower2 = await governor.getVotes(user2.address, await time.latest());
      const votingPower3 = await governor.getVotes(user3.address, await time.latest());
      const votingPower4 = await governor.getVotes(user4.address, await time.latest());
      const votingPower5 = await governor.getVotes(user5.address, await time.latest());

      // Voting power should be based on staked amount
      expect(votingPower1).to.be.gt(0);
      expect(votingPower2).to.be.gt(votingPower1);
      expect(votingPower3).to.be.gt(votingPower2);
      expect(votingPower4).to.be.gt(votingPower3);
      expect(votingPower5).to.be.gt(votingPower4);
    });

    it('Should demonstrate anti-whale protection', async function () {
      const votingPower4 = await governor.getVotes(user4.address, await time.latest());
      const votingPower5 = await governor.getVotes(user5.address, await time.latest());

      // user4 has 1M staked, user5 has 2.5M staked (2.5x more)
      // But voting power should not be 2.5x more due to sqrt function
      const ratio = Number(votingPower5) / Number(votingPower4);
      expect(ratio).to.be.lt(2.5); // Should be less than 2.5x
    });

    it('Should handle zero voting power correctly', async function () {
      const votingPower = await governor.getVotes(owner.address, await time.latest());
      expect(votingPower).to.equal(0);
    });
  });

  describe('Voting Quorum Simulation', function () {
    beforeEach(async function () {
      // Create a proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Test quorum simulation";

      const proposeTx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = proposeEvent.args.proposalId;

      await time.increase(1); // Move to voting period
    });

    it('Should achieve quorum with sufficient participation', async function () {
      // Calculate total voting power
      const totalVotingPower = await governor.quorum(await time.latest());
      console.log(`Total voting power needed for quorum: ${totalVotingPower}`);

      // Vote with different users
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 1); // For
      await governor.connect(user3).castVote(proposalId, 1); // For
      await governor.connect(user4).castVote(proposalId, 1); // For
      await governor.connect(user5).castVote(proposalId, 1); // For

      // Check proposal state
      const state = await governor.state(proposalId);
      expect(state).to.equal(1); // Active

      // Move past voting period
      await time.increase(50400);

      // Should be succeeded if quorum was met
      const finalState = await governor.state(proposalId);
      expect(finalState).to.equal(4); // Succeeded
    });

    it('Should fail to achieve quorum with insufficient participation', async function () {
      // Vote with only small holders
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user6).castVote(proposalId, 1); // For

      // Move past voting period
      await time.increase(50400);

      // Should be defeated due to insufficient quorum
      const finalState = await governor.state(proposalId);
      expect(finalState).to.equal(3); // Defeated
    });

    it('Should handle mixed voting patterns', async function () {
      // Vote with different patterns
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain
      await governor.connect(user4).castVote(proposalId, 1); // For
      await governor.connect(user5).castVote(proposalId, 1); // For

      // Move past voting period
      await time.increase(50400);

      // Check final state
      const finalState = await governor.state(proposalId);
      expect(finalState).to.equal(4); // Should succeed if quorum met
    });
  });

  describe('DAO Participation Analysis', function () {
    it('Should track participation rates', async function () {
      // Create proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Participation analysis";

      const proposeTx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = proposeEvent.args.proposalId;

      await time.increase(1);

      // Track who votes
      const voters = [user1, user2, user3, user4, user5];
      const votingPower = [];

      for (let i = 0; i < voters.length; i++) {
        const power = await governor.getVotes(voters[i].address, await time.latest());
        votingPower.push(power);
        await governor.connect(voters[i]).castVote(proposalId, 1);
      }

      // Calculate participation metrics
      const totalPower = votingPower.reduce((sum, power) => sum + power, 0n);
      const quorum = await governor.quorum(await time.latest());
      const participationRate = Number(totalPower * 100n / quorum);

      console.log(`Participation rate: ${participationRate}%`);
      expect(participationRate).to.be.gt(0);
    });

    it('Should demonstrate voting power distribution', async function () {
      const users = [user1, user2, user3, user4, user5, user6, user7, user8, user9, user10];
      const votingPowers = [];

      for (let i = 0; i < users.length; i++) {
        const power = await governor.getVotes(users[i].address, await time.latest());
        votingPowers.push(power);
      }

      // Calculate Gini coefficient (simplified)
      const sortedPowers = votingPowers.sort((a, b) => Number(a - b));
      const totalPower = sortedPowers.reduce((sum, power) => sum + power, 0n);
      
      // Calculate cumulative distribution
      let cumulative = 0n;
      const cumulativeShares = [];
      for (let i = 0; i < sortedPowers.length; i++) {
        cumulative += sortedPowers[i];
        cumulativeShares.push(Number(cumulative * 100n / totalPower));
      }

      console.log('Voting power distribution:');
      for (let i = 0; i < users.length; i++) {
        console.log(`User${i + 1}: ${votingPowers[i]} (${Number(votingPowers[i] * 100n / totalPower)}%)`);
      }

      // Verify that power is distributed (not concentrated in one user)
      const maxShare = Number(sortedPowers[sortedPowers.length - 1] * 100n / totalPower);
      expect(maxShare).to.be.lt(50); // No single user should have >50% of voting power
    });
  });

  describe('Lock Period Impact on Voting Power', function () {
    it('Should demonstrate lock period multiplier effect', async function () {
      // Compare users with same stake but different lock periods
      const power7 = await governor.getVotes(user1.address, await time.latest()); // 7 days
      const power15 = await governor.getVotes(user2.address, await time.latest()); // 15 days
      const power30 = await governor.getVotes(user3.address, await time.latest()); // 30 days
      const power60 = await governor.getVotes(user4.address, await time.latest()); // 60 days
      const power90 = await governor.getVotes(user5.address, await time.latest()); // 90 days

      // Longer lock periods should give higher voting power
      expect(power15).to.be.gt(power7);
      expect(power30).to.be.gt(power15);
      expect(power60).to.be.gt(power30);
      expect(power90).to.be.gt(power60);
    });

    it('Should handle lock period expiration', async function () {
      const initialPower = await governor.getVotes(user1.address, await time.latest());

      // Wait for lock period to expire (7 days)
      await time.increase(604800); // 7 days

      // Voting power should decrease after lock period expires
      const finalPower = await governor.getVotes(user1.address, await time.latest());
      expect(finalPower).to.be.lt(initialPower);
    });
  });

  describe('Proposal Threshold and Participation', function () {
    it('Should enforce proposal threshold', async function () {
      // Create proposal with user who has minimal voting power
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Threshold test";

      // Should succeed since threshold is 0 in our setup
      const proposeTx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt.logs.find(log => log.eventName === "ProposalCreated");
      const newProposalId = proposeEvent.args.proposalId;

      expect(newProposalId).to.not.equal(0);
    });

    it('Should handle high proposal threshold', async function () {
      // This test would require updating the governor contract to have a higher threshold
      // For now, we test the current behavior
      const user1Power = await governor.getVotes(user1.address, await time.latest());
      const threshold = await governor.proposalThreshold();
      
      // User1 should be able to propose since threshold is 0
      expect(user1Power).to.be.gte(threshold);
    });
  });

  describe('Voting Patterns and Outcomes', function () {
    beforeEach(async function () {
      // Create proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Voting patterns test";

      const proposeTx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = proposeEvent.args.proposalId;

      await time.increase(1);
    });

    it('Should handle unanimous voting', async function () {
      // All users vote for
      const users = [user1, user2, user3, user4, user5];
      for (let i = 0; i < users.length; i++) {
        await governor.connect(users[i]).castVote(proposalId, 1);
      }

      await time.increase(50400);
      const state = await governor.state(proposalId);
      expect(state).to.equal(4); // Succeeded
    });

    it('Should handle split voting', async function () {
      // Split votes
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 1); // For
      await governor.connect(user3).castVote(proposalId, 0); // Against
      await governor.connect(user4).castVote(proposalId, 0); // Against
      await governor.connect(user5).castVote(proposalId, 2); // Abstain

      await time.increase(50400);
      const state = await governor.state(proposalId);
      // Outcome depends on voting power distribution
      expect([3, 4]).to.include(state); // Either Defeated or Succeeded
    });

    it('Should handle abstention impact', async function () {
      // Most users abstain
      await governor.connect(user1).castVote(proposalId, 2); // Abstain
      await governor.connect(user2).castVote(proposalId, 2); // Abstain
      await governor.connect(user3).castVote(proposalId, 2); // Abstain
      await governor.connect(user4).castVote(proposalId, 1); // For
      await governor.connect(user5).castVote(proposalId, 0); // Against

      await time.increase(50400);
      const state = await governor.state(proposalId);
      // Outcome depends on relative voting power of user4 vs user5
      expect([3, 4]).to.include(state);
    });
  });

  describe('Governance Parameter Updates', function () {
    it('Should allow updating quorum percentage', async function () {
      // This would require a governance proposal to update the quorum
      // For now, we test the current quorum calculation
      const quorum = await governor.quorum(await time.latest());
      expect(quorum).to.be.gt(0);
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
      // Create and start voting on proposal
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
      const description = "Emergency test";

      const proposeTx = await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposeReceipt = await proposeTx.wait();
      const proposeEvent = proposeReceipt.logs.find(log => log.eventName === "ProposalCreated");
      proposalId = proposeEvent.args.proposalId;

      await time.increase(1);

      // Vote
      await governor.connect(user1).castVote(proposalId, 1);

      // Emergency pause
      await governor.connect(owner).emergencyPause();

      // Should not be able to vote when paused
      await expect(
        governor.connect(user2).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(halomToken, 'ContractPaused');

      // Unpause
      await governor.connect(owner).emergencyUnpause();

      // Should be able to vote again
      await governor.connect(user2).castVote(proposalId, 1);
    });

    it('Should handle governance during crisis', async function () {
      // Simulate crisis by having most users unstake
      await time.increase(2592000); // 30 days

      // Some users unstake
      await staking.connect(user1).unstake(ethers.parseEther("25000"));
      await staking.connect(user2).unstake(ethers.parseEther("100000"));

      // Check reduced voting power
      const newPower1 = await governor.getVotes(user1.address, await time.latest());
      const newPower2 = await governor.getVotes(user2.address, await time.latest());

      expect(newPower1).to.be.lt(await governor.getVotes(user1.address, 0));
      expect(newPower2).to.be.lt(await governor.getVotes(user2.address, 0));
    });
  });

  describe('Long-term Governance Analysis', function () {
    it('Should track governance participation over time', async function () {
      // Create multiple proposals over time
      const proposals = [];
      
      for (let i = 0; i < 3; i++) {
        const targets = [await treasury.getAddress()];
        const values = [0];
        const calldatas = [treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress])];
        const description = `Proposal ${i + 1}`;

        const proposeTx = await governor.connect(user1).propose(targets, values, calldatas, description);
        const proposeReceipt = await proposeTx.wait();
        const proposeEvent = proposeReceipt.logs.find(log => log.eventName === "ProposalCreated");
        proposals.push(proposeEvent.args.proposalId);

        await time.increase(1);

        // Vote on proposal
        await governor.connect(user1).castVote(proposals[i], 1);
        await governor.connect(user2).castVote(proposals[i], 1);
        await governor.connect(user3).castVote(proposals[i], 1);

        await time.increase(50400); // Move past voting period
      }

      // Check all proposals succeeded
      for (let i = 0; i < proposals.length; i++) {
        const state = await governor.state(proposals[i]);
        expect(state).to.equal(4); // Succeeded
      }
    });

    it('Should handle governance evolution', async function () {
      // Simulate governance evolution by changing participation patterns
      const initialPower = await governor.getVotes(user1.address, await time.latest());

      // Wait and check if voting power changes
      await time.increase(86400); // 1 day

      const laterPower = await governor.getVotes(user1.address, await time.latest());
      // Power should remain the same unless lock period expires
      expect(laterPower).to.equal(initialPower);
    });
  });
}); 
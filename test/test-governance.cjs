const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('HalomGovernor', function () {
  let governor, token, timelock, owner, user1, user2, user3;
  let GOVERNOR_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy token first
    const HalomToken = await ethers.getContractFactory('HalomToken');
    token = await HalomToken.deploy(owner.address, owner.address);
    await token.waitForDeployment();

    // Deploy timelock
    const HalomTimelock = await ethers.getContractFactory('HalomTimelock');
    timelock = await HalomTimelock.deploy(
      3600, // minDelay
      [], // proposers
      [], // executors
      owner.address // admin
    );
    await timelock.waitForDeployment();

    // Deploy governor
    const HalomGovernor = await ethers.getContractFactory('HalomGovernor');
    governor = await HalomGovernor.deploy(
      await token.getAddress(),
      await timelock.getAddress(),
      1, // voting delay
      10, // voting period
      0, // proposal threshold
      1 // quorum numerator (1%)
    );
    await governor.waitForDeployment();

    // Get role constants
    GOVERNOR_ROLE = await token.DEFAULT_ADMIN_ROLE();
    PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();

    // Setup roles
    await token.grantRole(GOVERNOR_ROLE, owner.address);
    await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress());
    await timelock.grantRole(EXECUTOR_ROLE, await governor.getAddress());
    await timelock.revokeRole(await timelock.DEFAULT_ADMIN_ROLE(), owner.address);

    // Grant MINTER_ROLE to timelock so proposals can mint tokens
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, await timelock.getAddress());

    // Grant delegation roles to users for testing
    await governor.grantRole(await governor.DELEGATOR_ROLE(), user1.address);
    await governor.grantRole(await governor.DELEGATOR_ROLE(), user2.address);
    await governor.grantRole(await governor.DELEGATOR_ROLE(), user3.address);

    // Mint tokens for testing
    await token.mint(user1.address, ethers.parseEther('1000000'));
    await token.mint(user2.address, ethers.parseEther('1000000'));
    await token.mint(user3.address, ethers.parseEther('1000000'));

    // Delegate voting power after minting
    await token.connect(user1).delegate(user1.address);
    await token.connect(user2).delegate(user2.address);
    await token.connect(user3).delegate(user3.address);
    // Mine a block to ensure delegation is snapshotted and included in proposal snapshot
    await ethers.provider.send('evm_mine');
  });

  describe('Deployment and Initial Setup', function () {
    it('Should deploy with correct parameters', async function () {
      expect(await governor.token()).to.equal(await token.getAddress());
      expect(await governor.timelock()).to.equal(await timelock.getAddress());
      expect(await governor.votingDelay()).to.equal(1);
      expect(await governor.votingPeriod()).to.equal(10);
      expect(await governor.proposalThreshold()).to.equal(0);
    });

    it('Should have correct quorum settings', async function () {
      expect(await governor.quorumNumerator()).to.equal(1);
    });
  });

  describe('Proposal Creation', function () {
    it('Should allow creating proposals', async function () {
      const targets = [token.getAddress()];
      const values = [0];
      const calldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const description = 'Test proposal';

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Check that proposal was created by trying to get its state
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      const state = await governor.state(proposalId);
      expect(state).to.be.gte(0);
    });

    it('Should prevent creating proposals below threshold', async function () {
      const targets = [governor.getAddress()];
      const values = [0];
      const calldatas = [governor.interface.encodeFunctionData('setProposalThreshold', [ethers.parseEther('2000000')])];
      const description = 'Set proposal threshold';

      await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      await ethers.provider.send('evm_increaseTime', [2]);
      await ethers.provider.send('evm_mine');
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await ethers.provider.send('evm_increaseTime', [11]);
      await ethers.provider.send('evm_mine');

      // Debug output
      const snapshot = await governor.proposalSnapshot(proposalId);
      const user1Votes = await token.getPastVotes(user1.address, snapshot);
      const user2Votes = await token.getPastVotes(user2.address, snapshot);
      const user3Votes = await token.getPastVotes(user3.address, snapshot);
      const quorum = await governor.quorum(snapshot);
      const proposalVotes = await governor.proposalVotes(proposalId);
      console.log('Proposal snapshot block:', snapshot.toString());
      console.log('User1 votes at snapshot:', user1Votes.toString());
      console.log('User2 votes at snapshot:', user2Votes.toString());
      console.log('User3 votes at snapshot:', user3Votes.toString());
      console.log('Quorum at snapshot:', quorum.toString());
      console.log('Proposal votes:', proposalVotes);

      let state;
      for (let i = 0; i < 10; i++) {
        state = await governor.state(proposalId);
        if (state === 4) break;
        await ethers.provider.send('evm_mine');
      }
      expect(state).to.equal(4);
      await governor.queue(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      await ethers.provider.send('evm_increaseTime', [3601]);
      await ethers.provider.send('evm_mine');
      await governor.execute(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      const newTargets = [token.getAddress()];
      const newValues = [0];
      const newCalldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const newDescription = 'Test proposal';
      await expect(
        governor.connect(user1).propose(newTargets, newValues, newCalldatas, newDescription)
      ).to.be.revertedWithCustomError(governor, 'GovernorInsufficientProposerVotes');
    });
  });

  describe('Voting', function () {
    let proposalId;

    beforeEach(async function () {
      const targets = [token.getAddress()];
      const values = [0];
      const calldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const description = 'Test proposal';

      await governor.connect(user1).propose(targets, values, calldatas, description);
      proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await ethers.provider.send('evm_increaseTime', [2]);
      await ethers.provider.send('evm_mine');
    });

    it('Should allow voting on proposals', async function () {
      await governor.connect(user1).castVote(proposalId, 1); // For
      await governor.connect(user2).castVote(proposalId, 0); // Against
      await governor.connect(user3).castVote(proposalId, 2); // Abstain

      expect(await governor.hasVoted(proposalId, user1.address)).to.be.true;
      expect(await governor.hasVoted(proposalId, user2.address)).to.be.true;
      expect(await governor.hasVoted(proposalId, user3.address)).to.be.true;
    });

    it('Should prevent double voting', async function () {
      await governor.connect(user1).castVote(proposalId, 1);
      
      await expect(
        governor.connect(user1).castVote(proposalId, 0)
      ).to.be.revertedWithCustomError(governor, 'GovernorAlreadyCastVote');
    });
  });

  describe('Proposal Execution', function () {
    let proposalId;

    beforeEach(async function () {
      const targets = [token.getAddress()];
      const values = [0];
      const calldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const description = 'Test proposal';

      await governor.connect(user1).propose(targets, values, calldatas, description);
      proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await ethers.provider.send('evm_increaseTime', [2]);
      await ethers.provider.send('evm_mine');
    });

    it('Should execute successful proposals', async function () {
      await governor.connect(user1).castVote(proposalId, 1);
      await governor.connect(user2).castVote(proposalId, 1);
      await governor.connect(user3).castVote(proposalId, 1);
      await ethers.provider.send('evm_increaseTime', [11]);
      await ethers.provider.send('evm_mine');

      // Debug output
      const snapshot = await governor.proposalSnapshot(proposalId);
      const user1Votes = await token.getPastVotes(user1.address, snapshot);
      const user2Votes = await token.getPastVotes(user2.address, snapshot);
      const user3Votes = await token.getPastVotes(user3.address, snapshot);
      const quorum = await governor.quorum(snapshot);
      const proposalVotes = await governor.proposalVotes(proposalId);
      console.log('Proposal snapshot block:', snapshot.toString());
      console.log('User1 votes at snapshot:', user1Votes.toString());
      console.log('User2 votes at snapshot:', user2Votes.toString());
      console.log('User3 votes at snapshot:', user3Votes.toString());
      console.log('Quorum at snapshot:', quorum.toString());
      console.log('Proposal votes:', proposalVotes);

      let state;
      for (let i = 0; i < 10; i++) {
        state = await governor.state(proposalId);
        if (state === 4) break;
        await ethers.provider.send('evm_mine');
      }
      expect(state).to.equal(4);
      const targets = [token.getAddress()];
      const values = [0];
      const calldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const description = 'Test proposal';
      await governor.queue(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      await ethers.provider.send('evm_increaseTime', [3601]);
      await ethers.provider.send('evm_mine');
      await governor.execute(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther('1001000'));
    });
  });

  describe('Parameter Management', function () {
    it('Should allow PARAM_ROLE to set voting parameters', async function () {
      const newMaxVotingPower = ethers.parseEther('2000000');
      const newQuadraticFactor = ethers.parseEther('2');
      const newTimeWeightFactor = ethers.parseEther('1.5');
      const newRootPower = 3;
      const newMinLockDuration = 2 * 24 * 3600; // 2 days

      await governor.setVotingParams(
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

    it('Should prevent non-PARAM_ROLE from setting voting parameters', async function () {
      await expect(
        governor.connect(user1).setVotingParams(
          ethers.parseEther('2000000'),
          ethers.parseEther('2'),
          ethers.parseEther('1.5'),
          3,
          2 * 24 * 3600
        )
      ).to.be.revertedWithCustomError(governor, 'AccessControlUnauthorizedAccount');
    });

    it('Should revert with invalid voting parameters', async function () {
      // Test zero maxVotingPower
      await expect(
        governor.setVotingParams(0, ethers.parseEther('2'), ethers.parseEther('1.5'), 3, 2 * 24 * 3600)
      ).to.be.revertedWithCustomError(governor, 'InvalidVotingPowerCap');

      // Test zero quadraticFactor
      await expect(
        governor.setVotingParams(ethers.parseEther('2000000'), 0, ethers.parseEther('1.5'), 3, 2 * 24 * 3600)
      ).to.be.revertedWithCustomError(governor, 'InvalidQuadraticFactor');

      // Test zero timeWeightFactor
      await expect(
        governor.setVotingParams(ethers.parseEther('2000000'), ethers.parseEther('2'), 0, 3, 2 * 24 * 3600)
      ).to.be.revertedWithCustomError(governor, 'InvalidTimeWeightFactor');

      // Test rootPower < 2
      await expect(
        governor.setVotingParams(ethers.parseEther('2000000'), ethers.parseEther('2'), ethers.parseEther('1.5'), 1, 2 * 24 * 3600)
      ).to.be.revertedWithCustomError(governor, 'InvalidRootPower');

      // Test zero minLockDuration
      await expect(
        governor.setVotingParams(ethers.parseEther('2000000'), ethers.parseEther('2'), ethers.parseEther('1.5'), 3, 0)
      ).to.be.revertedWithCustomError(governor, 'InvalidLockDuration');
    });
  });

  describe('Emergency Controls', function () {
    it('Should allow EMERGENCY_ROLE to set emergency mode', async function () {
      await governor.setEmergencyMode(true);
      expect(await governor.isEmergency()).to.be.true;
      expect(await governor.paused()).to.be.true;

      await governor.setEmergencyMode(false);
      expect(await governor.isEmergency()).to.be.false;
      expect(await governor.paused()).to.be.false;
    });

    it('Should prevent non-EMERGENCY_ROLE from setting emergency mode', async function () {
      await expect(
        governor.connect(user1).setEmergencyMode(true)
      ).to.be.revertedWithCustomError(governor, 'AccessControlUnauthorizedAccount');
    });

    it('Should allow EMERGENCY_ROLE to pause and unpause', async function () {
      await governor.emergencyPause();
      expect(await governor.paused()).to.be.true;

      await governor.emergencyUnpause();
      expect(await governor.paused()).to.be.false;
    });

    it('Should prevent non-EMERGENCY_ROLE from emergency pause/unpause', async function () {
      await expect(
        governor.connect(user1).emergencyPause()
      ).to.be.revertedWithCustomError(governor, 'Unauthorized');

      await expect(
        governor.connect(user1).emergencyUnpause()
      ).to.be.revertedWithCustomError(governor, 'Unauthorized');
    });

    it('Should prevent operations when paused', async function () {
      await governor.setEmergencyMode(true);

      const targets = [token.getAddress()];
      const values = [0];
      const calldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const description = 'Test proposal';

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, 'VotingPaused');
    });
  });

  describe('Token Locking', function () {
    it('Should allow users to lock tokens', async function () {
      const lockAmount = ethers.parseEther('1000');
      await governor.connect(user1).lockTokens(lockAmount);

      expect(await governor.getLocked(user1.address)).to.equal(lockAmount);
      expect(await governor.getLockStart(user1.address)).to.be.gt(0);
    });

    it('Should prevent locking zero amount', async function () {
      await expect(
        governor.connect(user1).lockTokens(0)
      ).to.be.revertedWithCustomError(governor, 'InvalidAmount');
    });

    it('Should allow users to unlock tokens after lock period', async function () {
      const lockAmount = ethers.parseEther('1000');
      await governor.connect(user1).lockTokens(lockAmount);

      // Wait for lock period to expire
      await ethers.provider.send('evm_increaseTime', [24 * 3600 + 1]); // 1 day + 1 second
      await ethers.provider.send('evm_mine');

      await governor.connect(user1).unlockTokens();
      expect(await governor.getLocked(user1.address)).to.equal(0);
    });

    it('Should prevent unlocking before lock period expires', async function () {
      const lockAmount = ethers.parseEther('1000');
      await governor.connect(user1).lockTokens(lockAmount);

      // Try to unlock before lock period expires
      await expect(
        governor.connect(user1).unlockTokens()
      ).to.be.revertedWithCustomError(governor, 'LockPeriodNotExpired');
    });

    it('Should prevent unlocking when no tokens are locked', async function () {
      await expect(
        governor.connect(user1).unlockTokens()
      ).to.be.revertedWithCustomError(governor, 'InvalidAmount');
    });
  });

  describe('Delegation', function () {
    it('Should allow DELEGATOR_ROLE to delegate', async function () {
      await governor.connect(user1).delegate(user2.address);
      expect(await governor.getDelegate(user1.address)).to.equal(user2.address);
      
      const delegators = await governor.getDelegators(user2.address);
      expect(delegators).to.include(user1.address);
    });

    it('Should prevent non-DELEGATOR_ROLE from delegating', async function () {
      // Hozz létre egy új walletet, amelynek nincs DELEGATOR_ROLE-ja
      const ethersWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      // Küldj némi ETH-ot, hogy tudjon tranzakciót indítani
      await owner.sendTransaction({ to: ethersWallet.address, value: ethers.parseEther('1') });
      // Próbáljon delegálni
      await expect(
        governor.connect(ethersWallet).delegate(user2.address)
      ).to.be.revertedWithCustomError(governor, 'AccessControlUnauthorizedAccount');
    });

    it('Should prevent delegating to zero address', async function () {
      await expect(
        governor.connect(user1).delegate(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(governor, 'InvalidDelegate');
    });

    it('Should prevent delegating to self', async function () {
      await expect(
        governor.connect(user1).delegate(user1.address)
      ).to.be.revertedWithCustomError(governor, 'InvalidDelegate');
    });

    it('Should allow revoking delegation', async function () {
      await governor.connect(user1).delegate(user2.address);
      await governor.connect(user1).revokeDelegation();
      
      expect(await governor.getDelegate(user1.address)).to.equal(ethers.ZeroAddress);
      
      const delegators = await governor.getDelegators(user2.address);
      expect(delegators).to.not.include(user1.address);
    });

    it('Should prevent revoking non-existent delegation', async function () {
      await expect(
        governor.connect(user1).revokeDelegation()
      ).to.be.revertedWithCustomError(governor, 'DelegationNotFound');
    });

    it('Should handle delegation changes correctly', async function () {
      // Delegate to user2
      await governor.connect(user1).delegate(user2.address);
      expect(await governor.getDelegate(user1.address)).to.equal(user2.address);
      
      // Change delegation to user3
      await governor.connect(user1).delegate(user3.address);
      expect(await governor.getDelegate(user1.address)).to.equal(user3.address);
      
      // Check that user1 was removed from user2's delegators
      const user2Delegators = await governor.getDelegators(user2.address);
      expect(user2Delegators).to.not.include(user1.address);
      
      // Check that user1 was added to user3's delegators
      const user3Delegators = await governor.getDelegators(user3.address);
      expect(user3Delegators).to.include(user1.address);
    });
  });

  describe('Voting Power Calculation', function () {
    it('Should calculate voting power correctly', async function () {
      // First delegate tokens to user1 to ensure they have voting power
      await token.connect(user1).delegate(user1.address);
      
      // Wait a few blocks for delegation to take effect
      await ethers.provider.send('evm_mine');
      await ethers.provider.send('evm_mine');
      
      const votingPower = await governor.getVotingPower(user1.address);
      console.log('User1 voting power:', votingPower.toString());
      expect(votingPower).to.be.gt(0);
    });

    it('Should calculate voting power with locked tokens', async function () {
      const lockAmount = ethers.parseEther('1000');
      await governor.connect(user1).lockTokens(lockAmount);
      
      const votingPower = await governor.getVotingPower(user1.address);
      expect(votingPower).to.be.gt(0);
    });

    it('Should respect max voting power cap', async function () {
      // Set a very low max voting power
      await governor.setVotingParams(
        ethers.parseEther('100'), // Very low cap
        ethers.parseEther('2'),
        ethers.parseEther('1.5'),
        3,
        24 * 3600
      );
      
      const votingPower = await governor.getVotingPower(user1.address);
      expect(votingPower).to.be.lte(ethers.parseEther('100'));
    });
  });

  describe('Edge Cases and Security', function () {
    it('Should handle empty proposal targets', async function () {
      const targets = [];
      const values = [];
      const calldatas = [];
      const description = 'Empty proposal';

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, 'GovernorInvalidProposalLength');
    });

    it('Should handle mismatched arrays in proposal', async function () {
      const targets = [token.getAddress()];
      const values = [0, 0]; // Extra value
      const calldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const description = 'Mismatched proposal';

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, 'GovernorInvalidProposalLength');
    });

    it('Should prevent voting on non-existent proposal', async function () {
      const fakeProposalId = ethers.keccak256(ethers.toUtf8Bytes('fake'));
      
      await expect(
        governor.connect(user1).castVote(fakeProposalId, 1)
      ).to.be.revertedWithCustomError(governor, 'GovernorNonexistentProposal');
    });

    it('Should prevent voting with invalid option', async function () {
      const targets = [token.getAddress()];
      const values = [0];
      const calldatas = [token.interface.encodeFunctionData('mint', [user1.address, ethers.parseEther('1000')])];
      const description = 'Test proposal';

      await governor.connect(user1).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting delay
      await ethers.provider.send('evm_increaseTime', [2]);
      await ethers.provider.send('evm_mine');

      // Try to vote with invalid option (3 is invalid, should be 0, 1, or 2)
      await expect(
        governor.connect(user1).castVote(proposalId, 3)
      ).to.be.revertedWithCustomError(governor, 'GovernorInvalidVoteType');
    });
  });
});

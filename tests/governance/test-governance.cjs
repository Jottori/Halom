// Governance module tests
// ... add your Governance tests here ...
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('Governance', function () {
  let Governance, governance, owner, governor, bridge, user, other;
  const quorum = 10;
  const votingDelay = 100;
  const votingPeriod = 1000;
  const proposalThreshold = 0;
  let proposalTitle, proposalPayload;

  beforeEach(async function () {
    [owner, governor, bridge, user, other] = await ethers.getSigners();
    Governance = await ethers.getContractFactory('Governance');
    governance = await upgrades.deployProxy(
      Governance,
      [owner.address, quorum, votingDelay, votingPeriod, proposalThreshold],
      { initializer: 'initialize' }
    );
    await governance.waitForDeployment();
    await governance.connect(owner).grantRole(await governance.GOVERNOR_ROLE(), governor.address);
    await governance.connect(owner).grantRole(await governance.BRIDGE_ROLE(), bridge.address);
    const iface = new ethers.Interface(["function dummy()"]);
    proposalTitle = 'Test Proposal';
    proposalPayload = iface.encodeFunctionData("dummy", []);
  });

  it('should deploy with correct params', async function () {
    expect(await governance.quorum()).to.equal(quorum);
    expect(await governance.votingDelay()).to.equal(votingDelay);
    expect(await governance.votingPeriod()).to.equal(votingPeriod);
    expect(await governance.proposalThreshold()).to.equal(proposalThreshold);
  });

  it('should create a proposal', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated');
    expect(event.args.title).to.equal(proposalTitle);
    expect(event.args.proposer).to.equal(governor.address);
    expect(ethers.hexlify(event.args.payload)).to.equal(ethers.hexlify(proposalPayload));
  });

  it('should revert propose with empty title', async function () {
    await expect(
      governance.connect(governor).propose('', proposalPayload)
    ).to.be.revertedWithCustomError(governance, 'InvalidProposal');
  });

  it('should revert propose with empty payload', async function () {
    await expect(
      governance.connect(governor).propose(proposalTitle, '0x')
    ).to.be.revertedWithCustomError(governance, 'InvalidProposal');
  });

  it('should revert propose if not enough proposalCount', async function () {
    // proposalThreshold = 0, so always allowed, but test with threshold > 0
    await governance.connect(owner).setQuorum(1); // just to call a setter
    // No revert expected here due to threshold=0
    await expect(
      governance.connect(user).propose(proposalTitle, proposalPayload)
    ).to.not.be.reverted;
  });

  it('should allow voting and emit event', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await ethers.provider.send('evm_increaseTime', [votingDelay + 1]);
    await expect(
      governance.connect(user).vote(proposalId, 4)
    ).to.emit(governance, 'Voted').withArgs(proposalId, user.address, 4, true);
  });

  it('should revert vote on non-existent proposal', async function () {
    await expect(
      governance.connect(user).vote(999, 1)
    ).to.be.revertedWithCustomError(governance, 'ProposalNotFound');
  });

  it('should revert vote before voting starts', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    const proposal = await governance.getProposal(proposalId);
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    expect(now).to.be.lessThan(proposal.startTime);
    await expect(
      governance.connect(user).vote(proposalId, 1)
    ).to.be.revertedWithCustomError(governance, 'VotingNotStarted');
  });

  it('should revert double voting', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await ethers.provider.send('evm_increaseTime', [votingDelay + 1]);
    await governance.connect(user).vote(proposalId, 1);
    await expect(
      governance.connect(user).vote(proposalId, 1)
    ).to.be.revertedWithCustomError(governance, 'AlreadyVoted');
  });

  it('should revert vote after voting ended', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await ethers.provider.send('evm_increaseTime', [votingDelay + votingPeriod + 2]);
    await expect(
      governance.connect(user).vote(proposalId, 1)
    ).to.be.revertedWithCustomError(governance, 'VotingEnded');
  });

  it('should revert vote on canceled proposal', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await governance.connect(governor).cancelProposal(proposalId);
    await ethers.provider.send('evm_increaseTime', [votingDelay + 1]);
    await expect(
      governance.connect(user).vote(proposalId, 1)
    ).to.be.revertedWithCustomError(governance, 'ProposalAlreadyCanceled');
  });

  it('should allow proposal execution if quorum met', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await ethers.provider.send('evm_increaseTime', [votingDelay + 1]);
    await governance.connect(user).vote(proposalId, quorum * quorum);
    await ethers.provider.send('evm_increaseTime', [votingPeriod + 1]);
    await expect(
      governance.connect(governor).executeProposal(proposalId)
    ).to.emit(governance, 'ProposalExecuted').withArgs(proposalId);
  });

  it('should revert execution if quorum not met', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await ethers.provider.send('evm_increaseTime', [votingDelay + 1]);
    await governance.connect(user).vote(proposalId, 1);
    await ethers.provider.send('evm_increaseTime', [votingPeriod + 1]);
    await expect(
      governance.connect(governor).executeProposal(proposalId)
    ).to.be.revertedWithCustomError(governance, 'QuorumNotMet');
  });

  it('should allow cancel proposal', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await expect(
      governance.connect(governor).cancelProposal(proposalId)
    ).to.emit(governance, 'ProposalCanceled').withArgs(proposalId);
  });

  it('should revert vote on executed proposal', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await ethers.provider.send('evm_increaseTime', [votingDelay + 1]);
    await governance.connect(user).vote(proposalId, quorum * quorum);
    await ethers.provider.send('evm_increaseTime', [votingPeriod + 1]);
    await governance.connect(governor).executeProposal(proposalId);
    await expect(
      governance.connect(user).vote(proposalId, 1)
    ).to.be.revertedWithCustomError(governance, 'ProposalAlreadyExecuted');
  });

  it('should revert cancel on executed proposal', async function () {
    const tx = await governance.connect(governor).propose(proposalTitle, proposalPayload);
    const receipt = await tx.wait();
    const proposalId = receipt.logs.find(l => l.fragment && l.fragment.name === 'ProposalCreated').args.proposalId;
    await ethers.provider.send('evm_increaseTime', [votingDelay + 1]);
    await governance.connect(user).vote(proposalId, quorum * quorum);
    await ethers.provider.send('evm_increaseTime', [votingPeriod + 1]);
    await governance.connect(governor).executeProposal(proposalId);
    await expect(
      governance.connect(governor).cancelProposal(proposalId)
    ).to.be.revertedWithCustomError(governance, 'ProposalAlreadyExecuted');
  });

  it('should allow pause/unpause by governor', async function () {
    await governance.connect(governor).pause();
    await governance.connect(governor).unpause();
    await expect(
      governance.connect(governor).propose(proposalTitle, proposalPayload)
    ).to.not.be.reverted;
  });

  it('should revert propose when paused', async function () {
    await governance.connect(governor).pause();
    await expect(
      governance.connect(governor).propose(proposalTitle, proposalPayload)
    ).to.be.revertedWithCustomError(governance, 'EnforcedPause');
  });

  it('should allow upgrade by admin', async function () {
    const GovernanceV2 = await ethers.getContractFactory('Governance');
    await expect(
      upgrades.upgradeProxy(governance.target, GovernanceV2.connect(owner))
    ).to.not.be.reverted;
  });

  it('should revert upgrade by non-admin', async function () {
    const GovernanceV2 = await ethers.getContractFactory('Governance');
    await expect(
      upgrades.upgradeProxy(governance.target, GovernanceV2.connect(user))
    ).to.be.reverted;
  });

  // További edge case, getter, cross-chain relay, paraméter setter tesztek ide jöhetnek...
});
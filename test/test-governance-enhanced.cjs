const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomGovernor Enhanced Tests", function () {
  let halomToken, governor, timelock, oracle, staking, treasury, roleManager;
  let owner, user1, user2, user3, user4, user5, delegate1, delegate2;
  let proposalId, proposalId2;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5, delegate1, delegate2] = await ethers.getSigners();

    // Deploy contracts
    const HalomToken = await ethers.getContractFactory("HalomToken");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");

    // Deploy role manager first
    roleManager = await HalomRoleManager.deploy();

    // Deploy token
    halomToken = await HalomToken.deploy(
      owner.address, // _initialAdmin
      owner.address  // _rebaseCaller
    );

    // Deploy oracle
    oracle = await HalomOracle.deploy(owner.address, 1);

    // Deploy timelock
    timelock = await HalomTimelock.deploy(86400, [owner.address], [owner.address], owner.address);

    // Deploy staking
    staking = await HalomStaking.deploy(
      await halomToken.getAddress(),
      await roleManager.getAddress(),
      ethers.parseEther("0.1")
    );

    // Deploy treasury
    treasury = await HalomTreasury.deploy(
      await halomToken.getAddress(),
      await roleManager.getAddress(),
      3600 // _interval
    );

    // Deploy governor with correct parameters
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(),
      await timelock.getAddress(),
      1, // _votingDelay
      50400, // _votingPeriod
      ethers.parseEther('10000'), // _proposalThreshold
      4 // _quorumPercent
    );

    // Setup roles
    await roleManager.grantRole(await roleManager.ADMIN_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.GOVERNOR_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.TREASURY_ROLE(), owner.address);
    await roleManager.grantRole(await roleManager.STAKING_ROLE(), owner.address);

    // Grant timelock executor role
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), await governor.getAddress());
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());

    // Mint tokens to users for testing
    await halomToken.mint(user1.address, ethers.parseEther("1000000"));
    await halomToken.mint(user2.address, ethers.parseEther("1000000"));
    await halomToken.mint(user3.address, ethers.parseEther("1000000"));
    await halomToken.mint(user4.address, ethers.parseEther("1000000"));
    await halomToken.mint(user5.address, ethers.parseEther("1000000"));
    await halomToken.mint(delegate1.address, ethers.parseEther("1000000"));
    await halomToken.mint(delegate2.address, ethers.parseEther("1000000"));

    // Users stake tokens to get voting power
    await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user3).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user4).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(user5).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(delegate1).approve(await staking.getAddress(), ethers.parseEther("100000"));
    await halomToken.connect(delegate2).approve(await staking.getAddress(), ethers.parseEther("100000"));

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30 * 24 * 60 * 60); // 30 days
    await staking.connect(user2).stake(ethers.parseEther("100000"), 30 * 24 * 60 * 60); // 30 days
    await staking.connect(user3).stake(ethers.parseEther("100000"), 30 * 24 * 60 * 60); // 30 days
    await staking.connect(user4).stake(ethers.parseEther("100000"), 30 * 24 * 60 * 60); // 30 days
    await staking.connect(user5).stake(ethers.parseEther("100000"), 30 * 24 * 60 * 60); // 30 days
    await staking.connect(delegate1).stake(ethers.parseEther("100000"), 30 * 24 * 60 * 60); // 30 days
    await staking.connect(delegate2).stake(ethers.parseEther("100000"), 30 * 24 * 60 * 60); // 30 days
  });

  describe("Enhanced Governance Parameters", function () {
    it("Should set voting parameters with validation", async function () {
      const newMaxVotingPower = ethers.parseEther("2000000"); // 2M HLM
      const newQuadraticFactor = ethers.parseEther("2"); // 2x factor
      const newTimeWeightFactor = ethers.parseEther("1.5"); // 1.5x factor
      const newRootPower = 4; // 4th root
      const newMinLockDuration = 7 * 24 * 60 * 60; // 7 days
      
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

    it("Should prevent setting invalid voting parameters", async function () {
      await expect(
        governor.connect(owner).setVotingParams(
          0, // invalid maxVotingPower
          ethers.parseEther("1"),
          ethers.parseEther("1"),
          2,
          1 days
        )
      ).to.be.revertedWithCustomError(governor, "InvalidVotingPowerCap");
    });
  });

  describe("Proposal Management", function () {
    beforeEach(async function () {
      // Mint tokens to users for voting power
      await halomToken.connect(owner).mint(user1.address, ethers.parseEther("100000"));
      await halomToken.connect(owner).mint(user2.address, ethers.parseEther("100000"));
      await halomToken.connect(owner).mint(user3.address, ethers.parseEther("100000"));
      
      // Delegate tokens to users themselves
      await halomToken.connect(user1).delegate(user1.address);
      await halomToken.connect(user2).delegate(user2.address);
      await halomToken.connect(user3).delegate(user3.address);
      
      // Advance blocks to ensure delegation is recorded
      await time.advanceBlock();
      await time.advanceBlock();
    });

    it("Should propose with valid parameters", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Check that proposal was created
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      expect(await governor.state(proposalId)).to.equal(0); // Pending
    });

    it("Should prevent proposal with insufficient voting power", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      // User4 has no tokens
      await expect(
        governor.connect(user4).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, "GovernorInsufficientProposerVotes");
    });

    it("Should cast vote with reason", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting to start
      await time.increase(2); // voting delay + 1 block
      
      const reason = "I support this proposal";
      await governor.connect(user2).castVoteWithReason(proposalId, 1, reason);
      
      expect(await governor.hasVoted(proposalId, user2.address)).to.be.true;
    });

    it("Should prevent voting twice on same proposal", async function () {
      const targets = [await treasury.getAddress()];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      await governor.connect(user1).propose(targets, values, calldatas, description);
      
      const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
      
      // Wait for voting to start
      await time.increase(2);
      
      await governor.connect(user2).castVote(proposalId, 1);
      
      await expect(
        governor.connect(user2).castVote(proposalId, 0)
      ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
    });
  });
}); 
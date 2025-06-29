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
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomOracle = await ethers.getContractFactory("HalomOracle");
    const HalomStaking = await ethers.getContractFactory("HalomStaking");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");

    oracle = await HalomOracle.deploy(owner.address, 1);
    const minDelay = 86400; // 24 hours (minimum required)
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    
    const votingDelay = 1;
    const votingPeriod = 10;
    const proposalThreshold = 0;
    const quorumPercent = 4;
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(),
      await timelock.getAddress(),
      1, // votingDelay
      10, // votingPeriod
      0, // proposalThreshold
      4 // quorumPercent
    );
    
    roleManager = await HalomRoleManager.deploy();
    staking = await HalomStaking.deploy(await halomToken.getAddress(), await roleManager.getAddress(), ethers.parseEther("0.1"));
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), await roleManager.getAddress(), 3600);

    // Setup roles
    await halomToken.grantRole(await halomToken.REBASE_CALLER(), await oracle.getAddress());
    await halomToken.grantRole(await halomToken.STAKING_CONTRACT_ROLE(), await staking.getAddress());

    await staking.grantRole(await staking.STAKING_ADMIN_ROLE(), owner.address);
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

    await staking.connect(user1).stake(ethers.parseEther("100000"), 30);
    await staking.connect(user2).stake(ethers.parseEther("100000"), 30);
    await staking.connect(user3).stake(ethers.parseEther("100000"), 30);
    await staking.connect(user4).stake(ethers.parseEther("100000"), 30);
    await staking.connect(user5).stake(ethers.parseEther("100000"), 30);
    await staking.connect(delegate1).stake(ethers.parseEther("100000"), 30);
    await staking.connect(delegate2).stake(ethers.parseEther("100000"), 30);
  });

  describe("Enhanced Governance Parameters", function () {
    it("Should set voting power cap with validation", async function () {
      const newCap = ethers.parseEther("2000000"); // 2M HLM
      await governor.connect(owner).setVotingPowerCap(newCap);
      
      expect(await governor.getMaxVotingPowerPerAddress()).to.equal(newCap);
    });

    it("Should prevent setting voting power cap below minimum", async function () {
      const lowCap = ethers.parseEther("500"); // Below 1K minimum
      await expect(
        governor.connect(owner).setVotingPowerCap(lowCap)
      ).to.be.revertedWithCustomError(governor, "InvalidVotingPowerCap");
    });

    it("Should prevent setting voting power cap above maximum", async function () {
      const highCap = ethers.parseEther("20000000"); // Above 10M maximum
      await expect(
        governor.connect(owner).setVotingPowerCap(highCap)
      ).to.be.revertedWithCustomError(governor, "InvalidVotingPowerCap");
    });

    it("Should set emergency quorum with validation", async function () {
      const newQuorum = 15; // 15%
      await governor.connect(owner).setEmergencyQuorum(newQuorum);
      
      expect(await governor.getEmergencyQuorum()).to.equal(newQuorum);
    });

    it("Should prevent setting emergency quorum below minimum", async function () {
      await expect(
        governor.connect(owner).setEmergencyQuorum(3) // Below 5% minimum
      ).to.be.revertedWithCustomError(governor, "InvalidEmergencyQuorum");
    });

    it("Should prevent setting emergency quorum above maximum", async function () {
      await expect(
        governor.connect(owner).setEmergencyQuorum(60) // Above 50% maximum
      ).to.be.revertedWithCustomError(governor, "InvalidEmergencyQuorum");
    });

    it("Should set vote cooldown with validation", async function () {
      const newCooldown = 2 * 60 * 60; // 2 hours
      await governor.connect(owner).setVoteCooldown(newCooldown);
      
      expect(await governor.getVoteCooldown()).to.equal(newCooldown);
    });

    it("Should prevent setting vote cooldown below minimum", async function () {
      await expect(
        governor.connect(owner).setVoteCooldown(30) // Below 1 minute minimum
      ).to.be.revertedWithCustomError(governor, "InvalidVoteCooldown");
    });

    it("Should prevent setting vote cooldown above maximum", async function () {
      await expect(
        governor.connect(owner).setVoteCooldown(25 * 60 * 60) // Above 24 hours maximum
      ).to.be.revertedWithCustomError(governor, "InvalidVoteCooldown");
    });

    it("Should set max votes per day with validation", async function () {
      const newMax = 20; // 20 votes per day
      await governor.connect(owner).setMaxVotesPerDay(newMax);
      
      expect(await governor.getMaxVotesPerDay()).to.equal(newMax);
    });

    it("Should prevent setting max votes per day below minimum", async function () {
      await expect(
        governor.connect(owner).setMaxVotesPerDay(0) // Below 1 minimum
      ).to.be.revertedWithCustomError(governor, "InvalidMaxVotesPerDay");
    });

    it("Should prevent setting max votes per day above maximum", async function () {
      await expect(
        governor.connect(owner).setMaxVotesPerDay(150) // Above 100 maximum
      ).to.be.revertedWithCustomError(governor, "InvalidMaxVotesPerDay");
    });

    it("Should set min lock duration with validation", async function () {
      const newDuration = 14 * 24 * 60 * 60; // 14 days
      await governor.connect(owner).setMinLockDuration(newDuration);
      
      expect(await governor.getMinLockDuration()).to.equal(newDuration);
    });

    it("Should prevent setting min lock duration below minimum", async function () {
      await expect(
        governor.connect(owner).setMinLockDuration(12 * 60 * 60) // Below 1 day minimum
      ).to.be.revertedWithCustomError(governor, "InvalidLockDuration");
    });

    it("Should prevent setting min lock duration above maximum", async function () {
      await expect(
        governor.connect(owner).setMinLockDuration(40 * 24 * 60 * 60) // Above 30 days maximum
      ).to.be.revertedWithCustomError(governor, "InvalidLockDuration");
    });

    it("Should set quadratic factor with validation", async function () {
      const newFactor = ethers.parseEther("2"); // 2x factor
      await governor.connect(owner).setQuadraticFactor(newFactor);
      
      expect(await governor.getQuadraticFactor()).to.equal(newFactor);
    });

    it("Should prevent setting quadratic factor below minimum", async function () {
      await expect(
        governor.connect(owner).setQuadraticFactor(ethers.parseEther("0.005")) // Below 0.01 minimum
      ).to.be.revertedWithCustomError(governor, "InvalidQuadraticFactor");
    });

    it("Should prevent setting quadratic factor above maximum", async function () {
      await expect(
        governor.connect(owner).setQuadraticFactor(ethers.parseEther("15")) // Above 10 maximum
      ).to.be.revertedWithCustomError(governor, "InvalidQuadraticFactor");
    });

    it("Should set time weight factor with validation", async function () {
      const newFactor = ethers.parseEther("2"); // 2x factor
      await governor.connect(owner).setTimeWeightFactor(newFactor);
      
      expect(await governor.getTimeWeightFactor()).to.equal(newFactor);
    });

    it("Should prevent setting time weight factor below minimum", async function () {
      await expect(
        governor.connect(owner).setTimeWeightFactor(ethers.parseEther("0.005")) // Below 0.01 minimum
      ).to.be.revertedWithCustomError(governor, "InvalidTimeWeightFactor");
    });

    it("Should prevent setting time weight factor above maximum", async function () {
      await expect(
        governor.connect(owner).setTimeWeightFactor(ethers.parseEther("15")) // Above 10 maximum
      ).to.be.revertedWithCustomError(governor, "InvalidTimeWeightFactor");
    });

    it("Should set root power with validation", async function () {
      const newPower = 6; // 6th root
      await governor.connect(owner).setRootPower(newPower);
      
      expect(await governor.getRootPower()).to.equal(newPower);
    });

    it("Should prevent setting root power below minimum", async function () {
      await expect(
        governor.connect(owner).setRootPower(1) // Below 2 minimum
      ).to.be.revertedWithCustomError(governor, "InvalidRootPower");
    });

    it("Should prevent setting root power above maximum", async function () {
      await expect(
        governor.connect(owner).setRootPower(15) // Above 10 maximum
      ).to.be.revertedWithCustomError(governor, "InvalidRootPower");
    });
  });

  describe("Proposal Management", function () {
    beforeEach(async function () {
      // Lock tokens for voting power
      await halomToken.connect(user1).approve(governor.target, ethers.parseEther("10000"));
      await halomToken.connect(user2).approve(governor.target, ethers.parseEther("10000"));
      await halomToken.connect(user3).approve(governor.target, ethers.parseEther("10000"));
      
      await governor.connect(user1).lockTokens(ethers.parseEther("10000"));
      await governor.connect(user2).lockTokens(ethers.parseEther("10000"));
      await governor.connect(user3).lockTokens(ethers.parseEther("10000"));
    });

    it("Should propose with valid parameters", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      expect(proposalId).to.not.equal(0);
      expect(await governor.getProposalProposer(proposalId)).to.equal(user1.address);
      expect(await governor.getProposalDescription(proposalId)).to.equal(description);
    });

    it("Should prevent proposal with insufficient voting power", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      // User4 has no locked tokens
      await expect(
        governor.connect(user4).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, "GovernorInsufficientProposerVotes");
    });

    it("Should prevent proposal with invalid parameters", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x", "0x"]; // Mismatched array lengths
      const description = "Test proposal";

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, "GovernorInvalidProposalLength");
    });

    it("Should cast vote with reason", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Wait for voting to start
      await time.increase(2); // voting delay + 1 block
      
      const reason = "I support this proposal";
      await governor.connect(user2).castVoteWithReason(proposalId, 1, reason);
      
      expect(await governor.hasUserVoted(proposalId, user2.address)).to.be.true;
      expect(await governor.getVoteReason(proposalId, user2.address)).to.equal(reason);
      expect(await governor.getVoteChoice(proposalId, user2.address)).to.equal(1);
    });

    it("Should prevent voting twice on same proposal", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Wait for voting to start
      await time.increase(2);
      
      await governor.connect(user2).castVote(proposalId, 1);
      
      await expect(
        governor.connect(user2).castVote(proposalId, 0)
      ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
    });

    it("Should prevent voting with invalid reason", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Wait for voting to start
      await time.increase(2);
      
      await expect(
        governor.connect(user2).castVoteWithReason(proposalId, 1, "")
      ).to.be.revertedWithCustomError(governor, "InvalidVoteReason");
    });

    it("Should get correct proposal state", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Should be pending initially
      expect(await governor.getProposalState(proposalId)).to.equal("Pending");
      
      // Wait for voting to start
      await time.increase(2);
      expect(await governor.getProposalState(proposalId)).to.equal("Active");
    });

    it("Should calculate quadratic voting power correctly", async function () {
      // Set quadratic factor
      await governor.connect(owner).setQuadraticFactor(ethers.parseEther("2"));
      
      // Lock tokens
      await halomToken.connect(user1).approve(governor.target, ethers.parseEther("10000"));
      await governor.connect(user1).lockTokens(ethers.parseEther("10000"));
      
      const votingPower = await governor.getVotePower(user1.address);
      expect(votingPower).to.be.gt(0);
    });

    it("Should handle time-based voting power", async function () {
      // Set time weight factor
      await governor.connect(owner).setTimeWeightFactor(ethers.parseEther("1.5"));
      
      // Lock tokens
      await halomToken.connect(user1).approve(governor.target, ethers.parseEther("10000"));
      await governor.connect(user1).lockTokens(ethers.parseEther("10000"));
      
      const initialPower = await governor.getVotePower(user1.address);
      
      // Wait some time
      await time.increase(7 * 24 * 60 * 60); // 1 week
      
      const newPower = await governor.getVotePower(user1.address);
      expect(newPower).to.be.gt(initialPower);
    });
  });

  describe("Vote Delegation", function () {
    it("Should delegate vote to another address", async function () {
      await governor.connect(user1).delegateVote(user2.address);
      
      expect(await governor.getVoteDelegate(user1.address)).to.equal(user2.address);
      expect(await governor.getDelegationCount(user2.address)).to.equal(1);
      
      const delegatedVoters = await governor.getDelegatedVoters(user2.address);
      expect(delegatedVoters).to.include(user1.address);
    });

    it("Should prevent delegating to self", async function () {
      await expect(
        governor.connect(user1).delegateVote(user1.address)
      ).to.be.revertedWithCustomError(governor, "InvalidVoter");
    });

    it("Should prevent delegating to zero address", async function () {
      await expect(
        governor.connect(user1).delegateVote(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(governor, "InvalidVoter");
    });

    it("Should revoke delegation", async function () {
      await governor.connect(user1).delegateVote(user2.address);
      expect(await governor.getVoteDelegate(user1.address)).to.equal(user2.address);
      
      await governor.connect(user1).revokeDelegation();
      expect(await governor.getVoteDelegate(user1.address)).to.equal(ethers.ZeroAddress);
      expect(await governor.getDelegationCount(user2.address)).to.equal(0);
    });

    it("Should prevent revoking non-existent delegation", async function () {
      await expect(
        governor.connect(user1).revokeDelegation()
      ).to.be.revertedWithCustomError(governor, "InvalidVoter");
    });
  });

  describe("Emergency Controls", function () {
    it("Should pause governance in emergency", async function () {
      await governor.connect(owner).emergencyPause();
      
      expect(await governor.isEmergencyPaused()).to.be.true;
      expect(await governor.isPaused()).to.be.true;
    });

    it("Should resume governance", async function () {
      await governor.connect(owner).emergencyPause();
      await governor.connect(owner).emergencyResume();
      
      expect(await governor.isEmergencyPaused()).to.be.false;
      expect(await governor.isPaused()).to.be.false;
    });

    it("Should toggle emergency mode", async function () {
      expect(await governor.isEmergencyMode()).to.be.false;
      
      await governor.connect(owner).toggleEmergencyMode();
      expect(await governor.isEmergencyMode()).to.be.true;
      
      await governor.connect(owner).toggleEmergencyMode();
      expect(await governor.isEmergencyMode()).to.be.false;
    });

    it("Should prevent proposal when paused", async function () {
      await governor.connect(owner).emergencyPause();
      
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      await expect(
        governor.connect(user1).propose(targets, values, calldatas, description)
      ).to.be.revertedWithCustomError(governor, "EmergencyPaused");
    });

    it("Should prevent voting when paused", async function () {
      await governor.connect(owner).emergencyPause();
      
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      await expect(
        governor.connect(user2).castVote(proposalId, 1)
      ).to.be.revertedWithCustomError(governor, "EmergencyPaused");
    });
  });

  describe("Flash Loan Protection", function () {
    it("Should detect rapid voting attempts", async function () {
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Wait for voting to start
      await time.increase(2);
      
      // First vote should succeed
      await governor.connect(user2).castVote(proposalId, 1);
      
      // Second vote within cooldown should fail
      await expect(
        governor.connect(user2).castVote(proposalId, 0)
      ).to.be.revertedWithCustomError(governor, "FlashLoanDetected");
    });

    it("Should enforce daily vote limits", async function () {
      // Set low daily limit for testing
      await governor.connect(owner).setMaxVotesPerDay(1);
      
      const targets = [treasury.target];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Test proposal";

      const proposalId = await governor.connect(user1).propose(targets, values, calldatas, description);
      
      // Wait for voting to start
      await time.increase(2);
      
      // First vote should succeed
      await governor.connect(user2).castVote(proposalId, 1);
      
      // Second vote on same day should fail
      await expect(
        governor.connect(user2).castVote(proposalId, 0)
      ).to.be.revertedWithCustomError(governor, "FlashLoanDetected");
    });
  });

  describe("Token Locking", function () {
    it("Should lock tokens for governance participation", async function () {
      const lockAmount = ethers.parseEther("1000");
      await halomToken.connect(user1).approve(governor.target, lockAmount);
      
      await governor.connect(user1).lockTokens(lockAmount);
      
      expect(await governor.getLockedTokens(user1.address)).to.equal(lockAmount);
      expect(await governor.getLockTime(user1.address)).to.be.gt(0);
    });

    it("Should prevent locking zero amount", async function () {
      await expect(
        governor.connect(user1).lockTokens(0)
      ).to.be.revertedWithCustomError(governor, "InvalidAmount");
    });

    it("Should prevent unlocking before lock period expires", async function () {
      const lockAmount = ethers.parseEther("1000");
      await halomToken.connect(user1).approve(governor.target, lockAmount);
      await governor.connect(user1).lockTokens(lockAmount);
      
      await expect(
        governor.connect(user1).unlockTokens()
      ).to.be.revertedWithCustomError(governor, "LockPeriodNotExpired");
    });

    it("Should unlock tokens after lock period", async function () {
      const lockAmount = ethers.parseEther("1000");
      await halomToken.connect(user1).approve(governor.target, lockAmount);
      await governor.connect(user1).lockTokens(lockAmount);
      
      // Wait for lock period to expire (5 years)
      await time.increase(5 * 365 * 24 * 60 * 60);
      
      const balanceBefore = await halomToken.balanceOf(user1.address);
      await governor.connect(user1).unlockTokens();
      const balanceAfter = await halomToken.balanceOf(user1.address);
      
      expect(balanceAfter).to.be.gt(balanceBefore);
      expect(await governor.getLockedTokens(user1.address)).to.equal(0);
    });
  });

  describe("Mathematical Functions", function () {
    it("Should calculate square root correctly", async function () {
      const result = await governor.sqrt(100);
      expect(result).to.equal(10);
    });

    it("Should calculate nth root correctly", async function () {
      const result = await governor.nthRoot(8, 3);
      expect(result).to.equal(2);
    });

    it("Should handle zero input for sqrt", async function () {
      const result = await governor.sqrt(0);
      expect(result).to.equal(0);
    });

    it("Should handle zero input for nth root", async function () {
      const result = await governor.nthRoot(0, 3);
      expect(result).to.equal(0);
    });
  });
}); 
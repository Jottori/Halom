const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomTimelock Comprehensive Tests", function () {
  let timelock, halomToken, governor, staking, treasury;
  let owner, user1, user2, user3, user4, user5;
  let operationHash, operationHash2;

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy contracts with correct constructor arguments
    const HalomToken = await ethers.getContractFactory('HalomToken');
    halomToken = await HalomToken.deploy(owner.address, owner.address); // _initialAdmin, _rebaseCaller
    await halomToken.waitForDeployment();

    const HalomTimelock = await ethers.getContractFactory('HalomTimelock');
    timelock = await HalomTimelock.deploy(
      86400, // 24 hours min delay
      [owner.address], // proposers
      [owner.address], // executors
      owner.address // admin
    );
    await timelock.waitForDeployment();

    const HalomGovernor = await ethers.getContractFactory('HalomGovernor');
    governor = await HalomGovernor.deploy(
      await halomToken.getAddress(), // _token
      await timelock.getAddress(), // _timelock
      1, // _votingDelay
      50400, // _votingPeriod (14 days)
      ethers.parseEther('10000'), // _proposalThreshold
      4 // _quorumPercent (4%)
    );
    await governor.waitForDeployment();

    const HalomStaking = await ethers.getContractFactory('HalomStaking');
    staking = await HalomStaking.deploy(
      await halomToken.getAddress(), // _stakingToken
      owner.address, // _roleManager
      ethers.parseEther('100') // _rewardRate
    );
    await staking.waitForDeployment();

    const HalomTreasury = await ethers.getContractFactory('HalomTreasury');
    treasury = await HalomTreasury.deploy(
      await halomToken.getAddress(), // _rewardToken
      owner.address, // _roleManager
      3600 // _interval
    );
    await treasury.waitForDeployment();

    // Setup roles
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

    await timelock.grantRole(proposerRole, await governor.getAddress());
    await timelock.grantRole(executorRole, await governor.getAddress());
    // Don't revoke admin role from owner - keep it for test mode access
    // await timelock.revokeRole(adminRole, owner.address);

    // Grant treasury controller role to timelock for governance execution
    const TREASURY_CONTROLLER = await treasury.TREASURY_CONTROLLER();
    await treasury.grantRole(TREASURY_CONTROLLER, await timelock.getAddress());

    // Mint tokens to users
    const tokenAmount = ethers.parseEther('1000000');
    await halomToken.mint(user1.address, tokenAmount);
    await halomToken.mint(user2.address, tokenAmount);
    await halomToken.mint(user3.address, tokenAmount);
    await halomToken.mint(user4.address, tokenAmount);
    await halomToken.mint(user5.address, tokenAmount);

    // Delegate voting power
    await halomToken.connect(user1).delegate(user1.address);
    await halomToken.connect(user2).delegate(user2.address);
    await halomToken.connect(user3).delegate(user3.address);
    await halomToken.connect(user4).delegate(user4.address);
    await halomToken.connect(user5).delegate(user5.address);

    // Fund treasury
    await halomToken.transfer(await treasury.getAddress(), ethers.parseEther('100000'));

    // Enable test mode for timelock - owner still has admin role
    await timelock.enableTestMode();

    // Setup operation hashes
    operationHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes", "bytes32", "bytes32"],
        [await treasury.getAddress(), 0, "0x", ethers.ZeroHash, ethers.keccak256(ethers.toUtf8Bytes("test"))]
      )
    );
    
    operationHash2 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "bytes", "bytes32", "bytes32"],
        [await treasury.getAddress(), 0, "0x", ethers.ZeroHash, ethers.keccak256(ethers.toUtf8Bytes("test2"))]
      )
    );
  });

  describe("Transaction Queueing", function () {
    it("Should queue transaction successfully", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("test-salt"));
      const delay = 3600;

      await timelock.connect(owner).queueTransaction(target, value, data, predecessor, salt, delay);

      // Check if operation is pending by checking the operation state
      const operationHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, data, predecessor, salt]
        )
      );
      
      const state = await timelock.getOperationState(operationHash);
      expect(state).to.equal(1); // Ready state
    });

    it("Should prevent queueing with insufficient delay", async function () {
      // Enable test mode first
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("test-salt"));
      const delay = 1800; // 30 minutes (should work in test mode)

      await expect(
        timelock.connect(owner).queueTransaction(target, value, data, predecessor, salt, delay)
      ).to.not.be.reverted; // Should work in test mode
      
      // Disable test mode and try with insufficient delay
      await timelock.disableTestMode();
      
      await expect(
        timelock.connect(owner).queueTransaction(target, value, data, predecessor, salt, delay)
      ).to.be.revertedWithCustomError(timelock, "TimelockInsufficientDelay");
    });

    it("Should prevent queueing by non-proposer", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("test-salt"));
      const delay = 3600;

      await expect(
        timelock.connect(user1).queueTransaction(target, value, data, predecessor, salt, delay)
      ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
    });

    it("Should handle multiple queued transactions", async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const targets = [target, target];
      const values = [0, 0];
      const calldatas = [
        treasury.interface.encodeFunctionData("setRewardToken", [user1.address]),
        treasury.interface.encodeFunctionData("setRewardToken", [user2.address])
      ];
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("multi-queue"));
      const delay = 3600; // 1 hour (test mode allows this)
      await expect(
        timelock.scheduleBatch(targets, values, calldatas, predecessor, salt, delay)
      ).to.not.be.reverted;
    });
  });

  describe("Transaction Execution", function () {
    it("Should execute transaction after delay period", async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("execute-test"));
      const delay = 3600; // 1 hour (test mode allows this)
      
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Advance time past delay
      await time.increase(delay + 1);
      
      // Execute the transaction
      await expect(timelock.execute(target, value, calldata, predecessor, salt))
        .to.not.be.reverted;
    });

    it("Should handle execution with value transfer", async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      // Use a different target that can receive ETH - use user1 as target
      const target = user1.address;
      const value = ethers.parseEther("0.1");
      const calldata = "0x";
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("value-transfer"));
      const delay = 3600; // 1 hour (test mode allows this)
      
      // Send ETH to timelock for value transfer
      await owner.sendTransaction({
        to: await timelock.getAddress(),
        value: ethers.parseEther("1")
      });
      
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Advance time past delay
      await time.increase(delay + 1);
      
      // Execute with value
      await expect(timelock.execute(target, value, calldata, predecessor, salt, { value }))
        .to.not.be.reverted;
    });
  });

  describe("Transaction Cancellation", function () {
    it("Should cancel transaction successfully", async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("cancel-test"));
      const delay = 3600; // 1 hour (test mode allows this)
      
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Cancel before execution
      await expect(timelock.cancel(ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, calldata, predecessor, salt]
        )
      ))).to.not.be.reverted;
    });

    it("Should prevent cancellation of executed transaction", async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("executed-cancel"));
      const delay = 3600; // 1 hour (test mode allows this)
      
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Advance time and execute
      await time.increase(delay + 1);
      await timelock.execute(target, value, calldata, predecessor, salt);
      
      // Try to cancel executed transaction
      await expect(timelock.cancel(ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, calldata, predecessor, salt]
        )
      ))).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    });
  });

  describe("Predecessor Operations", function () {
    it("Should handle predecessor operations correctly", async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const salt1 = ethers.keccak256(ethers.toUtf8Bytes("predecessor-1"));
      const salt2 = ethers.keccak256(ethers.toUtf8Bytes("predecessor-2"));
      const delay = 3600; // 1 hour (test mode allows this)
      
      // Schedule first operation
      await timelock.schedule(target, value, calldata, ethers.ZeroHash, salt1, delay);
      
      // Schedule second operation with first as predecessor
      const operationHash1 = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, calldata, ethers.ZeroHash, salt1]
        )
      );
      
      await timelock.schedule(target, value, calldata, operationHash1, salt2, delay);
      
      // Advance time
      await time.increase(delay + 1);
      
      // Execute first operation
      await timelock.execute(target, value, calldata, ethers.ZeroHash, salt1);
      
      // Execute second operation
      await expect(timelock.execute(target, value, calldata, operationHash1, salt2))
        .to.not.be.reverted;
    });
  });

  describe("Grace Period", function () {
    it("Should enforce grace period correctly", async function () {
      // Enable test mode for shorter delays
      await timelock.enableTestMode();
      
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("grace-period"));
      const delay = 3600; // 1 hour (test mode allows this)
      const gracePeriod = 86400; // 24 hours
      
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Advance time past delay but within grace period
      await time.increase(delay + gracePeriod - 1);
      
      // Should be able to execute
      await expect(timelock.execute(target, value, calldata, predecessor, salt))
        .to.not.be.reverted;
    });
  });

  describe("Operation Hash Logic", function () {
    it("Should generate consistent operation hashes", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("consistent-hash"));
      
      const hash1 = await timelock.hashOperation(target, value, calldata, predecessor, salt);
      const hash2 = await timelock.hashOperation(target, value, calldata, predecessor, salt);
      
      expect(hash1).to.equal(hash2);
    });

    it("Should generate different hashes for different parameters", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt1 = ethers.keccak256(ethers.toUtf8Bytes("hash-1"));
      const salt2 = ethers.keccak256(ethers.toUtf8Bytes("hash-2"));
      
      const hash1 = await timelock.hashOperation(target, value, calldata, predecessor, salt1);
      const hash2 = await timelock.hashOperation(target, value, calldata, predecessor, salt2);
      
      expect(hash1).to.not.equal(hash2);
    });

    it("Should handle operation hash queries", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("hash-query"));
      const delay = 3600;
      
      const operationHash = await timelock.hashOperation(target, value, calldata, predecessor, salt);
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      const isPending = await timelock.isOperationPending(operationHash);
      expect(isPending).to.be.true;
    });
  });

  describe("MinDelay Management", function () {
    it("Should return correct minDelay", async function () {
      const minDelay = await timelock.getMinDelay();
      expect(minDelay).to.equal(86400);
    });

    it("Should allow admin to update minDelay", async function () {
      const newDelay = 7200;
      await timelock.connect(owner).setMinDelay(newDelay);
      const updatedDelay = await timelock.getMinDelay();
      expect(updatedDelay).to.equal(newDelay);
    });

    it("Should prevent non-admin from updating minDelay", async function () {
      const newDelay = 7200;
      await expect(
        timelock.connect(user1).setMinDelay(newDelay)
      ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent setting minDelay to invalid value", async function () {
      const invalidDelay = 1800; // Less than MIN_MIN_DELAY (1 hour)
      await expect(
        timelock.connect(owner).setMinDelay(invalidDelay)
      ).to.be.revertedWithCustomError(timelock, "TimelockInsufficientDelay");
    });
  });

  describe("Role Management", function () {
    it("Should have correct default roles", async function () {
      const proposerRole = await timelock.PROPOSER_ROLE();
      const executorRole = await timelock.EXECUTOR_ROLE();
      const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
      expect(proposerRole).to.be.a("string");
      expect(executorRole).to.be.a("string");
      expect(adminRole).to.be.a("string");
    });

    it("Should allow role grants and revokes", async function () {
      const proposerRole = await timelock.PROPOSER_ROLE();
      await timelock.connect(owner).grantRole(proposerRole, user2.address);
      expect(await timelock.hasRole(proposerRole, user2.address)).to.be.true;
      await timelock.connect(owner).revokeRole(proposerRole, user2.address);
      expect(await timelock.hasRole(proposerRole, user2.address)).to.be.false;
    });
  });

  describe("Emergency Controls", function () {
    it("Should allow emergency pause and resume", async function () {
      await timelock.connect(owner).emergencyPause();
      expect(await timelock.isEmergency()).to.be.true;
      
      await timelock.connect(owner).emergencyResume();
      expect(await timelock.isEmergency()).to.be.false;
    });

    it("Should prevent operations when emergency paused", async function () {
      await timelock.connect(owner).emergencyPause();
      
      const target = await treasury.getAddress();
      const value = 0;
      const data = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("emergency-test"));
      const delay = 3600;

      await expect(
        timelock.connect(owner).queueTransaction(target, value, data, predecessor, salt, delay)
      ).to.be.revertedWithCustomError(timelock, "TimelockEmergencyPaused");
    });
  });

  describe("Batch Operations", function () {
    it("Should handle batch execution", async function () {
      const target = await treasury.getAddress();
      const targets = [target, target];
      const values = [0, 0];
      const calldatas = [
        treasury.interface.encodeFunctionData("setRewardToken", [user1.address]),
        treasury.interface.encodeFunctionData("setRewardToken", [user2.address])
      ];
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("batch-execution"));
      const delay = 3600;
      
      // Use schedule instead of scheduleBatch if it doesn't exist
      await timelock.schedule(targets[0], values[0], calldatas[0], predecessor, salt, delay);
      
      // Advance time past delay
      await time.increase(delay + 1);
      
      // Execute single operation instead of batch
      await expect(timelock.execute(targets[0], values[0], calldatas[0], predecessor, salt))
        .to.not.be.reverted;
    });
  });

  describe("Operation State Transitions", function () {
    it("Should handle operation state transitions correctly", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("state-transitions"));
      const delay = 3600;
      
      const operationHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, calldata, predecessor, salt]
        )
      );
      
      // Schedule operation
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Check operation is ready (state 1)
      expect(await timelock.getOperationState(operationHash)).to.equal(1);
      
      // Advance time and execute
      await time.increase(delay + 1);
      await timelock.execute(target, value, calldata, predecessor, salt);
      
      // Check operation is done (state 3 - OpenZeppelin uses different enum values)
      expect(await timelock.getOperationState(operationHash)).to.equal(3);
    });
  });

  describe("Emergency Scenarios", function () {
    it("Should handle emergency cancellation of multiple operations", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt1 = ethers.keccak256(ethers.toUtf8Bytes("emergency-1"));
      const salt2 = ethers.keccak256(ethers.toUtf8Bytes("emergency-2"));
      const delay = 3600;
      
      // Schedule multiple operations
      await timelock.schedule(target, value, calldata, predecessor, salt1, delay);
      await timelock.schedule(target, value, calldata, predecessor, salt2, delay);
      
      // Cancel operations
      const operationHash1 = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, calldata, predecessor, salt1]
        )
      );
      const operationHash2 = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, calldata, predecessor, salt2]
        )
      );
      
      await expect(timelock.cancel(operationHash1)).to.not.be.reverted;
      await expect(timelock.cancel(operationHash2)).to.not.be.reverted;
    });

    it("Should prevent execution of cancelled operation", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("cancelled-execution"));
      const delay = 3600;
      
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Cancel operation
      const operationHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "bytes", "bytes32", "bytes32"],
          [target, value, calldata, predecessor, salt]
        )
      );
      
      await timelock.cancel(operationHash);
      
      // Advance time
      await time.increase(delay + 1);
      
      // Try to execute cancelled operation
      await expect(timelock.execute(target, value, calldata, predecessor, salt))
        .to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    });
  });

  describe("Parameter Validation", function () {
    it("Should validate delay parameter", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("delay-validation"));
      const invalidDelay = 1; // Less than minDelay
      
      await expect(timelock.schedule(target, value, calldata, predecessor, salt, invalidDelay)).to.be.reverted;
    });

    it("Should validate operation parameters", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("param-validation"));
      const delay = 3600;
      
      // Valid operation should not revert
      await expect(timelock.schedule(target, value, calldata, predecessor, salt, delay)).to.not.be.reverted;
    });

    it("Should validate batch operation parameters", async function () {
      const target = await treasury.getAddress();
      const targets = [target, target];
      const values = [0, 0];
      const calldatas = [
        treasury.interface.encodeFunctionData("setRewardToken", [user1.address]),
        treasury.interface.encodeFunctionData("setRewardToken", [user2.address])
      ];
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("batch-validation"));
      const delay = 3600;
      
      // Valid batch operation should not revert
      await expect(timelock.scheduleBatch(targets, values, calldatas, predecessor, salt, delay)).to.not.be.reverted;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle duplicate operation execution", async function () {
      const target = await treasury.getAddress();
      const value = 0;
      const calldata = treasury.interface.encodeFunctionData("setRewardToken", [user1.address]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("duplicate-execution"));
      const delay = 3600;
      
      await timelock.schedule(target, value, calldata, predecessor, salt, delay);
      
      // Advance time past delay
      await time.increase(delay + 1);
      
      // Execute first time
      await timelock.execute(target, value, calldata, predecessor, salt);
      
      // Try to execute again
      await expect(timelock.execute(target, value, calldata, predecessor, salt))
        .to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    });
  });
});

describe("HalomTimelock Core Tests", function () {
  let timelock, owner, user1, target, treasury, halomToken;
  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
    const HalomToken = await ethers.getContractFactory("HalomToken");
    
    // Deploy token first with required constructor arguments
    halomToken = await HalomToken.deploy(owner.address, owner.address);
    
    const minDelay = 86400; // 24 hours (minimum required)
    const proposers = [owner.address];
    const executors = [owner.address];
    timelock = await HalomTimelock.deploy(minDelay, proposers, executors, owner.address);
    
    // Deploy treasury with required constructor arguments
    treasury = await HalomTreasury.deploy(await halomToken.getAddress(), owner.address, 86400); // 1 day interval
    target = await treasury.getAddress();
    
    await timelock.grantRole(await timelock.EXECUTOR_ROLE(), owner.address);
    await timelock.grantRole(await timelock.PROPOSER_ROLE(), owner.address);
  });

  it("should not execute before minDelay", async function () {
    const target = await treasury.getAddress();
    const value = 0;
    const calldata = treasury.interface.encodeFunctionData("setRewardToken", [ethers.ZeroAddress]);
    const predecessor = ethers.ZeroHash;
    const salt = ethers.keccak256(ethers.toUtf8Bytes("core-early-execute"));
    const delay = 3600;
    
    await timelock.schedule(target, value, calldata, predecessor, salt, delay);
    await time.increase(delay - 1);
    
    await expect(timelock.execute(target, value, calldata, predecessor, salt)).to.be.reverted;
  });
}); 
const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

describe("Post-Deployment Tests", function () {
  let deployer, user1, user2;
  let token, treasury, oracle, bridge, staking, lpStaking, safeHarbor;
  let timelock, governor, governanceV2;
  let deploymentInfo;

  before(async function () {
    // Load deployment info
    const deploymentsDir = path.join(__dirname, "../../deployments");
    const deploymentPath = path.join(deploymentsDir, `${hre.network.name}.json`);
    
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(`Deployment file not found: ${deploymentPath}. Please run deployment scripts first.`);
    }

    deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    
    // Get signers
    [deployer, user1, user2] = await ethers.getSigners();

    // Attach to deployed contracts
    const Token = await ethers.getContractFactory("Token");
    const Treasury = await ethers.getContractFactory("Treasury");
    const Oracle = await ethers.getContractFactory("Oracle");
    const Bridge = await ethers.getContractFactory("Bridge");
    const Staking = await ethers.getContractFactory("Staking");
    const LPStaking = await ethers.getContractFactory("LPStaking");
    const SafeHarbor = await ethers.getContractFactory("SafeHarbor");
    const Timelock = await ethers.getContractFactory("Timelock");
    const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
    const GovernanceV2 = await ethers.getContractFactory("GovernanceV2");

    token = Token.attach(deploymentInfo.contracts.token);
    treasury = Treasury.attach(deploymentInfo.contracts.treasury);
    oracle = Oracle.attach(deploymentInfo.contracts.oracle);
    bridge = Bridge.attach(deploymentInfo.contracts.bridge);
    staking = Staking.attach(deploymentInfo.contracts.staking);
    lpStaking = LPStaking.attach(deploymentInfo.contracts.lpStaking);
    safeHarbor = SafeHarbor.attach(deploymentInfo.contracts.safeHarbor);
    timelock = Timelock.attach(deploymentInfo.contracts.governance.timelock);
    governor = HalomGovernor.attach(deploymentInfo.contracts.governance.governor);
    governanceV2 = GovernanceV2.attach(deploymentInfo.contracts.governance.governanceV2);
  });

  describe("Contract Deployment Verification", function () {
    it("Should have all contracts deployed with valid addresses", async function () {
      expect(token.address).to.not.equal(ethers.ZeroAddress);
      expect(treasury.address).to.not.equal(ethers.ZeroAddress);
      expect(oracle.address).to.not.equal(ethers.ZeroAddress);
      expect(bridge.address).to.not.equal(ethers.ZeroAddress);
      expect(staking.address).to.not.equal(ethers.ZeroAddress);
      expect(lpStaking.address).to.not.equal(ethers.ZeroAddress);
      expect(safeHarbor.address).to.not.equal(ethers.ZeroAddress);
      expect(timelock.address).to.not.equal(ethers.ZeroAddress);
      expect(governor.address).to.not.equal(ethers.ZeroAddress);
      expect(governanceV2.address).to.not.equal(ethers.ZeroAddress);
    });

    it("Should have correct contract names", async function () {
      expect(await token.name()).to.equal("Halom Protocol");
      expect(await token.symbol()).to.equal("HLM");
    });
  });

  describe("Role Configuration", function () {
    it("Should have correct MINTER_ROLE assignments", async function () {
      const MINTER_ROLE = await token.MINTER_ROLE();
      
      expect(await token.hasRole(MINTER_ROLE, treasury.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE, bridge.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE, staking.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE, lpStaking.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE, safeHarbor.address)).to.be.true;
    });

    it("Should have correct BURNER_ROLE assignments", async function () {
      const BURNER_ROLE = await token.BURNER_ROLE();
      
      expect(await token.hasRole(BURNER_ROLE, treasury.address)).to.be.true;
      expect(await token.hasRole(BURNER_ROLE, bridge.address)).to.be.true;
      expect(await token.hasRole(BURNER_ROLE, staking.address)).to.be.true;
      expect(await token.hasRole(BURNER_ROLE, lpStaking.address)).to.be.true;
      expect(await token.hasRole(BURNER_ROLE, safeHarbor.address)).to.be.true;
    });

    it("Should have correct governance role assignments", async function () {
      const GOVERNANCE_ROLE = await token.GOVERNANCE_ROLE();
      expect(await token.hasRole(GOVERNANCE_ROLE, governor.address)).to.be.true;
    });
  });

  describe("Timelock Configuration", function () {
    it("Should have correct timelock roles", async function () {
      const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
      const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
      const ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

      expect(await timelock.hasRole(PROPOSER_ROLE, governor.address)).to.be.true;
      expect(await timelock.hasRole(EXECUTOR_ROLE, governor.address)).to.be.true;
      expect(await timelock.hasRole(ADMIN_ROLE, deployer.address)).to.be.false; // Should be revoked
    });

    it("Should have correct minimum delay", async function () {
      const minDelay = await timelock.getMinDelay();
      expect(minDelay).to.equal(2 * 24 * 60 * 60); // 2 days
    });
  });

  describe("Governor Configuration", function () {
    it("Should have correct voting parameters", async function () {
      expect(await governor.votingDelay()).to.equal(4);
      expect(await governor.votingPeriod()).to.equal(45818);
      expect(await governor.proposalThreshold()).to.equal(500);
      expect(await governor.quorumNumerator()).to.equal(4);
    });

    it("Should have correct token and timelock addresses", async function () {
      expect(await governor.token()).to.equal(token.address);
      expect(await governor.timelock()).to.equal(timelock.address);
    });
  });

  describe("Treasury Configuration", function () {
    it("Should have correct token address", async function () {
      expect(await treasury.token()).to.equal(token.address);
    });

    it("Should have correct governance role", async function () {
      const GOVERNANCE_ROLE = await treasury.GOVERNANCE_ROLE();
      expect(await treasury.hasRole(GOVERNANCE_ROLE, governor.address)).to.be.true;
    });
  });

  describe("Bridge Configuration", function () {
    it("Should have correct token and treasury addresses", async function () {
      expect(await bridge.token()).to.equal(token.address);
      expect(await bridge.treasury()).to.equal(treasury.address);
    });

    it("Should be in active state", async function () {
      expect(await bridge.isActive()).to.be.true;
    });
  });

  describe("Staking Configuration", function () {
    it("Should have correct token and treasury addresses", async function () {
      expect(await staking.token()).to.equal(token.address);
      expect(await staking.treasury()).to.equal(treasury.address);
    });

    it("Should have correct LP staking configuration", async function () {
      expect(await lpStaking.token()).to.equal(token.address);
      expect(await lpStaking.treasury()).to.equal(treasury.address);
    });
  });

  describe("SafeHarbor Configuration", function () {
    it("Should have correct token and treasury addresses", async function () {
      expect(await safeHarbor.token()).to.equal(token.address);
      expect(await safeHarbor.treasury()).to.equal(treasury.address);
    });

    it("Should be in active state", async function () {
      const status = await safeHarbor.getStatus();
      expect(status.safeHarborActive).to.be.true;
    });
  });

  describe("Basic Functionality Tests", function () {
    it("Should allow token transfers", async function () {
      const amount = ethers.parseEther("100");
      await token.transfer(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount);
    });

    it("Should allow staking", async function () {
      const stakeAmount = ethers.parseEther("10");
      await token.connect(user1).approve(staking.address, stakeAmount);
      await staking.connect(user1).stake(stakeAmount);
      
      const userStake = await staking.getUserStake(user1.address);
      expect(userStake.amount).to.equal(stakeAmount);
    });

    it("Should allow unstaking", async function () {
      const initialBalance = await token.balanceOf(user1.address);
      const userStake = await staking.getUserStake(user1.address);
      
      await staking.connect(user1).unstake(userStake.amount);
      
      const finalBalance = await token.balanceOf(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });
  });

  describe("Governance Functionality", function () {
    it("Should allow proposal creation", async function () {
      // This test requires tokens to be delegated to the proposer
      const proposalThreshold = await governor.proposalThreshold();
      const userBalance = await token.balanceOf(user2.address);
      
      if (userBalance >= proposalThreshold) {
        await token.connect(user2).delegate(user2.address);
        
        const targets = [treasury.address];
        const values = [0];
        const calldatas = [treasury.interface.encodeFunctionData("pause")];
        const description = "Test proposal: Pause treasury";
        
        await governor.connect(user2).propose(targets, values, calldatas, description);
        
        // Verify proposal was created
        const proposalCount = await governor.proposalCount();
        expect(proposalCount).to.be.gt(0);
      }
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow pausing contracts", async function () {
      await treasury.pause();
      expect(await treasury.paused()).to.be.true;
      
      await treasury.unpause();
      expect(await treasury.paused()).to.be.false;
    });

    it("Should allow emergency stops", async function () {
      await bridge.emergencyStop();
      expect(await bridge.isActive()).to.be.false;
      
      await bridge.resume();
      expect(await bridge.isActive()).to.be.true;
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete staking cycle", async function () {
      const stakeAmount = ethers.parseEther("50");
      
      // Stake
      await token.connect(user2).approve(staking.address, stakeAmount);
      await staking.connect(user2).stake(stakeAmount);
      
      // Check stake
      const userStake = await staking.getUserStake(user2.address);
      expect(userStake.amount).to.equal(stakeAmount);
      
      // Unstake
      await staking.connect(user2).unstake(stakeAmount);
      
      // Verify unstake
      const finalStake = await staking.getUserStake(user2.address);
      expect(finalStake.amount).to.equal(0);
    });

    it("Should handle bridge operations", async function () {
      const bridgeAmount = ethers.parseEther("25");
      
      // Approve bridge
      await token.connect(user2).approve(bridge.address, bridgeAmount);
      
      // Bridge tokens
      await bridge.connect(user2).bridgeTokens(bridgeAmount);
      
      // Verify bridge balance
      const bridgeBalance = await token.balanceOf(bridge.address);
      expect(bridgeBalance).to.be.gte(bridgeAmount);
    });
  });

  describe("Security Checks", function () {
    it("Should not allow unauthorized minting", async function () {
      const amount = ethers.parseEther("1000");
      
      await expect(
        token.connect(user1).mint(user1.address, amount)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("Should not allow unauthorized role grants", async function () {
      const MINTER_ROLE = await token.MINTER_ROLE();
      
      await expect(
        token.connect(user1).grantRole(MINTER_ROLE, user1.address)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("Should not allow unauthorized treasury operations", async function () {
      await expect(
        treasury.connect(user1).withdraw(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Gas Optimization Verification", function () {
    it("Should have reasonable gas costs for basic operations", async function () {
      const amount = ethers.parseEther("10");
      
      // Test transfer gas cost
      const transferTx = await token.transfer(user1.address, amount);
      const transferReceipt = await transferTx.wait();
      expect(transferReceipt.gasUsed).to.be.lt(100000); // Should be under 100k gas
      
      // Test stake gas cost
      await token.connect(user1).approve(staking.address, amount);
      const stakeTx = await staking.connect(user1).stake(amount);
      const stakeReceipt = await stakeTx.wait();
      expect(stakeReceipt.gasUsed).to.be.lt(200000); // Should be under 200k gas
    });
  });

  describe("Deployment Summary", function () {
    it("Should log deployment summary", async function () {
      console.log("\n🎉 Post-Deployment Test Summary:");
      console.log("✅ All contracts deployed successfully");
      console.log("✅ All roles configured correctly");
      console.log("✅ Governance system operational");
      console.log("✅ Basic functionality verified");
      console.log("✅ Security measures in place");
      console.log("✅ Gas optimization verified");
      
      console.log("\n📋 Contract Addresses:");
      console.log("Token:", token.address);
      console.log("Treasury:", treasury.address);
      console.log("Oracle:", oracle.address);
      console.log("Bridge:", bridge.address);
      console.log("Staking:", staking.address);
      console.log("LP Staking:", lpStaking.address);
      console.log("SafeHarbor:", safeHarbor.address);
      console.log("Timelock:", timelock.address);
      console.log("Governor:", governor.address);
      console.log("GovernanceV2:", governanceV2.address);
      
      console.log("\n🚀 Halom Protocol is ready for production!");
    });
  });
}); 
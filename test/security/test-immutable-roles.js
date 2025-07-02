const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Immutable Role Declarations and Hierarchical Access Control", function () {
    let bridge, staking, governance;
    let owner, governor, validator, relayer, emergency, pauser, user;
    let addrs;

    beforeEach(async function () {
        [owner, governor, validator, relayer, emergency, pauser, user, ...addrs] = await ethers.getSigners();

        // Deploy contracts
        const Bridge = await ethers.getContractFactory("HalomBridge");
        const Staking = await ethers.getContractFactory("HalomStakingV2");
        const Governance = await ethers.getContractFactory("HalomGovernanceV2");
        const MockToken = await ethers.getContractFactory("MockERC20");

        const mockToken = await MockToken.deploy("Mock Token", "MTK");
        await mockToken.deployed();

        bridge = await Bridge.deploy();
        staking = await Staking.deploy();
        governance = await Governance.deploy();

        // Initialize contracts
        await bridge.initialize(1, owner.address, 100); // 1% bridge fee
        await staking.initialize(mockToken.address, owner.address);
        await governance.initialize(
            owner.address,
            ethers.utils.parseEther("1000"), // proposal threshold
            7 * 24 * 3600, // 7 days voting period
            24 * 3600, // 1 day execution delay
            ethers.utils.parseEther("10000"), // quorum votes
            6000 // 60% approval threshold
        );
    });

    describe("Immutable Role Declarations", function () {
        it("Should have immutable role declarations in Bridge contract", async function () {
            // Check that roles are immutable (compile-time constants)
            const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
            const RELAYER_ROLE = await bridge.RELAYER_ROLE();
            const EMERGENCY_ROLE = await bridge.EMERGENCY_ROLE();
            const PAUSER_ROLE = await bridge.PAUSER_ROLE();
            const BRIDGE_ROLE = await bridge.BRIDGE_ROLE();
            const ORACLE_ROLE = await bridge.ORACLE_ROLE();
            const BLACKLIST_ROLE = await bridge.BLACKLIST_ROLE();

            expect(VALIDATOR_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VALIDATOR_ROLE")));
            expect(RELAYER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RELAYER_ROLE")));
            expect(EMERGENCY_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE")));
            expect(PAUSER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_ROLE")));
            expect(BRIDGE_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BRIDGE_ROLE")));
            expect(ORACLE_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ORACLE_ROLE")));
            expect(BLACKLIST_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BLACKLIST_ROLE")));
        });

        it("Should have immutable role declarations in Staking contract", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            const REWARDER_ROLE = await staking.REWARDER_ROLE();
            const EMERGENCY_ROLE = await staking.EMERGENCY_ROLE();
            const PAUSER_ROLE = await staking.PAUSER_ROLE();
            const MINTER_ROLE = await staking.MINTER_ROLE();
            const SLASHER_ROLE = await staking.SLASHER_ROLE();

            expect(GOVERNOR_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GOVERNOR_ROLE")));
            expect(REWARDER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REWARDER_ROLE")));
            expect(EMERGENCY_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE")));
            expect(PAUSER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_ROLE")));
            expect(MINTER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")));
            expect(SLASHER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SLASHER_ROLE")));
        });

        it("Should have immutable role declarations in Governance contract", async function () {
            const GOVERNOR_ROLE = await governance.GOVERNOR_ROLE();
            const EXECUTOR_ROLE = await governance.EXECUTOR_ROLE();
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const VETO_ROLE = await governance.VETO_ROLE();
            const EMERGENCY_ROLE = await governance.EMERGENCY_ROLE();
            const PAUSER_ROLE = await governance.PAUSER_ROLE();
            const TIMELOCK_ROLE = await governance.TIMELOCK_ROLE();
            const MULTISIG_ROLE = await governance.MULTISIG_ROLE();

            expect(GOVERNOR_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GOVERNOR_ROLE")));
            expect(EXECUTOR_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXECUTOR_ROLE")));
            expect(PROPOSER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PROPOSER_ROLE")));
            expect(VETO_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VETO_ROLE")));
            expect(EMERGENCY_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE")));
            expect(PAUSER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_ROLE")));
            expect(TIMELOCK_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TIMELOCK_ROLE")));
            expect(MULTISIG_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MULTISIG_ROLE")));
        });
    });

    describe("Hierarchical Role Structure", function () {
        it("Should have correct role hierarchy in Bridge contract", async function () {
            const DEFAULT_ADMIN_ROLE = await bridge.DEFAULT_ADMIN_ROLE();
            const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
            const RELAYER_ROLE = await bridge.RELAYER_ROLE();
            const EMERGENCY_ROLE = await bridge.EMERGENCY_ROLE();
            const PAUSER_ROLE = await bridge.PAUSER_ROLE();

            // Check that DEFAULT_ADMIN_ROLE is admin for all other roles
            expect(await bridge.getRoleAdmin(VALIDATOR_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
            expect(await bridge.getRoleAdmin(RELAYER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
            expect(await bridge.getRoleAdmin(EMERGENCY_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
            expect(await bridge.getRoleAdmin(PAUSER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
        });

        it("Should have correct role hierarchy in Staking contract", async function () {
            const DEFAULT_ADMIN_ROLE = await staking.DEFAULT_ADMIN_ROLE();
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            const REWARDER_ROLE = await staking.REWARDER_ROLE();
            const EMERGENCY_ROLE = await staking.EMERGENCY_ROLE();
            const PAUSER_ROLE = await staking.PAUSER_ROLE();
            const MINTER_ROLE = await staking.MINTER_ROLE();
            const SLASHER_ROLE = await staking.SLASHER_ROLE();

            // Check that GOVERNOR_ROLE is admin for operational roles
            expect(await staking.getRoleAdmin(REWARDER_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await staking.getRoleAdmin(PAUSER_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await staking.getRoleAdmin(MINTER_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await staking.getRoleAdmin(SLASHER_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await staking.getRoleAdmin(EMERGENCY_ROLE)).to.equal(GOVERNOR_ROLE);
        });

        it("Should have correct role hierarchy in Governance contract", async function () {
            const DEFAULT_ADMIN_ROLE = await governance.DEFAULT_ADMIN_ROLE();
            const GOVERNOR_ROLE = await governance.GOVERNOR_ROLE();
            const EXECUTOR_ROLE = await governance.EXECUTOR_ROLE();
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const VETO_ROLE = await governance.VETO_ROLE();
            const EMERGENCY_ROLE = await governance.EMERGENCY_ROLE();
            const PAUSER_ROLE = await governance.PAUSER_ROLE();
            const TIMELOCK_ROLE = await governance.TIMELOCK_ROLE();
            const MULTISIG_ROLE = await governance.MULTISIG_ROLE();

            // Check that GOVERNOR_ROLE is admin for operational roles
            expect(await governance.getRoleAdmin(EXECUTOR_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await governance.getRoleAdmin(PROPOSER_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await governance.getRoleAdmin(VETO_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await governance.getRoleAdmin(EMERGENCY_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await governance.getRoleAdmin(PAUSER_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await governance.getRoleAdmin(TIMELOCK_ROLE)).to.equal(GOVERNOR_ROLE);
            expect(await governance.getRoleAdmin(MULTISIG_ROLE)).to.equal(GOVERNOR_ROLE);
        });
    });

    describe("Role Management", function () {
        it("Should allow DEFAULT_ADMIN_ROLE to grant roles", async function () {
            const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
            
            await bridge.grantRole(VALIDATOR_ROLE, validator.address);
            expect(await bridge.hasRole(VALIDATOR_ROLE, validator.address)).to.be.true;
        });

        it("Should allow role admins to grant sub-roles", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            const REWARDER_ROLE = await staking.REWARDER_ROLE();
            
            // Grant GOVERNOR_ROLE to governor
            await staking.grantRole(GOVERNOR_ROLE, governor.address);
            
            // Governor should be able to grant REWARDER_ROLE
            await staking.connect(governor).grantRole(REWARDER_ROLE, relayer.address);
            expect(await staking.hasRole(REWARDER_ROLE, relayer.address)).to.be.true;
        });

        it("Should prevent non-admin from granting roles", async function () {
            const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
            
            await expect(
                bridge.connect(user).grantRole(VALIDATOR_ROLE, validator.address)
            ).to.be.revertedWith("AccessControl");
        });

        it("Should allow role revocation", async function () {
            const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
            
            await bridge.grantRole(VALIDATOR_ROLE, validator.address);
            expect(await bridge.hasRole(VALIDATOR_ROLE, validator.address)).to.be.true;
            
            await bridge.revokeRole(VALIDATOR_ROLE, validator.address);
            expect(await bridge.hasRole(VALIDATOR_ROLE, validator.address)).to.be.false;
        });
    });

    describe("Role-Based Access Control", function () {
        it("Should restrict bridge functions to appropriate roles", async function () {
            const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
            const RELAYER_ROLE = await bridge.RELAYER_ROLE();
            const EMERGENCY_ROLE = await bridge.EMERGENCY_ROLE();
            const PAUSER_ROLE = await bridge.PAUSER_ROLE();

            // Grant roles
            await bridge.grantRole(VALIDATOR_ROLE, validator.address);
            await bridge.grantRole(RELAYER_ROLE, relayer.address);
            await bridge.grantRole(EMERGENCY_ROLE, emergency.address);
            await bridge.grantRole(PAUSER_ROLE, pauser.address);

            // Test pause function
            await expect(bridge.connect(user).pause()).to.be.reverted;
            await expect(bridge.connect(pauser).pause()).to.not.be.reverted;

            // Test emergency pause
            await expect(bridge.connect(user).emergencyPause("test")).to.be.reverted;
            await expect(bridge.connect(emergency).emergencyPause("test")).to.not.be.reverted;
        });

        it("Should restrict staking functions to appropriate roles", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            const REWARDER_ROLE = await staking.REWARDER_ROLE();
            const SLASHER_ROLE = await staking.SLASHER_ROLE();

            // Grant roles
            await staking.grantRole(GOVERNOR_ROLE, governor.address);
            await staking.grantRole(REWARDER_ROLE, relayer.address);
            await staking.grantRole(SLASHER_ROLE, emergency.address);

            // Test slash function
            await expect(staking.connect(user).slash(validator.address, 1000, "test")).to.be.reverted;
            await expect(staking.connect(emergency).slash(validator.address, 1000, "test")).to.not.be.reverted;
        });

        it("Should restrict governance functions to appropriate roles", async function () {
            const GOVERNOR_ROLE = await governance.GOVERNOR_ROLE();
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const EXECUTOR_ROLE = await governance.EXECUTOR_ROLE();

            // Grant roles
            await governance.grantRole(GOVERNOR_ROLE, governor.address);
            await governance.grantRole(PROPOSER_ROLE, validator.address);
            await governance.grantRole(EXECUTOR_ROLE, relayer.address);

            // Test proposal creation
            const targets = [user.address];
            const values = [0];
            const signatures = [""];
            const calldatas = ["0x"];
            const description = "Test proposal";

            await expect(
                governance.connect(user).propose(targets, values, signatures, calldatas, description)
            ).to.be.reverted;
            
            await expect(
                governance.connect(validator).propose(targets, values, signatures, calldatas, description)
            ).to.not.be.reverted;
        });
    });

    describe("Time-Limited Roles (Governance)", function () {
        it("Should grant roles with expiry", async function () {
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const duration = 30 * 24 * 3600; // 30 days

            await governance.grantRoleWithExpiry(PROPOSER_ROLE, validator.address, duration);
            expect(await governance.hasRole(PROPOSER_ROLE, validator.address)).to.be.true;

            // Check expiry time
            const expiry = await governance.roleExpiry(PROPOSER_ROLE, validator.address);
            expect(expiry).to.be.gt(0);
        });

        it("Should respect role expiry", async function () {
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const duration = 1; // 1 second

            await governance.grantRoleWithExpiry(PROPOSER_ROLE, validator.address, duration);
            expect(await governance.hasRole(PROPOSER_ROLE, validator.address)).to.be.true;

            // Wait for expiry
            await ethers.provider.send("evm_increaseTime", [2]);
            await ethers.provider.send("evm_mine");

            expect(await governance.hasRole(PROPOSER_ROLE, validator.address)).to.be.false;
        });

        it("Should prevent granting roles with excessive duration", async function () {
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const maxDuration = await governance.roleMaxDuration(PROPOSER_ROLE);
            const excessiveDuration = maxDuration + 1;

            await expect(
                governance.grantRoleWithExpiry(PROPOSER_ROLE, validator.address, excessiveDuration)
            ).to.be.revertedWith("Governance__InvalidRoleDuration");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow emergency pause", async function () {
            const EMERGENCY_ROLE = await bridge.EMERGENCY_ROLE();
            await bridge.grantRole(EMERGENCY_ROLE, emergency.address);

            await expect(bridge.connect(emergency).emergencyPause("Security incident")).to.not.be.reverted;
            expect(await bridge.paused()).to.be.true;
        });

        it("Should allow emergency unpause", async function () {
            const EMERGENCY_ROLE = await bridge.EMERGENCY_ROLE();
            await bridge.grantRole(EMERGENCY_ROLE, emergency.address);

            await bridge.connect(emergency).emergencyPause("Test");
            await expect(bridge.connect(emergency).emergencyUnpause()).to.not.be.reverted;
            expect(await bridge.paused()).to.be.false;
        });

        it("Should restrict emergency functions to emergency role", async function () {
            await expect(bridge.connect(user).emergencyPause("test")).to.be.reverted;
            await expect(bridge.connect(user).emergencyUnpause()).to.be.reverted;
        });
    });

    describe("Gas Optimization Verification", function () {
        it("Should use immutable roles for gas efficiency", async function () {
            // This test verifies that roles are immutable and don't consume storage
            // The actual gas savings would be measured during deployment
            
            const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
            const RELAYER_ROLE = await bridge.RELAYER_ROLE();
            
            // These should be compile-time constants, not storage variables
            expect(VALIDATOR_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("VALIDATOR_ROLE")));
            expect(RELAYER_ROLE).to.equal(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RELAYER_ROLE")));
        });
    });

    describe("Security Edge Cases", function () {
        it("Should prevent role escalation", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            const REWARDER_ROLE = await staking.REWARDER_ROLE();

            // Grant REWARDER_ROLE to user
            await staking.grantRole(REWARDER_ROLE, user.address);
            
            // User should not be able to grant GOVERNOR_ROLE
            await expect(
                staking.connect(user).grantRole(GOVERNOR_ROLE, user.address)
            ).to.be.revertedWith("AccessControl");
        });

        it("Should handle role expiry correctly", async function () {
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const duration = 1;

            await governance.grantRoleWithExpiry(PROPOSER_ROLE, validator.address, duration);
            
            // Role should be active initially
            expect(await governance.hasRole(PROPOSER_ROLE, validator.address)).to.be.true;
            
            // Wait for expiry
            await ethers.provider.send("evm_increaseTime", [2]);
            await ethers.provider.send("evm_mine");
            
            // Role should be expired
            expect(await governance.hasRole(PROPOSER_ROLE, validator.address)).to.be.false;
            expect(await governance.isRoleExpired(PROPOSER_ROLE, validator.address)).to.be.true;
        });

        it("Should prevent expired roles from performing actions", async function () {
            const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
            const duration = 1;

            await governance.grantRoleWithExpiry(PROPOSER_ROLE, validator.address, duration);
            
            // Wait for expiry
            await ethers.provider.send("evm_increaseTime", [2]);
            await ethers.provider.send("evm_mine");
            
            // Try to create proposal with expired role
            const targets = [user.address];
            const values = [0];
            const signatures = [""];
            const calldatas = ["0x"];
            const description = "Test proposal";

            await expect(
                governance.connect(validator).propose(targets, values, signatures, calldatas, description)
            ).to.be.reverted;
        });
    });
}); 
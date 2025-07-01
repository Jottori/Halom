const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Halom Role-Based Architecture", function () {
    let roles, token, staking, governance, oracle, bridge;
    let owner, governor, minter, pauser, blacklister, bridgeOperator, oracleOperator, user;
    let DEFAULT_ADMIN_ROLE, UPGRADER_ROLE, GOVERNOR_ROLE, EMERGENCY_ROLE;
    let MINTER_ROLE, PAUSER_ROLE, BLACKLIST_ROLE, BRIDGE_ROLE, ORACLE_ROLE;

    beforeEach(async function () {
        [owner, governor, minter, pauser, blacklister, bridgeOperator, oracleOperator, user] = await ethers.getSigners();

        // Deploy Roles contract
        const Roles = await ethers.getContractFactory("Roles");
        roles = await Roles.deploy();
        await roles.initialize(owner.address);

        // Get role constants
        DEFAULT_ADMIN_ROLE = await roles.DEFAULT_ADMIN_ROLE();
        UPGRADER_ROLE = await roles.UPGRADER_ROLE();
        GOVERNOR_ROLE = await roles.GOVERNOR_ROLE();
        EMERGENCY_ROLE = await roles.EMERGENCY_ROLE();
        MINTER_ROLE = await roles.MINTER_ROLE();
        PAUSER_ROLE = await roles.PAUSER_ROLE();
        BLACKLIST_ROLE = await roles.BLACKLIST_ROLE();
        BRIDGE_ROLE = await roles.BRIDGE_ROLE();
        ORACLE_ROLE = await roles.ORACLE_ROLE();

        // Deploy other contracts
        const HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy();
        await token.initialize("Halom Token", "HALOM", owner.address);

        const Staking = await ethers.getContractFactory("Staking");
        staking = await Staking.deploy();
        await staking.initialize(await token.getAddress(), owner.address);

        const Governance = await ethers.getContractFactory("Governance");
        governance = await Governance.deploy();
        await governance.initialize(owner.address, ethers.parseEther("1000000"), 86400, 604800, ethers.parseEther("10000"));

        const Oracle = await ethers.getContractFactory("Oracle");
        oracle = await Oracle.deploy();
        await oracle.initialize(owner.address, 3, 3600, 300);

        const Bridge = await ethers.getContractFactory("Bridge");
        bridge = await Bridge.deploy();
        await bridge.initialize(await token.getAddress(), owner.address, ethers.parseEther("100"), ethers.parseEther("1000000"), 50);
    });

    describe("Role Definitions", function () {
        it("Should have correct role constants", async function () {
            expect(DEFAULT_ADMIN_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("DEFAULT_ADMIN_ROLE")));
            expect(UPGRADER_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE")));
            expect(GOVERNOR_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE")));
            expect(EMERGENCY_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE")));
            expect(MINTER_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")));
            expect(PAUSER_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE")));
            expect(BLACKLIST_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("BLACKLIST_ROLE")));
            expect(BRIDGE_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE")));
            expect(ORACLE_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE")));
        });

        it("Should have correct role descriptions", async function () {
            expect(await roles.getRoleDescription(DEFAULT_ADMIN_ROLE)).to.include("Full administrative control");
            expect(await roles.getRoleDescription(GOVERNOR_ROLE)).to.include("Governance parameter modification");
            expect(await roles.getRoleDescription(MINTER_ROLE)).to.include("Token mint");
            expect(await roles.getRoleDescription(PAUSER_ROLE)).to.include("pause/unpause");
            expect(await roles.getRoleDescription(BLACKLIST_ROLE)).to.include("Address blacklisting");
            expect(await roles.getRoleDescription(BRIDGE_ROLE)).to.include("Cross-chain bridge operations");
            expect(await roles.getRoleDescription(ORACLE_ROLE)).to.include("Data submission");
        });
    });

    describe("Role Management", function () {
        it("Should allow DEFAULT_ADMIN_ROLE to grant roles", async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            expect(await roles.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
        });

        it("Should allow DEFAULT_ADMIN_ROLE to revoke roles", async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            await roles.revokeRole(GOVERNOR_ROLE, governor.address);
            expect(await roles.hasRole(GOVERNOR_ROLE, governor.address)).to.be.false;
        });

        it("Should not allow non-admin to grant roles", async function () {
            await expect(
                roles.connect(user).grantRole(GOVERNOR_ROLE, governor.address)
            ).to.be.revertedWithCustomError(roles, "AccessControlUnauthorizedAccount");
        });

        it("Should allow users to renounce their own roles", async function () {
            await roles.grantRole(MINTER_ROLE, user.address);
            await roles.connect(user).renounceRole(MINTER_ROLE, user.address);
            expect(await roles.hasRole(MINTER_ROLE, user.address)).to.be.false;
        });

        it("Should not allow users to renounce others' roles", async function () {
            await roles.grantRole(MINTER_ROLE, minter.address);
            await expect(
                roles.connect(user).renounceRole(MINTER_ROLE, minter.address)
            ).to.be.revertedWithCustomError(roles, "UnauthorizedRoleManagement");
        });
    });

    describe("Role Hierarchy", function () {
        it("Should have correct role hierarchy", async function () {
            const governorHierarchy = await roles.getRoleHierarchy(GOVERNOR_ROLE);
            expect(governorHierarchy).to.have.length(1);
            expect(governorHierarchy[0]).to.equal(DEFAULT_ADMIN_ROLE);

            const emergencyHierarchy = await roles.getRoleHierarchy(EMERGENCY_ROLE);
            expect(emergencyHierarchy).to.have.length(2);
            expect(emergencyHierarchy).to.include(DEFAULT_ADMIN_ROLE);
            expect(emergencyHierarchy).to.include(GOVERNOR_ROLE);
        });

        it("Should check role inheritance correctly", async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            expect(await roles.hasRoleOrParent(MINTER_ROLE, governor.address)).to.be.false;
            
            await roles.grantRole(MINTER_ROLE, governor.address);
            expect(await roles.hasRoleOrParent(MINTER_ROLE, governor.address)).to.be.true;
        });
    });

    describe("Token Contract Role Integration", function () {
        beforeEach(async function () {
            await roles.grantRole(MINTER_ROLE, minter.address);
            await roles.grantRole(PAUSER_ROLE, pauser.address);
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            await roles.grantRole(BLACKLIST_ROLE, blacklister.address);
        });

        it("Should allow MINTER_ROLE to mint tokens", async function () {
            await token.connect(minter).mint(user.address, ethers.parseEther("1000"));
            expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("1000"));
        });

        it("Should not allow non-MINTER_ROLE to mint tokens", async function () {
            await expect(
                token.connect(user).mint(user.address, ethers.parseEther("1000"))
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should allow PAUSER_ROLE to pause token", async function () {
            await token.connect(pauser).pause();
            expect(await token.paused()).to.be.true;
        });

        it("Should allow PAUSER_ROLE to unpause token", async function () {
            await token.connect(pauser).pause();
            await token.connect(pauser).unpause();
            expect(await token.paused()).to.be.false;
        });

        it("Should allow GOVERNOR_ROLE to set fee parameters", async function () {
            await token.connect(governor).setFeeParams(200, 1000);
            const feeParams = await token.getFeeParams();
            expect(feeParams[0]).to.equal(200); // bps
            expect(feeParams[1]).to.equal(1000); // maxFee
        });

        it("Should allow GOVERNOR_ROLE to set anti-whale parameters", async function () {
            await token.connect(governor).setAntiWhaleParams(
                ethers.parseEther("2000"),
                ethers.parseEther("20000"),
                600
            );
            const antiWhaleParams = await token.getAntiWhaleParams();
            expect(antiWhaleParams[0]).to.equal(ethers.parseEther("2000"));
            expect(antiWhaleParams[1]).to.equal(ethers.parseEther("20000"));
            expect(antiWhaleParams[2]).to.equal(600);
        });

        it("Should allow BLACKLIST_ROLE to blacklist addresses", async function () {
            await token.connect(blacklister).blacklist(user.address);
            expect(await token.isBlacklisted(user.address)).to.be.true;
        });

        it("Should allow BLACKLIST_ROLE to unblacklist addresses", async function () {
            await token.connect(blacklister).blacklist(user.address);
            await token.connect(blacklister).unBlacklist(user.address);
            expect(await token.isBlacklisted(user.address)).to.be.false;
        });
    });

    describe("Staking Contract Role Integration", function () {
        beforeEach(async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            await roles.grantRole(PAUSER_ROLE, pauser.address);
            await token.mint(user.address, ethers.parseEther("10000"));
            await token.connect(user).approve(await staking.getAddress(), ethers.parseEther("10000"));
        });

        it("Should allow GOVERNOR_ROLE to set reward rate", async function () {
            await staking.connect(governor).setRewardRate(ethers.parseEther("0.002"));
            // Verify reward rate was set (implementation dependent)
        });

        it("Should allow GOVERNOR_ROLE to emergency withdraw", async function () {
            await staking.connect(user).stake(ethers.parseEther("1000"));
            await staking.connect(governor).emergencyWithdraw();
            // Verify emergency withdrawal (implementation dependent)
        });

        it("Should allow PAUSER_ROLE to pause staking", async function () {
            await staking.connect(pauser).pause();
            expect(await staking.paused()).to.be.true;
        });

        it("Should allow PAUSER_ROLE to unpause staking", async function () {
            await staking.connect(pauser).pause();
            await staking.connect(pauser).unpause();
            expect(await staking.paused()).to.be.false;
        });
    });

    describe("Governance Contract Role Integration", function () {
        beforeEach(async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            await roles.grantRole(BRIDGE_ROLE, bridgeOperator.address);
        });

        it("Should allow GOVERNOR_ROLE to execute proposals", async function () {
            // Create a proposal first
            await governance.connect(user).propose("Test Proposal", "0x");
            const proposalId = 1;
            
            // Vote on proposal
            await governance.connect(user).vote(proposalId, ethers.parseEther("1000"));
            
            // Fast forward time to allow execution
            await ethers.provider.send("evm_increaseTime", [604800]); // 7 days
            await ethers.provider.send("evm_mine");
            
            await governance.connect(governor).executeProposal(proposalId);
            // Verify proposal execution (implementation dependent)
        });

        it("Should allow GOVERNOR_ROLE to set quorum", async function () {
            await governance.connect(governor).setQuorum(ethers.parseEther("2000000"));
            const params = await governance.getGovernanceParams();
            expect(params[0]).to.equal(ethers.parseEther("2000000"));
        });

        it("Should allow GOVERNOR_ROLE to set voting delay", async function () {
            await governance.connect(governor).setVotingDelay(172800); // 2 days
            const params = await governance.getGovernanceParams();
            expect(params[1]).to.equal(172800);
        });

        it("Should allow GOVERNOR_ROLE to set voting period", async function () {
            await governance.connect(governor).setVotingPeriod(1209600); // 14 days
            const params = await governance.getGovernanceParams();
            expect(params[2]).to.equal(1209600);
        });

        it("Should allow BRIDGE_ROLE to relay cross-chain proposals", async function () {
            await governance.connect(bridgeOperator).relayCrossChainProposal("0x1234");
            // Verify cross-chain proposal relay (implementation dependent)
        });
    });

    describe("Oracle Contract Role Integration", function () {
        beforeEach(async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            await roles.grantRole(ORACLE_ROLE, oracleOperator.address);
        });

        it("Should allow ORACLE_ROLE to submit prices", async function () {
            await oracle.connect(oracleOperator).submitPrice(ethers.keccak256(ethers.toUtf8Bytes("ETH/USD")), ethers.parseEther("2000"));
            const priceData = await oracle.getLatestPrice(ethers.keccak256(ethers.toUtf8Bytes("ETH/USD")));
            expect(priceData[0]).to.equal(ethers.parseEther("2000"));
        });

        it("Should not allow non-ORACLE_ROLE to submit prices", async function () {
            await expect(
                oracle.connect(user).submitPrice(ethers.keccak256(ethers.toUtf8Bytes("ETH/USD")), ethers.parseEther("2000"))
            ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
        });

        it("Should allow GOVERNOR_ROLE to add oracles", async function () {
            await oracle.connect(governor).addOracle(user.address);
            expect(await oracle.isAuthorizedOracle(user.address)).to.be.true;
        });

        it("Should allow GOVERNOR_ROLE to remove oracles", async function () {
            await oracle.connect(governor).addOracle(user.address);
            await oracle.connect(governor).removeOracle(user.address);
            expect(await oracle.isAuthorizedOracle(user.address)).to.be.false;
        });

        it("Should allow GOVERNOR_ROLE to set price validity period", async function () {
            await oracle.connect(governor).setPriceValidityPeriod(7200); // 2 hours
            const config = await oracle.getOracleConfig();
            expect(config[1]).to.equal(7200);
        });

        it("Should allow GOVERNOR_ROLE to set minimum oracle count", async function () {
            await oracle.connect(governor).setMinOracleCount(5);
            const config = await oracle.getOracleConfig();
            expect(config[0]).to.equal(5);
        });
    });

    describe("Bridge Contract Role Integration", function () {
        beforeEach(async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            await roles.grantRole(BRIDGE_ROLE, bridgeOperator.address);
            await token.mint(user.address, ethers.parseEther("10000"));
            await token.connect(user).approve(await bridge.getAddress(), ethers.parseEther("10000"));
        });

        it("Should allow BRIDGE_ROLE to mint from bridge", async function () {
            await bridge.connect(bridgeOperator).mintFromBridge(user.address, ethers.parseEther("1000"), 1);
            expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("11000"));
        });

        it("Should allow BRIDGE_ROLE to unlock tokens", async function () {
            await bridge.connect(bridgeOperator).unlockTokens(user.address, ethers.parseEther("1000"));
            expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("11000"));
        });

        it("Should not allow non-BRIDGE_ROLE to mint from bridge", async function () {
            await expect(
                bridge.connect(user).mintFromBridge(user.address, ethers.parseEther("1000"), 1)
            ).to.be.revertedWithCustomError(bridge, "AccessControlUnauthorizedAccount");
        });

        it("Should allow GOVERNOR_ROLE to set bridge address", async function () {
            await bridge.connect(governor).setBridge(user.address);
            // Verify bridge address was set (implementation dependent)
        });

        it("Should allow GOVERNOR_ROLE to set chain support", async function () {
            await bridge.connect(governor).setChainSupport(10, true); // Polygon
            expect(await bridge.isChainSupported(10)).to.be.true;
        });

        it("Should allow GOVERNOR_ROLE to set bridge fee", async function () {
            await bridge.connect(governor).setBridgeFee(100); // 1%
            const config = await bridge.getBridgeConfig();
            expect(config[3]).to.equal(100);
        });
    });

    describe("Emergency Role Functionality", function () {
        beforeEach(async function () {
            await roles.grantRole(EMERGENCY_ROLE, user.address);
        });

        it("Should allow EMERGENCY_ROLE to activate emergency functions", async function () {
            await roles.connect(user).activateEmergencyRole("Security incident detected");
            // Verify emergency activation (implementation dependent)
        });

        it("Should not allow non-EMERGENCY_ROLE to activate emergency functions", async function () {
            await expect(
                roles.connect(governor).activateEmergencyRole("Test")
            ).to.be.revertedWithCustomError(roles, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Role Analytics", function () {
        beforeEach(async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            await roles.grantRole(MINTER_ROLE, minter.address);
            await roles.grantRole(PAUSER_ROLE, pauser.address);
        });

        it("Should return correct account roles", async function () {
            const ownerRoles = await roles.getAccountRoles(owner.address);
            expect(ownerRoles).to.include(DEFAULT_ADMIN_ROLE);

            const governorRoles = await roles.getAccountRoles(governor.address);
            expect(governorRoles).to.include(GOVERNOR_ROLE);

            const minterRoles = await roles.getAccountRoles(minter.address);
            expect(minterRoles).to.include(MINTER_ROLE);
        });

        it("Should return correct role counts", async function () {
            expect(await roles.getAccountRoleCount(owner.address)).to.equal(9); // All roles
            expect(await roles.getAccountRoleCount(governor.address)).to.equal(1); // Only GOVERNOR_ROLE
            expect(await roles.getAccountRoleCount(user.address)).to.equal(0); // No roles
        });

        it("Should check if account has any role", async function () {
            expect(await roles.hasAnyRole(owner.address)).to.be.true;
            expect(await roles.hasAnyRole(governor.address)).to.be.true;
            expect(await roles.hasAnyRole(user.address)).to.be.false;
        });
    });

    describe("Role Constants Export", function () {
        it("Should return all role constants", async function () {
            const constants = await roles.getRoleConstants();
            expect(constants[0]).to.equal(DEFAULT_ADMIN_ROLE);
            expect(constants[1]).to.equal(UPGRADER_ROLE);
            expect(constants[2]).to.equal(GOVERNOR_ROLE);
            expect(constants[3]).to.equal(EMERGENCY_ROLE);
            expect(constants[4]).to.equal(MINTER_ROLE);
            expect(constants[5]).to.equal(PAUSER_ROLE);
            expect(constants[6]).to.equal(BLACKLIST_ROLE);
            expect(constants[7]).to.equal(BRIDGE_ROLE);
            expect(constants[8]).to.equal(ORACLE_ROLE);
        });
    });

    describe("Security and Access Control", function () {
        it("Should prevent unauthorized role escalation", async function () {
            await roles.grantRole(GOVERNOR_ROLE, governor.address);
            
            // Governor should not be able to grant DEFAULT_ADMIN_ROLE
            await expect(
                roles.connect(governor).grantRole(DEFAULT_ADMIN_ROLE, user.address)
            ).to.be.revertedWithCustomError(roles, "AccessControlUnauthorizedAccount");
        });

        it("Should prevent circular role dependencies", async function () {
            await expect(
                roles.setRoleHierarchy(DEFAULT_ADMIN_ROLE, [GOVERNOR_ROLE])
            ).to.be.revertedWithCustomError(roles, "CircularRoleDependency");
        });

        it("Should validate role parameters", async function () {
            await expect(
                roles.grantRole(ethers.keccak256(ethers.toUtf8Bytes("INVALID_ROLE")), user.address)
            ).to.be.revertedWithCustomError(roles, "InvalidRole");
        });

        it("Should validate account addresses", async function () {
            await expect(
                roles.grantRole(GOVERNOR_ROLE, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(roles, "InvalidAccount");
        });
    });
}); 
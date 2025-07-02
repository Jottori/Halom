const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomGovernanceV2 - Roles", function () {
    let governance, token, timelock, owner, user1, user2, user3, user4;
    let multisig1, multisig2, multisig3;

    beforeEach(async function () {
        [owner, user1, user2, user3, user4, multisig1, multisig2, multisig3] = await ethers.getSigners();

        // Deploy token
        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Halom Token", "HALOM");
        await token.deployed();

        // Deploy timelock
        const TimelockController = await ethers.getContractFactory("TimelockController");
        timelock = await TimelockController.deploy(300, [owner.address], [owner.address]);
        await timelock.deployed();

        // Deploy governance
        const GovernanceV2 = await ethers.getContractFactory("HalomGovernanceV2");
        governance = await GovernanceV2.deploy(
            token.address,
            timelock.address,
            multisig1.address,
            1, // voting delay
            45818, // voting period
            ethers.utils.parseEther("1000"), // proposal threshold
            4 // quorum percentage
        );
        await governance.deployed();

        // Setup initial balances
        await token.mint(user1.address, ethers.utils.parseEther("10000"));
        await token.mint(user2.address, ethers.utils.parseEther("10000"));
        await token.mint(user3.address, ethers.utils.parseEther("10000"));
        await token.mint(user4.address, ethers.utils.parseEther("10000"));
    });

    describe("Initialization", function () {
        it("Should initialize with correct parameters", async function () {
            expect(await governance.hasRole(await governance.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await governance.hasRole(await governance.EMERGENCY_ROLE(), owner.address)).to.be.true;
            expect(await governance.multisigThreshold()).to.equal(1);
            expect(await governance.totalMultisigSigners()).to.equal(1);
        });

        it("Should revert if initialized twice", async function () {
            const GovernanceV2 = await ethers.getContractFactory("HalomGovernanceV2");
            const newGovernance = await GovernanceV2.deploy(
                token.address,
                timelock.address,
                multisig1.address,
                1,
                45818,
                ethers.utils.parseEther("1000"),
                4
            );
            await expect(newGovernance.initialize(
                token.address,
                timelock.address,
                multisig1.address,
                1,
                45818,
                ethers.utils.parseEther("1000"),
                4
            )).to.be.revertedWith("Initializable: contract is already initialized");
        });
    });

    describe("Time-Limited Role Management", function () {
        it("Should grant time-limited role successfully", async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600 // 7 days
            );

            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.true;
            expect(await governance.getRoleExpiry(user1.address)).to.be.gt(0);
        });

        it("Should revert if duration exceeds maximum", async function () {
            await expect(governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                10 * 24 * 3600 // 10 days (exceeds 7-day limit)
            )).to.be.revertedWithCustomError(governance, "Governance__InvalidRole");
        });

        it("Should revert if role not time-limited", async function () {
            await expect(governance.grantTimeLimitedRole(
                user1.address,
                await governance.DEFAULT_ADMIN_ROLE(),
                7 * 24 * 3600
            )).to.be.revertedWithCustomError(governance, "Governance__InvalidRole");
        });

        it("Should emit RoleGranted event", async function () {
            await expect(governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            )).to.emit(governance, "RoleGranted")
              .withArgs(user1.address, await governance.REBASE_CALLER_ROLE(), anyValue);
        });

        it("Should expire role after duration", async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                1 // 1 second
            );

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [2]);
            await ethers.provider.send("evm_mine");

            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.false;
        });
    });

    describe("Role Expiry Checking", function () {
        beforeEach(async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            );
        });

        it("Should check role expiry correctly", async function () {
            await governance.checkRoleExpiry(user1.address);
            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.true;
        });

        it("Should revoke expired roles", async function () {
            // Fast forward time to expire role
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            await governance.checkRoleExpiry(user1.address);
            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.false;
        });

        it("Should emit RoleExpired event", async function () {
            // Fast forward time to expire role
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            await expect(governance.checkRoleExpiry(user1.address))
                .to.emit(governance, "RoleExpired")
                .withArgs(user1.address, await governance.REBASE_CALLER_ROLE());
        });
    });

    describe("Multisig Management", function () {
        it("Should add multisig signer", async function () {
            await governance.addMultisigSigner(multisig2.address);
            expect(await governance.isMultisigSigner(multisig2.address)).to.be.true;
            expect(await governance.totalMultisigSigners()).to.equal(2);
        });

        it("Should remove multisig signer", async function () {
            await governance.addMultisigSigner(multisig2.address);
            await governance.removeMultisigSigner(multisig2.address);
            expect(await governance.isMultisigSigner(multisig2.address)).to.be.false;
            expect(await governance.totalMultisigSigners()).to.equal(1);
        });

        it("Should revert if adding too many signers", async function () {
            await governance.addMultisigSigner(multisig2.address);
            await governance.addMultisigSigner(multisig3.address);
            await governance.addMultisigSigner(user1.address);
            await governance.addMultisigSigner(user2.address);
            await governance.addMultisigSigner(user3.address);
            await governance.addMultisigSigner(user4.address);

            await expect(governance.addMultisigSigner(owner.address))
                .to.be.revertedWithCustomError(governance, "Governance__InvalidMultisigSigner");
        });

        it("Should revert if removing too many signers", async function () {
            await expect(governance.removeMultisigSigner(multisig1.address))
                .to.be.revertedWithCustomError(governance, "Governance__InvalidMultisigSigner");
        });

        it("Should update multisig threshold", async function () {
            await governance.addMultisigSigner(multisig2.address);
            await governance.updateMultisigThreshold(2);
            expect(await governance.multisigThreshold()).to.equal(2);
        });

        it("Should revert if threshold invalid", async function () {
            await expect(governance.updateMultisigThreshold(5))
                .to.be.revertedWithCustomError(governance, "Governance__InvalidThreshold");
        });
    });

    describe("Multisig Proposals", function () {
        beforeEach(async function () {
            await governance.addMultisigSigner(multisig2.address);
            await governance.addMultisigSigner(multisig3.address);
            await governance.updateMultisigThreshold(2);
        });

        it("Should create multisig proposal", async function () {
            const proposalId = await governance.createMultisigProposal(
                user1.address,
                0,
                "0x"
            );
            expect(proposalId).to.not.equal(0);
        });

        it("Should approve proposal", async function () {
            const proposalId = await governance.createMultisigProposal(
                user1.address,
                0,
                "0x"
            );

            await governance.approveMultisigProposal(proposalId);
            const proposal = await governance.getMultisigProposal(proposalId);
            expect(proposal.approvals).to.equal(1);
        });

        it("Should execute proposal with sufficient approvals", async function () {
            const proposalId = await governance.createMultisigProposal(
                user1.address,
                0,
                "0x"
            );

            await governance.approveMultisigProposal(proposalId);
            await governance.connect(multisig2).approveMultisigProposal(proposalId);
            await governance.executeMultisigProposal(proposalId);

            const proposal = await governance.getMultisigProposal(proposalId);
            expect(proposal.executed).to.be.true;
        });

        it("Should revert if insufficient approvals", async function () {
            const proposalId = await governance.createMultisigProposal(
                user1.address,
                0,
                "0x"
            );

            await governance.approveMultisigProposal(proposalId);
            await expect(governance.executeMultisigProposal(proposalId))
                .to.be.revertedWithCustomError(governance, "Governance__InsufficientApprovals");
        });

        it("Should revert if already approved", async function () {
            const proposalId = await governance.createMultisigProposal(
                user1.address,
                0,
                "0x"
            );

            await governance.approveMultisigProposal(proposalId);
            await expect(governance.approveMultisigProposal(proposalId))
                .to.be.revertedWithCustomError(governance, "Governance__AlreadyApproved");
        });

        it("Should revert if proposal expired", async function () {
            const proposalId = await governance.createMultisigProposal(
                user1.address,
                0,
                "0x"
            );

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            await expect(governance.approveMultisigProposal(proposalId))
                .to.be.revertedWithCustomError(governance, "Governance__ProposalExpired");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow emergency role grant", async function () {
            await governance.emergencyGrantRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE()
            );

            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.true;
        });

        it("Should expire emergency granted roles", async function () {
            await governance.emergencyGrantRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE()
            );

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.false;
        });

        it("Should emit emergency action events", async function () {
            await expect(governance.emergencyGrantRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE()
            )).to.emit(governance, "EmergencyAction")
              .withArgs(owner.address, "GRANT_ROLE", anyValue);
        });

        it("Should revert if not emergency role", async function () {
            await expect(governance.connect(user1).emergencyGrantRole(
                user2.address,
                await governance.REBASE_CALLER_ROLE()
            )).to.be.revertedWithCustomError(governance, "Governance__EmergencyOnly");
        });
    });

    describe("Role Validation", function () {
        it("Should validate role expiry correctly", async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            );

            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.true;

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.false;
        });

        it("Should handle non-time-limited roles", async function () {
            expect(await governance.hasRole(await governance.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            );
            await governance.grantTimeLimitedRole(
                user2.address,
                await governance.REWARDER_ROLE(),
                30 * 24 * 3600
            );
        });

        it("Should get all roles for account", async function () {
            const roles = await governance.getRoles(owner.address);
            expect(roles.length).to.be.gt(0);
            expect(roles).to.include(await governance.DEFAULT_ADMIN_ROLE());
        });

        it("Should get role expiry", async function () {
            const expiry = await governance.getRoleExpiry(user1.address);
            expect(expiry).to.be.gt(0);
        });

        it("Should check multisig signer status", async function () {
            expect(await governance.isMultisigSigner(multisig1.address)).to.be.true;
            expect(await governance.isMultisigSigner(user1.address)).to.be.false;
        });

        it("Should get multisig proposal info", async function () {
            const proposalId = await governance.createMultisigProposal(
                user1.address,
                0,
                "0x"
            );

            const proposal = await governance.getMultisigProposal(proposalId);
            expect(proposal.proposer).to.equal(owner.address);
            expect(proposal.target).to.equal(user1.address);
        });
    });

    describe("Access Control Override", function () {
        it("Should enforce multisig requirements", async function () {
            await expect(governance.connect(user1).grantTimeLimitedRole(
                user2.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            )).to.be.revertedWithCustomError(governance, "Governance__RoleRequiresMultisig");
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle zero duration roles", async function () {
            await expect(governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                0
            )).to.not.be.reverted;
        });

        it("Should handle maximum duration roles", async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600 // Maximum for REBASE_CALLER_ROLE
            );

            const expiry = await governance.getRoleExpiry(user1.address);
            expect(expiry).to.be.gt(0);
        });

        it("Should handle multiple roles for same account", async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            );
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REWARDER_ROLE(),
                30 * 24 * 3600
            );

            const roles = await governance.getRoles(user1.address);
            expect(roles.length).to.equal(2);
        });

        it("Should handle role revocation", async function () {
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            );

            await governance.revokeRole(await governance.REBASE_CALLER_ROLE(), user1.address);
            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.false;
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete role lifecycle", async function () {
            // 1. Grant time-limited role
            await governance.grantTimeLimitedRole(
                user1.address,
                await governance.REBASE_CALLER_ROLE(),
                7 * 24 * 3600
            );

            // 2. Verify role assignment
            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.true;

            // 3. Add multisig signer
            await governance.addMultisigSigner(multisig2.address);

            // 4. Create and execute multisig proposal
            const proposalId = await governance.createMultisigProposal(
                user2.address,
                0,
                "0x"
            );
            await governance.approveMultisigProposal(proposalId);
            await governance.connect(multisig2).approveMultisigProposal(proposalId);
            await governance.executeMultisigProposal(proposalId);

            // 5. Role expires
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            // 6. Check role expiry
            await governance.checkRoleExpiry(user1.address);
            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.false;
        });

        it("Should handle concurrent role operations", async function () {
            // Grant multiple roles concurrently
            await Promise.all([
                governance.grantTimeLimitedRole(
                    user1.address,
                    await governance.REBASE_CALLER_ROLE(),
                    7 * 24 * 3600
                ),
                governance.grantTimeLimitedRole(
                    user2.address,
                    await governance.REWARDER_ROLE(),
                    30 * 24 * 3600
                ),
                governance.addMultisigSigner(multisig2.address)
            ]);

            expect(await governance.hasRole(await governance.REBASE_CALLER_ROLE(), user1.address)).to.be.true;
            expect(await governance.hasRole(await governance.REWARDER_ROLE(), user2.address)).to.be.true;
            expect(await governance.isMultisigSigner(multisig2.address)).to.be.true;
        });
    });
}); 
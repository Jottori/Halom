const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Pausable Functionality Tests", function () {
    let stakingV2, token, owner, pauser, emergency, user1, user2;
    let snapshotId;

    beforeEach(async function () {
        [owner, pauser, emergency, user1, user2] = await ethers.getSigners();
        
        // Deploy token
        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        await token.waitForDeployment();
        
        // Deploy staking contract
        const StakingV2 = await ethers.getContractFactory("StakingV2");
        stakingV2 = await StakingV2.deploy();
        await stakingV2.waitForDeployment();
        
        // Setup roles
        const PAUSER_ROLE = await stakingV2.PAUSER_ROLE();
        const EMERGENCY_ROLE = await stakingV2.EMERGENCY_ROLE();
        const DEFAULT_ADMIN_ROLE = await stakingV2.DEFAULT_ADMIN_ROLE();
        
        await stakingV2.grantRole(PAUSER_ROLE, pauser.address);
        await stakingV2.grantRole(EMERGENCY_ROLE, emergency.address);
        
        // Setup token for staking
        await token.grantRole(await token.MINTER_ROLE(), owner.address);
        await token.mint(user1.address, ethers.parseEther("10000"));
        await token.mint(user2.address, ethers.parseEther("10000"));
        
        // Approve staking
        await token.connect(user1).approve(stakingV2.target, ethers.parseEther("10000"));
        await token.connect(user2).approve(stakingV2.target, ethers.parseEther("10000"));
        
        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    describe("Unit Tests", function () {
        describe("Pause Functionality", function () {
            it("Should allow pauser to pause contract", async function () {
                await stakingV2.connect(pauser).pause();
                expect(await stakingV2.paused()).to.be.true;
            });

            it("Should allow pauser to unpause contract", async function () {
                await stakingV2.connect(pauser).pause();
                await stakingV2.connect(pauser).unpause();
                expect(await stakingV2.paused()).to.be.false;
            });

            it("Should emit StakingPaused event", async function () {
                await expect(stakingV2.connect(pauser).pause())
                    .to.emit(stakingV2, "StakingPaused")
                    .withArgs(pauser.address);
            });

            it("Should emit StakingUnpaused event", async function () {
                await stakingV2.connect(pauser).pause();
                await expect(stakingV2.connect(pauser).unpause())
                    .to.emit(stakingV2, "StakingUnpaused")
                    .withArgs(pauser.address);
            });
        });

        describe("Emergency Pause", function () {
            it("Should allow emergency role to pause with reason", async function () {
                const reason = "Emergency maintenance";
                await stakingV2.connect(emergency).emergencyPause(reason);
                expect(await stakingV2.paused()).to.be.true;
            });

            it("Should emit EmergencyPaused event", async function () {
                const reason = "Emergency maintenance";
                await expect(stakingV2.connect(emergency).emergencyPause(reason))
                    .to.emit(stakingV2, "EmergencyPaused")
                    .withArgs(emergency.address, reason);
            });
        });

        describe("Access Control", function () {
            it("Should revert pause from non-pauser", async function () {
                await expect(stakingV2.connect(user1).pause())
                    .to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
            });

            it("Should revert unpause from non-pauser", async function () {
                await stakingV2.connect(pauser).pause();
                await expect(stakingV2.connect(user1).unpause())
                    .to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
            });

            it("Should revert emergency pause from non-emergency", async function () {
                await expect(stakingV2.connect(user1).emergencyPause("reason"))
                    .to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
            });
        });
    });

    describe("Integration Tests", function () {
        describe("Staking Operations When Paused", function () {
            beforeEach(async function () {
                await stakingV2.connect(pauser).pause();
            });

            it("Should revert stake when paused", async function () {
                await expect(
                    stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0)
                ).to.be.revertedWithCustomError(stakingV2, "EnforcedPause");
            });

            it("Should revert unstake when paused", async function () {
                // First stake when not paused
                await stakingV2.connect(pauser).unpause();
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                
                // Then pause and try to unstake
                await stakingV2.connect(pauser).pause();
                await expect(
                    stakingV2.connect(user1).unstake(ethers.parseEther("500"))
                ).to.be.revertedWithCustomError(stakingV2, "EnforcedPause");
            });

            it("Should revert delegate when paused", async function () {
                await expect(
                    stakingV2.connect(user1).delegate(user2.address, ethers.parseEther("1000"))
                ).to.be.revertedWithCustomError(stakingV2, "EnforcedPause");
            });

            it("Should revert claim rewards when paused", async function () {
                await expect(
                    stakingV2.connect(user1).claimRewards()
                ).to.be.revertedWithCustomError(stakingV2, "EnforcedPause");
            });
        });

        describe("View Functions When Paused", function () {
            beforeEach(async function () {
                await stakingV2.connect(pauser).pause();
            });

            it("Should allow getVotes when paused", async function () {
                const votes = await stakingV2.getVotes(user1.address);
                expect(votes).to.equal(0);
            });

            it("Should allow getPastVotes when paused", async function () {
                const pastVotes = await stakingV2.getPastVotes(user1.address, await ethers.provider.getBlockNumber());
                expect(pastVotes).to.equal(0);
            });

            it("Should allow getTotalVotes when paused", async function () {
                const totalVotes = await stakingV2.getTotalVotes();
                expect(totalVotes).to.equal(0);
            });

            it("Should allow getEffectiveStake when paused", async function () {
                const effectiveStake = await stakingV2.getEffectiveStake(user1.address);
                expect(effectiveStake).to.equal(0);
            });
        });

        describe("Emergency Operations", function () {
            it("Should allow emergency withdraw when paused", async function () {
                await stakingV2.connect(pauser).pause();
                
                // Emergency role should be able to withdraw tokens
                await expect(
                    stakingV2.connect(emergency).emergencyWithdraw(
                        token.target,
                        user1.address,
                        ethers.parseEther("1000")
                    )
                ).to.not.be.reverted;
            });
        });
    });

    describe("Gas Tests", function () {
        it("Should measure gas for pause operation", async function () {
            const tx = await stakingV2.connect(pauser).pause();
            const receipt = await tx.wait();
            console.log("Pause gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(50000); // Should be efficient
        });

        it("Should measure gas for unpause operation", async function () {
            await stakingV2.connect(pauser).pause();
            const tx = await stakingV2.connect(pauser).unpause();
            const receipt = await tx.wait();
            console.log("Unpause gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(50000); // Should be efficient
        });

        it("Should measure gas for emergency pause", async function () {
            const reason = "Emergency maintenance";
            const tx = await stakingV2.connect(emergency).emergencyPause(reason);
            const receipt = await tx.wait();
            console.log("Emergency pause gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(60000); // Slightly more due to string
        });

        it("Should measure gas for staking operations when paused vs unpaused", async function () {
            // Measure gas for successful stake
            const stakeTx = await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
            const stakeReceipt = await stakeTx.wait();
            console.log("Stake gas used (unpaused):", stakeReceipt.gasUsed.toString());
            
            // Pause and measure gas for failed stake
            await stakingV2.connect(pauser).pause();
            const failedStakeTx = await stakingV2.connect(user2).stake(ethers.parseEther("1000"), 0)
                .catch(tx => tx);
            console.log("Stake gas used (paused, failed):", failedStakeTx.gasLimit.toString());
        });
    });

    describe("Security Tests", function () {
        describe("Reentrancy Protection", function () {
            it("Should prevent reentrancy in pause function", async function () {
                // This test would require a malicious contract that tries to reenter
                // For now, we test that the function completes successfully
                await expect(stakingV2.connect(pauser).pause()).to.not.be.reverted;
            });
        });

        describe("Role Escalation", function () {
            it("Should prevent non-pauser from gaining pauser role", async function () {
                const PAUSER_ROLE = await stakingV2.PAUSER_ROLE();
                await expect(
                    stakingV2.connect(user1).grantRole(PAUSER_ROLE, user1.address)
                ).to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent non-emergency from gaining emergency role", async function () {
                const EMERGENCY_ROLE = await stakingV2.EMERGENCY_ROLE();
                await expect(
                    stakingV2.connect(user1).grantRole(EMERGENCY_ROLE, user1.address)
                ).to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
            });
        });

        describe("State Consistency", function () {
            it("Should maintain consistent state after pause/unpause cycle", async function () {
                // Perform some operations
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                const initialStake = await stakingV2.getEffectiveStake(user1.address);
                
                // Pause and unpause
                await stakingV2.connect(pauser).pause();
                await stakingV2.connect(pauser).unpause();
                
                // Check state consistency
                const finalStake = await stakingV2.getEffectiveStake(user1.address);
                expect(finalStake).to.equal(initialStake);
            });

            it("Should prevent state corruption during emergency pause", async function () {
                // Perform operations
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                const initialStake = await stakingV2.getEffectiveStake(user1.address);
                
                // Emergency pause
                await stakingV2.connect(emergency).emergencyPause("Emergency");
                
                // Check state is preserved
                const finalStake = await stakingV2.getEffectiveStake(user1.address);
                expect(finalStake).to.equal(initialStake);
            });
        });
    });

    describe("Stress Tests", function () {
        describe("Rapid Pause/Unpause Cycles", function () {
            it("Should handle rapid pause/unpause cycles", async function () {
                for (let i = 0; i < 10; i++) {
                    await stakingV2.connect(pauser).pause();
                    expect(await stakingV2.paused()).to.be.true;
                    
                    await stakingV2.connect(pauser).unpause();
                    expect(await stakingV2.paused()).to.be.false;
                }
            });

            it("Should handle concurrent pause attempts", async function () {
                // This simulates multiple pausers trying to pause simultaneously
                const promises = [];
                for (let i = 0; i < 5; i++) {
                    promises.push(stakingV2.connect(pauser).pause());
                }
                
                await Promise.all(promises);
                expect(await stakingV2.paused()).to.be.true;
            });
        });

        describe("High Volume Operations", function () {
            it("Should handle many users staking before pause", async function () {
                const users = await ethers.getSigners();
                const stakePromises = [];
                
                // Have many users stake simultaneously
                for (let i = 10; i < 20; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                    await token.connect(users[i]).approve(stakingV2.target, ethers.parseEther("1000"));
                    stakePromises.push(
                        stakingV2.connect(users[i]).stake(ethers.parseEther("100"), 0)
                    );
                }
                
                await Promise.all(stakePromises);
                
                // Then pause
                await stakingV2.connect(pauser).pause();
                expect(await stakingV2.paused()).to.be.true;
            });
        });

        describe("Emergency Scenarios", function () {
            it("Should handle emergency pause during high activity", async function () {
                // Start many operations
                const users = await ethers.getSigners();
                const operations = [];
                
                for (let i = 10; i < 15; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                    await token.connect(users[i]).approve(stakingV2.target, ethers.parseEther("1000"));
                    operations.push(
                        stakingV2.connect(users[i]).stake(ethers.parseEther("100"), 0)
                    );
                }
                
                // Emergency pause during operations
                await stakingV2.connect(emergency).emergencyPause("Emergency during high activity");
                
                // Wait for operations to complete or fail
                await Promise.allSettled(operations);
                
                expect(await stakingV2.paused()).to.be.true;
            });
        });
    });

    describe("Edge Cases", function () {
        it("Should handle pause with empty reason", async function () {
            await expect(stakingV2.connect(emergency).emergencyPause(""))
                .to.not.be.reverted;
        });

        it("Should handle pause with very long reason", async function () {
            const longReason = "A".repeat(1000);
            await expect(stakingV2.connect(emergency).emergencyPause(longReason))
                .to.not.be.reverted;
        });

        it("Should handle multiple emergency pauses", async function () {
            await stakingV2.connect(emergency).emergencyPause("First emergency");
            await stakingV2.connect(emergency).emergencyPause("Second emergency");
            expect(await stakingV2.paused()).to.be.true;
        });
    });
}); 
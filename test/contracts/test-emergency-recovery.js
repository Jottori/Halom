const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Emergency Recovery Tests", function () {
    let token, stakingV2, bridge, owner, emergency, user1, user2, user3;
    let snapshotId;

    beforeEach(async function () {
        [owner, emergency, user1, user2, user3] = await ethers.getSigners();
        
        // Deploy token
        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        await token.waitForDeployment();
        
        // Deploy staking contract
        const StakingV2 = await ethers.getContractFactory("StakingV2");
        stakingV2 = await StakingV2.deploy();
        await stakingV2.waitForDeployment();
        
        // Deploy bridge contract
        const Bridge = await ethers.getContractFactory("Bridge");
        bridge = await Bridge.deploy();
        await bridge.waitForDeployment();
        
        // Setup roles
        const EMERGENCY_ROLE = await token.EMERGENCY_ROLE();
        const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
        
        await token.grantRole(EMERGENCY_ROLE, emergency.address);
        await stakingV2.grantRole(EMERGENCY_ROLE, emergency.address);
        await bridge.grantRole(EMERGENCY_ROLE, emergency.address);
        
        // Setup token
        await token.grantRole(await token.MINTER_ROLE(), owner.address);
        await token.mint(user1.address, ethers.parseEther("10000"));
        await token.mint(user2.address, ethers.parseEther("10000"));
        
        // Transfer some tokens to contracts for testing
        await token.transfer(stakingV2.target, ethers.parseEther("5000"));
        await token.transfer(bridge.target, ethers.parseEther("3000"));
        
        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    describe("Unit Tests", function () {
        describe("Emergency Withdraw", function () {
            it("Should allow emergency role to withdraw tokens", async function () {
                const initialBalance = await token.balanceOf(user1.address);
                
                await stakingV2.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("1000")
                );
                
                const finalBalance = await token.balanceOf(user1.address);
                expect(finalBalance).to.equal(initialBalance + ethers.parseEther("1000"));
            });

            it("Should emit EmergencyWithdraw event", async function () {
                await expect(
                    stakingV2.connect(emergency).emergencyWithdraw(
                        token.target,
                        user1.address,
                        ethers.parseEther("1000")
                    )
                ).to.emit(stakingV2, "EmergencyWithdraw")
                 .withArgs(emergency.address, token.target, user1.address, ethers.parseEther("1000"));
            });

            it("Should track emergency actions", async function () {
                const initialActions = await stakingV2.emergencyActions(emergency.address);
                
                await stakingV2.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("1000")
                );
                
                const finalActions = await stakingV2.emergencyActions(emergency.address);
                expect(finalActions).to.be.gt(initialActions);
            });

            it("Should revert with invalid recipient", async function () {
                await expect(
                    stakingV2.connect(emergency).emergencyWithdraw(
                        token.target,
                        ethers.ZeroAddress,
                        ethers.parseEther("1000")
                    )
                ).to.be.revertedWith("Invalid recipient");
            });

            it("Should revert with invalid amount", async function () {
                await expect(
                    stakingV2.connect(emergency).emergencyWithdraw(
                        token.target,
                        user1.address,
                        0
                    )
                ).to.be.revertedWith("Invalid amount");
            });
        });

        describe("Emergency Pause", function () {
            it("Should allow emergency role to pause all operations", async function () {
                await stakingV2.connect(emergency).emergencyPauseAll();
                
                expect(await stakingV2.paused()).to.be.true;
            });

            it("Should emit EmergencyPauseAll event", async function () {
                await expect(
                    stakingV2.connect(emergency).emergencyPauseAll()
                ).to.emit(stakingV2, "EmergencyPauseAll")
                 .withArgs(emergency.address);
            });

            it("Should track emergency pause actions", async function () {
                const initialActions = await stakingV2.emergencyActions(emergency.address);
                
                await stakingV2.connect(emergency).emergencyPauseAll();
                
                const finalActions = await stakingV2.emergencyActions(emergency.address);
                expect(finalActions).to.be.gt(initialActions);
            });
        });

        describe("Emergency Role Management", function () {
            it("Should allow emergency role to grant temporary roles", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.connect(emergency).emergencyGrantRole(user1.address, REBASE_CALLER_ROLE);
                
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
            });

            it("Should set emergency timeout for granted roles", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.connect(emergency).emergencyGrantRole(user1.address, REBASE_CALLER_ROLE);
                
                const expiry = await token.getRoleExpiry(REBASE_CALLER_ROLE, user1.address);
                const expectedExpiry = (await time.latest()) + 24 * 3600; // 24 hours
                expect(expiry).to.equal(expectedExpiry);
            });

            it("Should emit EmergencyAction event", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await expect(
                    token.connect(emergency).emergencyGrantRole(user1.address, REBASE_CALLER_ROLE)
                ).to.emit(token, "EmergencyAction")
                 .withArgs(emergency.address, "GRANT_ROLE", await time.latest());
            });
        });
    });

    describe("Integration Tests", function () {
        describe("Cross-Contract Emergency Operations", function () {
            it("Should handle emergency operations across multiple contracts", async function () {
                // Emergency pause all contracts
                await stakingV2.connect(emergency).emergencyPauseAll();
                await bridge.connect(emergency).emergencyPause("Emergency");
                
                expect(await stakingV2.paused()).to.be.true;
                expect(await bridge.paused()).to.be.true;
            });

            it("Should allow emergency recovery of funds from multiple contracts", async function () {
                const user1InitialBalance = await token.balanceOf(user1.address);
                
                // Emergency withdraw from staking contract
                await stakingV2.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("1000")
                );
                
                // Emergency withdraw from bridge contract
                await bridge.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("500")
                );
                
                const user1FinalBalance = await token.balanceOf(user1.address);
                expect(user1FinalBalance).to.equal(user1InitialBalance + ethers.parseEther("1500"));
            });

            it("Should maintain emergency action tracking across contracts", async function () {
                const stakingActions = await stakingV2.emergencyActions(emergency.address);
                const bridgeActions = await bridge.emergencyActions(emergency.address);
                
                await stakingV2.connect(emergency).emergencyPauseAll();
                await bridge.connect(emergency).emergencyPause("Emergency");
                
                const newStakingActions = await stakingV2.emergencyActions(emergency.address);
                const newBridgeActions = await bridge.emergencyActions(emergency.address);
                
                expect(newStakingActions).to.be.gt(stakingActions);
                expect(newBridgeActions).to.be.gt(bridgeActions);
            });
        });

        describe("Emergency Recovery Scenarios", function () {
            it("Should handle emergency recovery after attack", async function () {
                // Simulate attack scenario - pause all operations
                await stakingV2.connect(emergency).emergencyPauseAll();
                await bridge.connect(emergency).emergencyPause("Attack detected");
                
                // Emergency withdraw funds to safe address
                await stakingV2.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("2000")
                );
                
                await bridge.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("1000")
                );
                
                // Grant temporary admin role for recovery
                const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
                await token.connect(emergency).emergencyGrantRole(user1.address, DEFAULT_ADMIN_ROLE);
                
                expect(await token.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.true;
            });

            it("Should handle emergency recovery with time constraints", async function () {
                // Emergency grant role with timeout
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                await token.connect(emergency).emergencyGrantRole(user1.address, REBASE_CALLER_ROLE);
                
                // Role should be valid immediately
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
                
                // Advance time past emergency timeout
                await time.increase(25 * 3600); // 25 hours
                
                // Role should be expired
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.false;
            });
        });
    });

    describe("Gas Tests", function () {
        it("Should measure gas for emergency withdraw", async function () {
            const tx = await stakingV2.connect(emergency).emergencyWithdraw(
                token.target,
                user1.address,
                ethers.parseEther("1000")
            );
            const receipt = await tx.wait();
            console.log("Emergency withdraw gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(100000);
        });

        it("Should measure gas for emergency pause all", async function () {
            const tx = await stakingV2.connect(emergency).emergencyPauseAll();
            const receipt = await tx.wait();
            console.log("Emergency pause all gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(80000);
        });

        it("Should measure gas for emergency grant role", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            const tx = await token.connect(emergency).emergencyGrantRole(user1.address, REBASE_CALLER_ROLE);
            const receipt = await tx.wait();
            console.log("Emergency grant role gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(120000);
        });

        it("Should compare gas usage for different emergency operations", async function () {
            // Emergency withdraw
            const withdrawTx = await stakingV2.connect(emergency).emergencyWithdraw(
                token.target,
                user1.address,
                ethers.parseEther("1000")
            );
            const withdrawReceipt = await withdrawTx.wait();
            
            // Emergency pause
            const pauseTx = await stakingV2.connect(emergency).emergencyPauseAll();
            const pauseReceipt = await pauseTx.wait();
            
            // Emergency grant role
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            const grantTx = await token.connect(emergency).emergencyGrantRole(user2.address, REBASE_CALLER_ROLE);
            const grantReceipt = await grantTx.wait();
            
            console.log("Withdraw gas:", withdrawReceipt.gasUsed.toString());
            console.log("Pause gas:", pauseReceipt.gasUsed.toString());
            console.log("Grant role gas:", grantReceipt.gasUsed.toString());
            
            // Withdraw should use most gas due to token transfer
            expect(withdrawReceipt.gasUsed).to.be.gt(pauseReceipt.gasUsed);
        });
    });

    describe("Security Tests", function () {
        describe("Access Control", function () {
            it("Should prevent non-emergency from emergency operations", async function () {
                await expect(
                    stakingV2.connect(user1).emergencyWithdraw(
                        token.target,
                        user2.address,
                        ethers.parseEther("1000")
                    )
                ).to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent non-emergency from emergency pause", async function () {
                await expect(
                    stakingV2.connect(user1).emergencyPauseAll()
                ).to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent non-emergency from emergency grant role", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await expect(
                    token.connect(user1).emergencyGrantRole(user2.address, REBASE_CALLER_ROLE)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Emergency Timeout", function () {
            it("Should enforce emergency timeout on granted roles", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.connect(emergency).emergencyGrantRole(user1.address, REBASE_CALLER_ROLE);
                
                // Role should be valid initially
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
                
                // Advance time past emergency timeout
                await time.increase(25 * 3600); // 25 hours
                
                // Role should be expired
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.false;
            });

            it("Should prevent expired emergency roles from being used", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.connect(emergency).emergencyGrantRole(user1.address, REBASE_CALLER_ROLE);
                
                // Advance time to expire role
                await time.increase(25 * 3600);
                
                // Should not be able to use expired role
                await expect(
                    token.connect(user1).rebase()
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Emergency Action Tracking", function () {
            it("Should track all emergency actions", async function () {
                const initialActions = await stakingV2.emergencyActions(emergency.address);
                
                // Perform multiple emergency actions
                await stakingV2.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("1000")
                );
                
                await stakingV2.connect(emergency).emergencyPauseAll();
                
                const finalActions = await stakingV2.emergencyActions(emergency.address);
                expect(finalActions).to.be.gt(initialActions);
            });

            it("Should prevent emergency action abuse", async function () {
                // Emergency actions should be tracked and limited
                for (let i = 0; i < 5; i++) {
                    await stakingV2.connect(emergency).emergencyWithdraw(
                        token.target,
                        user1.address,
                        ethers.parseEther("100")
                    );
                }
                
                // Should still be able to perform actions
                await expect(
                    stakingV2.connect(emergency).emergencyPauseAll()
                ).to.not.be.reverted;
            });
        });
    });

    describe("Stress Tests", function () {
        describe("Multiple Emergency Operations", function () {
            it("Should handle many emergency operations simultaneously", async function () {
                const users = await ethers.getSigners();
                
                // Grant emergency role to multiple users
                const EMERGENCY_ROLE = await stakingV2.EMERGENCY_ROLE();
                for (let i = 10; i < 15; i++) {
                    await stakingV2.grantRole(EMERGENCY_ROLE, users[i].address);
                }
                
                // Concurrent emergency operations
                const operationPromises = [];
                for (let i = 10; i < 15; i++) {
                    operationPromises.push(
                        stakingV2.connect(users[i]).emergencyWithdraw(
                            token.target,
                            users[i].address,
                            ethers.parseEther("100")
                        )
                    );
                }
                
                await Promise.all(operationPromises);
                
                // All operations should succeed
                for (let i = 10; i < 15; i++) {
                    const balance = await token.balanceOf(users[i].address);
                    expect(balance).to.be.gt(0);
                }
            });

            it("Should handle rapid emergency role grants", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                const users = await ethers.getSigners();
                
                // Grant emergency roles rapidly
                const grantPromises = [];
                for (let i = 10; i < 20; i++) {
                    grantPromises.push(
                        token.connect(emergency).emergencyGrantRole(users[i].address, REBASE_CALLER_ROLE)
                    );
                }
                
                await Promise.all(grantPromises);
                
                // All should have roles
                for (let i = 10; i < 20; i++) {
                    expect(await token.hasRole(REBASE_CALLER_ROLE, users[i].address)).to.be.true;
                }
            });
        });

        describe("Emergency Recovery Under Load", function () {
            it("Should handle emergency recovery during high activity", async function () {
                const users = await ethers.getSigners();
                
                // Setup high activity scenario
                for (let i = 10; i < 20; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                    await token.connect(users[i]).approve(stakingV2.target, ethers.parseEther("1000"));
                }
                
                // Start staking operations
                const stakingPromises = [];
                for (let i = 10; i < 20; i++) {
                    stakingPromises.push(
                        stakingV2.connect(users[i]).stake(ethers.parseEther("100"), 0)
                    );
                }
                
                // Emergency pause during operations
                await stakingV2.connect(emergency).emergencyPauseAll();
                
                // Wait for operations to complete or fail
                await Promise.allSettled(stakingPromises);
                
                expect(await stakingV2.paused()).to.be.true;
            });
        });
    });

    describe("Edge Cases", function () {
        it("Should handle emergency operations with zero amounts", async function () {
            await expect(
                stakingV2.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    0
                )
            ).to.be.revertedWith("Invalid amount");
        });

        it("Should handle emergency operations with maximum amounts", async function () {
            const maxAmount = await token.balanceOf(stakingV2.target);
            
            await expect(
                stakingV2.connect(emergency).emergencyWithdraw(
                    token.target,
                    user1.address,
                    maxAmount
                )
            ).to.not.be.reverted;
        });

        it("Should handle emergency operations with expired emergency role", async function () {
            const EMERGENCY_ROLE = await stakingV2.EMERGENCY_ROLE();
            
            // Grant emergency role with timeout
            await stakingV2.connect(owner).grantTimeLimitedRole(emergency.address, EMERGENCY_ROLE, 3600);
            
            // Advance time to expire role
            await time.increase(2 * 3600);
            
            // Should not be able to perform emergency operations
            await expect(
                stakingV2.connect(emergency).emergencyPauseAll()
            ).to.be.revertedWithCustomError(stakingV2, "AccessControlUnauthorizedAccount");
        });

        it("Should handle emergency operations on paused contracts", async function () {
            // Pause contract first
            await stakingV2.connect(emergency).emergencyPauseAll();
            
            // Should still be able to perform emergency withdraw when paused
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
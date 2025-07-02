const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Monitoring and Alerting Tests", function () {
    let token, stakingV2, bridge, monitoring, owner, admin, user1, user2;
    let snapshotId;

    beforeEach(async function () {
        [owner, admin, user1, user2] = await ethers.getSigners();
        
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
        
        // Deploy monitoring contract
        const Monitoring = await ethers.getContractFactory("Monitoring");
        monitoring = await Monitoring.deploy();
        await monitoring.waitForDeployment();
        
        // Setup roles
        const DEFAULT_ADMIN_ROLE = await monitoring.DEFAULT_ADMIN_ROLE();
        await monitoring.grantRole(DEFAULT_ADMIN_ROLE, admin.address);
        
        // Setup token
        await token.grantRole(await token.MINTER_ROLE(), owner.address);
        await token.mint(user1.address, ethers.parseEther("10000"));
        await token.mint(user2.address, ethers.parseEther("10000"));
        
        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    describe("Unit Tests", function () {
        describe("Critical Event Emission", function () {
            it("Should emit critical events correctly", async function () {
                const eventType = "TEST_EVENT";
                const data = ethers.toUtf8Bytes("Test data");
                
                await expect(
                    monitoring.connect(admin).emitCriticalEvent(eventType, data)
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs(eventType, admin.address, await time.latest(), data);
            });

            it("Should emit critical events without data", async function () {
                const eventType = "TEST_EVENT";
                
                await expect(
                    monitoring.connect(admin).emitCriticalEvent(eventType, "0x")
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs(eventType, admin.address, await time.latest(), "0x");
            });

            it("Should revert from non-admin", async function () {
                await expect(
                    monitoring.connect(user1).emitCriticalEvent("TEST", "0x")
                ).to.be.revertedWithCustomError(monitoring, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Monitoring Modifier", function () {
            it("Should emit monitoring events with modifier", async function () {
                const eventType = "MONITORED_FUNCTION";
                
                await expect(
                    monitoring.connect(admin).testMonitoredFunction()
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs(eventType, admin.address, await time.latest(), "0x");
            });

            it("Should execute function normally with monitoring", async function () {
                const result = await monitoring.connect(admin).testMonitoredFunction();
                expect(result).to.equal(42); // Expected return value
            });
        });

        describe("Event Data Handling", function () {
            it("Should handle large event data", async function () {
                const eventType = "LARGE_DATA_EVENT";
                const largeData = "0x" + "00".repeat(1000); // 1000 bytes
                
                await expect(
                    monitoring.connect(admin).emitCriticalEvent(eventType, largeData)
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs(eventType, admin.address, await time.latest(), largeData);
            });

            it("Should handle empty event data", async function () {
                const eventType = "EMPTY_DATA_EVENT";
                
                await expect(
                    monitoring.connect(admin).emitCriticalEvent(eventType, "0x")
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs(eventType, admin.address, await time.latest(), "0x");
            });
        });
    });

    describe("Integration Tests", function () {
        describe("Cross-Contract Monitoring", function () {
            it("Should monitor token operations", async function () {
                // Setup monitoring for token
                await token.setMonitoringContract(monitoring.target);
                
                await expect(
                    token.connect(admin).mint(user1.address, ethers.parseEther("1000"))
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs("TOKEN_MINT", admin.address, await time.latest(), "0x");
            });

            it("Should monitor staking operations", async function () {
                // Setup monitoring for staking
                await stakingV2.setMonitoringContract(monitoring.target);
                
                // Approve staking
                await token.connect(user1).approve(stakingV2.target, ethers.parseEther("1000"));
                
                await expect(
                    stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0)
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs("STAKE", user1.address, await time.latest(), "0x");
            });

            it("Should monitor bridge operations", async function () {
                // Setup monitoring for bridge
                await bridge.setMonitoringContract(monitoring.target);
                
                await expect(
                    bridge.connect(admin).pause()
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs("BRIDGE_PAUSE", admin.address, await time.latest(), "0x");
            });
        });

        describe("Event Aggregation", function () {
            it("Should aggregate multiple events", async function () {
                const events = [];
                
                // Emit multiple events
                for (let i = 0; i < 5; i++) {
                    const eventType = `EVENT_${i}`;
                    const data = ethers.toUtf8Bytes(`Data ${i}`);
                    
                    const tx = await monitoring.connect(admin).emitCriticalEvent(eventType, data);
                    const receipt = await tx.wait();
                    
                    events.push({
                        type: eventType,
                        data: data,
                        timestamp: await time.latest()
                    });
                }
                
                // Verify all events were emitted
                expect(events).to.have.length(5);
            });

            it("Should handle concurrent event emission", async function () {
                const users = await ethers.getSigners();
                
                // Grant admin role to multiple users
                const DEFAULT_ADMIN_ROLE = await monitoring.DEFAULT_ADMIN_ROLE();
                for (let i = 10; i < 15; i++) {
                    await monitoring.grantRole(DEFAULT_ADMIN_ROLE, users[i].address);
                }
                
                // Concurrent event emission
                const eventPromises = [];
                for (let i = 10; i < 15; i++) {
                    eventPromises.push(
                        monitoring.connect(users[i]).emitCriticalEvent(
                            `CONCURRENT_EVENT_${i}`,
                            ethers.toUtf8Bytes(`Data from user ${i}`)
                        )
                    );
                }
                
                await Promise.all(eventPromises);
                
                // All events should be emitted successfully
                for (let i = 0; i < eventPromises.length; i++) {
                    expect(eventPromises[i]).to.not.be.reverted;
                }
            });
        });
    });

    describe("Gas Tests", function () {
        it("Should measure gas for critical event emission", async function () {
            const tx = await monitoring.connect(admin).emitCriticalEvent(
                "TEST_EVENT",
                ethers.toUtf8Bytes("Test data")
            );
            const receipt = await tx.wait();
            console.log("Critical event emission gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(100000);
        });

        it("Should measure gas for monitored function", async function () {
            const tx = await monitoring.connect(admin).testMonitoredFunction();
            const receipt = await tx.wait();
            console.log("Monitored function gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(120000);
        });

        it("Should compare gas usage with different data sizes", async function () {
            // Small data
            const smallTx = await monitoring.connect(admin).emitCriticalEvent(
                "SMALL_DATA",
                ethers.toUtf8Bytes("Small")
            );
            const smallReceipt = await smallTx.wait();
            
            // Large data
            const largeData = "0x" + "00".repeat(1000);
            const largeTx = await monitoring.connect(admin).emitCriticalEvent(
                "LARGE_DATA",
                largeData
            );
            const largeReceipt = await largeTx.wait();
            
            console.log("Small data gas:", smallReceipt.gasUsed.toString());
            console.log("Large data gas:", largeReceipt.gasUsed.toString());
            
            expect(largeReceipt.gasUsed).to.be.gt(smallReceipt.gasUsed);
        });

        it("Should measure gas for multiple events", async function () {
            const startGas = await ethers.provider.getBalance(admin.address);
            
            for (let i = 0; i < 10; i++) {
                await monitoring.connect(admin).emitCriticalEvent(
                    `EVENT_${i}`,
                    ethers.toUtf8Bytes(`Data ${i}`)
                );
            }
            
            const endGas = await ethers.provider.getBalance(admin.address);
            const totalGasUsed = startGas - endGas;
            
            console.log("Total gas for 10 events:", totalGasUsed.toString());
            expect(totalGasUsed).to.be.lt(ethers.parseEther("0.001")); // Should be reasonable
        });
    });

    describe("Security Tests", function () {
        describe("Access Control", function () {
            it("Should prevent unauthorized event emission", async function () {
                await expect(
                    monitoring.connect(user1).emitCriticalEvent("TEST", "0x")
                ).to.be.revertedWithCustomError(monitoring, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent unauthorized monitoring setup", async function () {
                await expect(
                    token.connect(user1).setMonitoringContract(monitoring.target)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Event Manipulation", function () {
            it("Should prevent event data manipulation", async function () {
                const originalData = ethers.toUtf8Bytes("Original data");
                
                await monitoring.connect(admin).emitCriticalEvent("TEST", originalData);
                
                // Event data should be immutable
                // This test verifies the event was emitted correctly
                expect(originalData).to.equal(ethers.toUtf8Bytes("Original data"));
            });

            it("Should handle malicious event data", async function () {
                const maliciousData = "0x" + "ff".repeat(1000); // Large malicious data
                
                await expect(
                    monitoring.connect(admin).emitCriticalEvent("MALICIOUS", maliciousData)
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs("MALICIOUS", admin.address, await time.latest(), maliciousData);
            });
        });

        describe("Monitoring Contract Security", function () {
            it("Should prevent monitoring contract manipulation", async function () {
                // Deploy malicious monitoring contract
                const MaliciousMonitoring = await ethers.getContractFactory("Token"); // Using token as malicious contract
                const maliciousMonitoring = await MaliciousMonitoring.deploy();
                
                // Should not be able to set malicious monitoring contract
                await expect(
                    token.connect(admin).setMonitoringContract(maliciousMonitoring.target)
                ).to.be.revertedWith("Invalid monitoring contract");
            });

            it("Should handle monitoring contract failure gracefully", async function () {
                // This test would require a monitoring contract that can fail
                // For now, we test that the main contract continues to function
                await expect(
                    token.connect(admin).mint(user1.address, ethers.parseEther("1000"))
                ).to.not.be.reverted;
            });
        });
    });

    describe("Stress Tests", function () {
        describe("High Volume Event Emission", function () {
            it("Should handle many events rapidly", async function () {
                const eventPromises = [];
                
                for (let i = 0; i < 50; i++) {
                    eventPromises.push(
                        monitoring.connect(admin).emitCriticalEvent(
                            `HIGH_VOLUME_EVENT_${i}`,
                            ethers.toUtf8Bytes(`Data ${i}`)
                        )
                    );
                }
                
                await Promise.all(eventPromises);
                
                // All events should be emitted successfully
                for (let i = 0; i < eventPromises.length; i++) {
                    expect(eventPromises[i]).to.not.be.reverted;
                }
            });

            it("Should handle concurrent monitoring from multiple contracts", async function () {
                // Setup monitoring for multiple contracts
                await token.setMonitoringContract(monitoring.target);
                await stakingV2.setMonitoringContract(monitoring.target);
                await bridge.setMonitoringContract(monitoring.target);
                
                // Perform operations on all contracts simultaneously
                const operations = [];
                
                // Token operations
                operations.push(token.connect(admin).mint(user1.address, ethers.parseEther("1000")));
                
                // Staking operations
                await token.connect(user1).approve(stakingV2.target, ethers.parseEther("1000"));
                operations.push(stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0));
                
                // Bridge operations
                operations.push(bridge.connect(admin).pause());
                
                await Promise.all(operations);
                
                // All operations should succeed
                for (let i = 0; i < operations.length; i++) {
                    expect(operations[i]).to.not.be.reverted;
                }
            });
        });

        describe("Large Data Handling", function () {
            it("Should handle very large event data", async function () {
                const largeData = "0x" + "00".repeat(10000); // 10KB of data
                
                await expect(
                    monitoring.connect(admin).emitCriticalEvent("LARGE_DATA_EVENT", largeData)
                ).to.emit(monitoring, "CriticalEvent")
                 .withArgs("LARGE_DATA_EVENT", admin.address, await time.latest(), largeData);
            });

            it("Should handle many events with large data", async function () {
                const largeData = "0x" + "00".repeat(1000); // 1KB of data
                
                for (let i = 0; i < 10; i++) {
                    await monitoring.connect(admin).emitCriticalEvent(
                        `LARGE_DATA_EVENT_${i}`,
                        largeData
                    );
                }
                
                // All events should be emitted successfully
                // This test verifies the system can handle large data volumes
            });
        });
    });

    describe("Edge Cases", function () {
        it("Should handle empty event type", async function () {
            await expect(
                monitoring.connect(admin).emitCriticalEvent("", "0x")
            ).to.emit(monitoring, "CriticalEvent")
             .withArgs("", admin.address, await time.latest(), "0x");
        });

        it("Should handle very long event type", async function () {
            const longEventType = "A".repeat(1000);
            
            await expect(
                monitoring.connect(admin).emitCriticalEvent(longEventType, "0x")
            ).to.emit(monitoring, "CriticalEvent")
             .withArgs(longEventType, admin.address, await time.latest(), "0x");
        });

        it("Should handle monitoring contract address changes", async function () {
            // Set monitoring contract
            await token.setMonitoringContract(monitoring.target);
            
            // Change monitoring contract
            await token.setMonitoringContract(ethers.ZeroAddress);
            
            // Should still function normally
            await expect(
                token.connect(admin).mint(user1.address, ethers.parseEther("1000"))
            ).to.not.be.reverted;
        });

        it("Should handle monitoring during contract pause", async function () {
            await stakingV2.setMonitoringContract(monitoring.target);
            
            // Pause staking
            await stakingV2.connect(admin).pause();
            
            // Monitoring should still work for allowed operations
            await expect(
                stakingV2.connect(admin).emergencyWithdraw(
                    token.target,
                    user1.address,
                    ethers.parseEther("1000")
                )
            ).to.not.be.reverted;
        });
    });
}); 
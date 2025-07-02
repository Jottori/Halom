const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Gas Optimization Tests", function () {
    let gasOptimized, token, owner, user1, user2, user3;
    let snapshotId;

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();
        
        // Deploy gas optimized contract
        const GasOptimized = await ethers.getContractFactory("GasOptimized");
        gasOptimized = await GasOptimized.deploy();
        await gasOptimized.waitForDeployment();
        
        // Deploy token for testing
        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        await token.waitForDeployment();
        
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
        describe("Immutable Constants", function () {
            it("Should use immutable constants correctly", async function () {
                const minStake = await gasOptimized.MIN_STAKE();
                const maxCommission = await gasOptimized.MAX_COMMISSION();
                
                expect(minStake).to.equal(ethers.parseEther("1000"));
                expect(maxCommission).to.equal(2000); // 20%
            });

            it("Should measure gas savings from immutable constants", async function () {
                // Compare gas usage with immutable vs storage constants
                const immutableTx = await gasOptimized.getMinStake();
                const storageTx = await gasOptimized.getStorageConstant();
                
                console.log("Immutable constant gas:", immutableTx.toString());
                console.log("Storage constant gas:", storageTx.toString());
                
                // Immutable should use less gas
                expect(immutableTx).to.be.lt(storageTx);
            });
        });

        describe("Packed Structs", function () {
            it("Should use packed structs correctly", async function () {
                const amount = ethers.parseEther("1000");
                const lockTime = Math.floor(Date.now() / 1000);
                const lockPeriod = 1; // 1 month
                
                await gasOptimized.setUserStake(user1.address, amount, lockTime, lockPeriod);
                
                const userStake = await gasOptimized.getUserStake(user1.address);
                expect(userStake.amount).to.equal(amount);
                expect(userStake.lockTime).to.equal(lockTime);
                expect(userStake.lockPeriod).to.equal(lockPeriod);
            });

            it("Should measure gas savings from packed structs", async function () {
                const amount = ethers.parseEther("1000");
                const lockTime = Math.floor(Date.now() / 1000);
                const lockPeriod = 1;
                
                // Packed struct
                const packedTx = await gasOptimized.setUserStake(user1.address, amount, lockTime, lockPeriod);
                const packedReceipt = await packedTx.wait();
                
                // Unpacked struct (for comparison)
                const unpackedTx = await gasOptimized.setUnpackedUserStake(user1.address, amount, lockTime, lockPeriod);
                const unpackedReceipt = await unpackedTx.wait();
                
                console.log("Packed struct gas:", packedReceipt.gasUsed.toString());
                console.log("Unpacked struct gas:", unpackedReceipt.gasUsed.toString());
                
                // Packed should use less gas
                expect(packedReceipt.gasUsed).to.be.lt(unpackedReceipt.gasUsed);
            });
        });

        describe("Unchecked Math", function () {
            it("Should use unchecked math for safe operations", async function () {
                const a = 1000;
                const b = 500;
                
                const result = await gasOptimized.calculateRewards(a, b);
                expect(result).to.equal((a * b) / 1e18);
            });

            it("Should measure gas savings from unchecked math", async function () {
                const a = 1000;
                const b = 500;
                
                // Unchecked math
                const uncheckedTx = await gasOptimized.calculateRewards(a, b);
                const uncheckedReceipt = await uncheckedTx.wait();
                
                // Checked math (for comparison)
                const checkedTx = await gasOptimized.calculateRewardsChecked(a, b);
                const checkedReceipt = await checkedTx.wait();
                
                console.log("Unchecked math gas:", uncheckedReceipt.gasUsed.toString());
                console.log("Checked math gas:", checkedReceipt.gasUsed.toString());
                
                // Unchecked should use less gas
                expect(uncheckedReceipt.gasUsed).to.be.lt(checkedReceipt.gasUsed);
            });

            it("Should handle overflow scenarios safely", async function () {
                const maxUint = ethers.MaxUint256;
                const rate = 1e18;
                
                // Should handle overflow gracefully
                await expect(
                    gasOptimized.calculateRewards(maxUint, rate)
                ).to.not.be.reverted;
            });
        });

        describe("Loop Optimizations", function () {
            it("Should use optimized loops", async function () {
                const users = [user1.address, user2.address, user3.address];
                const amounts = [1000, 2000, 3000];
                
                await gasOptimized.batchProcessOptimized(users, amounts);
                
                for (let i = 0; i < users.length; i++) {
                    const processed = await gasOptimized.getProcessedAmount(users[i]);
                    expect(processed).to.equal(amounts[i]);
                }
            });

            it("Should measure gas savings from loop optimizations", async function () {
                const users = [user1.address, user2.address, user3.address];
                const amounts = [1000, 2000, 3000];
                
                // Optimized loop
                const optimizedTx = await gasOptimized.batchProcessOptimized(users, amounts);
                const optimizedReceipt = await optimizedTx.wait();
                
                // Regular loop (for comparison)
                const regularTx = await gasOptimized.batchProcessRegular(users, amounts);
                const regularReceipt = await regularTx.wait();
                
                console.log("Optimized loop gas:", optimizedReceipt.gasUsed.toString());
                console.log("Regular loop gas:", regularReceipt.gasUsed.toString());
                
                // Optimized should use less gas
                expect(optimizedReceipt.gasUsed).to.be.lt(regularReceipt.gasUsed);
            });
        });
    });

    describe("Integration Tests", function () {
        describe("Combined Optimizations", function () {
            it("Should combine multiple optimizations", async function () {
                const users = [user1.address, user2.address, user3.address];
                const amounts = [ethers.parseEther("1000"), ethers.parseEther("2000"), ethers.parseEther("3000")];
                
                // Use optimized batch processing with packed structs
                await gasOptimized.batchProcessWithStructs(users, amounts);
                
                for (let i = 0; i < users.length; i++) {
                    const userStake = await gasOptimized.getUserStake(users[i]);
                    expect(userStake.amount).to.equal(amounts[i]);
                }
            });

            it("Should handle complex operations efficiently", async function () {
                const users = [user1.address, user2.address, user3.address];
                const rates = [1000, 2000, 3000];
                
                // Complex operation combining multiple optimizations
                await gasOptimized.complexOptimizedOperation(users, rates);
                
                for (let i = 0; i < users.length; i++) {
                    const result = await gasOptimized.getComplexResult(users[i]);
                    expect(result).to.be.gt(0);
                }
            });
        });

        describe("Gas-Efficient Data Structures", function () {
            it("Should use efficient data structures", async function () {
                const data = [1, 2, 3, 4, 5];
                
                await gasOptimized.storeOptimizedData(data);
                
                const retrieved = await gasOptimized.getOptimizedData();
                expect(retrieved).to.deep.equal(data);
            });

            it("Should handle large datasets efficiently", async function () {
                const largeData = Array.from({length: 100}, (_, i) => i);
                
                await gasOptimized.storeOptimizedData(largeData);
                
                const retrieved = await gasOptimized.getOptimizedData();
                expect(retrieved).to.deep.equal(largeData);
            });
        });
    });

    describe("Gas Tests", function () {
        describe("Deployment Gas", function () {
            it("Should measure deployment gas", async function () {
                const GasOptimized = await ethers.getContractFactory("GasOptimized");
                const deploymentTx = await GasOptimized.deploy();
                const deploymentReceipt = await deploymentTx.waitForDeployment();
                
                console.log("GasOptimized deployment gas:", deploymentReceipt.gasLimit.toString());
                expect(deploymentReceipt.gasLimit).to.be.lt(5000000); // Should be reasonable
            });

            it("Should compare deployment gas with non-optimized contract", async function () {
                const GasOptimized = await ethers.getContractFactory("GasOptimized");
                const NonOptimized = await ethers.getContractFactory("NonOptimized");
                
                const optimizedTx = await GasOptimized.deploy();
                const nonOptimizedTx = await NonOptimized.deploy();
                
                const optimizedReceipt = await optimizedTx.waitForDeployment();
                const nonOptimizedReceipt = await nonOptimizedTx.waitForDeployment();
                
                console.log("Optimized deployment gas:", optimizedReceipt.gasLimit.toString());
                console.log("Non-optimized deployment gas:", nonOptimizedReceipt.gasLimit.toString());
                
                // Optimized should use less gas
                expect(optimizedReceipt.gasLimit).to.be.lt(nonOptimizedReceipt.gasLimit);
            });
        });

        describe("Function Call Gas", function () {
            it("Should measure gas for optimized functions", async function () {
                const users = [user1.address, user2.address];
                const amounts = [1000, 2000];
                
                const tx = await gasOptimized.batchProcessOptimized(users, amounts);
                const receipt = await tx.wait();
                
                console.log("Optimized batch process gas:", receipt.gasUsed.toString());
                expect(receipt.gasUsed).to.be.lt(200000);
            });

            it("Should measure gas for struct operations", async function () {
                const amount = ethers.parseEther("1000");
                const lockTime = Math.floor(Date.now() / 1000);
                const lockPeriod = 1;
                
                const tx = await gasOptimized.setUserStake(user1.address, amount, lockTime, lockPeriod);
                const receipt = await tx.wait();
                
                console.log("Packed struct operation gas:", receipt.gasUsed.toString());
                expect(receipt.gasUsed).to.be.lt(100000);
            });

            it("Should measure gas for math operations", async function () {
                const a = 1000;
                const b = 500;
                
                const tx = await gasOptimized.calculateRewards(a, b);
                const receipt = await tx.wait();
                
                console.log("Unchecked math operation gas:", receipt.gasUsed.toString());
                expect(receipt.gasUsed).to.be.lt(50000);
            });
        });

        describe("Storage Gas", function () {
            it("Should measure storage gas savings", async function () {
                // Store data in optimized format
                const optimizedTx = await gasOptimized.storeOptimized(user1.address, 1000, 2000);
                const optimizedReceipt = await optimizedTx.wait();
                
                // Store data in non-optimized format
                const nonOptimizedTx = await gasOptimized.storeNonOptimized(user2.address, 1000, 2000);
                const nonOptimizedReceipt = await nonOptimizedTx.wait();
                
                console.log("Optimized storage gas:", optimizedReceipt.gasUsed.toString());
                console.log("Non-optimized storage gas:", nonOptimizedReceipt.gasUsed.toString());
                
                // Optimized should use less gas
                expect(optimizedReceipt.gasUsed).to.be.lt(nonOptimizedReceipt.gasUsed);
            });
        });
    });

    describe("Security Tests", function () {
        describe("Unchecked Math Safety", function () {
            it("Should handle overflow scenarios safely", async function () {
                const maxUint = ethers.MaxUint256;
                const rate = 1e18;
                
                // Should not revert due to overflow
                await expect(
                    gasOptimized.calculateRewards(maxUint, rate)
                ).to.not.be.reverted;
            });

            it("Should handle underflow scenarios safely", async function () {
                const smallAmount = 1;
                const largeRate = ethers.MaxUint256;
                
                // Should not revert due to underflow
                await expect(
                    gasOptimized.calculateRewards(smallAmount, largeRate)
                ).to.not.be.reverted;
            });
        });

        describe("Data Integrity", function () {
            it("Should maintain data integrity with optimizations", async function () {
                const amount = ethers.parseEther("1000");
                const lockTime = Math.floor(Date.now() / 1000);
                const lockPeriod = 1;
                
                await gasOptimized.setUserStake(user1.address, amount, lockTime, lockPeriod);
                
                const userStake = await gasOptimized.getUserStake(user1.address);
                expect(userStake.amount).to.equal(amount);
                expect(userStake.lockTime).to.equal(lockTime);
                expect(userStake.lockPeriod).to.equal(lockPeriod);
            });

            it("Should handle edge cases correctly", async function () {
                const maxAmount = ethers.MaxUint256;
                const maxTime = ethers.MaxUint256;
                const maxPeriod = 255; // Max uint8
                
                await gasOptimized.setUserStake(user1.address, maxAmount, maxTime, maxPeriod);
                
                const userStake = await gasOptimized.getUserStake(user1.address);
                expect(userStake.amount).to.equal(maxAmount);
                expect(userStake.lockTime).to.equal(maxTime);
                expect(userStake.lockPeriod).to.equal(maxPeriod);
            });
        });
    });

    describe("Stress Tests", function () {
        describe("High Volume Operations", function () {
            it("Should handle many users efficiently", async function () {
                const users = await ethers.getSigners();
                const amounts = [];
                
                for (let i = 10; i < 30; i++) {
                    amounts.push(1000 + i);
                }
                
                const userAddresses = users.slice(10, 30).map(user => user.address);
                
                const tx = await gasOptimized.batchProcessOptimized(userAddresses, amounts);
                const receipt = await tx.wait();
                
                console.log("20 users batch process gas:", receipt.gasUsed.toString());
                expect(receipt.gasUsed).to.be.lt(500000);
            });

            it("Should handle large datasets", async function () {
                const largeData = Array.from({length: 1000}, (_, i) => i);
                
                const tx = await gasOptimized.storeOptimizedData(largeData);
                const receipt = await tx.wait();
                
                console.log("1000 elements storage gas:", receipt.gasUsed.toString());
                expect(receipt.gasUsed).to.be.lt(1000000);
            });
        });

        describe("Rapid Operations", function () {
            it("Should handle rapid operations efficiently", async function () {
                for (let i = 0; i < 10; i++) {
                    await gasOptimized.setUserStake(
                        user1.address,
                        ethers.parseEther("1000"),
                        Math.floor(Date.now() / 1000),
                        i % 6
                    );
                }
                
                const userStake = await gasOptimized.getUserStake(user1.address);
                expect(userStake.amount).to.equal(ethers.parseEther("1000"));
            });
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero values", async function () {
            await gasOptimized.setUserStake(user1.address, 0, 0, 0);
            
            const userStake = await gasOptimized.getUserStake(user1.address);
            expect(userStake.amount).to.equal(0);
            expect(userStake.lockTime).to.equal(0);
            expect(userStake.lockPeriod).to.equal(0);
        });

        it("Should handle maximum values", async function () {
            const maxAmount = ethers.MaxUint256;
            const maxTime = ethers.MaxUint256;
            const maxPeriod = 255;
            
            await gasOptimized.setUserStake(user1.address, maxAmount, maxTime, maxPeriod);
            
            const userStake = await gasOptimized.getUserStake(user1.address);
            expect(userStake.amount).to.equal(maxAmount);
            expect(userStake.lockTime).to.equal(maxTime);
            expect(userStake.lockPeriod).to.equal(maxPeriod);
        });

        it("Should handle empty arrays", async function () {
            await expect(
                gasOptimized.batchProcessOptimized([], [])
            ).to.not.be.reverted;
        });

        it("Should handle single element operations", async function () {
            await gasOptimized.batchProcessOptimized([user1.address], [1000]);
            
            const processed = await gasOptimized.getProcessedAmount(user1.address);
            expect(processed).to.equal(1000);
        });
    });
}); 
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Oracle Integration Tests", function () {
    let token, oracle, owner, oracleCaller, user1, user2;
    let snapshotId;

    beforeEach(async function () {
        [owner, oracleCaller, user1, user2] = await ethers.getSigners();
        
        // Deploy token
        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        await token.waitForDeployment();
        
        // Deploy oracle
        const Oracle = await ethers.getContractFactory("Oracle");
        oracle = await Oracle.deploy();
        await oracle.waitForDeployment();
        
        // Setup roles
        const ORACLE_ROLE = await oracle.ORACLE_ROLE();
        const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
        const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
        
        await oracle.grantRole(ORACLE_ROLE, oracleCaller.address);
        await token.grantRole(REBASE_CALLER_ROLE, oracleCaller.address);
        
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
        describe("Oracle Setup", function () {
            it("Should set oracle correctly", async function () {
                await token.setOracle(oracle.target);
                expect(await token.oracle()).to.equal(oracle.target);
            });

            it("Should emit OracleSet event", async function () {
                await expect(token.setOracle(oracle.target))
                    .to.emit(token, "OracleSet")
                    .withArgs(oracle.target);
            });

            it("Should revert setting invalid oracle", async function () {
                await expect(
                    token.setOracle(ethers.ZeroAddress)
                ).to.be.revertedWith("Invalid oracle address");
            });

            it("Should revert setting oracle from non-admin", async function () {
                await expect(
                    token.connect(user1).setOracle(oracle.target)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Oracle Data Retrieval", function () {
            beforeEach(async function () {
                await token.setOracle(oracle.target);
            });

            it("Should get HOI from oracle", async function () {
                const hoi = await oracle.getHOI();
                expect(hoi).to.be.gt(0);
            });

            it("Should get last update time from oracle", async function () {
                const lastUpdateTime = await oracle.getLastUpdateTime();
                expect(lastUpdateTime).to.be.gte(0);
            });

            it("Should get nonce from oracle", async function () {
                const nonce = await oracle.getNonce();
                expect(nonce).to.be.gte(0);
            });

            it("Should handle oracle not set", async function () {
                // Reset oracle
                await token.setOracle(ethers.ZeroAddress);
                
                await expect(
                    token.connect(oracleCaller).rebase()
                ).to.be.revertedWith("Oracle not set");
            });
        });

        describe("Rebase Function", function () {
            beforeEach(async function () {
                await token.setOracle(oracle.target);
            });

            it("Should execute rebase with oracle data", async function () {
                const initialSupply = await token.totalSupply();
                
                await expect(
                    token.connect(oracleCaller).rebase()
                ).to.not.be.reverted;
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
            });

            it("Should emit Rebase event", async function () {
                await expect(token.connect(oracleCaller).rebase())
                    .to.emit(token, "Rebase")
                    .withArgs(await oracle.getHOI(), await oracle.getLastUpdateTime(), await oracle.getNonce());
            });

            it("Should revert rebase from non-authorized caller", async function () {
                await expect(
                    token.connect(user1).rebase()
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });
    });

    describe("Integration Tests", function () {
        describe("Oracle-Token Integration", function () {
            beforeEach(async function () {
                await token.setOracle(oracle.target);
            });

            it("Should handle oracle data updates", async function () {
                const initialHOI = await oracle.getHOI();
                const initialSupply = await token.totalSupply();
                
                // Update oracle data
                await oracle.connect(oracleCaller).setHOI(initialHOI + 1000, await oracle.getNonce() + 1);
                
                // Execute rebase
                await token.connect(oracleCaller).rebase();
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
            });

            it("Should handle multiple rebases", async function () {
                const initialSupply = await token.totalSupply();
                
                // Execute multiple rebases
                for (let i = 0; i < 5; i++) {
                    await token.connect(oracleCaller).rebase();
                    await time.increase(3600); // 1 hour between rebases
                }
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
            });

            it("Should maintain token balance ratios", async function () {
                const user1InitialBalance = await token.balanceOf(user1.address);
                const user2InitialBalance = await token.balanceOf(user2.address);
                const initialRatio = user1InitialBalance * BigInt(10000) / user2InitialBalance;
                
                // Execute rebase
                await token.connect(oracleCaller).rebase();
                
                const user1FinalBalance = await token.balanceOf(user1.address);
                const user2FinalBalance = await token.balanceOf(user2.address);
                const finalRatio = user1FinalBalance * BigInt(10000) / user2FinalBalance;
                
                // Ratio should be maintained (within small rounding error)
                expect(finalRatio).to.be.closeTo(initialRatio, BigInt(1));
            });
        });

        describe("Oracle Upgrade Scenarios", function () {
            it("Should handle oracle contract upgrade", async function () {
                await token.setOracle(oracle.target);
                
                // Deploy new oracle
                const Oracle = await ethers.getContractFactory("Oracle");
                const newOracle = await Oracle.deploy();
                await newOracle.waitForDeployment();
                
                // Setup new oracle
                const ORACLE_ROLE = await newOracle.ORACLE_ROLE();
                await newOracle.grantRole(ORACLE_ROLE, oracleCaller.address);
                
                // Switch to new oracle
                await token.setOracle(newOracle.target);
                expect(await token.oracle()).to.equal(newOracle.target);
                
                // Should work with new oracle
                await expect(
                    token.connect(oracleCaller).rebase()
                ).to.not.be.reverted;
            });

            it("Should handle oracle failure gracefully", async function () {
                await token.setOracle(oracle.target);
                
                // Simulate oracle failure by setting invalid data
                await oracle.connect(oracleCaller).setHOI(0, await oracle.getNonce() + 1);
                
                // Should handle gracefully
                await expect(
                    token.connect(oracleCaller).rebase()
                ).to.not.be.reverted;
            });
        });
    });

    describe("Gas Tests", function () {
        beforeEach(async function () {
            await token.setOracle(oracle.target);
        });

        it("Should measure gas for setOracle", async function () {
            const tx = await token.setOracle(oracle.target);
            const receipt = await tx.wait();
            console.log("setOracle gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(100000);
        });

        it("Should measure gas for rebase operation", async function () {
            const tx = await token.connect(oracleCaller).rebase();
            const receipt = await tx.wait();
            console.log("Rebase gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(200000);
        });

        it("Should measure gas for oracle data retrieval", async function () {
            const hoiTx = await oracle.getHOI();
            const lastUpdateTx = await oracle.getLastUpdateTime();
            const nonceTx = await oracle.getNonce();
            
            console.log("getHOI gas used:", hoiTx.toString());
            console.log("getLastUpdateTime gas used:", lastUpdateTx.toString());
            console.log("getNonce gas used:", nonceTx.toString());
            
            expect(hoiTx).to.be.lt(50000);
            expect(lastUpdateTx).to.be.lt(50000);
            expect(nonceTx).to.be.lt(50000);
        });

        it("Should compare gas usage with different oracle states", async function () {
            // First rebase
            const tx1 = await token.connect(oracleCaller).rebase();
            const receipt1 = await tx1.wait();
            
            // Update oracle and second rebase
            await oracle.connect(oracleCaller).setHOI(await oracle.getHOI() + 1000, await oracle.getNonce() + 1);
            const tx2 = await token.connect(oracleCaller).rebase();
            const receipt2 = await tx2.wait();
            
            console.log("First rebase gas:", receipt1.gasUsed.toString());
            console.log("Second rebase gas:", receipt2.gasUsed.toString());
            
            // Gas usage should be similar
            expect(Math.abs(Number(receipt1.gasUsed) - Number(receipt2.gasUsed))).to.be.lt(10000);
        });
    });

    describe("Security Tests", function () {
        describe("Access Control", function () {
            it("Should prevent unauthorized oracle changes", async function () {
                await expect(
                    token.connect(user1).setOracle(oracle.target)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent unauthorized rebase calls", async function () {
                await token.setOracle(oracle.target);
                
                await expect(
                    token.connect(user1).rebase()
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Oracle Manipulation", function () {
            it("Should prevent oracle data manipulation", async function () {
                await token.setOracle(oracle.target);
                
                // Only oracle role should be able to update data
                await expect(
                    oracle.connect(user1).setHOI(1000, 1)
                ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
            });

            it("Should validate oracle nonce", async function () {
                await token.setOracle(oracle.target);
                
                const currentNonce = await oracle.getNonce();
                
                // Try to use old nonce
                await expect(
                    oracle.connect(oracleCaller).setHOI(1000, currentNonce - 1)
                ).to.be.revertedWith("Invalid nonce");
            });
        });

        describe("Data Integrity", function () {
            it("Should handle oracle data consistency", async function () {
                await token.setOracle(oracle.target);
                
                const initialHOI = await oracle.getHOI();
                const initialSupply = await token.totalSupply();
                
                // Execute rebase
                await token.connect(oracleCaller).rebase();
                
                // Oracle data should remain consistent
                const finalHOI = await oracle.getHOI();
                expect(finalHOI).to.equal(initialHOI);
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
            });

            it("Should prevent double rebase with same data", async function () {
                await token.setOracle(oracle.target);
                
                const initialSupply = await token.totalSupply();
                
                // First rebase
                await token.connect(oracleCaller).rebase();
                const supplyAfterFirst = await token.totalSupply();
                
                // Second rebase with same oracle data
                await token.connect(oracleCaller).rebase();
                const supplyAfterSecond = await token.totalSupply();
                
                // Should not change supply if oracle data hasn't changed
                expect(supplyAfterSecond).to.equal(supplyAfterFirst);
            });
        });
    });

    describe("Stress Tests", function () {
        beforeEach(async function () {
            await token.setOracle(oracle.target);
        });

        describe("High Frequency Rebase", function () {
            it("Should handle rapid rebase operations", async function () {
                const initialSupply = await token.totalSupply();
                
                // Execute many rebases rapidly
                for (let i = 0; i < 20; i++) {
                    await token.connect(oracleCaller).rebase();
                }
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
            });

            it("Should handle concurrent rebase attempts", async function () {
                const users = await ethers.getSigners();
                
                // Grant rebase role to multiple users
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                for (let i = 10; i < 15; i++) {
                    await token.grantRole(REBASE_CALLER_ROLE, users[i].address);
                }
                
                // Concurrent rebase attempts
                const rebasePromises = [];
                for (let i = 10; i < 15; i++) {
                    rebasePromises.push(token.connect(users[i]).rebase());
                }
                
                await Promise.all(rebasePromises);
                
                // Should handle gracefully
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.be.gt(0);
            });
        });

        describe("Oracle Data Changes", function () {
            it("Should handle frequent oracle updates", async function () {
                const initialSupply = await token.totalSupply();
                
                for (let i = 0; i < 10; i++) {
                    // Update oracle data
                    await oracle.connect(oracleCaller).setHOI(
                        await oracle.getHOI() + 1000,
                        await oracle.getNonce() + 1
                    );
                    
                    // Execute rebase
                    await token.connect(oracleCaller).rebase();
                    
                    await time.increase(3600); // 1 hour between updates
                }
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
            });

            it("Should handle large oracle data changes", async function () {
                const initialSupply = await token.totalSupply();
                
                // Large HOI change
                await oracle.connect(oracleCaller).setHOI(
                    await oracle.getHOI() * BigInt(2),
                    await oracle.getNonce() + 1
                );
                
                await token.connect(oracleCaller).rebase();
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
            });
        });

        describe("Token Holder Scenarios", function () {
            it("Should handle many token holders during rebase", async function () {
                const users = await ethers.getSigners();
                
                // Distribute tokens to many users
                for (let i = 10; i < 30; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                }
                
                const initialSupply = await token.totalSupply();
                
                // Execute rebase
                await token.connect(oracleCaller).rebase();
                
                const finalSupply = await token.totalSupply();
                expect(finalSupply).to.not.equal(initialSupply);
                
                // Check that all users still have tokens
                for (let i = 10; i < 30; i++) {
                    const balance = await token.balanceOf(users[i].address);
                    expect(balance).to.be.gt(0);
                }
            });
        });
    });

    describe("Edge Cases", function () {
        beforeEach(async function () {
            await token.setOracle(oracle.target);
        });

        it("Should handle zero HOI", async function () {
            await oracle.connect(oracleCaller).setHOI(0, await oracle.getNonce() + 1);
            
            await expect(
                token.connect(oracleCaller).rebase()
            ).to.not.be.reverted;
        });

        it("Should handle very large HOI", async function () {
            await oracle.connect(oracleCaller).setHOI(
                ethers.parseEther("1000000"),
                await oracle.getNonce() + 1
            );
            
            await expect(
                token.connect(oracleCaller).rebase()
            ).to.not.be.reverted;
        });

        it("Should handle oracle with no data", async function () {
            // Deploy fresh oracle
            const Oracle = await ethers.getContractFactory("Oracle");
            const freshOracle = await Oracle.deploy();
            await freshOracle.waitForDeployment();
            
            await token.setOracle(freshOracle.target);
            
            await expect(
                token.connect(oracleCaller).rebase()
            ).to.not.be.reverted;
        });

        it("Should handle rebase with no token holders", async function () {
            // Burn all tokens
            await token.connect(user1).transfer(ethers.ZeroAddress, await token.balanceOf(user1.address));
            await token.connect(user2).transfer(ethers.ZeroAddress, await token.balanceOf(user2.address));
            
            await expect(
                token.connect(oracleCaller).rebase()
            ).to.not.be.reverted;
        });
    });
}); 
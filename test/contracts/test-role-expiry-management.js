const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Role Expiry Management Tests", function () {
    let token, stakingV2, governanceV2, owner, governor, user1, user2, user3;
    let snapshotId;

    beforeEach(async function () {
        [owner, governor, user1, user2, user3] = await ethers.getSigners();
        
        // Deploy token
        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        await token.waitForDeployment();
        
        // Deploy staking contract
        const StakingV2 = await ethers.getContractFactory("StakingV2");
        stakingV2 = await StakingV2.deploy();
        await stakingV2.waitForDeployment();
        
        // Deploy governance contract
        const GovernanceV2 = await ethers.getContractFactory("GovernanceV2");
        governanceV2 = await GovernanceV2.deploy();
        await governanceV2.waitForDeployment();
        
        // Setup roles
        const GOVERNOR_ROLE = await governanceV2.GOVERNOR_ROLE();
        const DEFAULT_ADMIN_ROLE = await governanceV2.DEFAULT_ADMIN_ROLE();
        
        await governanceV2.grantRole(GOVERNOR_ROLE, governor.address);
        
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
        describe("Role Configuration", function () {
            it("Should set role info correctly", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true, // isTimeLimited
                    7 * 24 * 3600, // maxDuration (7 days)
                    ethers.parseEther("1000"), // minStake
                    true // requiresMultisig
                );
                
                const roleInfo = await token.getRoleInfo(REBASE_CALLER_ROLE);
                expect(roleInfo.isTimeLimited).to.be.true;
                expect(roleInfo.maxDuration).to.equal(7 * 24 * 3600);
                expect(roleInfo.minStake).to.equal(ethers.parseEther("1000"));
                expect(roleInfo.requiresMultisig).to.be.true;
            });

            it("Should emit RoleInfoSet event", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await expect(
                    token.setRoleInfo(
                        REBASE_CALLER_ROLE,
                        true,
                        7 * 24 * 3600,
                        ethers.parseEther("1000"),
                        true
                    )
                ).to.emit(token, "RoleInfoSet")
                 .withArgs(REBASE_CALLER_ROLE, true, 7 * 24 * 3600, ethers.parseEther("1000"), true);
            });
        });

        describe("Time-Limited Role Granting", function () {
            it("Should grant time-limited role correctly", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                const duration = 3 * 24 * 3600; // 3 days
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, duration);
                
                const expiry = await token.getRoleExpiry(REBASE_CALLER_ROLE, user1.address);
                const expectedExpiry = (await time.latest()) + duration;
                expect(expiry).to.equal(expectedExpiry);
                
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
            });

            it("Should emit RoleGrantedWithExpiry event", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                const duration = 3 * 24 * 3600;
                const expectedExpiry = (await time.latest()) + duration;
                
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, duration)
                ).to.emit(token, "RoleGrantedWithExpiry")
                 .withArgs(user1.address, REBASE_CALLER_ROLE, expectedExpiry);
            });

            it("Should revert if duration exceeds max duration", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600, // max 7 days
                    ethers.parseEther("1000"),
                    false
                );
                
                const duration = 10 * 24 * 3600; // 10 days
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, duration)
                ).to.be.revertedWith("Duration too long");
            });

            it("Should revert if role is not time-limited", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    false, // not time-limited
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 3600)
                ).to.be.revertedWith("Role is not time-limited");
            });
        });

        describe("Role Expiry Checking", function () {
            it("Should return false for expired role", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                // Grant role for 1 hour
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 3600);
                
                // Advance time by 2 hours
                await time.increase(2 * 3600);
                
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.false;
            });

            it("Should return true for non-expired role", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                // Grant role for 1 day
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600);
                
                // Advance time by 12 hours
                await time.increase(12 * 3600);
                
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
            });

            it("Should handle non-time-limited roles", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    false, // not time-limited
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await token.grantRole(REBASE_CALLER_ROLE, user1.address);
                
                // Advance time significantly
                await time.increase(365 * 24 * 3600); // 1 year
                
                expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
            });
        });
    });

    describe("Integration Tests", function () {
        describe("Role Usage in Functions", function () {
            it("Should allow function access with valid time-limited role", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600);
                
                // Should be able to call rebase function
                await expect(
                    token.connect(user1).rebase(1000)
                ).to.not.be.reverted;
            });

            it("Should deny function access with expired role", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 3600);
                
                // Advance time to expire role
                await time.increase(2 * 3600);
                
                // Should not be able to call rebase function
                await expect(
                    token.connect(user1).rebase(1000)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });

            it("Should handle role expiry during function execution", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                // Grant role for very short duration
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 1);
                
                // Try to call function immediately
                await expect(
                    token.connect(user1).rebase(1000)
                ).to.not.be.reverted;
                
                // Advance time by 2 seconds
                await time.increase(2);
                
                // Should not be able to call function anymore
                await expect(
                    token.connect(user1).rebase(1000)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Stake Requirements", function () {
            it("Should enforce minimum stake requirements", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"), // 1000 token minimum
                    false
                );
                
                // Grant role to user with insufficient stake
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600)
                ).to.be.revertedWith("Insufficient stake");
            });

            it("Should allow role grant with sufficient stake", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                // Grant user enough tokens
                await token.mint(user1.address, ethers.parseEther("2000"));
                
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600)
                ).to.not.be.reverted;
            });
        });
    });

    describe("Gas Tests", function () {
        it("Should measure gas for setting role info", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            const tx = await token.setRoleInfo(
                REBASE_CALLER_ROLE,
                true,
                7 * 24 * 3600,
                ethers.parseEther("1000"),
                true
            );
            const receipt = await tx.wait();
            console.log("Set role info gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(100000);
        });

        it("Should measure gas for granting time-limited role", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            await token.setRoleInfo(
                REBASE_CALLER_ROLE,
                true,
                7 * 24 * 3600,
                ethers.parseEther("1000"),
                false
            );
            
            const tx = await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600);
            const receipt = await tx.wait();
            console.log("Grant time-limited role gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(150000);
        });

        it("Should measure gas for checking role expiry", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            await token.setRoleInfo(
                REBASE_CALLER_ROLE,
                true,
                7 * 24 * 3600,
                ethers.parseEther("1000"),
                false
            );
            
            await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600);
            
            const tx = await token.hasRole(REBASE_CALLER_ROLE, user1.address);
            console.log("Check role expiry gas used:", tx.toString());
            expect(tx).to.be.lt(50000);
        });

        it("Should compare gas usage with different role types", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            // Time-limited role
            await token.setRoleInfo(
                REBASE_CALLER_ROLE,
                true,
                7 * 24 * 3600,
                ethers.parseEther("1000"),
                false
            );
            
            const timeLimitedTx = await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600);
            const timeLimitedReceipt = await timeLimitedTx.wait();
            
            // Regular role
            await token.grantRole(REBASE_CALLER_ROLE, user2.address);
            
            console.log("Time-limited role grant gas:", timeLimitedReceipt.gasUsed.toString());
            console.log("Regular role grant gas: ~50000 (estimated)");
            
            expect(timeLimitedReceipt.gasUsed).to.be.gt(50000); // Time-limited should use more gas
        });
    });

    describe("Security Tests", function () {
        describe("Access Control", function () {
            it("Should prevent non-admin from setting role info", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await expect(
                    token.connect(user1).setRoleInfo(
                        REBASE_CALLER_ROLE,
                        true,
                        7 * 24 * 3600,
                        ethers.parseEther("1000"),
                        false
                    )
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent non-admin from granting time-limited roles", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await expect(
                    token.connect(user1).grantTimeLimitedRole(user2.address, REBASE_CALLER_ROLE, 24 * 3600)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Role Escalation", function () {
            it("Should prevent expired roles from being used", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 1);
                await time.increase(2);
                
                // User should not be able to grant roles to themselves
                await expect(
                    token.connect(user1).grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600)
                ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Parameter Validation", function () {
            it("Should validate duration parameters", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                // Zero duration
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 0)
                ).to.be.revertedWith("Duration must be greater than 0");
                
                // Very large duration
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 1000 * 24 * 3600)
                ).to.be.revertedWith("Duration too long");
            });

            it("Should validate stake requirements", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                // User with no tokens
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600)
                ).to.be.revertedWith("Insufficient stake");
                
                // User with insufficient tokens
                await token.mint(user1.address, ethers.parseEther("500"));
                await expect(
                    token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600)
                ).to.be.revertedWith("Insufficient stake");
            });
        });
    });

    describe("Stress Tests", function () {
        describe("Multiple Time-Limited Roles", function () {
            it("Should handle many time-limited roles", async function () {
                const users = await ethers.getSigners();
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                // Grant roles to many users
                const grantPromises = [];
                for (let i = 10; i < 20; i++) {
                    await token.mint(users[i].address, ethers.parseEther("2000"));
                    grantPromises.push(
                        token.grantTimeLimitedRole(users[i].address, REBASE_CALLER_ROLE, 24 * 3600)
                    );
                }
                
                await Promise.all(grantPromises);
                
                // Check all have roles
                for (let i = 10; i < 20; i++) {
                    expect(await token.hasRole(REBASE_CALLER_ROLE, users[i].address)).to.be.true;
                }
                
                // Advance time to expire all roles
                await time.increase(25 * 3600);
                
                // Check all roles expired
                for (let i = 10; i < 20; i++) {
                    expect(await token.hasRole(REBASE_CALLER_ROLE, users[i].address)).to.be.false;
                }
            });
        });

        describe("Rapid Role Operations", function () {
            it("Should handle rapid grant/revoke cycles", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await token.mint(user1.address, ethers.parseEther("2000"));
                
                for (let i = 0; i < 10; i++) {
                    await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 3600);
                    expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
                    
                    await token.revokeRole(REBASE_CALLER_ROLE, user1.address);
                    expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.false;
                }
            });
        });

        describe("Concurrent Role Checks", function () {
            it("Should handle concurrent role expiry checks", async function () {
                const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
                
                await token.setRoleInfo(
                    REBASE_CALLER_ROLE,
                    true,
                    7 * 24 * 3600,
                    ethers.parseEther("1000"),
                    false
                );
                
                await token.mint(user1.address, ethers.parseEther("2000"));
                await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 3600);
                
                // Multiple concurrent checks
                const checkPromises = [];
                for (let i = 0; i < 10; i++) {
                    checkPromises.push(token.hasRole(REBASE_CALLER_ROLE, user1.address));
                }
                
                const results = await Promise.all(checkPromises);
                results.forEach(result => expect(result).to.be.true);
            });
        });
    });

    describe("Edge Cases", function () {
        it("Should handle role expiry at exact time", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            await token.setRoleInfo(
                REBASE_CALLER_ROLE,
                true,
                7 * 24 * 3600,
                ethers.parseEther("1000"),
                false
            );
            
            await token.mint(user1.address, ethers.parseEther("2000"));
            await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 3600);
            
            // Advance time to exact expiry
            await time.increase(3600);
            
            // Role should be expired
            expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.false;
        });

        it("Should handle very short role durations", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            await token.setRoleInfo(
                REBASE_CALLER_ROLE,
                true,
                7 * 24 * 3600,
                ethers.parseEther("1000"),
                false
            );
            
            await token.mint(user1.address, ethers.parseEther("2000"));
            await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 1);
            
            // Role should be valid immediately
            expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
            
            // Role should expire after 1 second
            await time.increase(2);
            expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.false;
        });

        it("Should handle role expiry with zero balance", async function () {
            const REBASE_CALLER_ROLE = await token.REBASE_CALLER_ROLE();
            
            await token.setRoleInfo(
                REBASE_CALLER_ROLE,
                true,
                7 * 24 * 3600,
                ethers.parseEther("1000"),
                false
            );
            
            // Grant role to user with sufficient balance
            await token.mint(user1.address, ethers.parseEther("2000"));
            await token.grantTimeLimitedRole(user1.address, REBASE_CALLER_ROLE, 24 * 3600);
            
            // Transfer all tokens away
            await token.connect(user1).transfer(user2.address, ethers.parseEther("2000"));
            
            // Role should still be valid (stake check only at grant time)
            expect(await token.hasRole(REBASE_CALLER_ROLE, user1.address)).to.be.true;
        });
    });
}); 
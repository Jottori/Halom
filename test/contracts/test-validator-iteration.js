const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Validator Iteration Tests", function () {
    let bridgeValidator, token, owner, validator1, validator2, validator3, user1, user2;
    let snapshotId;

    beforeEach(async function () {
        [owner, validator1, validator2, validator3, user1, user2] = await ethers.getSigners();
        
        // Deploy token for staking
        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy();
        await token.waitForDeployment();
        
        // Deploy bridge validator
        const BridgeValidator = await ethers.getContractFactory("BridgeValidator");
        bridgeValidator = await BridgeValidator.deploy();
        await bridgeValidator.waitForDeployment();
        
        // Setup token
        await token.grantRole(await token.MINTER_ROLE(), owner.address);
        await token.mint(validator1.address, ethers.parseEther("10000"));
        await token.mint(validator2.address, ethers.parseEther("10000"));
        await token.mint(validator3.address, ethers.parseEther("10000"));
        
        // Approve staking
        await token.connect(validator1).approve(bridgeValidator.target, ethers.parseEther("10000"));
        await token.connect(validator2).approve(bridgeValidator.target, ethers.parseEther("10000"));
        await token.connect(validator3).approve(bridgeValidator.target, ethers.parseEther("10000"));
        
        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    describe("Unit Tests", function () {
        describe("Validator Management", function () {
            it("Should add validators correctly", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                
                const validatorInfo = await bridgeValidator.getValidatorInfo(validator1.address);
                expect(validatorInfo.isActive).to.be.true;
                expect(validatorInfo.stake).to.equal(ethers.parseEther("1000"));
                expect(validatorInfo.votingPower).to.be.gt(0);
            });

            it("Should remove validators correctly", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).removeValidator(validator1.address);
                
                const validatorInfo = await bridgeValidator.getValidatorInfo(validator1.address);
                expect(validatorInfo.isActive).to.be.false;
                expect(validatorInfo.stake).to.equal(0);
                expect(validatorInfo.votingPower).to.equal(0);
            });

            it("Should maintain active validators array correctly", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                
                expect(await bridgeValidator.activeValidators(0)).to.equal(validator1.address);
                expect(await bridgeValidator.activeValidators(1)).to.equal(validator2.address);
                expect(await bridgeValidator.totalValidators()).to.equal(2);
            });

            it("Should update validator indices correctly", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                
                expect(await bridgeValidator.validatorIndex(validator1.address)).to.equal(0);
                expect(await bridgeValidator.validatorIndex(validator2.address)).to.equal(1);
            });
        });

        describe("Validator Array Operations", function () {
            it("Should handle validator removal from middle of array", async function () {
                // Add 3 validators
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator3.address, ethers.parseEther("1000"));
                
                // Remove middle validator (validator2)
                await bridgeValidator.connect(owner).removeValidator(validator2.address);
                
                // Check array is compacted
                expect(await bridgeValidator.activeValidators(0)).to.equal(validator1.address);
                expect(await bridgeValidator.activeValidators(1)).to.equal(validator3.address);
                expect(await bridgeValidator.totalValidators()).to.equal(2);
                
                // Check indices are updated
                expect(await bridgeValidator.validatorIndex(validator1.address)).to.equal(0);
                expect(await bridgeValidator.validatorIndex(validator3.address)).to.equal(1);
            });

            it("Should handle validator removal from end of array", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                
                // Remove last validator
                await bridgeValidator.connect(owner).removeValidator(validator2.address);
                
                expect(await bridgeValidator.activeValidators(0)).to.equal(validator1.address);
                expect(await bridgeValidator.totalValidators()).to.equal(1);
            });

            it("Should handle validator removal from beginning of array", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                
                // Remove first validator
                await bridgeValidator.connect(owner).removeValidator(validator1.address);
                
                expect(await bridgeValidator.activeValidators(0)).to.equal(validator2.address);
                expect(await bridgeValidator.totalValidators()).to.equal(1);
            });
        });
    });

    describe("Integration Tests", function () {
        describe("Proposal Voting with Validators", function () {
            beforeEach(async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator3.address, ethers.parseEther("1000"));
            });

            it("Should handle proposal creation and voting", async function () {
                const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test request"));
                
                const proposalId = await bridgeValidator.connect(validator1).createProposal(
                    requestHash,
                    "Test proposal"
                );
                
                // Vote on proposal
                await bridgeValidator.connect(validator1).vote(proposalId, true);
                await bridgeValidator.connect(validator2).vote(proposalId, true);
                await bridgeValidator.connect(validator3).vote(proposalId, false);
                
                const proposalInfo = await bridgeValidator.getProposalInfo(proposalId);
                expect(proposalInfo.yesVotes).to.be.gt(0);
                expect(proposalInfo.noVotes).to.be.gt(0);
            });

            it("Should update validator reputations after proposal execution", async function () {
                const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test request"));
                
                const proposalId = await bridgeValidator.connect(validator1).createProposal(
                    requestHash,
                    "Test proposal"
                );
                
                // All vote yes
                await bridgeValidator.connect(validator1).vote(proposalId, true);
                await bridgeValidator.connect(validator2).vote(proposalId, true);
                await bridgeValidator.connect(validator3).vote(proposalId, true);
                
                // Execute proposal
                await bridgeValidator.connect(owner).executeProposal(proposalId);
                
                // Check reputation updates
                const validator1Info = await bridgeValidator.getValidatorInfo(validator1.address);
                const validator2Info = await bridgeValidator.getValidatorInfo(validator2.address);
                const validator3Info = await bridgeValidator.getValidatorInfo(validator3.address);
                
                expect(validator1Info.reputation).to.be.gt(100); // Base reputation is 100
                expect(validator2Info.reputation).to.be.gt(100);
                expect(validator3Info.reputation).to.be.gt(100);
            });
        });

        describe("Validator Iteration in Reputation Updates", function () {
            it("Should iterate through all active validators during reputation update", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator3.address, ethers.parseEther("1000"));
                
                const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test request"));
                const proposalId = await bridgeValidator.connect(validator1).createProposal(
                    requestHash,
                    "Test proposal"
                );
                
                // All vote yes
                await bridgeValidator.connect(validator1).vote(proposalId, true);
                await bridgeValidator.connect(validator2).vote(proposalId, true);
                await bridgeValidator.connect(validator3).vote(proposalId, true);
                
                // Execute proposal
                await bridgeValidator.connect(owner).executeProposal(proposalId);
                
                // All validators should have updated reputation
                const validator1Info = await bridgeValidator.getValidatorInfo(validator1.address);
                const validator2Info = await bridgeValidator.getValidatorInfo(validator2.address);
                const validator3Info = await bridgeValidator.getValidatorInfo(validator3.address);
                
                expect(validator1Info.reputation).to.be.gt(100);
                expect(validator2Info.reputation).to.be.gt(100);
                expect(validator3Info.reputation).to.be.gt(100);
            });
        });
    });

    describe("Gas Tests", function () {
        it("Should measure gas for adding validators", async function () {
            const tx = await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
            const receipt = await tx.wait();
            console.log("Add validator gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(200000);
        });

        it("Should measure gas for removing validators", async function () {
            await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
            await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
            
            const tx = await bridgeValidator.connect(owner).removeValidator(validator1.address);
            const receipt = await tx.wait();
            console.log("Remove validator gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(150000);
        });

        it("Should measure gas for reputation updates", async function () {
            await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
            await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
            
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test request"));
            const proposalId = await bridgeValidator.connect(validator1).createProposal(
                requestHash,
                "Test proposal"
            );
            
            await bridgeValidator.connect(validator1).vote(proposalId, true);
            await bridgeValidator.connect(validator2).vote(proposalId, true);
            
            const tx = await bridgeValidator.connect(owner).executeProposal(proposalId);
            const receipt = await tx.wait();
            console.log("Execute proposal with reputation update gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(300000);
        });

        it("Should compare gas usage with different validator counts", async function () {
            const users = await ethers.getSigners();
            
            // Test with 3 validators
            for (let i = 10; i < 13; i++) {
                await token.mint(users[i].address, ethers.parseEther("1000"));
                await token.connect(users[i]).approve(bridgeValidator.target, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(users[i].address, ethers.parseEther("1000"));
            }
            
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test request"));
            const proposalId = await bridgeValidator.connect(users[10]).createProposal(
                requestHash,
                "Test proposal"
            );
            
            for (let i = 10; i < 13; i++) {
                await bridgeValidator.connect(users[i]).vote(proposalId, true);
            }
            
            const tx3 = await bridgeValidator.connect(owner).executeProposal(proposalId);
            const receipt3 = await tx3.wait();
            console.log("3 validators gas used:", receipt3.gasUsed.toString());
            
            // Test with 5 validators
            for (let i = 13; i < 15; i++) {
                await token.mint(users[i].address, ethers.parseEther("1000"));
                await token.connect(users[i]).approve(bridgeValidator.target, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(users[i].address, ethers.parseEther("1000"));
            }
            
            const proposalId2 = await bridgeValidator.connect(users[10]).createProposal(
                requestHash,
                "Test proposal 2"
            );
            
            for (let i = 10; i < 15; i++) {
                await bridgeValidator.connect(users[i]).vote(proposalId2, true);
            }
            
            const tx5 = await bridgeValidator.connect(owner).executeProposal(proposalId2);
            const receipt5 = await tx5.wait();
            console.log("5 validators gas used:", receipt5.gasUsed.toString());
            
            expect(receipt5.gasUsed).to.be.gt(receipt3.gasUsed); // More validators = more gas
        });
    });

    describe("Security Tests", function () {
        describe("Access Control", function () {
            it("Should prevent non-admin from adding validators", async function () {
                await expect(
                    bridgeValidator.connect(user1).addValidator(validator1.address, ethers.parseEther("1000"))
                ).to.be.revertedWithCustomError(bridgeValidator, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent non-admin from removing validators", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await expect(
                    bridgeValidator.connect(user1).removeValidator(validator1.address)
                ).to.be.revertedWithCustomError(bridgeValidator, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Array Manipulation", function () {
            it("Should prevent array out of bounds access", async function () {
                await expect(
                    bridgeValidator.activeValidators(0)
                ).to.be.revertedWith("Array index out of bounds");
            });

            it("Should handle duplicate validator additions gracefully", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await expect(
                    bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"))
                ).to.be.revertedWith("Validator already exists");
            });

            it("Should handle removing non-existent validators gracefully", async function () {
                await expect(
                    bridgeValidator.connect(owner).removeValidator(validator1.address)
                ).to.be.revertedWith("Validator does not exist");
            });
        });

        describe("State Consistency", function () {
            it("Should maintain consistent state after validator operations", async function () {
                await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                await bridgeValidator.connect(owner).addValidator(validator2.address, ethers.parseEther("1000"));
                
                const initialCount = await bridgeValidator.totalValidators();
                const initialStake = await bridgeValidator.totalStake();
                
                await bridgeValidator.connect(owner).removeValidator(validator1.address);
                
                const finalCount = await bridgeValidator.totalValidators();
                const finalStake = await bridgeValidator.totalStake();
                
                expect(finalCount).to.equal(initialCount - 1);
                expect(finalStake).to.equal(initialStake - ethers.parseEther("1000"));
            });
        });
    });

    describe("Stress Tests", function () {
        describe("Large Validator Sets", function () {
            it("Should handle many validators", async function () {
                const users = await ethers.getSigners();
                
                // Add 20 validators
                for (let i = 10; i < 30; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                    await token.connect(users[i]).approve(bridgeValidator.target, ethers.parseEther("1000"));
                    await bridgeValidator.connect(owner).addValidator(users[i].address, ethers.parseEther("1000"));
                }
                
                expect(await bridgeValidator.totalValidators()).to.equal(20);
                
                // Test proposal with many validators
                const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test request"));
                const proposalId = await bridgeValidator.connect(users[10]).createProposal(
                    requestHash,
                    "Test proposal"
                );
                
                // All vote yes
                for (let i = 10; i < 30; i++) {
                    await bridgeValidator.connect(users[i]).vote(proposalId, true);
                }
                
                // Execute proposal
                await bridgeValidator.connect(owner).executeProposal(proposalId);
                
                // All should have updated reputation
                for (let i = 10; i < 30; i++) {
                    const validatorInfo = await bridgeValidator.getValidatorInfo(users[i].address);
                    expect(validatorInfo.reputation).to.be.gt(100);
                }
            });
        });

        describe("Rapid Validator Changes", function () {
            it("Should handle rapid add/remove cycles", async function () {
                for (let i = 0; i < 10; i++) {
                    await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
                    await bridgeValidator.connect(owner).removeValidator(validator1.address);
                }
                
                expect(await bridgeValidator.totalValidators()).to.equal(0);
            });

            it("Should handle concurrent validator operations", async function () {
                const users = await ethers.getSigners();
                
                // Add many validators simultaneously
                const addPromises = [];
                for (let i = 10; i < 20; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                    await token.connect(users[i]).approve(bridgeValidator.target, ethers.parseEther("1000"));
                    addPromises.push(
                        bridgeValidator.connect(owner).addValidator(users[i].address, ethers.parseEther("1000"))
                    );
                }
                
                await Promise.all(addPromises);
                expect(await bridgeValidator.totalValidators()).to.equal(10);
            });
        });

        describe("Complex Reputation Scenarios", function () {
            it("Should handle reputation updates with mixed voting", async function () {
                const users = await ethers.getSigners();
                
                // Add 10 validators
                for (let i = 10; i < 20; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                    await token.connect(users[i]).approve(bridgeValidator.target, ethers.parseEther("1000"));
                    await bridgeValidator.connect(owner).addValidator(users[i].address, ethers.parseEther("1000"));
                }
                
                // Create multiple proposals with mixed voting
                for (let j = 0; j < 5; j++) {
                    const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`test request ${j}`));
                    const proposalId = await bridgeValidator.connect(users[10]).createProposal(
                        requestHash,
                        `Test proposal ${j}`
                    );
                    
                    // Half vote yes, half vote no
                    for (let i = 10; i < 15; i++) {
                        await bridgeValidator.connect(users[i]).vote(proposalId, true);
                    }
                    for (let i = 15; i < 20; i++) {
                        await bridgeValidator.connect(users[i]).vote(proposalId, false);
                    }
                    
                    await bridgeValidator.connect(owner).executeProposal(proposalId);
                }
                
                // Check reputation distribution
                let totalReputation = 0;
                for (let i = 10; i < 20; i++) {
                    const validatorInfo = await bridgeValidator.getValidatorInfo(users[i].address);
                    totalReputation += validatorInfo.reputation;
                }
                
                // Reputation should be distributed
                expect(totalReputation).to.be.gt(1000); // 10 validators * 100 base
            });
        });
    });

    describe("Edge Cases", function () {
        it("Should handle single validator", async function () {
            await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000"));
            expect(await bridgeValidator.totalValidators()).to.equal(1);
            
            await bridgeValidator.connect(owner).removeValidator(validator1.address);
            expect(await bridgeValidator.totalValidators()).to.equal(0);
        });

        it("Should handle zero validators", async function () {
            expect(await bridgeValidator.totalValidators()).to.equal(0);
            expect(await bridgeValidator.totalStake()).to.equal(0);
        });

        it("Should handle validator with zero stake", async function () {
            await bridgeValidator.connect(owner).addValidator(validator1.address, 0);
            const validatorInfo = await bridgeValidator.getValidatorInfo(validator1.address);
            expect(validatorInfo.stake).to.equal(0);
            expect(validatorInfo.votingPower).to.equal(0);
        });

        it("Should handle very large stakes", async function () {
            await token.mint(validator1.address, ethers.parseEther("1000000"));
            await token.connect(validator1).approve(bridgeValidator.target, ethers.parseEther("1000000"));
            await bridgeValidator.connect(owner).addValidator(validator1.address, ethers.parseEther("1000000"));
            
            const validatorInfo = await bridgeValidator.getValidatorInfo(validator1.address);
            expect(validatorInfo.stake).to.equal(ethers.parseEther("1000000"));
            expect(validatorInfo.votingPower).to.be.gt(0);
        });
    });
}); 
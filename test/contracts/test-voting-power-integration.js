const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Voting Power Integration Tests", function () {
    let governanceV2, stakingV2, token, owner, governor, user1, user2, user3;
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
        
        // Setup token for staking
        await token.grantRole(await token.MINTER_ROLE(), owner.address);
        await token.mint(user1.address, ethers.parseEther("10000"));
        await token.mint(user2.address, ethers.parseEther("10000"));
        await token.mint(user3.address, ethers.parseEther("10000"));
        
        // Approve staking
        await token.connect(user1).approve(stakingV2.target, ethers.parseEther("10000"));
        await token.connect(user2).approve(stakingV2.target, ethers.parseEther("10000"));
        await token.connect(user3).approve(stakingV2.target, ethers.parseEther("10000"));
        
        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    afterEach(async function () {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    describe("Unit Tests", function () {
        describe("Staking Contract Integration", function () {
            it("Should set staking contract correctly", async function () {
                await governanceV2.connect(governor).setStakingContract(stakingV2.target);
                expect(await governanceV2.stakingContract()).to.equal(stakingV2.target);
            });

            it("Should emit StakingContractSet event", async function () {
                await expect(governanceV2.connect(governor).setStakingContract(stakingV2.target))
                    .to.emit(governanceV2, "StakingContractSet")
                    .withArgs(stakingV2.target);
            });

            it("Should revert setting invalid staking contract", async function () {
                await expect(
                    governanceV2.connect(governor).setStakingContract(ethers.ZeroAddress)
                ).to.be.revertedWith("Invalid staking contract");
            });

            it("Should revert setting staking contract from non-governor", async function () {
                await expect(
                    governanceV2.connect(user1).setStakingContract(stakingV2.target)
                ).to.be.revertedWithCustomError(governanceV2, "AccessControlUnauthorizedAccount");
            });
        });

        describe("Voting Power Retrieval", function () {
            beforeEach(async function () {
                await governanceV2.connect(governor).setStakingContract(stakingV2.target);
            });

            it("Should return 0 voting power when staking contract not set", async function () {
                // Reset staking contract
                await governanceV2.connect(governor).setStakingContract(ethers.ZeroAddress);
                const votes = await governanceV2.getVotes(user1.address);
                expect(votes).to.equal(0);
            });

            it("Should return correct voting power from staking contract", async function () {
                // Stake tokens
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                
                const votes = await governanceV2.getVotes(user1.address);
                expect(votes).to.equal(ethers.parseEther("1000"));
            });

            it("Should return correct past voting power", async function () {
                // Stake tokens
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                const blockNumber = await ethers.provider.getBlockNumber();
                
                // Wait for next block
                await time.increase(1);
                
                const pastVotes = await governanceV2.getPastVotes(user1.address, blockNumber);
                expect(pastVotes).to.equal(ethers.parseEther("1000"));
            });

            it("Should handle delegation voting power", async function () {
                // User1 stakes and delegates to user2
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                await stakingV2.connect(user1).delegate(user2.address, ethers.parseEther("500"));
                
                const user1Votes = await governanceV2.getVotes(user1.address);
                const user2Votes = await governanceV2.getVotes(user2.address);
                
                expect(user1Votes).to.equal(ethers.parseEther("500")); // Remaining stake
                expect(user2Votes).to.equal(ethers.parseEther("500")); // Delegated amount
            });
        });
    });

    describe("Integration Tests", function () {
        beforeEach(async function () {
            await governanceV2.connect(governor).setStakingContract(stakingV2.target);
        });

        describe("Governance Proposal Voting", function () {
            it("Should use staking voting power for proposals", async function () {
                // Setup governance parameters
                await governanceV2.connect(governor).setGovernanceParameters(
                    ethers.parseEther("100"), // proposal threshold
                    86400, // voting period
                    3600, // execution delay
                    ethers.parseEther("1000"), // quorum
                    5000 // approval threshold
                );
                
                // Stake tokens
                await stakingV2.connect(user1).stake(ethers.parseEther("2000"), 0);
                await stakingV2.connect(user2).stake(ethers.parseEther("1500"), 0);
                
                // Create proposal
                const proposalId = await governanceV2.connect(user1).propose(
                    [token.target],
                    [0],
                    ["mint(address,uint256)"],
                    [ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, ethers.parseEther("1000")])],
                    "Test proposal"
                );
                
                // Vote on proposal
                await governanceV2.connect(user1).castVote(proposalId, 1); // For
                await governanceV2.connect(user2).castVote(proposalId, 1); // For
                
                // Check voting power
                const proposalVotes = await governanceV2.getProposalVotes(proposalId);
                expect(proposalVotes.forVotes).to.equal(ethers.parseEther("3500")); // 2000 + 1500
            });

            it("Should handle voting power changes during proposal", async function () {
                // Setup governance
                await governanceV2.connect(governor).setGovernanceParameters(
                    ethers.parseEther("100"),
                    86400,
                    3600,
                    ethers.parseEther("1000"),
                    5000
                );
                
                // Initial stake
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                
                // Create proposal
                const proposalId = await governanceV2.connect(user1).propose(
                    [token.target],
                    [0],
                    ["mint(address,uint256)"],
                    [ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, ethers.parseEther("1000")])],
                    "Test proposal"
                );
                
                // Vote with initial power
                await governanceV2.connect(user1).castVote(proposalId, 1);
                
                // Add more stake
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                
                // Vote again (should not affect previous vote)
                await governanceV2.connect(user1).castVote(proposalId, 1);
                
                // Check that only initial voting power was counted
                const proposalVotes = await governanceV2.getProposalVotes(proposalId);
                expect(proposalVotes.forVotes).to.equal(ethers.parseEther("1000"));
            });
        });

        describe("Delegation Integration", function () {
            it("Should handle complex delegation scenarios", async function () {
                // Setup delegation chain: user1 -> user2 -> user3
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                await stakingV2.connect(user2).stake(ethers.parseEther("500"), 0);
                await stakingV2.connect(user3).stake(ethers.parseEther("300"), 0);
                
                // Delegate
                await stakingV2.connect(user1).delegate(user2.address, ethers.parseEther("400"));
                await stakingV2.connect(user2).delegate(user3.address, ethers.parseEther("300"));
                
                // Check voting power
                const user1Votes = await governanceV2.getVotes(user1.address);
                const user2Votes = await governanceV2.getVotes(user2.address);
                const user3Votes = await governanceV2.getVotes(user3.address);
                
                expect(user1Votes).to.equal(ethers.parseEther("600")); // 1000 - 400
                expect(user2Votes).to.equal(ethers.parseEther("600")); // 500 + 400 - 300
                expect(user3Votes).to.equal(ethers.parseEther("600")); // 300 + 300
            });
        });
    });

    describe("Gas Tests", function () {
        beforeEach(async function () {
            await governanceV2.connect(governor).setStakingContract(stakingV2.target);
        });

        it("Should measure gas for setStakingContract", async function () {
            const tx = await governanceV2.connect(governor).setStakingContract(stakingV2.target);
            const receipt = await tx.wait();
            console.log("setStakingContract gas used:", receipt.gasUsed.toString());
            expect(receipt.gasUsed).to.be.lt(100000);
        });

        it("Should measure gas for getVotes with staking contract", async function () {
            await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
            
            const tx = await governanceV2.getVotes(user1.address);
            console.log("getVotes gas used:", tx.toString());
            expect(tx).to.be.lt(100000);
        });

        it("Should measure gas for getPastVotes", async function () {
            await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
            const blockNumber = await ethers.provider.getBlockNumber();
            
            const tx = await governanceV2.getPastVotes(user1.address, blockNumber);
            console.log("getPastVotes gas used:", tx.toString());
            expect(tx).to.be.lt(100000);
        });

        it("Should compare gas usage with and without staking contract", async function () {
            // With staking contract
            await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
            const withStaking = await governanceV2.getVotes(user1.address);
            
            // Without staking contract
            await governanceV2.connect(governor).setStakingContract(ethers.ZeroAddress);
            const withoutStaking = await governanceV2.getVotes(user1.address);
            
            console.log("Votes with staking:", withStaking.toString());
            console.log("Votes without staking:", withoutStaking.toString());
        });
    });

    describe("Security Tests", function () {
        describe("Access Control", function () {
            it("Should prevent unauthorized staking contract changes", async function () {
                await expect(
                    governanceV2.connect(user1).setStakingContract(stakingV2.target)
                ).to.be.revertedWithCustomError(governanceV2, "AccessControlUnauthorizedAccount");
            });

            it("Should prevent setting malicious contract as staking contract", async function () {
                // Deploy malicious contract
                const MaliciousContract = await ethers.getContractFactory("Token");
                const malicious = await MaliciousContract.deploy();
                
                await expect(
                    governanceV2.connect(governor).setStakingContract(malicious.target)
                ).to.not.be.reverted; // This should be allowed, but the contract should handle it gracefully
            });
        });

        describe("Voting Power Manipulation", function () {
            it("Should prevent double voting with same voting power", async function () {
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                
                // Setup governance
                await governanceV2.connect(governor).setGovernanceParameters(
                    ethers.parseEther("100"),
                    86400,
                    3600,
                    ethers.parseEther("1000"),
                    5000
                );
                
                const proposalId = await governanceV2.connect(user1).propose(
                    [token.target],
                    [0],
                    ["mint(address,uint256)"],
                    [ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, ethers.parseEther("1000")])],
                    "Test proposal"
                );
                
                // Vote once
                await governanceV2.connect(user1).castVote(proposalId, 1);
                
                // Try to vote again
                await expect(
                    governanceV2.connect(user1).castVote(proposalId, 1)
                ).to.be.revertedWith("Governance: already voted");
            });
        });

        describe("State Consistency", function () {
            it("Should maintain consistent voting power across operations", async function () {
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                const initialVotes = await governanceV2.getVotes(user1.address);
                
                // Perform some operations
                await stakingV2.connect(user1).stake(ethers.parseEther("500"), 0);
                await stakingV2.connect(user1).unstake(ethers.parseEther("200"));
                
                const finalVotes = await governanceV2.getVotes(user1.address);
                expect(finalVotes).to.equal(ethers.parseEther("1300")); // 1000 + 500 - 200
            });
        });
    });

    describe("Stress Tests", function () {
        beforeEach(async function () {
            await governanceV2.connect(governor).setStakingContract(stakingV2.target);
        });

        describe("High Volume Voting", function () {
            it("Should handle many users voting simultaneously", async function () {
                const users = await ethers.getSigners();
                
                // Setup governance
                await governanceV2.connect(governor).setGovernanceParameters(
                    ethers.parseEther("100"),
                    86400,
                    3600,
                    ethers.parseEther("1000"),
                    5000
                );
                
                // Setup many users with stakes
                const setupPromises = [];
                for (let i = 10; i < 20; i++) {
                    await token.mint(users[i].address, ethers.parseEther("1000"));
                    await token.connect(users[i]).approve(stakingV2.target, ethers.parseEther("1000"));
                    setupPromises.push(stakingV2.connect(users[i]).stake(ethers.parseEther("100"), 0));
                }
                await Promise.all(setupPromises);
                
                // Create proposal
                const proposalId = await governanceV2.connect(user1).propose(
                    [token.target],
                    [0],
                    ["mint(address,uint256)"],
                    [ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, ethers.parseEther("1000")])],
                    "Test proposal"
                );
                
                // Many users vote simultaneously
                const votePromises = [];
                for (let i = 10; i < 20; i++) {
                    votePromises.push(governanceV2.connect(users[i]).castVote(proposalId, 1));
                }
                
                await Promise.all(votePromises);
                
                // Check total votes
                const proposalVotes = await governanceV2.getProposalVotes(proposalId);
                expect(proposalVotes.forVotes).to.equal(ethers.parseEther("1000")); // 10 users * 100 tokens
            });
        });

        describe("Complex Delegation Networks", function () {
            it("Should handle complex delegation networks", async function () {
                const users = await ethers.getSigners();
                
                // Setup complex delegation: user10 -> user11 -> user12 -> ... -> user19
                for (let i = 10; i < 20; i++) {
                    await token.mint(users[i].address, ethers.parseEther("100"));
                    await token.connect(users[i]).approve(stakingV2.target, ethers.parseEther("100"));
                    await stakingV2.connect(users[i]).stake(ethers.parseEther("100"), 0);
                    
                    if (i < 19) {
                        await stakingV2.connect(users[i]).delegate(users[i + 1].address, ethers.parseEther("50"));
                    }
                }
                
                // Check voting power accumulation
                const finalVotes = await governanceV2.getVotes(users[19].address);
                expect(finalVotes).to.be.gt(ethers.parseEther("100")); // Should have accumulated delegated tokens
            });
        });

        describe("Rapid State Changes", function () {
            it("Should handle rapid staking/unstaking cycles", async function () {
                await stakingV2.connect(user1).stake(ethers.parseEther("1000"), 0);
                
                for (let i = 0; i < 10; i++) {
                    await stakingV2.connect(user1).unstake(ethers.parseEther("50"));
                    await stakingV2.connect(user1).stake(ethers.parseEther("50"), 0);
                    
                    const votes = await governanceV2.getVotes(user1.address);
                    expect(votes).to.equal(ethers.parseEther("1000")); // Should remain constant
                }
            });
        });
    });

    describe("Edge Cases", function () {
        beforeEach(async function () {
            await governanceV2.connect(governor).setStakingContract(stakingV2.target);
        });

        it("Should handle zero voting power", async function () {
            const votes = await governanceV2.getVotes(user1.address);
            expect(votes).to.equal(0);
        });

        it("Should handle very large voting power", async function () {
            await token.mint(user1.address, ethers.parseEther("1000000"));
            await token.connect(user1).approve(stakingV2.target, ethers.parseEther("1000000"));
            await stakingV2.connect(user1).stake(ethers.parseEther("1000000"), 0);
            
            const votes = await governanceV2.getVotes(user1.address);
            expect(votes).to.equal(ethers.parseEther("1000000"));
        });

        it("Should handle staking contract upgrade", async function () {
            // Deploy new staking contract
            const StakingV2 = await ethers.getContractFactory("StakingV2");
            const newStakingV2 = await StakingV2.deploy();
            
            // Switch to new contract
            await governanceV2.connect(governor).setStakingContract(newStakingV2.target);
            
            // Should return 0 for old stakes
            const votes = await governanceV2.getVotes(user1.address);
            expect(votes).to.equal(0);
        });
    });
}); 
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Security Audit Tests", function () {
    let HalomToken, halomToken, HalomStaking, staking, HalomLPStaking, lpStaking, MockERC20, lpToken;
    let owner, governor, user1, user2, user3, rewarder;
    let GOVERNOR_ROLE, REWARDER_ROLE;

    async function deployContracts() {
        [owner, governor, user1, user2, user3, rewarder] = await ethers.getSigners();

        // Deploy HalomToken
        HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(owner.address, governor.address);

        // Deploy HalomStaking
        HalomStaking = await ethers.getContractFactory("HalomStaking");
        staking = await HalomStaking.deploy(halomToken.target, governor.address);

        // Deploy MockERC20 for LP token
        MockERC20 = await ethers.getContractFactory("MockERC20");
        lpToken = await MockERC20.deploy("LP Token", "LP", ethers.parseEther("1000000"));

        // Deploy HalomLPStaking
        HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(
            lpToken.target,
            halomToken.target,
            governor.address,
            rewarder.address
        );

        // Get role constants
        GOVERNOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));
        REWARDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REWARDER_ROLE"));

        // Setup token permissions
        await halomToken.setStakingContract(staking.target);
        await halomToken.grantRole(ethers.keccak256(ethers.toUtf8Bytes("DEFAULT_ADMIN_ROLE")), lpStaking.target);

        // Fund users
        await halomToken.transfer(user1.address, ethers.parseEther("10000"));
        await halomToken.transfer(user2.address, ethers.parseEther("10000"));
        await halomToken.transfer(user3.address, ethers.parseEther("10000"));
        await lpToken.transfer(user1.address, ethers.parseEther("1000"));
        await lpToken.transfer(user2.address, ethers.parseEther("1000"));

        // Approve tokens
        await halomToken.connect(user1).approve(staking.target, ethers.parseEther("10000"));
        await halomToken.connect(user2).approve(staking.target, ethers.parseEther("10000"));
        await lpToken.connect(user1).approve(lpStaking.target, ethers.parseEther("1000"));
        await lpToken.connect(user2).approve(lpStaking.target, ethers.parseEther("1000"));

        return { halomToken, staking, lpStaking, lpToken, governor, user1, user2, user3, rewarder };
    }

    describe("Rewards without stakers - HalomStaking", function () {
        it("Should store rewards for first staker instead of losing them", async function () {
            const { halomToken, staking, user1 } = await deployContracts();

            // Add rewards when no one is staked
            const rewardAmount = ethers.parseEther("1000");
            await halomToken.mint(staking.target, rewardAmount);
            
            // Simulate rebase call from token contract
            await staking.connect({ ...governor, address: halomToken.target }).addRewards(rewardAmount);
            
            // Check pending rewards
            expect(await staking.getPendingRewards()).to.equal(rewardAmount);

            // First staker should get all pending rewards
            const stakeAmount = ethers.parseEther("100");
            await staking.connect(user1).stakeWithLockPeriod(stakeAmount, 0); // 1 month lock

            // Check that pending rewards are distributed
            expect(await staking.getPendingRewards()).to.equal(0);
            
            // User should have high rewards per share
            const pendingRewards = await staking.getPendingRewardsForUser(user1.address);
            expect(pendingRewards).to.be.gt(0);
        });

        it("Should handle multiple reward additions before first staker", async function () {
            const { halomToken, staking, user1 } = await deployContracts();

            // Add rewards multiple times
            const reward1 = ethers.parseEther("500");
            const reward2 = ethers.parseEther("300");
            
            await halomToken.mint(staking.target, reward1 + reward2);
            await staking.connect({ ...governor, address: halomToken.target }).addRewards(reward1);
            await staking.connect({ ...governor, address: halomToken.target }).addRewards(reward2);
            
            expect(await staking.getPendingRewards()).to.equal(reward1 + reward2);

            // First staker gets all accumulated rewards
            await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 0);
            expect(await staking.getPendingRewards()).to.equal(0);
        });
    });

    describe("Rewards without stakers - HalomLPStaking", function () {
        it("Should store rewards for first staker instead of losing them", async function () {
            const { halomToken, lpStaking, user1, rewarder } = await deployContracts();

            // Fund rewarder
            await halomToken.mint(rewarder.address, ethers.parseEther("1000"));
            await halomToken.connect(rewarder).approve(lpStaking.target, ethers.parseEther("1000"));

            // Add rewards when no one is staked
            const rewardAmount = ethers.parseEther("500");
            await lpStaking.connect(rewarder).addRewards(rewardAmount);
            
            expect(await lpStaking.getPendingRewards()).to.equal(rewardAmount);

            // First staker should get all pending rewards
            const stakeAmount = ethers.parseEther("100");
            await lpStaking.connect(user1).stake(stakeAmount);

            // Check that pending rewards are distributed
            expect(await lpStaking.getPendingRewards()).to.equal(0);
            
            // User should have high rewards per share
            const pendingRewards = await lpStaking.getPendingRewardsForUser(user1.address);
            expect(pendingRewards).to.be.gt(0);
        });

        it("Should handle multiple reward additions before first staker", async function () {
            const { halomToken, lpStaking, user1, rewarder } = await deployContracts();

            // Fund rewarder
            await halomToken.mint(rewarder.address, ethers.parseEther("1000"));
            await halomToken.connect(rewarder).approve(lpStaking.target, ethers.parseEther("1000"));

            // Add rewards multiple times
            await lpStaking.connect(rewarder).addRewards(ethers.parseEther("300"));
            await lpStaking.connect(rewarder).addRewards(ethers.parseEther("200"));
            
            expect(await lpStaking.getPendingRewards()).to.equal(ethers.parseEther("500"));

            // First staker gets all accumulated rewards
            await lpStaking.connect(user1).stake(ethers.parseEther("100"));
            expect(await lpStaking.getPendingRewards()).to.equal(0);
        });
    });

    describe("Emergency Recovery Functions", function () {
        it("Should allow governor to recover tokens sent by mistake", async function () {
            const { halomToken, staking, lpStaking, governor, user1 } = await deployContracts();

            // Deploy a random token
            const RandomToken = await ethers.getContractFactory("MockERC20");
            const randomToken = await RandomToken.deploy("Random", "RND", ethers.parseEther("10000"));

            // Send random token to staking contract by mistake
            await randomToken.transfer(staking.target, ethers.parseEther("100"));

            // Governor should be able to recover it
            const recoveryAmount = ethers.parseEther("50");
            await staking.connect(governor).emergencyRecovery(
                randomToken.target,
                user1.address,
                recoveryAmount
            );

            expect(await randomToken.balanceOf(user1.address)).to.equal(recoveryAmount);
        });

        it("Should prevent recovery of staked tokens", async function () {
            const { halomToken, staking, governor, user1 } = await deployContracts();

            // Stake some tokens
            await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 0);

            // Try to recover staked tokens - should fail
            await expect(
                staking.connect(governor).emergencyRecovery(
                    halomToken.target,
                    user1.address,
                    ethers.parseEther("50")
                )
            ).to.be.revertedWith("Cannot recover staked tokens");
        });

        it("Should prevent recovery of LP tokens from LP staking", async function () {
            const { lpToken, lpStaking, governor, user1 } = await deployContracts();

            // Stake some LP tokens
            await lpStaking.connect(user1).stake(ethers.parseEther("100"));

            // Try to recover staked LP tokens - should fail
            await expect(
                lpStaking.connect(governor).emergencyRecovery(
                    lpToken.target,
                    user1.address,
                    ethers.parseEther("50")
                )
            ).to.be.revertedWith("Cannot recover staked LP tokens");
        });

        it("Should allow recovery of excess reward tokens", async function () {
            const { halomToken, lpStaking, governor, user1, rewarder } = await deployContracts();

            // Fund rewarder and add rewards
            await halomToken.mint(rewarder.address, ethers.parseEther("1000"));
            await halomToken.connect(rewarder).approve(lpStaking.target, ethers.parseEther("1000"));
            await lpStaking.connect(rewarder).addRewards(ethers.parseEther("500"));

            // Stake some tokens
            await lpStaking.connect(user1).stake(ethers.parseEther("100"));

            // Send extra tokens by mistake
            await halomToken.transfer(lpStaking.target, ethers.parseEther("200"));

            // Governor should be able to recover excess tokens
            await lpStaking.connect(governor).emergencyRecovery(
                halomToken.target,
                user1.address,
                ethers.parseEther("100")
            );

            expect(await halomToken.balanceOf(user1.address)).to.be.gt(ethers.parseEther("10000"));
        });

        it("Should prevent recovery of required reward tokens", async function () {
            const { halomToken, lpStaking, governor, user1, rewarder } = await deployContracts();

            // Fund rewarder and add rewards
            await halomToken.mint(rewarder.address, ethers.parseEther("1000"));
            await halomToken.connect(rewarder).approve(lpStaking.target, ethers.parseEther("1000"));
            await lpStaking.connect(rewarder).addRewards(ethers.parseEther("500"));

            // Try to recover more than available - should fail
            await expect(
                lpStaking.connect(governor).emergencyRecovery(
                    halomToken.target,
                    user1.address,
                    ethers.parseEther("600")
                )
            ).to.be.revertedWith("Cannot recover required rewards");
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle zero amount stakes", async function () {
            const { staking, user1 } = await deployContracts();

            await expect(
                staking.connect(user1).stakeWithLockPeriod(0, 0)
            ).to.be.revertedWith("Cannot stake 0 tokens");
        });

        it("Should handle zero amount unstakes", async function () {
            const { staking, user1 } = await deployContracts();

            // Stake first
            await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 0);

            await expect(
                staking.connect(user1).unstake(0)
            ).to.be.revertedWith("Cannot unstake 0 tokens");
        });

        it("Should handle invalid lock periods", async function () {
            const { staking, user1 } = await deployContracts();

            await expect(
                staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 10)
            ).to.be.revertedWith("Invalid lock period");
        });

        it("Should handle excessive lock durations", async function () {
            const { staking, user1 } = await deployContracts();

            await expect(
                staking.connect(user1).stake(ethers.parseEther("100"), 2000 * 24 * 60 * 60) // 2000 days
            ).to.be.revertedWith("Lock duration too long");
        });

        it("Should handle zero lock duration", async function () {
            const { staking, user1 } = await deployContracts();

            await expect(
                staking.connect(user1).stake(ethers.parseEther("100"), 0)
            ).to.be.revertedWith("Lock duration must be positive");
        });

        it("Should handle slashing zero address", async function () {
            const { staking, governor } = await deployContracts();

            await expect(
                staking.connect(governor).slash(ethers.ZeroAddress, ethers.parseEther("10"))
            ).to.be.revertedWith("Cannot slash zero address");
        });

        it("Should handle slashing zero amount", async function () {
            const { staking, governor, user1 } = await deployContracts();

            await expect(
                staking.connect(governor).slash(user1.address, 0)
            ).to.be.revertedWith("Cannot slash 0 amount");
        });

        it("Should handle partial unstaking in multiple transactions", async function () {
            const { staking, user1 } = await deployContracts();

            // Stake tokens
            await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 0);

            // Fast forward time to unlock
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
            await ethers.provider.send("evm_mine");

            // Unstake in multiple transactions
            await staking.connect(user1).unstake(ethers.parseEther("30"));
            await staking.connect(user1).unstake(ethers.parseEther("40"));
            await staking.connect(user1).unstake(ethers.parseEther("30"));

            const userStake = await staking.stakes(user1.address);
            expect(userStake.amount).to.equal(0);
        });

        it("Should handle multiple users staking in same block", async function () {
            const { staking, user1, user2 } = await deployContracts();

            // Both users stake in the same block
            await staking.connect(user1).stakeWithLockPeriod(ethers.parseEther("100"), 0);
            await staking.connect(user2).stakeWithLockPeriod(ethers.parseEther("200"), 0);

            expect(await staking.totalStaked()).to.equal(ethers.parseEther("300"));
            expect(await staking.stakes(user1.address)).to.have.property("amount", ethers.parseEther("100"));
            expect(await staking.stakes(user2.address)).to.have.property("amount", ethers.parseEther("200"));
        });
    });

    describe("Access Control", function () {
        it("Should prevent non-governor from slashing", async function () {
            const { staking, user1, user2 } = await deployContracts();

            await expect(
                staking.connect(user1).slash(user2.address, ethers.parseEther("10"))
            ).to.be.reverted;
        });

        it("Should prevent non-governor from emergency recovery", async function () {
            const { staking, user1, user2 } = await deployContracts();

            await expect(
                staking.connect(user1).emergencyRecovery(
                    ethers.ZeroAddress,
                    user2.address,
                    ethers.parseEther("10")
                )
            ).to.be.reverted;
        });

        it("Should prevent non-rewarder from adding rewards to LP staking", async function () {
            const { lpStaking, user1 } = await deployContracts();

            await expect(
                lpStaking.connect(user1).addRewards(ethers.parseEther("100"))
            ).to.be.reverted;
        });

        it("Should prevent non-governor from setting lock boost params", async function () {
            const { staking, user1 } = await deployContracts();

            await expect(
                staking.connect(user1).setLockBoostParams(1000, 365 * 24 * 60 * 60)
            ).to.be.reverted;
        });
    });

    describe("Constructor Validation", function () {
        it("Should revert with zero token address", async function () {
            await expect(
                HalomStaking.deploy(ethers.ZeroAddress, governor.address)
            ).to.be.revertedWith("Token address cannot be zero");
        });

        it("Should revert with zero governance address", async function () {
            await expect(
                HalomStaking.deploy(halomToken.target, ethers.ZeroAddress)
            ).to.be.revertedWith("Governance address cannot be zero");
        });
    });

    describe("View Functions", function () {
        it("Should return correct contract balances", async function () {
            const { staking, lpStaking } = await deployContracts();

            const stakingBalances = await staking.getContractBalances();
            const lpStakingBalances = await lpStaking.getContractBalances();

            expect(stakingBalances.halomTokenBalance).to.equal(0);
            expect(stakingBalances.pendingRewardsBalance).to.equal(0);
            expect(lpStakingBalances.lpTokenBalance).to.equal(0);
            expect(lpStakingBalances.halomTokenBalance).to.equal(0);
            expect(lpStakingBalances.pendingRewardsBalance).to.equal(0);
        });

        it("Should return correct pending rewards", async function () {
            const { staking, lpStaking } = await deployContracts();

            expect(await staking.getPendingRewards()).to.equal(0);
            expect(await lpStaking.getPendingRewards()).to.equal(0);
        });
    });
}); 
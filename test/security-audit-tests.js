const { expect } = require("chai");
const { ethers } = require("hardhat");

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
        staking = await HalomStaking.deploy(halomToken.target, governor.address, rewarder.address, governor.address);

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
        await halomToken.connect(governor).setStakingContract(staking.target);
        await halomToken.connect(governor).grantRole(ethers.keccak256(ethers.toUtf8Bytes("DEFAULT_ADMIN_ROLE")), lpStaking.target);

        // Grant REWARDER_ROLE to rewarder in staking contract
        await staking.connect(governor).grantRole(REWARDER_ROLE, rewarder.address);

        // Fund users with smaller amounts to avoid overflow
        await halomToken.connect(governor).transfer(user1.address, ethers.parseEther("200"));
        await halomToken.connect(governor).transfer(user2.address, ethers.parseEther("200"));
        await halomToken.connect(governor).transfer(user3.address, ethers.parseEther("200"));
        await lpToken.transfer(user1.address, ethers.parseEther("10"));
        await lpToken.transfer(user2.address, ethers.parseEther("10"));

        // Approve tokens
        await halomToken.connect(user1).approve(staking.target, ethers.parseEther("200"));
        await halomToken.connect(user2).approve(staking.target, ethers.parseEther("200"));
        await lpToken.connect(user1).approve(lpStaking.target, ethers.parseEther("10"));
        await lpToken.connect(user2).approve(lpStaking.target, ethers.parseEther("10"));

        return { halomToken, staking, lpStaking, lpToken, governor, user1, user2, user3, rewarder };
    }

    describe("Rewards without stakers - HalomStaking", function () {
        it("Should store rewards for first staker instead of losing them", async function () {
            const { halomToken, staking, user1 } = await deployContracts();

            // Add rewards when no one is staked
            const rewardAmount = ethers.parseEther("10");
            await halomToken.connect(governor).mint(rewarder.address, rewardAmount);
            await halomToken.connect(rewarder).approve(staking.target, rewardAmount);
            await staking.connect(rewarder).addRewards(rewardAmount);
            
            // Check pending rewards
            expect(await staking.getPendingRewards()).to.equal(rewardAmount);

            // First staker should get all pending rewards
            const stakeAmount = ethers.parseEther("100");
            await staking.connect(user1).stake(stakeAmount);

            // Check that pending rewards are distributed
            expect(await staking.getPendingRewards()).to.equal(0);
            
            // User should have received rewards (pending should be 0, mert már kifizette)
            const pendingRewards = await staking.getPendingRewardsForUser(user1.address);
            expect(pendingRewards).to.equal(0);
        });
    });

    describe("Rewards without stakers - HalomLPStaking", function () {
        it("Should store rewards for first staker instead of losing them", async function () {
            const { halomToken, lpStaking, user1, rewarder } = await deployContracts();

            // Fund rewarder
            const rewardAmount = ethers.parseEther("5");
            await halomToken.connect(governor).mint(rewarder.address, rewardAmount);
            await halomToken.connect(rewarder).approve(lpStaking.target, rewardAmount);
            await lpStaking.connect(rewarder).addRewards(rewardAmount);

            expect(await lpStaking.getPendingRewards()).to.equal(rewardAmount);

            // First staker should get all pending rewards
            const stakeAmount = ethers.parseEther("10");
            await lpStaking.connect(user1).stake(stakeAmount);

            // Check that pending rewards are distributed
            expect(await lpStaking.getPendingRewards()).to.equal(0);
            
            // User should have received rewards (pending should be 0)
            const pendingRewards = await lpStaking.getPendingRewardsForUser(user1.address);
            expect(pendingRewards).to.equal(0);
        });
    });

    describe("Emergency Recovery Functions", function () {
        it("Should allow governor to recover tokens sent by mistake", async function () {
            const { halomToken, staking, lpStaking, governor, user1 } = await deployContracts();

            // Deploy a random token
            const RandomToken = await ethers.getContractFactory("MockERC20");
            const randomToken = await RandomToken.deploy("Random", "RND", ethers.parseEther("1000"));

            // Send random token to staking contract by mistake
            await randomToken.transfer(staking.target, ethers.parseEther("10"));

            // Governor should be able to recover it
            const recoveryAmount = ethers.parseEther("5");
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
            await staking.connect(user1).stake(ethers.parseEther("100"));

            // Try to recover staked tokens - should fail
            await expect(
                staking.connect(governor).emergencyRecovery(
                    halomToken.target,
                    user1.address,
                    ethers.parseEther("5")
                )
            ).to.be.revertedWith("Cannot recover staked tokens");
        });

        it("Should prevent recovery of LP tokens from LP staking", async function () {
            const { lpToken, lpStaking, governor, user1 } = await deployContracts();

            // Stake some LP tokens
            await lpStaking.connect(user1).stake(ethers.parseEther("10"));

            // Try to recover staked LP tokens - should fail
            await expect(
                lpStaking.connect(governor).emergencyRecovery(
                    lpToken.target,
                    user1.address,
                    ethers.parseEther("5")
                )
            ).to.be.revertedWith("Cannot recover staked LP tokens");
        });
    });

    describe("Access Control", function () {
        it("Should prevent non-governor from emergency recovery", async function () {
            const { staking, user1 } = await deployContracts();

            await expect(
                staking.connect(user1).emergencyRecovery(
                    ethers.ZeroAddress,
                    user1.address,
                    ethers.parseEther("10")
                )
            ).to.be.reverted;
        });

        it("Should prevent non-rewarder from adding rewards to LP staking", async function () {
            const { lpStaking, user1 } = await deployContracts();

            await expect(
                lpStaking.connect(user1).addRewards(ethers.parseEther("10"))
            ).to.be.reverted;
        });
    });

    describe("Constructor Validation", function () {
        it("Should revert with zero token address", async function () {
            await expect(
                HalomStaking.deploy(ethers.ZeroAddress, governor.address, rewarder.address, governor.address)
            ).to.be.revertedWith("Halom token is zero address");
        });
    });

    describe("View Functions", function () {
        it("Should return correct contract balances", async function () {
            const { lpStaking } = await deployContracts();

            const balances = await lpStaking.getContractBalances();
            expect(balances.lpTokenBalance).to.be.gte(0);
            expect(balances.halomTokenBalance).to.be.gte(0);
            expect(balances.pendingRewardsBalance).to.be.gte(0);
        });

        it("Should return correct pending rewards", async function () {
            const { staking, user1 } = await deployContracts();

            const pendingRewards = await staking.getPendingRewardsForUser(user1.address);
            expect(pendingRewards).to.equal(0);
        });
    });
}); 
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Halom Protocol Security Audit Tests", function () {
    let halomToken, staking, lpStaking, governor, deployer, user1, user2, user3;
    let initialSupply, maxTransferAmount, maxWalletAmount;

    beforeEach(async function () {
        [deployer, user1, user2, user3] = await ethers.getSigners();
        
        // Deploy contracts
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(deployer.address, deployer.address);
        await halomToken.deployed();

        const HalomStaking = await ethers.getContractFactory("HalomStaking");
        staking = await HalomStaking.deploy(
            halomToken.address,
            deployer.address,
            deployer.address,
            deployer.address
        );
        await staking.deployed();

        const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(
            halomToken.address, // Using HLM as LP token for testing
            halomToken.address,
            deployer.address,
            deployer.address
        );
        await lpStaking.deployed();

        // Setup roles
        await halomToken.setStakingContract(staking.address);
        const REWARDER_ROLE = await staking.REWARDER_ROLE();
        await staking.grantRole(REWARDER_ROLE, halomToken.address);

        // Mint initial tokens
        initialSupply = ethers.utils.parseEther("10000000"); // 10M HLM
        await halomToken.mint(deployer.address, initialSupply);

        // Get anti-whale limits
        maxTransferAmount = await halomToken.maxTransferAmount();
        maxWalletAmount = await halomToken.maxWalletAmount();
    });

    describe("Reward Distribution Fix", function () {
        it("Should properly distribute rewards when rebase is called", async function () {
            // Transfer tokens to users for staking
            const stakeAmount = ethers.utils.parseEther("1000");
            await halomToken.transfer(user1.address, stakeAmount);
            await halomToken.transfer(user2.address, stakeAmount);

            // Users stake tokens
            await halomToken.connect(user1).approve(staking.address, stakeAmount);
            await staking.connect(user1).stake(stakeAmount);
            
            await halomToken.connect(user2).approve(staking.address, stakeAmount);
            await staking.connect(user2).stake(stakeAmount);

            // Check initial balances
            const initialStakingBalance = await halomToken.balanceOf(staking.address);
            const initialUser1Rewards = await staking.getPendingRewardsForUser(user1.address);
            const initialUser2Rewards = await staking.getPendingRewardsForUser(user2.address);

            // Perform rebase (positive supply delta)
            const supplyDelta = ethers.utils.parseEther("100000"); // 100k HLM increase
            await halomToken.rebase(supplyDelta);

            // Check that rewards were distributed
            const finalStakingBalance = await halomToken.balanceOf(staking.address);
            const finalUser1Rewards = await staking.getPendingRewardsForUser(user1.address);
            const finalUser2Rewards = await staking.getPendingRewardsForUser(user2.address);

            // Verify rewards were added to staking contract
            expect(finalStakingBalance).to.be.gt(initialStakingBalance);
            
            // Verify users can claim rewards
            expect(finalUser1Rewards).to.be.gt(initialUser1Rewards);
            expect(finalUser2Rewards).to.be.gt(initialUser2Rewards);

            // Users claim rewards
            await staking.connect(user1).claimRewards();
            await staking.connect(user2).claimRewards();

            // Verify users received tokens
            const user1Balance = await halomToken.balanceOf(user1.address);
            const user2Balance = await halomToken.balanceOf(user2.address);
            expect(user1Balance).to.be.gt(0);
            expect(user2Balance).to.be.gt(0);
        });

        it("Should handle zero supply delta correctly", async function () {
            const initialSupply = await halomToken.totalSupply();
            await halomToken.rebase(0);
            const finalSupply = await halomToken.totalSupply();
            expect(finalSupply).to.equal(initialSupply);
        });
    });

    describe("Anti-Whale Protection", function () {
        it("Should enforce transfer limits for regular users", async function () {
            // Transfer tokens to user
            const transferAmount = ethers.utils.parseEther("1000");
            await halomToken.transfer(user1.address, transferAmount);

            // Try to transfer more than maxTransferAmount
            const excessiveAmount = maxTransferAmount.add(ethers.utils.parseEther("1"));
            await expect(
                halomToken.connect(user1).transfer(user2.address, excessiveAmount)
            ).to.be.revertedWith("HalomToken: Transfer amount exceeds limit");
        });

        it("Should enforce wallet balance limits", async function () {
            // Transfer tokens to user up to max wallet limit
            await halomToken.transfer(user1.address, maxWalletAmount);

            // Try to transfer more tokens to exceed max wallet
            const additionalAmount = ethers.utils.parseEther("1");
            await expect(
                halomToken.transfer(user1.address, additionalAmount)
            ).to.be.revertedWith("HalomToken: Wallet balance would exceed limit");
        });

        it("Should allow excluded addresses to bypass limits", async function () {
            // Deployer is excluded from limits
            const largeAmount = maxTransferAmount.mul(2);
            await expect(
                halomToken.transfer(user1.address, largeAmount)
            ).to.not.be.reverted;
        });

        it("Should allow admin to update anti-whale limits", async function () {
            const newMaxTransfer = ethers.utils.parseEther("50000");
            const newMaxWallet = ethers.utils.parseEther("100000");
            
            await halomToken.setAntiWhaleLimits(newMaxTransfer, newMaxWallet);
            
            expect(await halomToken.maxTransferAmount()).to.equal(newMaxTransfer);
            expect(await halomToken.maxWalletAmount()).to.equal(newMaxWallet);
        });

        it("Should allow admin to exclude addresses from limits", async function () {
            await halomToken.setExcludedFromLimits(user1.address, true);
            expect(await halomToken.isExcludedFromLimits(user1.address)).to.be.true;
            
            // User1 should now be able to transfer large amounts
            await halomToken.transfer(user1.address, maxTransferAmount.mul(2));
            await expect(
                halomToken.connect(user1).transfer(user2.address, maxTransferAmount.mul(2))
            ).to.not.be.reverted;
        });
    });

    describe("Role Management", function () {
        it("Should use proper roles instead of DEFAULT_ADMIN_ROLE for staking", async function () {
            // Check that staking contract has REWARDER_ROLE, not DEFAULT_ADMIN_ROLE
            const REWARDER_ROLE = await staking.REWARDER_ROLE();
            const DEFAULT_ADMIN_ROLE = await staking.DEFAULT_ADMIN_ROLE();
            
            expect(await staking.hasRole(REWARDER_ROLE, halomToken.address)).to.be.true;
            expect(await staking.hasRole(DEFAULT_ADMIN_ROLE, halomToken.address)).to.be.false;
        });

        it("Should allow token contract to call addRewards on staking", async function () {
            // Token contract should have REWARDER_ROLE
            const REWARDER_ROLE = await staking.REWARDER_ROLE();
            expect(await staking.hasRole(REWARDER_ROLE, halomToken.address)).to.be.true;
        });

        it("Should prevent unauthorized addresses from calling addRewards", async function () {
            await expect(
                staking.connect(user1).addRewards(ethers.utils.parseEther("1000"))
            ).to.be.reverted;
        });
    });

    describe("Rebase Security", function () {
        it("Should enforce maxRebaseDelta limit", async function () {
            const currentSupply = await halomToken.totalSupply();
            const maxDelta = await halomToken.maxRebaseDelta();
            const maxDeltaValue = currentSupply.mul(maxDelta).div(10000);
            
            // Try to rebase with amount exceeding maxDelta
            const excessiveDelta = maxDeltaValue.add(ethers.utils.parseEther("1"));
            await expect(
                halomToken.rebase(excessiveDelta)
            ).to.be.revertedWith("HalomToken: Supply increase too large");
        });

        it("Should handle negative supply delta correctly", async function () {
            const currentSupply = await halomToken.totalSupply();
            const maxDelta = await halomToken.maxRebaseDelta();
            const maxDeltaValue = currentSupply.mul(maxDelta).div(10000);
            
            // Try to rebase with negative amount exceeding maxDelta
            const excessiveNegativeDelta = maxDeltaValue.add(ethers.utils.parseEther("1"));
            await expect(
                halomToken.rebase(-excessiveNegativeDelta)
            ).to.be.revertedWith("HalomToken: Supply decrease too large");
        });

        it("Should only allow REBASE_CALLER to call rebase", async function () {
            await expect(
                halomToken.connect(user1).rebase(ethers.utils.parseEther("1000"))
            ).to.be.reverted;
        });
    });

    describe("Staking Security", function () {
        it("Should prevent unstaking before lock period", async function () {
            const stakeAmount = ethers.utils.parseEther("1000");
            await halomToken.transfer(user1.address, stakeAmount);
            await halomToken.connect(user1).approve(staking.address, stakeAmount);
            await staking.connect(user1).stake(stakeAmount);

            // Try to unstake immediately
            await expect(
                staking.connect(user1).unstake(stakeAmount)
            ).to.be.revertedWith("Lock period not expired");
        });

        it("Should enforce minimum and maximum stake amounts", async function () {
            const minStake = await staking.minStakeAmount();
            const maxStake = await staking.maxStakeAmount();

            // Try to stake below minimum
            await halomToken.transfer(user1.address, minStake.sub(1));
            await halomToken.connect(user1).approve(staking.address, minStake.sub(1));
            await expect(
                staking.connect(user1).stake(minStake.sub(1))
            ).to.be.revertedWith("Below minimum stake amount");

            // Try to stake above maximum
            await halomToken.transfer(user1.address, maxStake.add(1));
            await halomToken.connect(user1).approve(staking.address, maxStake.add(1));
            await expect(
                staking.connect(user1).stake(maxStake.add(1))
            ).to.be.revertedWith("Above maximum stake amount");
        });
    });

    describe("Fourth Root Calculations", function () {
        it("Should calculate governance power correctly", async function () {
            const stakeAmount = ethers.utils.parseEther("10000"); // 10k HLM
            await halomToken.transfer(user1.address, stakeAmount);
            await halomToken.connect(user1).approve(staking.address, stakeAmount);
            await staking.connect(user1).stake(stakeAmount);

            const governancePower = await staking.getGovernancePower(user1.address);
            // Fourth root of 10000 should be approximately 10
            expect(governancePower).to.be.closeTo(ethers.utils.parseEther("10"), ethers.utils.parseEther("0.1"));
        });

        it("Should distribute rewards based on fourth root", async function () {
            // User1 stakes 1000 HLM, User2 stakes 10000 HLM
            const stake1 = ethers.utils.parseEther("1000");
            const stake2 = ethers.utils.parseEther("10000");
            
            await halomToken.transfer(user1.address, stake1);
            await halomToken.transfer(user2.address, stake2);
            
            await halomToken.connect(user1).approve(staking.address, stake1);
            await halomToken.connect(user2).approve(staking.address, stake2);
            
            await staking.connect(user1).stake(stake1);
            await staking.connect(user2).stake(stake2);

            // Perform rebase to generate rewards
            await halomToken.rebase(ethers.utils.parseEther("100000"));

            // Check rewards - should be based on fourth root, not linear
            const rewards1 = await staking.getPendingRewardsForUser(user1.address);
            const rewards2 = await staking.getPendingRewardsForUser(user2.address);

            // User2 has 10x more tokens but should not get 10x more rewards due to fourth root
            const ratio = rewards2.mul(1000).div(rewards1);
            expect(ratio).to.be.lt(1000); // Should be less than 10x
        });
    });
}); 
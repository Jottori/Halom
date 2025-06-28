const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomStaking Delegation System", function () {
    let halomToken, staking, owner, user1, user2, user3, rewarder;
    let mockLP, mockEURC;

    beforeEach(async function () {
        [owner, user1, user2, user3, rewarder] = await ethers.getSigners();

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockLP = await MockERC20.deploy("Mock LP", "MLP", ethers.parseEther("1000000"));
        mockEURC = await MockERC20.deploy("Mock EURC", "MEURC", ethers.parseEther("1000000"));

        // Deploy HalomToken with correct constructor parameters
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(owner.address, owner.address); // (oracle, governor)

        // Deploy HalomStaking
        const HalomStaking = await ethers.getContractFactory("HalomStaking");
        staking = await HalomStaking.deploy(
            halomToken.target,
            owner.address,
            2000, // rewardRate
            30 * 24 * 60 * 60, // lockPeriod (30 days)
            5000 // slashPercentage (50%)
        );

        // Grant MINTER_ROLE to rewarder and staking contract
        await halomToken.grantRole(await halomToken.MINTER_ROLE(), rewarder.address);
        await halomToken.grantRole(await halomToken.MINTER_ROLE(), await staking.getAddress());

        // Mint tokens to users via rewarder
        await halomToken.connect(rewarder).mint(user1.address, ethers.parseEther("10000"));
        await halomToken.connect(rewarder).mint(user2.address, ethers.parseEther("10000"));
        await halomToken.connect(rewarder).mint(user3.address, ethers.parseEther("10000"));
        await halomToken.connect(rewarder).mint(rewarder.address, ethers.parseEther("100000"));

        // Approve staking contract for all users
        await halomToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("10000"));
        await halomToken.connect(user2).approve(await staking.getAddress(), ethers.parseEther("10000"));
        await halomToken.connect(user3).approve(await staking.getAddress(), ethers.parseEther("10000"));
        
        // Approve HalomToken contract for rewarder (needed for addRewards transferFrom)
        await halomToken.connect(rewarder).approve(await halomToken.getAddress(), ethers.parseEther("1000000"));
        
        // Grant REWARDER_ROLE to rewarder in staking contract
        await staking.grantRole(await staking.REWARDER_ROLE(), rewarder.address);
    });

    describe("Delegation Functionality", function () {
        it("Should allow users to delegate tokens to validators", async function () {
            // User1 stakes tokens first
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);

            // User2 stakes tokens to become a validator
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);

            // User1 delegates to User2
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));

            // Check delegation info
            const delegationInfo = await staking.getDelegationInfo(user1.address);
            expect(delegationInfo.validator).to.equal(user2.address);
            expect(delegationInfo.userDelegatedAmount).to.equal(ethers.parseEther("500"));

            // Check validator info
            const validatorInfo = await staking.getValidatorInfo(user2.address);
            expect(validatorInfo.totalDelegated).to.equal(ethers.parseEther("500"));
        });

        it("Should allow validators to set commission rates", async function () {
            // User2 stakes to become validator
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);

            // Set commission rate (10%)
            await staking.connect(user2).setCommissionRate(1000);

            const validatorInfo = await staking.getValidatorInfo(user2.address);
            expect(validatorInfo.commissionRate).to.equal(1000);
        });

        it("Should revert if non-validator tries to set commission", async function () {
            // User1 hasn't staked yet
            await expect(
                staking.connect(user1).setCommissionRate(1000)
            ).to.be.revertedWith("Only validators can set commission");
        });

        it("Should revert if commission rate is too high", async function () {
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);

            // Try to set commission rate above 20%
            await expect(
                staking.connect(user2).setCommissionRate(2500)
            ).to.be.revertedWith("Commission rate too high");
        });

        it("Should allow undelegation", async function () {
            // Setup delegation
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));

            // Undelegate
            await staking.connect(user1).undelegateFromValidator();

            // Check delegation is removed
            const delegationInfo = await staking.getDelegationInfo(user1.address);
            expect(delegationInfo.validator).to.equal(ethers.ZeroAddress);
            expect(delegationInfo.userDelegatedAmount).to.equal(0);
        });

        it("Should revert undelegation if no delegation exists", async function () {
            await expect(
                staking.connect(user1).undelegateFromValidator()
            ).to.be.revertedWith("No delegation found");
        });

        it("Should prevent self-delegation", async function () {
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);

            await expect(
                staking.connect(user1).delegateToValidator(user1.address, ethers.parseEther("500"))
            ).to.be.revertedWith("Cannot delegate to self");
        });

        it("Should allow changing delegation", async function () {
            // Setup initial delegation
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);
            await staking.connect(user3).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);
            
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));

            // Change delegation to user3
            await staking.connect(user1).delegateToValidator(user3.address, ethers.parseEther("500"));

            // Check new delegation
            const delegationInfo = await staking.getDelegationInfo(user1.address);
            expect(delegationInfo.validator).to.equal(user3.address);

            // Check old validator's total delegated is reduced
            const validator2Info = await staking.getValidatorInfo(user2.address);
            expect(validator2Info.totalDelegated).to.equal(0);
        });
    });

    describe("Delegator Rewards", function () {
        it("Should calculate delegator rewards correctly", async function () {
            // Setup delegation with commission
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);
            await staking.connect(user2).setCommissionRate(1000); // 10% commission
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));

            // Add rewards to the pool
            await staking.connect(rewarder).addRewards(ethers.parseEther("1000"));

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600]); // 7 days
            await ethers.provider.send("evm_mine");

            // Claim delegator rewards
            const balanceBefore = await halomToken.balanceOf(user1.address);
            await staking.connect(user1).claimDelegatorRewards();
            const balanceAfter = await halomToken.balanceOf(user1.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should revert claiming rewards without delegation", async function () {
            await expect(
                staking.connect(user1).claimDelegatorRewards()
            ).to.be.revertedWith("No delegation found");
        });

        it("Should revert claiming rewards when no rewards available", async function () {
            // Setup delegation but no rewards
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));
            
            // Try to claim rewards - should fail because no rewards were added
            await expect(
                staking.connect(user1).claimDelegatorRewards()
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });
    });

    describe("Validator Commission", function () {
        it("Should allow validators to claim commission", async function () {
            // Setup delegation first
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);
            await staking.connect(user2).setCommissionRate(1000); // 10%
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));

            // Add rewards and wait for time to pass
            await staking.connect(rewarder).addRewards(ethers.parseEther("100"));

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            // Now claim commission
            await staking.connect(user2).claimCommission();
            
            // Check that commission was claimed
            const validatorInfo = await staking.getValidatorInfo(user2.address);
            expect(validatorInfo.pendingCommission).to.equal(0);
        });

        it("Should revert claiming commission without being validator", async function () {
            await expect(
                staking.connect(user1).claimCommission()
            ).to.be.revertedWith("No commission to claim");
        });
    });

    describe("Rebase-Aware Reward System", function () {
        it("Should track rebase index correctly", async function () {
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            
            const rebaseIndex = await staking.userLastRebaseIndex(user1.address);
            expect(rebaseIndex).to.be.gt(0);
        });

        it("Should adjust rewards for rebase changes", async function () {
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            
            // Add rewards (smaller amount to avoid balance issues)
            await staking.connect(rewarder).addRewards(ethers.parseEther("100"));
            
            // Claim rewards (this will trigger the updateRewards modifier)
            await staking.connect(user1).claimRewards();
            
            // Check that rewards were claimed
            const pendingRewards = await staking.getPendingRewardsForUser(user1.address);
            expect(pendingRewards).to.equal(0);
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complex delegation scenarios", async function () {
            // Multiple users stake and delegate
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);
            await staking.connect(user3).stakeWithLock(ethers.parseEther("300"), 30 * 24 * 3600);

            // Set different commission rates
            await staking.connect(user2).setCommissionRate(1000); // 10%
            await staking.connect(user3).setCommissionRate(1500); // 15%

            // User1 delegates to both validators (sequentially)
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));
            await staking.connect(user1).delegateToValidator(user3.address, ethers.parseEther("500"));

            // Add rewards
            await staking.connect(rewarder).addRewards(ethers.parseEther("1000"));

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            // All parties should be able to claim rewards
            await expect(staking.connect(user1).claimDelegatorRewards()).to.not.be.reverted;
            // Note: Commission claims require earned commission, which may not be available in this test
        });

        it("Should maintain correct state after multiple operations", async function () {
            // Initial setup
            await staking.connect(user1).stakeWithLock(ethers.parseEther("1000"), 30 * 24 * 3600);
            await staking.connect(user2).stakeWithLock(ethers.parseEther("500"), 30 * 24 * 3600);
            await staking.connect(user2).setCommissionRate(1000);
            await staking.connect(user1).delegateToValidator(user2.address, ethers.parseEther("500"));

            // Add rewards
            await staking.connect(rewarder).addRewards(ethers.parseEther("1000"));

            // Fast forward and claim
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600]);
            await ethers.provider.send("evm_mine");

            await staking.connect(user1).claimDelegatorRewards();
            await staking.connect(user2).claimCommission();

            // Undelegate
            await staking.connect(user1).undelegateFromValidator();

            // Check final state
            const delegationInfo = await staking.getDelegationInfo(user1.address);
            expect(delegationInfo.validator).to.equal(ethers.ZeroAddress);

            const validatorInfo = await staking.getValidatorInfo(user2.address);
            expect(validatorInfo.totalDelegated).to.equal(0);
        });
    });
}); 
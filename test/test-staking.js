const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomStaking", function () {
    let HalomToken, token, HalomStaking, staking;
    let owner, governor, slasher, rewarder, staker1, staker2;

    const GOVERNOR_ROLE = ethers.utils.id("GOVERNOR_ROLE");
    const SLASHER_ROLE = ethers.utils.id("SLASHER_ROLE");
    const REWARDER_ROLE = ethers.utils.id("REWARDER_ROLE");

    async function deployStakingFixture() {
        [owner, governor, slasher, rewarder, staker1, staker2] = await ethers.getSigners();

        // Deploy Token
        HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy(governor.address, owner.address); // Governor, placeholder rebase caller
        await token.deployed();

        // Deploy Staking contract
        HalomStaking = await ethers.getContractFactory("HalomStaking");
        staking = await HalomStaking.deploy(token.address, governor.address, slasher.address, rewarder.address);
        await staking.deployed();
        
        // Grant minter role to staking contract for rewards
        const MINTER_ROLE = await token.MINTER_ROLE();
        await token.connect(governor).grantRole(MINTER_ROLE, staking.address);
        
        // Prepare tokens for stakers
        const initialMint = ethers.utils.parseUnits("10000", 18);
        await token.connect(governor).mint(staker1.address, initialMint);
        await token.connect(governor).mint(staker2.address, initialMint);
        await token.connect(staker1).approve(staking.address, initialMint);
        await token.connect(staker2).approve(staking.address, initialMint);

        return { token, staking, governor, slasher, rewarder, staker1, staker2 };
    }

    describe("Deployment and Role Setup", function () {
        it("Should set the correct roles on deployment", async function () {
            const { staking, governor, slasher, rewarder } = await loadFixture(deployStakingFixture);
            expect(await staking.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
            expect(await staking.hasRole(SLASHER_ROLE, slasher.address)).to.be.true;
            expect(await staking.hasRole(REWARDER_ROLE, rewarder.address)).to.be.true;
        });
    });

    describe("Staking, Unstaking, and Rewards", function () {
        it("Should allow staking and correctly update balances", async function () {
            const { staking, staker1 } = await loadFixture(deployStakingFixture);
            const amount = ethers.utils.parseUnits("1000", 18);
            await expect(staking.connect(staker1).stake(amount))
                .to.emit(staking, "Staked").withArgs(staker1.address, amount);
            expect(await staking.balanceOf(staker1.address)).to.equal(amount);
        });

        it("Should distribute rewards correctly", async function () {
            const { token, staking, rewarder, staker1 } = await loadFixture(deployStakingFixture);
            const stakeAmount = ethers.utils.parseUnits("1000", 18);
            await staking.connect(staker1).stake(stakeAmount);

            const rewardAmount = ethers.utils.parseUnits("100", 18);
            await token.connect(governor).mint(rewarder.address, rewardAmount);
            await token.connect(rewarder).approve(staking.address, rewardAmount);
            await staking.connect(rewarder).addRewards(rewardAmount);

            const initialBalance = await token.balanceOf(staker1.address);
            await staking.connect(staker1).claimRewards();
            const finalBalance = await token.balanceOf(staker1.address);
            
            expect(finalBalance).to.be.gt(initialBalance);
            expect(finalBalance).to.be.closeTo(initialBalance.add(rewardAmount), 1);
        });
    });
    
    describe("Slashing", function () {
        it("Should allow slasher to slash a staker", async function () {
            const { token, staking, slasher, staker1 } = await loadFixture(deployStakingFixture);
            const stakeAmount = ethers.utils.parseUnits("1000", 18);
            await staking.connect(staker1).stake(stakeAmount);

            const slashAmount = ethers.utils.parseUnits("100", 18);
            const initialTotalSupply = await token.totalSupply();
            const initialRewardsPerShare = await staking.rewardsPerShare();

            await staking.connect(slasher).slash(staker1.address, slashAmount);

            const finalTotalSupply = await token.totalSupply();
            const finalRewardsPerShare = await staking.rewardsPerShare();

            // 50% burned
            expect(finalTotalSupply).to.equal(initialTotalSupply.sub(slashAmount.div(2)));
            // 50% to rewards
            expect(finalRewardsPerShare).to.be.gt(initialRewardsPerShare);
            expect(await staking.balanceOf(staker1.address)).to.equal(stakeAmount.sub(slashAmount));
        });

        it("Should revert if non-slasher tries to slash", async function () {
             const { staking, staker1, staker2 } = await loadFixture(deployStakingFixture);
             await staking.connect(staker1).stake(1000);
             await expect(staking.connect(staker2).slash(staker1.address, 100)).to.be.reverted;
        });
    });

    describe("Governance Guardrails", function () {
        it("Should allow governor to set lock boost params within limits", async function () {
            const { staking, governor } = await loadFixture(deployStakingFixture);
            const newB0 = 4000; // 40%
            const newTMax = 60 * 24 * 60 * 60; // 60 days
            await expect(staking.connect(governor).setLockBoostParams(newB0, newTMax)).to.not.be.reverted;
            expect(await staking.lockBoostB0()).to.equal(newB0);
            expect(await staking.lockBoostTMax()).to.equal(newTMax);
        });

        it("Should revert if lock boost B0 is set too high", async function () {
            const { staking, governor } = await loadFixture(deployStakingFixture);
            const highB0 = 5001; // > 50%
            const tMax = 365 * 24 * 60 * 60;
            await expect(staking.connect(governor).setLockBoostParams(highB0, tMax))
                .to.be.revertedWith("B0 cannot exceed 50%");
        });

        it("Should revert if lock boost TMax is out of bounds", async function () {
            const { staking, governor } = await loadFixture(deployStakingFixture);
            const b0 = 2000;
            const shortTMax = 29 * 24 * 60 * 60; // < 30 days
            const longTMax = 731 * 24 * 60 * 60; // > 730 days

            await expect(staking.connect(governor).setLockBoostParams(b0, shortTMax))
                .to.be.revertedWith("TMax must be between 30 and 730 days");
            
            await expect(staking.connect(governor).setLockBoostParams(b0, longTMax))
                .to.be.revertedWith("TMax must be between 30 and 730 days");
        });
    });
}); 
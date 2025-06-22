const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomLPStaking", function () {
    let HalomToken, halomToken, MockERC20, lpToken, HalomLPStaking, lpStaking;
    let owner, governor, rewarder, user1;

    const REWARDER_ROLE = ethers.utils.id("REWARDER_ROLE");

    async function deployLPStakingFixture() {
        [owner, governor, rewarder, user1] = await ethers.getSigners();

        // Deploy HalomToken (as reward token)
        HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(governor.address, owner.address);
        await halomToken.deployed();

        // Deploy a mock LP token
        MockERC20 = await ethers.getContractFactory("MockERC20");
        lpToken = await MockERC20.deploy("LP Token", "LP", ethers.utils.parseUnits("1000000", 18));
        await lpToken.deployed();
        
        // Deploy LP Staking contract
        HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(lpToken.address, halomToken.address, governor.address, rewarder.address);
        await lpStaking.deployed();

        // Prepare tokens for user
        const lpAmount = ethers.utils.parseUnits("1000", 18);
        await lpToken.transfer(user1.address, lpAmount);
        await lpToken.connect(user1).approve(lpStaking.address, lpAmount);

        // Prepare reward tokens
        const rewardAmount = ethers.utils.parseUnits("5000", 18);
        await halomToken.connect(governor).mint(rewarder.address, rewardAmount);
        await halomToken.connect(rewarder).approve(lpStaking.address, rewardAmount);

        return { halomToken, lpToken, lpStaking, rewarder, user1, lpAmount, rewardAmount };
    }

    it("Should allow a user to stake and receive rewards", async function () {
        const { halomToken, lpStaking, rewarder, user1, lpAmount, rewardAmount } = await loadFixture(deployLPStakingFixture);

        // 1. User stakes LP tokens
        await expect(lpStaking.connect(user1).stake(lpAmount))
            .to.emit(lpStaking, "Staked").withArgs(user1.address, lpAmount);
        expect(await lpStaking.stakedBalance(user1.address)).to.equal(lpAmount);
        
        // 2. Rewarder adds rewards to the pool
        await expect(lpStaking.connect(rewarder).addRewards(rewardAmount))
            .to.emit(lpStaking, "RewardAdded").withArgs(rewarder.address, rewardAmount);
            
        // 3. User claims rewards
        const initialBalance = await halomToken.balanceOf(user1.address);
        await lpStaking.connect(user1).claimRewards();
        const finalBalance = await halomToken.balanceOf(user1.address);

        expect(finalBalance).to.be.gt(initialBalance);
        expect(finalBalance).to.be.closeTo(rewardAmount, 1);
        
        // 4. User unstakes
        await expect(lpStaking.connect(user1).unstake(lpAmount))
            .to.emit(lpStaking, "Unstaked").withArgs(user1.address, lpAmount);
        expect(await lpStaking.stakedBalance(user1.address)).to.equal(0);
    });

    it("Should revert if a non-rewarder tries to add rewards", async function () {
        const { lpStaking, user1, rewardAmount } = await loadFixture(deployLPStakingFixture);
        await expect(lpStaking.connect(user1).addRewards(rewardAmount))
            .to.be.reverted;
    });
});

// A simple mock ERC20 token for testing purposes
const { ContractFactory } = require("ethers");
const { artifacts } = require("hardhat");
const MockERC20Artifact = artifacts.readArtifactSync("contracts/test/MockERC20.sol:MockERC20");

// This is a bit of a hack to get a factory for a contract in a subdirectory
// Hardhat doesn't make this easy out of the box.
const MockERC20Factory = new ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode); 
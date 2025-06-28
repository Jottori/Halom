const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomLPStaking", function () {
    let HalomToken, halomToken, MockERC20, lpToken, HalomLPStaking, lpStaking;
    let owner, governor, rewarder, user1;
    let REWARDER_ROLE, MINTER_ROLE;

    async function deployLPStakingFixture() {
        [owner, governor, rewarder, user1] = await ethers.getSigners();

        // Deploy HalomToken (as reward token)
        HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(owner.address, governor.address); // (oracle, governor)

        // Deploy a mock LP token
        MockERC20 = await ethers.getContractFactory("MockERC20");
        lpToken = await MockERC20.deploy("LP Token", "LP", ethers.parseUnits("1000000", 18));
        
        // Deploy LP Staking contract
        HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(lpToken.target, halomToken.target, governor.address, 2000);

        // Get role constants
        REWARDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REWARDER_ROLE"));
        MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

        // Grant REWARDER_ROLE to rewarder in LP staking contract
        await lpStaking.connect(governor).grantRole(REWARDER_ROLE, rewarder.address);

        // Grant MINTER_ROLE to rewarder (not LP staking contract)
        await halomToken.connect(governor).grantRole(MINTER_ROLE, rewarder.address);

        // Prepare tokens for user
        const lpAmount = ethers.parseUnits("1000", 18);
        await lpToken.transfer(user1.address, lpAmount);
        await lpToken.connect(user1).approve(lpStaking.target, lpAmount);

        // Prepare reward tokens - mint to rewarder
        const rewardAmount = ethers.parseUnits("5000", 18);
        await halomToken.connect(rewarder).mint(rewarder.address, rewardAmount);
        await halomToken.connect(rewarder).approve(lpStaking.target, rewardAmount);

        // Emergency recovery teszt előtt:
        await halomToken.connect(rewarder).approve(await halomToken.getAddress(), ethers.parseEther("1000000"));
        
        // Grant MINTER_ROLE to LP staking contract for rewards
        await halomToken.connect(governor).grantRole(MINTER_ROLE, lpStaking.target);

        return { halomToken, lpToken, lpStaking, rewarder, user1, lpAmount, rewardAmount };
    }

    it("Should allow a user to stake and receive rewards", async function () {
        const { halomToken, lpStaking, rewarder, user1, lpAmount, rewardAmount } = await deployLPStakingFixture();

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
        const { lpStaking, user1, rewardAmount } = await deployLPStakingFixture();
        await expect(lpStaking.connect(user1).addRewards(rewardAmount))
            .to.be.reverted;
    });

    it("Should handle fourth root calculations correctly", async function () {
        const { lpStaking, user1, lpAmount } = await deployLPStakingFixture();

        // Stake tokens
        await lpStaking.connect(user1).stake(lpAmount);
        
        // Check fourth root calculation
        const fourthRoot = await lpStaking.fourthRoot(lpAmount);
        expect(fourthRoot).to.be.gt(0);
        
        // Check governance power
        const governancePower = await lpStaking.getGovernancePower(user1.address);
        expect(governancePower).to.be.gt(0);
    });

    it("Should handle pending rewards correctly", async function () {
        const { halomToken, lpStaking, rewarder, user1, lpAmount, rewardAmount } = await deployLPStakingFixture();

        // Stake tokens
        await lpStaking.connect(user1).stake(lpAmount);
        
        // Add rewards
        await lpStaking.connect(rewarder).addRewards(rewardAmount);
        
        // Check pending rewards
        const pendingRewards = await lpStaking.getPendingRewardsForUser(user1.address);
        expect(pendingRewards).to.be.gt(0);
    });

    it("Should handle emergency recovery correctly", async function () {
        const { halomToken, lpStaking, owner } = await deployLPStakingFixture();

        // Send some tokens to the contract by mistake (smaller amount)
        const recoveryAmount = ethers.parseEther("10"); // Much smaller amount to avoid wallet limit
        await halomToken.transfer(lpStaking.target, recoveryAmount);
        
        // Emergency recovery should be called by governor
        await lpStaking.connect(owner).emergencyRecovery(
            halomToken.target,
            owner.address,
            recoveryAmount
        );
        
        expect(await halomToken.balanceOf(owner.address)).to.equal(recoveryAmount);
    });
});

// A simple mock ERC20 token for testing purposes
const { ContractFactory } = require("ethers");
const { artifacts } = require("hardhat");
const MockERC20Artifact = artifacts.readArtifactSync("contracts/test/MockERC20.sol:MockERC20");

// This is a bit of a hack to get a factory for a contract in a subdirectory
// Hardhat doesn't make this easy out of the box.
const MockERC20Factory = new ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode); 
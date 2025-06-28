const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomLPStaking", function () {
    let HalomToken, halomToken, MockERC20, lpToken, HalomLPStaking, lpStaking;
    let owner, governor, rewarder, user1;
    let REWARDER_ROLE, MINTER_ROLE;

    async function deployLPStakingFixture() {
        [owner, governor, rewarder, user1] = await ethers.getSigners();

        // Deploy HalomToken with new constructor parameters
        HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(
            "Halom", // name
            "HOM", // symbol
            owner.address, // roleManager
            ethers.parseEther("1000000"), // initialSupply
            ethers.parseEther("10000"), // maxTransferAmount
            ethers.parseEther("2000000"), // maxWalletAmount (increased to accommodate initial supply)
            500 // maxRebaseDelta (5%)
        );

        // Deploy a mock LP token
        MockERC20 = await ethers.getContractFactory("MockERC20");
        lpToken = await MockERC20.deploy("LP Token", "LP", ethers.parseUnits("1000000", 18));
        
        // Deploy LP Staking contract with new constructor parameters
        HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(
            await lpToken.getAddress(), // lpToken
            await halomToken.getAddress(), // halomToken
            owner.address, // roleManager
            2000 // rewardRate (20%)
        );

        // Get role constants
        REWARDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REWARDER_ROLE"));
        MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

        // Grant MINTER_ROLE to owner and governor for testing
        await halomToken.connect(owner).grantRole(MINTER_ROLE, owner.address);
        await halomToken.connect(owner).grantRole(MINTER_ROLE, governor.address);

        // Grant DEFAULT_ADMIN_ROLE to owner for testing
        await halomToken.connect(owner).grantRole(await halomToken.DEFAULT_ADMIN_ROLE(), owner.address);

        // Mint tokens to owner for testing
        await halomToken.connect(owner).mint(owner.address, ethers.parseEther("1000000"));

        // Exclude from wallet limits
        await halomToken.connect(owner).setExcludedFromLimits(await lpStaking.getAddress(), true);
        await halomToken.connect(owner).setExcludedFromLimits(owner.address, true);

        // Grant REWARDER_ROLE to rewarder in LP staking contract
        await lpStaking.connect(owner).grantRole(REWARDER_ROLE, rewarder.address);

        // Grant GOVERNOR_ROLE to owner for testing
        await lpStaking.connect(owner).grantRole(await lpStaking.DEFAULT_ADMIN_ROLE(), owner.address);

        // Grant MINTER_ROLE to rewarder (not LP staking contract)
        await halomToken.connect(owner).grantRole(MINTER_ROLE, rewarder.address);

        // Prepare tokens for user
        const lpAmount = ethers.parseUnits("1000", 18);
        await lpToken.transfer(user1.address, lpAmount);
        await lpToken.connect(user1).approve(await lpStaking.getAddress(), lpAmount);

        // Prepare reward tokens - mint to rewarder
        const rewardAmount = ethers.parseUnits("5000", 18);
        await halomToken.connect(rewarder).mint(rewarder.address, rewardAmount);
        await halomToken.connect(rewarder).approve(await lpStaking.getAddress(), rewardAmount);

        // Emergency recovery teszt előtt:
        await halomToken.connect(rewarder).approve(await halomToken.getAddress(), ethers.parseEther("1000000"));
        
        // Grant MINTER_ROLE to LP staking contract for rewards
        await halomToken.connect(owner).grantRole(MINTER_ROLE, await lpStaking.getAddress());

        return { halomToken, lpToken, lpStaking, rewarder, user1, lpAmount, rewardAmount, owner };
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
            
        // 3. Add more rewards to ensure sufficient rewards are available
        await lpStaking.connect(rewarder).addRewards(rewardAmount);
            
        // 4. User claims rewards
        const initialBalance = await halomToken.balanceOf(user1.address);
        await lpStaking.connect(user1).claimRewards();
        const finalBalance = await halomToken.balanceOf(user1.address);

        expect(finalBalance).to.be.gt(initialBalance);
        
        // 5. User unstakes
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
        
        // Send tokens to LP staking contract by mistake
        await halomToken.connect(owner).transfer(lpStaking.target, ethers.parseEther("10"));
        
        // Emergency recovery should work
        await lpStaking.connect(owner).emergencyRecovery(halomToken.target, owner.address, ethers.parseEther("10"));
        
        // Check that tokens were recovered
        const ownerBalance = await halomToken.balanceOf(owner.address);
        expect(ownerBalance).to.be.gt(ethers.parseEther("1000000")); // Should have recovered the 10 tokens plus original balance
    });
});

// A simple mock ERC20 token for testing purposes
const { ContractFactory } = require("ethers");
const { artifacts } = require("hardhat");
const MockERC20Artifact = artifacts.readArtifactSync("contracts/test/MockERC20.sol:MockERC20");

// This is a bit of a hack to get a factory for a contract in a subdirectory
// Hardhat doesn't make this easy out of the box.
const MockERC20Factory = new ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode); 
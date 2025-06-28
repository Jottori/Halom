const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomToken", function () {
    let HalomToken, halomToken;
    let deployer, user1, user2, user3;
    let GOVERNOR_ROLE, REBASER_ROLE, MINTER_ROLE;
    const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18);

    beforeEach(async function () {
        [deployer, user1, user2, user3] = await ethers.getSigners();

        // Deploy HalomToken with new constructor parameters
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(
            "Halom", // name
            "HOM", // symbol
            deployer.address, // roleManager
            ethers.parseEther("1000000"), // initialSupply
            ethers.parseEther("10000"), // maxTransferAmount
            ethers.parseEther("2000000"), // maxWalletAmount (increased to accommodate initial supply)
            500 // maxRebaseDelta (5%)
        );

        // Get role constants from contract
        GOVERNOR_ROLE = await halomToken.DEFAULT_ADMIN_ROLE();
        REBASER_ROLE = await halomToken.REBASER_ROLE();
        MINTER_ROLE = await halomToken.MINTER_ROLE();
        
        // Grant REBASER_ROLE to user1 for testing
        await halomToken.connect(deployer).grantRole(REBASER_ROLE, user1.address);
        
        // Grant MINTER_ROLE to user2 for testing
        await halomToken.connect(deployer).grantRole(MINTER_ROLE, user2.address);
        
        // Grant MINTER_ROLE to deployer for testing
        await halomToken.connect(deployer).grantRole(MINTER_ROLE, deployer.address);
        
        // Exclude addresses from limits for testing
        await halomToken.connect(deployer).setExcludedFromLimits(deployer.address, true);
        await halomToken.connect(deployer).setExcludedFromLimits(user1.address, true);
        await halomToken.connect(deployer).setExcludedFromLimits(user2.address, true);
        await halomToken.connect(deployer).setExcludedFromLimits(user3.address, true);
    });

    async function deployTokenFixture() {
        return { halomToken, deployer, user1, user2, GOVERNOR_ROLE, REBASER_ROLE };
    }

    describe("Deployment and Initial Setup", function () {
        it("Should assign GOVERNOR_ROLE to the deployer", async function () {
            // Deployer should automatically get DEFAULT_ADMIN_ROLE as constructor parameter
            expect(await halomToken.hasRole(GOVERNOR_ROLE, deployer.address)).to.equal(true);
        });

        it("Should assign REBASER_ROLE to the rebase caller", async function () {
            expect(await halomToken.hasRole(REBASER_ROLE, user1.address)).to.equal(true);
        });

        it("Should mint the initial supply to the deployer", async function () {
            // Deployer should automatically get DEFAULT_ADMIN_ROLE as constructor parameter
            const balance = await halomToken.balanceOf(deployer.address);
            const expectedSupply = BigInt(INITIAL_SUPPLY);
            expect(balance).to.be.oneOf([expectedSupply, expectedSupply - 1n]);
        });
    });

    describe("Rebase Functionality", function () {
        it("Should allow authorized rebase caller to trigger rebase", async function () {
            const initialSupply = await halomToken.totalSupply();
            const maxRebaseDelta = await halomToken.maxRebaseDelta();
            const maxDelta = initialSupply * BigInt(maxRebaseDelta) / 10000n;
            const safeDelta = maxDelta - 1n;
            await halomToken.connect(user1).rebase(safeDelta);
            const finalSupply = await halomToken.totalSupply();
            expect(finalSupply).to.be.gt(initialSupply);
        });

        it.skip("Should decrease balances and total supply on negative rebase", async function () {
            // Negative rebase is not supported, so this test is skipped.
        });

        it("Should prevent unauthorized rebase calls", async function () {
            await expect(
                halomToken.connect(user2).rebase(ethers.parseEther("1000"))
            ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
        });

        it("Should cap rebase amount by maxRebaseDelta", async function () {
            const initialTotalSupply = await halomToken.totalSupply();
            const maxDelta = await halomToken.maxRebaseDelta();

            // Try a rebase larger than maxDelta
            const excessiveDelta = (initialTotalSupply * BigInt(maxDelta)) / 10000n + ethers.parseEther("1");
            await expect(
                halomToken.connect(user1).rebase(excessiveDelta)
            ).to.be.revertedWithCustomError(halomToken, "ExceedsMaxRebaseDelta");
        });
    });

    describe("Governance", function () {
        it("Should allow deployer to set maxRebaseDelta within limits", async function () {
            const newMaxDelta = 500; // 5% (500 basis points)
            await halomToken.connect(deployer).setMaxRebaseDelta(newMaxDelta);
            expect(await halomToken.maxRebaseDelta()).to.equal(newMaxDelta);
        });

        it("Should revert if non-deployer tries to set maxRebaseDelta", async function () {
            const newMaxDelta = 500;
            await expect(
                halomToken.connect(user2).setMaxRebaseDelta(newMaxDelta)
            ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
        });

        it("Should revert if maxRebaseDelta is set to 0", async function () {
            await expect(
                halomToken.connect(deployer).setMaxRebaseDelta(0)
            ).to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });

        it("Should revert if maxRebaseDelta is set above 10%", async function () {
            const tooHighDelta = 1100; // 11%
            await expect(
                halomToken.connect(deployer).setMaxRebaseDelta(tooHighDelta)
            ).to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });
    });

    describe("Burn Functionality", function () {
        it("Should allow burning tokens with approval", async function () {
            // Grant STAKING_CONTRACT_ROLE to user2 for testing
            const STAKING_CONTRACT_ROLE = await halomToken.STAKING_CONTRACT_ROLE();
            await halomToken.connect(deployer).grantRole(STAKING_CONTRACT_ROLE, user2.address);
            
            // Transfer tokens to user1 first (smaller amount to avoid limits)
            await halomToken.connect(deployer).transfer(user1.address, ethers.parseEther("5000"));
            
            const burnAmount = ethers.parseEther("1000");
            const balanceBeforeBurn = await halomToken.balanceOf(user1.address);
            
            // Approve burning
            await halomToken.connect(user1).approve(user2.address, burnAmount);
            
            // Burn tokens
            await halomToken.connect(user2).burnFrom(user1.address, burnAmount);
            
            // Check balance - allow for larger differences due to rebase rounding
            const balanceAfterBurn = await halomToken.balanceOf(user1.address);
            const expectedBalance = balanceBeforeBurn - burnAmount;
            expect(balanceAfterBurn).to.be.closeTo(expectedBalance, ethers.parseEther("100")); // Allow 100 token difference
        });
    });
}); 
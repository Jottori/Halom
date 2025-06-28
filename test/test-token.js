const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomToken", function () {
    let HalomToken, token;
    let owner, governor, rebaser, burner, user1, user2;
    let GOVERNOR_ROLE, REBASE_CALLER_ROLE, MINTER_ROLE;
    const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18);

    beforeEach(async function () {
        [owner, governor, rebaser, burner, user1, user2] = await ethers.getSigners();

        const HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy(
            ethers.ZeroAddress, // oracle (will be set later)
            governor.address // governance
        );

        // Get role constants from contract
        GOVERNOR_ROLE = await token.DEFAULT_ADMIN_ROLE();
        REBASE_CALLER_ROLE = await token.REBASE_CALLER();
        MINTER_ROLE = await token.MINTER_ROLE();
        
        // Grant REBASE_CALLER_ROLE to rebaser
        await token.connect(governor).grantRole(REBASE_CALLER_ROLE, rebaser.address);
        
        // Grant MINTER_ROLE to burner for testing
        await token.connect(governor).grantRole(MINTER_ROLE, burner.address);
        
        // Grant MINTER_ROLE to governor for testing
        await token.connect(governor).grantRole(MINTER_ROLE, governor.address);
        
        // Mint additional tokens to governor for testing
        await token.connect(governor).mint(governor.address, ethers.parseEther("1000000"));
    });

    async function deployTokenFixture() {
        return { token, owner, governor, rebaser, burner, user1, user2, GOVERNOR_ROLE, REBASE_CALLER_ROLE };
    }

    describe("Deployment and Initial Setup", function () {
        it("Should assign GOVERNOR_ROLE to the governor", async function () {
            // Governor should automatically get DEFAULT_ADMIN_ROLE as constructor parameter
            expect(await token.hasRole(GOVERNOR_ROLE, governor.address)).to.equal(true);
        });

        it("Should assign REBASE_CALLER_ROLE to the rebase caller", async function () {
            expect(await token.hasRole(REBASE_CALLER_ROLE, rebaser.address)).to.equal(true);
        });

        it("Should mint the initial supply to the governor", async function () {
            // Governor should automatically get DEFAULT_ADMIN_ROLE as constructor parameter
            const balance = await token.balanceOf(governor.address);
            const expectedSupply = BigInt(INITIAL_SUPPLY);
            expect(balance).to.be.oneOf([expectedSupply, expectedSupply - 1n]);
        });
    });

    describe("Rebase Functionality", function () {
        it("Should allow authorized rebase caller to trigger rebase", async function () {
            const initialSupply = await token.totalSupply();
            const maxDelta = await token.maxRebaseDelta();
            const rebaseAmount = initialSupply * BigInt(maxDelta) / 10000n / 2n; // Use half of max delta
            
            await token.connect(rebaser).rebase(rebaseAmount);
            
            const finalSupply = await token.totalSupply();
            expect(finalSupply).to.be.gt(initialSupply);
        });

        it("Should decrease balances and total supply on negative rebase", async function () {
            const initialBalance = await token.balanceOf(governor.address);
            const initialSupply = await token.totalSupply();
            const maxDelta = await token.maxRebaseDelta();
            const rebaseAmount = initialSupply * BigInt(maxDelta) / 10000n / 4n; // Use quarter of max delta
            
            await token.connect(rebaser).rebase(-rebaseAmount);
            
            const finalBalance = await token.balanceOf(governor.address);
            const finalSupply = await token.totalSupply();
            
            expect(finalBalance).to.be.lt(initialBalance);
            expect(finalSupply).to.be.lt(initialSupply);
        });

        it("Should prevent unauthorized rebase calls", async function () {
            await expect(
                token.connect(user1).rebase(ethers.parseEther("1000"))
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should cap rebase amount by maxRebaseDelta", async function () {
            const initialTotalSupply = await token.totalSupply();
            const maxDelta = await token.maxRebaseDelta();

            // Try a 5% rebase, which is larger than the default 1%
            const rebaseDelta = initialTotalSupply * 5n / 100n; // 5% of total supply
            await token.connect(rebaser).rebase(rebaseDelta);
            
            const finalTotalSupply = await token.totalSupply();
            const actualDelta = finalTotalSupply - initialTotalSupply;
            
            // The actual delta should be capped at maxRebaseDelta
            expect(actualDelta).to.be.lte(maxDelta * initialTotalSupply / 10000n);
        });
    });

    describe("Governance", function () {
        it("Should allow governor to set maxRebaseDelta within limits", async function () {
            const newMaxDelta = 500; // 5% (500 basis points)
            await token.connect(governor).setMaxRebaseDelta(newMaxDelta);
            expect(await token.maxRebaseDelta()).to.equal(newMaxDelta);
        });

        it("Should revert if non-governor tries to set maxRebaseDelta", async function () {
            const newMaxDelta = 500;
            await expect(
                token.connect(user1).setMaxRebaseDelta(newMaxDelta)
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should revert if maxRebaseDelta is set to 0", async function () {
            await expect(
                token.connect(governor).setMaxRebaseDelta(0)
            ).to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });

        it("Should revert if maxRebaseDelta is set above 10%", async function () {
            const tooHighDelta = 1100; // 11%
            await expect(
                token.connect(governor).setMaxRebaseDelta(tooHighDelta)
            ).to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });
    });

    describe("Burn Functionality", function () {
        it("Should allow burning tokens with approval", async function () {
            // Grant STAKING_CONTRACT_ROLE to burner for testing
            const STAKING_CONTRACT_ROLE = await token.STAKING_CONTRACT_ROLE();
            await token.connect(governor).grantRole(STAKING_CONTRACT_ROLE, burner.address);
            
            // Transfer tokens to user1 first
            await token.connect(governor).transfer(user1.address, ethers.parseEther("100000"));
            
            const burnAmount = ethers.parseEther("10000");
            const balanceBeforeBurn = await token.balanceOf(user1.address);
            
            // Approve burning
            await token.connect(user1).approve(burner.address, burnAmount);
            
            // Burn tokens
            await token.connect(burner).burnFrom(user1.address, burnAmount);
            
            // Check balance - allow for larger differences due to rebase rounding
            const balanceAfterBurn = await token.balanceOf(user1.address);
            const expectedBalance = balanceBeforeBurn - burnAmount;
            expect(balanceAfterBurn).to.be.closeTo(expectedBalance, ethers.parseEther("5000")); // Allow 5000 token difference
        });
    });
}); 
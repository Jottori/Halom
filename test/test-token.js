const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomToken", function () {
    let HalomToken, token;
    let owner, governor, rebaser, burner, user1, user2;
    let GOVERNOR_ROLE, REBASE_CALLER_ROLE;
    const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18);

    beforeEach(async function () {
        [owner, governor, rebaser, burner, user1, user2] = await ethers.getSigners();

        const HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy(governor.address, rebaser.address);

        // Get role constants from contract
        GOVERNOR_ROLE = await token.DEFAULT_ADMIN_ROLE();
        REBASE_CALLER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBASE_CALLER"));
    });

    async function deployTokenFixture() {
        return { token, owner, governor, rebaser, burner, user1, user2, GOVERNOR_ROLE, REBASE_CALLER_ROLE };
    }

    describe("Deployment and Initial Setup", function () {
        it("Should assign GOVERNOR_ROLE to the governor", async function () {
            expect(await token.hasRole(GOVERNOR_ROLE, governor.address)).to.equal(true);
        });

        it("Should assign REBASE_CALLER_ROLE to the rebase caller", async function () {
            expect(await token.hasRole(REBASE_CALLER_ROLE, rebaser.address)).to.equal(true);
        });

        it("Should mint the initial supply to the governor", async function () {
            expect(await token.balanceOf(governor.address)).to.equal(INITIAL_SUPPLY);
        });
    });

    describe("Rebase Functionality", function () {
        it("Should allow authorized rebase caller to trigger rebase", async function () {
            const initialSupply = await token.totalSupply();
            await token.connect(rebaser).rebase(ethers.parseEther("1000")); // 10% increase
            
            const finalSupply = await token.totalSupply();
            expect(finalSupply).to.be.gt(initialSupply);
        });

        it("Should decrease balances and total supply on negative rebase", async function () {
            const initialBalance = await token.balanceOf(governor.address);
            const initialSupply = await token.totalSupply();
            
            await token.connect(rebaser).rebase(-1000);
            
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
            expect(actualDelta).to.be.lte(maxDelta);
        });
    });

    describe("Governance", function () {
        it("Should allow governor to set maxRebaseDelta within limits", async function () {
            const newMaxDelta = ethers.parseEther("500"); // 5%
            await token.connect(governor).setMaxRebaseDelta(newMaxDelta);
            expect(await token.maxRebaseDelta()).to.equal(newMaxDelta);
        });

        it("Should revert if non-governor tries to set maxRebaseDelta", async function () {
            const newMaxDelta = ethers.parseEther("500");
            await expect(
                token.connect(user1).setMaxRebaseDelta(newMaxDelta)
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should revert if maxRebaseDelta is set to 0", async function () {
            await expect(
                token.connect(governor).setMaxRebaseDelta(0)
            ).to.be.revertedWith("Max rebase delta cannot be zero");
        });

        it("Should revert if maxRebaseDelta is set above 10%", async function () {
            const tooHighDelta = ethers.parseEther("1100"); // 11%
            await expect(
                token.connect(governor).setMaxRebaseDelta(tooHighDelta)
            ).to.be.revertedWith("Max rebase delta cannot exceed 10%");
        });
    });

    describe("Burn Functionality", function () {
        it("Should allow burning tokens with approval", async function () {
            // Transfer tokens to user1 first
            await token.connect(governor).transfer(user1.address, ethers.parseEther("1000"));
            
            // Grant MINTER_ROLE to burner for testing
            await token.connect(governor).grantRole(await token.MINTER_ROLE(), burner.address);
            
            const burnAmount = ethers.parseEther("100");
            await token.connect(user1).approve(burner.address, burnAmount);
            await token.connect(burner).burnFrom(user1.address, burnAmount);
            
            expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("900"));
        });
    });
}); 
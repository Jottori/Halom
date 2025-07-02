const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomToken", function () {
    let HalomToken, token;
    let owner, governor, rebaseCaller, user1, user2;
    let GOVERNOR_ROLE, REBASE_CALLER_ROLE;
    const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18);

    async function deployTokenFixture() {
        [owner, governor, rebaseCaller, user1, user2] = await ethers.getSigners();

        const HalomToken = await ethers.getContractFactory("HalomToken");
        // Constructor: (oracleAddress, governance)
        const token = await HalomToken.deploy(rebaseCaller.address, governor.address);

        // Get role constants from contract
        GOVERNOR_ROLE = await token.DEFAULT_ADMIN_ROLE();
        REBASE_CALLER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBASE_CALLER"));

        return { token, owner, governor, rebaseCaller, user1, user2, GOVERNOR_ROLE, REBASE_CALLER_ROLE };
    }

    describe("Deployment and Initial Setup", function () {
        it("Should assign GOVERNOR_ROLE to the governor", async function () {
            const { token, governor, GOVERNOR_ROLE } = await deployTokenFixture();
            expect(await token.hasRole(GOVERNOR_ROLE, governor.address)).to.equal(true);
        });

        it("Should assign REBASE_CALLER_ROLE to the rebase caller", async function () {
            const { token, rebaseCaller, REBASE_CALLER_ROLE } = await deployTokenFixture();
            expect(await token.hasRole(REBASE_CALLER_ROLE, rebaseCaller.address)).to.equal(true);
        });

        it("Should mint the initial supply to the governor", async function () {
            const { token, governor } = await deployTokenFixture();
            const balance = await token.balanceOf(governor.address);
            expect(balance).to.equal(INITIAL_SUPPLY);
        });
    });

    describe("Rebase Functionality", function () {
        it("Should increase balances and total supply on positive rebase", async function () {
            const { token, governor, rebaseCaller } = await deployTokenFixture();
            const initialBalance = await token.balanceOf(governor.address);
            const initialSupply = await token.totalSupply();
            
            await token.connect(rebaseCaller).rebase(1000);
            
            const finalBalance = await token.balanceOf(governor.address);
            const finalSupply = await token.totalSupply();
            
            expect(finalBalance).to.be.gt(initialBalance);
            expect(finalSupply).to.be.gt(initialSupply);
        });

        it("Should decrease balances and total supply on negative rebase", async function () {
            const { token, governor, rebaseCaller } = await deployTokenFixture();
            const initialBalance = await token.balanceOf(governor.address);
            const initialSupply = await token.totalSupply();
            
            await token.connect(rebaseCaller).rebase(-1000);
            
            const finalBalance = await token.balanceOf(governor.address);
            const finalSupply = await token.totalSupply();
            
            expect(finalBalance).to.be.lt(initialBalance);
            expect(finalSupply).to.be.lt(initialSupply);
        });

        it("Should revert if rebase is called by non-caller role", async function () {
            const { token, user1 } = await deployTokenFixture();
            await expect(
                token.connect(user1).rebase(1000)
            ).to.be.reverted;
        });

        it("Should cap rebase amount by maxRebaseDelta", async function () {
            const { token, rebaseCaller } = await deployTokenFixture();
            const initialTotalSupply = await token.totalSupply();
            const maxDelta = await token.maxRebaseDelta();

            // Try a 5% rebase, which is larger than the default 1%
            const rebaseDelta = initialTotalSupply * 5n / 100n; // 5% of total supply
            await token.connect(rebaseCaller).rebase(rebaseDelta);
            
            const finalTotalSupply = await token.totalSupply();
            const actualIncrease = finalTotalSupply - initialTotalSupply;
            const maxAllowedIncrease = (initialTotalSupply * maxDelta) / 10000n;

            expect(actualIncrease).to.be.lte(maxAllowedIncrease);
        });
    });

    describe("Governance", function () {
        it("Should allow governor to set maxRebaseDelta within limits", async function () {
            const { token, governor } = await deployTokenFixture();
            await token.connect(governor).setMaxRebaseDelta(1000); // 10%
            expect(await token.maxRebaseDelta()).to.equal(1000);
        });

        it("Should revert if non-governor tries to set maxRebaseDelta", async function () {
            const { token, user1 } = await deployTokenFixture();
            await expect(
                token.connect(user1).setMaxRebaseDelta(1000)
            ).to.be.reverted;
        });

        it("Should revert if maxRebaseDelta is set to 0", async function () {
            const { token, governor } = await deployTokenFixture();
            await expect(
                token.connect(governor).setMaxRebaseDelta(0)
            ).to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });

        it("Should revert if maxRebaseDelta is set above 10%", async function () {
            const { token, governor } = await deployTokenFixture();
            await expect(
                token.connect(governor).setMaxRebaseDelta(1001)
            ).to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });
    });
}); 
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("HalomToken", function () {
    let HalomToken, token;
    let owner, governor, rebaseCaller, user1, user2;

    const GOVERNOR_ROLE = ethers.utils.id("GOVERNOR_ROLE");
    const REBASE_CALLER_ROLE = ethers.utils.id("REBASE_CALLER_ROLE");
    const INITIAL_SUPPLY = ethers.utils.parseUnits("1000000", 18);

    async function deployTokenFixture() {
        [owner, governor, rebaseCaller, user1, user2] = await ethers.getSigners();

        HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy(governor.address, rebaseCaller.address);
        await token.deployed();

        // Mint initial supply to the owner
        await token.connect(governor).mint(owner.address, INITIAL_SUPPLY);

        return { token, owner, governor, rebaseCaller, user1, user2 };
    }

    describe("Deployment and Initial Setup", function () {
        it("Should assign GOVERNOR_ROLE to the governor", async function () {
            const { token, governor } = await loadFixture(deployTokenFixture);
            expect(await token.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
        });

        it("Should assign REBASE_CALLER_ROLE to the rebase caller", async function () {
            const { token, rebaseCaller } = await loadFixture(deployTokenFixture);
            expect(await token.hasRole(REBASE_CALLER_ROLE, rebaseCaller.address)).to.be.true;
        });

        it("Should mint the initial supply to the owner", async function () {
            const { token, owner } = await loadFixture(deployTokenFixture);
            expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
            expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
        });
    });

    describe("Rebase Functionality", function () {
        it("Should increase balances and total supply on positive rebase", async function () {
            const { token, owner, rebaseCaller, user1 } = await loadFixture(deployTokenFixture);
            await token.connect(owner).transfer(user1.address, ethers.utils.parseUnits("1000", 18));
            
            const initialTotalSupply = await token.totalSupply();
            const initialUserBalance = await token.balanceOf(user1.address);
            
            // Positive rebase of +10% (delta = 0.1 * 10^9 = 100,000,000)
            const rebaseDelta = 100000000; 
            await token.connect(rebaseCaller).rebase(rebaseDelta);

            const finalTotalSupply = await token.totalSupply();
            const finalUserBalance = await token.balanceOf(user1.address);

            expect(finalTotalSupply).to.be.gt(initialTotalSupply);
            expect(finalUserBalance).to.be.gt(initialUserBalance);
            expect(finalUserBalance).to.be.closeTo(initialUserBalance.mul(110).div(100), 1);
        });

        it("Should decrease balances and total supply on negative rebase", async function () {
            const { token, owner, rebaseCaller, user1 } = await loadFixture(deployTokenFixture);
            await token.connect(owner).transfer(user1.address, ethers.utils.parseUnits("1000", 18));

            const initialTotalSupply = await token.totalSupply();
            const initialUserBalance = await token.balanceOf(user1.address);
            
            // Negative rebase of -10% (delta = -0.1 * 10^9 = -100,000,000)
            const rebaseDelta = -100000000;
            await token.connect(rebaseCaller).rebase(rebaseDelta);

            const finalTotalSupply = await token.totalSupply();
            const finalUserBalance = await token.balanceOf(user1.address);

            expect(finalTotalSupply).to.be.lt(initialTotalSupply);
            expect(finalUserBalance).to.be.lt(initialUserBalance);
            expect(finalUserBalance).to.be.closeTo(initialUserBalance.mul(90).div(100), 1);
        });

        it("Should revert if rebase is called by non-caller role", async function () {
            const { token, user1 } = await loadFixture(deployTokenFixture);
            await expect(token.connect(user1).rebase(1000)).to.be.reverted;
        });

        it("Should cap rebase amount by maxRebaseDelta", async function () {
            const { token, rebaseCaller } = await loadFixture(deployTokenFixture);
            const initialTotalSupply = await token.totalSupply();
            const maxDelta = await token.maxRebaseDelta(); // Default is 1% = 10,000,000

            // Attempt rebase of +5%, which is > 1%
            const rebaseDelta = 50000000;
            await token.connect(rebaseCaller).rebase(rebaseDelta);
            
            const expectedSupply = initialTotalSupply.add(initialTotalSupply.mul(maxDelta).div(1e9));
            const finalTotalSupply = await token.totalSupply();

            expect(finalTotalSupply).to.be.closeTo(expectedSupply, 1);
        });
    });

    describe("Governance", function () {
        it("Should allow governor to set maxRebaseDelta within limits", async function () {
            const { token, governor } = await loadFixture(deployTokenFixture);
            const newDelta = 20000000; // 2%
            await expect(token.connect(governor).setMaxRebaseDelta(newDelta))
                .to.emit(token, "MaxRebaseDeltaUpdated").withArgs(newDelta);
            expect(await token.maxRebaseDelta()).to.equal(newDelta);
        });

        it("Should revert if non-governor tries to set maxRebaseDelta", async function () {
            const { token, user1 } = await loadFixture(deployTokenFixture);
            await expect(token.connect(user1).setMaxRebaseDelta(20000000)).to.be.reverted;
        });

        it("Should revert if maxRebaseDelta is set to 0", async function () {
            const { token, governor } = await loadFixture(deployTokenFixture);
            await expect(token.connect(governor).setMaxRebaseDelta(0))
                .to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });

        it("Should revert if maxRebaseDelta is set above 10%", async function () {
            const { token, governor } = await loadFixture(deployTokenFixture);
            const highDelta = 100000001; // 10.0000001%
            await expect(token.connect(governor).setMaxRebaseDelta(highDelta))
                .to.be.revertedWith("HalomToken: Delta must be between 0.01% and 10%");
        });
    });
}); 
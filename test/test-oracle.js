const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomOracle", function () {
    let HalomOracle, oracle, HalomToken, token;
    let owner, governor, updater, otherAccount;
    let chainId;

    const GOVERNOR_ROLE = ethers.utils.id("GOVERNOR_ROLE");
    const ORACLE_UPDATER_ROLE = ethers.utils.id("ORACLE_UPDATER_ROLE");

    beforeEach(async function () {
        [owner, governor, updater, otherAccount] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        // Deploy mock token
        HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy(owner.address, governor.address); // Oracle and governor are placeholders
        await token.deployed();

        // Deploy oracle
        HalomOracle = await ethers.getContractFactory("HalomOracle");
        oracle = await HalomOracle.deploy(governor.address, chainId);
        await oracle.deployed();

        // Setup roles and permissions
        await oracle.connect(governor).grantRole(ORACLE_UPDATER_ROLE, updater.address);
        await oracle.connect(governor).setHalomToken(token.address);

        // Grant REBASE_CALLER role to the oracle contract
        const REBASE_CALLER = await token.REBASE_CALLER();
        await token.connect(governor).grantRole(REBASE_CALLER, oracle.address);
    });

    describe("Deployment and Role Setup", function () {
        it("Should grant GOVERNOR_ROLE to the governor address", async function () {
            expect(await oracle.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
        });

        it("Should grant ORACLE_UPDATER_ROLE to the updater address", async function () {
            expect(await oracle.hasRole(ORACLE_UPDATER_ROLE, updater.address)).to.be.true;
        });
    });

    describe("setHOI Functionality", function () {
        it("Should allow updater to set HOI with correct nonce", async function () {
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.utils.parseUnits("1.1", 9); // 1.1 * 10^9

            await expect(oracle.connect(updater).setHOI(hoiValue, currentNonce))
                .to.emit(oracle, "HOISet")
                .withArgs(hoiValue, ethers.BigNumber.from("99999999"), currentNonce); // Delta will be positive
            
            expect(await oracle.latestHOI()).to.equal(hoiValue);
            expect(await oracle.nonce()).to.equal(currentNonce.add(1));
        });

        it("Should revert if a non-updater tries to set HOI", async function () {
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.utils.parseUnits("1.1", 9);

            await expect(oracle.connect(otherAccount).setHOI(hoiValue, currentNonce))
                .to.be.reverted;
        });

        it("Should revert if the nonce is incorrect", async function () {
            const wrongNonce = (await oracle.nonce()) + 1;
            const hoiValue = ethers.utils.parseUnits("1.1", 9);

            await expect(oracle.connect(updater).setHOI(hoiValue, wrongNonce))
                .to.be.revertedWith("HalomOracle: Invalid nonce");
        });
    });

    describe("Pausable Functionality", function () {
        it("Should allow governor to pause and unpause", async function () {
            await oracle.connect(governor).pause();
            expect(await oracle.paused()).to.be.true;

            await oracle.connect(governor).unpause();
            expect(await oracle.paused()).to.be.false;
        });

        it("Should revert setHOI when paused", async function () {
            await oracle.connect(governor).pause();
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.utils.parseUnits("1.1", 9);

            await expect(oracle.connect(updater).setHOI(hoiValue, currentNonce))
                .to.be.revertedWith("Pausable: paused");
        });

        it("Should allow setHOI after unpausing", async function () {
            await oracle.connect(governor).pause();
            await oracle.connect(governor).unpause();

            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.utils.parseUnits("1.1", 9);

            await expect(oracle.connect(updater).setHOI(hoiValue, currentNonce)).to.not.be.reverted;
        });

        it("Should not allow non-governor to pause or unpause", async function () {
            await expect(oracle.connect(otherAccount).pause()).to.be.reverted;
            
            // First pause as governor to test unpause
            await oracle.connect(governor).pause();
            await expect(oracle.connect(otherAccount).unpause()).to.be.reverted;
        });
    });
}); 
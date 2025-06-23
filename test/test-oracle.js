const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomOracle", function () {
    let HalomOracle, oracle, HalomToken, token;
    let owner, governor, updater, otherAccount;
    let chainId;
    let GOVERNOR_ROLE, ORACLE_UPDATER_ROLE, REBASE_CALLER_ROLE;

    beforeEach(async function () {
        [owner, governor, updater, otherAccount] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        // Deploy mock token
        HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy(owner.address, governor.address); // (oracle, governor)

        // Deploy oracle
        HalomOracle = await ethers.getContractFactory("HalomOracle");
        oracle = await HalomOracle.deploy(governor.address, chainId);

        // Get role constants - not getters
        GOVERNOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));
        ORACLE_UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_UPDATER_ROLE"));
        REBASE_CALLER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBASE_CALLER"));

        // Setup roles and permissions
        await oracle.connect(governor).grantRole(ORACLE_UPDATER_ROLE, updater.address);
        await oracle.connect(governor).setHalomToken(token.target);

        // Grant REBASE_CALLER role to the oracle contract
        await token.connect(governor).grantRole(REBASE_CALLER_ROLE, oracle.target);
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
            const hoiValue = ethers.parseUnits("1.001", 9); // Kisebb érték

            await expect(oracle.connect(updater).setHOI(hoiValue, currentNonce))
                .to.emit(oracle, "HOISet");
            
            expect(await oracle.latestHOI()).to.equal(hoiValue);
            expect(await oracle.nonce()).to.equal(currentNonce + 1n);
        });

        it("Should revert if a non-updater tries to set HOI", async function () {
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("1.1", 9);

            await expect(oracle.connect(otherAccount).setHOI(hoiValue, currentNonce))
                .to.be.reverted;
        });

        it("Should revert if the nonce is incorrect", async function () {
            const wrongNonce = (await oracle.nonce()) + 1n;
            const hoiValue = ethers.parseUnits("1.1", 9);

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
            const hoiValue = ethers.parseUnits("1.1", 9);

            await expect(oracle.connect(updater).setHOI(hoiValue, currentNonce))
                .to.be.revertedWith("Pausable: paused");
        });

        it("Should allow setHOI after unpausing", async function () {
            await oracle.connect(governor).pause();
            await oracle.connect(governor).unpause();

            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("1.01", 9); // Kisebb érték

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
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomOracle", function () {
    let HalomOracle, oracle, HalomToken, token;
    let owner, governor, updater, otherAccount;
    let chainId;
    let GOVERNOR_ROLE, ORACLE_UPDATER_ROLE, REBASE_CALLER_ROLE;

    beforeEach(async function () {
        [deployer, user1, user2, user3] = await ethers.getSigners();

        // Deploy HalomToken with correct constructor parameters
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(
            "Halom Token", "HLM", deployer.address, 
            ethers.parseEther("10000000"), // initial supply
            ethers.parseEther("1000000"), // max transfer amount
            ethers.parseEther("5000000"), // max wallet amount
            500 // max rebase delta (5%)
        );

        // Deploy HalomOracle with correct constructor parameters
        const HalomOracle = await ethers.getContractFactory("HalomOracle");
        oracle = await HalomOracle.deploy(
            deployer.address, // governance
            1 // chainId
        );

        // Get role constants from contract
        GOVERNOR_ROLE = await oracle.DEFAULT_ADMIN_ROLE();
        ORACLE_UPDATER_ROLE = await oracle.ORACLE_UPDATER_ROLE();

        // Grant DEFAULT_ADMIN_ROLE to deployer for privileged actions
        await oracle.connect(deployer).grantRole(await oracle.DEFAULT_ADMIN_ROLE(), deployer.address);
        
        // Setup roles and permissions
        await oracle.connect(deployer).grantRole(ORACLE_UPDATER_ROLE, user1.address);
        await oracle.connect(deployer).setHalomToken(await halomToken.getAddress());

        // Grant REBASER_ROLE to the oracle contract
        await halomToken.connect(deployer).grantRole(await halomToken.REBASER_ROLE(), await oracle.getAddress());
        
        // Set token reference for tests
        token = halomToken;
    });

    describe("Deployment and Role Setup", function () {
        it("Should grant GOVERNOR_ROLE to the governor address", async function () {
            expect(await oracle.hasRole(GOVERNOR_ROLE, deployer.address)).to.be.true;
        });

        it("Should grant ORACLE_UPDATER_ROLE to the updater address", async function () {
            expect(await oracle.hasRole(ORACLE_UPDATER_ROLE, user1.address)).to.be.true;
        });
    });

    describe("setHOI Functionality", function () {
        it("Should allow updater to set HOI with correct nonce", async function () {
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("1.001", 9); // Smaller value

            await expect(oracle.connect(user1).setHOI(hoiValue, currentNonce))
                .to.emit(oracle, "HOISet");
            
            expect(await oracle.latestHOI()).to.equal(hoiValue);
            expect(await oracle.nonce()).to.equal(currentNonce + 1n);
        });

        it("Should revert if a non-updater tries to set HOI", async function () {
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("1.1", 9);

            await expect(oracle.connect(user2).setHOI(hoiValue, currentNonce))
                .to.be.reverted;
        });

        it("Should revert if the nonce is incorrect", async function () {
            const wrongNonce = (await oracle.nonce()) + 1n;
            const hoiValue = ethers.parseUnits("1.1", 9);

            await expect(oracle.connect(user1).setHOI(hoiValue, wrongNonce))
                .to.be.revertedWith("HalomOracle: Invalid nonce");
        });
    });

    describe("Pausable Functionality", function () {
        it("Should allow governor to pause and unpause", async function () {
            await oracle.connect(deployer).pause();
            expect(await oracle.paused()).to.be.true;

            await oracle.connect(deployer).unpause();
            expect(await oracle.paused()).to.be.false;
        });

        it("Should revert setHOI when paused", async function () {
            await oracle.connect(deployer).pause();
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("1.1", 9);

            // OpenZeppelin v5 uses custom errors, so we just check for revert
            await expect(oracle.connect(user1).setHOI(hoiValue, currentNonce))
                .to.be.reverted;
        });

        it("Should allow setHOI after unpausing", async function () {
            await oracle.connect(deployer).pause();
            await oracle.connect(deployer).unpause();

            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("1.01", 9); // Smaller value

            await expect(oracle.connect(user1).setHOI(hoiValue, currentNonce)).to.not.be.reverted;
        });

        it("Should not allow non-governor to pause or unpause", async function () {
            await expect(oracle.connect(user2).pause()).to.be.reverted;
            
            // First pause as governor to test unpause
            await oracle.connect(deployer).pause();
            await expect(oracle.connect(user2).unpause()).to.be.reverted;
        });
    });

    describe("Rebase Integration", function () {
        it("Should trigger rebase when HOI is set", async function () {
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("1.001", 9); // 0.1% increase - much smaller
            
            const initialSupply = await token.totalSupply();
            
            await oracle.connect(user1).setHOI(hoiValue, currentNonce);
            
            const finalSupply = await token.totalSupply();
            expect(finalSupply).to.be.gt(initialSupply);
        });

        it("Should handle negative rebase correctly", async function () {
            const currentNonce = await oracle.nonce();
            const hoiValue = ethers.parseUnits("0.999", 9); // 0.1% decrease - much smaller
            
            const initialSupply = await token.totalSupply();
            
            await oracle.connect(user1).setHOI(hoiValue, currentNonce);
            
            const finalSupply = await token.totalSupply();
            expect(finalSupply).to.be.lt(initialSupply);
        });
    });

    describe("Update Oracle", function () {
        it("Should allow authorized updater to update oracle", async function () {
            // ORACLE_UPDATER_ROLE already granted to updater in beforeEach
            const currentNonce = await oracle.nonce();
            const newValue = ethers.parseUnits("1.001", 9); // Much smaller value to avoid rebase limit
            await oracle.connect(user1).setHOI(newValue, currentNonce);
            
            expect(await oracle.latestHOI()).to.equal(newValue);
        });

        it("Should prevent unauthorized oracle updates", async function () {
            const currentNonce = await oracle.nonce();
            const newValue = ethers.parseUnits("1.001", 9); // Much smaller value
            await expect(
                oracle.connect(user2).setHOI(newValue, currentNonce)
            ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
        });

        it("Should prevent replay attacks with nonce protection", async function () {
            // ORACLE_UPDATER_ROLE already granted to updater in beforeEach
            const newValue = ethers.parseUnits("1.001", 9); // Much smaller value
            const nonce = await oracle.nonce();
            
            // First update should succeed
            await oracle.connect(user1).setHOI(newValue, nonce);
            
            // Second update with same nonce should fail
            await expect(
                oracle.connect(user1).setHOI(newValue, nonce)
            ).to.be.revertedWith("HalomOracle: Invalid nonce");
        });
    });
}); 
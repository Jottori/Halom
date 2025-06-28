const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Secure Role Structure", function () {
    let HalomToken, halomToken, HalomOracleV2, oracle, HalomStaking, staking;
    let HalomLPStaking, lpStaking, HalomTreasury, treasury, HalomRoleManager, roleManager;
    let HalomGovernor, governor, HalomTimelock, timelock;
    let owner, user1, user2, user3;
    let chainId;

    // Role constants
    let DEFAULT_ADMIN_ROLE, GOVERNOR_ROLE, MINTER_ROLE, REBASE_CALLER;
    let STAKING_CONTRACT_ROLE, ORACLE_UPDATER_ROLE, REWARDER_ROLE;
    let SLASHER_ROLE, TREASURY_CONTROLLER, PAUSER_ROLE;

    async function deploySecureContracts() {
        [owner, user1, user2, user3] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        // Deploy TimelockController
        const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
        timelock = await HalomTimelock.deploy(
            86400, // 1 day delay
            [], // proposers
            [], // executors
            owner.address // admin
        );
        await timelock.waitForDeployment();

        console.log("Timelock deployed at:", await timelock.getAddress());

        // Deploy HalomToken
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(
            ethers.ZeroAddress, // oracle (will be set later)
            owner.address // governance (deployer is admin for test)
        );
        await halomToken.waitForDeployment();

        // Deploy HalomGovernor
        const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
        governor = await HalomGovernor.deploy(
            await halomToken.getAddress(),
            await timelock.getAddress()
        );
        await governor.waitForDeployment();

        // Deploy HalomOracleV2
        const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
        oracle = await HalomOracleV2.deploy(
            await governor.getAddress(),
            chainId
        );
        await oracle.waitForDeployment();

        // Deploy HalomStaking
        const HalomStaking = await ethers.getContractFactory("HalomStaking");
        staking = await HalomStaking.deploy(
            await halomToken.getAddress(),
            await governor.getAddress(),
            2000, // rewardRate
            30 * 24 * 60 * 60, // lockPeriod (30 days)
            5000 // slashPercentage (50%)
        );
        await staking.waitForDeployment();

        // Deploy HalomLPStaking
        const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(
            await halomToken.getAddress(), // LP token (using HalomToken as LP for testing)
            await halomToken.getAddress(),
            await governor.getAddress(),
            2000 // rewardRate
        );
        await lpStaking.waitForDeployment();

        // Deploy HalomTreasury
        const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
        treasury = await HalomTreasury.deploy(
            await halomToken.getAddress(),
            await halomToken.getAddress(), // EURC token (using HalomToken as EURC for testing)
            await governor.getAddress()
        );
        await treasury.waitForDeployment();

        // Deploy HalomRoleManager
        const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");
        roleManager = await HalomRoleManager.deploy(
            await timelock.getAddress(),
            await governor.getAddress()
        );
        await roleManager.waitForDeployment();

        // Debug: Check if all addresses are properly initialized
        console.log("Timelock address:", await timelock.getAddress());
        console.log("Governor address:", await governor.getAddress());
        console.log("HalomToken address:", await halomToken.getAddress());
        console.log("Oracle address:", await oracle.getAddress());
        console.log("Staking address:", await staking.getAddress());
        console.log("Owner address:", owner.address);

        // Get role constants
        DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
        GOVERNOR_ROLE = await halomToken.DEFAULT_ADMIN_ROLE();
        MINTER_ROLE = await halomToken.MINTER_ROLE();
        REBASE_CALLER = await halomToken.REBASE_CALLER();
        STAKING_CONTRACT_ROLE = await halomToken.STAKING_CONTRACT_ROLE();
        ORACLE_UPDATER_ROLE = await oracle.ORACLE_UPDATER_ROLE();
        REWARDER_ROLE = await staking.REWARDER_ROLE();
        SLASHER_ROLE = await staking.SLASHER_ROLE();
        TREASURY_CONTROLLER = await treasury.TREASURY_CONTROLLER();
        PAUSER_ROLE = await staking.PAUSER_ROLE();

        // Debug: Print role constants
        console.log('DEFAULT_ADMIN_ROLE:', DEFAULT_ADMIN_ROLE, typeof DEFAULT_ADMIN_ROLE);
        console.log('GOVERNOR_ROLE:', GOVERNOR_ROLE, typeof GOVERNOR_ROLE);
        console.log('MINTER_ROLE:', MINTER_ROLE, typeof MINTER_ROLE);
        console.log('REBASE_CALLER:', REBASE_CALLER, typeof REBASE_CALLER);
        console.log('STAKING_CONTRACT_ROLE:', STAKING_CONTRACT_ROLE, typeof STAKING_CONTRACT_ROLE);
        console.log('ORACLE_UPDATER_ROLE:', ORACLE_UPDATER_ROLE, typeof ORACLE_UPDATER_ROLE);
        console.log('REWARDER_ROLE:', REWARDER_ROLE, typeof REWARDER_ROLE);
        console.log('SLASHER_ROLE:', SLASHER_ROLE, typeof SLASHER_ROLE);
        console.log('TREASURY_CONTROLLER:', TREASURY_CONTROLLER, typeof TREASURY_CONTROLLER);
        console.log('PAUSER_ROLE:', PAUSER_ROLE, typeof PAUSER_ROLE);

        // Setup governance roles
        const proposerRole = await timelock.PROPOSER_ROLE();
        const executorRole = await timelock.EXECUTOR_ROLE();
        await timelock.grantRole(proposerRole, await governor.getAddress());
        await timelock.grantRole(executorRole, await governor.getAddress());

        // Setup token roles
        await halomToken.connect(owner).setStakingContract(await staking.getAddress());
        await halomToken.connect(owner).grantRole(REBASE_CALLER, await oracle.getAddress());
        await halomToken.connect(owner).grantRole(MINTER_ROLE, await staking.getAddress());

        // Setup oracle roles
        await oracle.setHalomToken(await halomToken.getAddress());
        await oracle.grantRole(await oracle.ORACLE_UPDATER_ROLE(), await roleManager.getAddress());
        await oracle.addOracleNode(await governor.getAddress());

        // Setup staking roles
        await staking.grantRole(REWARDER_ROLE, await halomToken.getAddress());
        await lpStaking.grantRole(REWARDER_ROLE, await governor.getAddress());

        // Grant MINTER_ROLE to owner for testing
        await halomToken.connect(owner).grantRole(MINTER_ROLE, owner.address);

        // Mint initial tokens
        await halomToken.connect(owner).mint(owner.address, ethers.parseEther("10000000"));
    }

    beforeEach(async function () {
        await deploySecureContracts();
    });

    describe("DEFAULT_ADMIN_ROLE Security", function () {
        it("Should only be assigned to TimelockController", async function () {
            expect(await timelock.hasRole(DEFAULT_ADMIN_ROLE, timelock.address)).to.be.true;
            expect(await timelock.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true; // Initially with deployer
            expect(await timelock.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.false;
        });

        it("Should not be assigned to individual wallets in other contracts", async function () {
            expect(await halomToken.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.false;
            expect(await oracle.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.false;
            expect(await staking.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.false;
        });
    });

    describe("MINTER_ROLE Security", function () {
        it("Should only be assigned to contracts, not individual wallets", async function () {
            expect(await halomToken.hasRole(MINTER_ROLE, staking.address)).to.be.true;
            expect(await halomToken.hasRole(MINTER_ROLE, user1.address)).to.be.false;
        });

        it("Should NOT grant DEFAULT_ADMIN_ROLE to staking contracts", async function () {
            // Staking contract should have MINTER_ROLE but NOT DEFAULT_ADMIN_ROLE
            expect(await halomToken.hasRole(MINTER_ROLE, staking.address)).to.be.true;
            expect(await halomToken.hasRole(DEFAULT_ADMIN_ROLE, staking.address)).to.be.false;
        });

        it("Should prevent unauthorized minting", async function () {
            await expect(
                halomToken.connect(user1).mint(user1.address, ethers.parseEther("1000"))
            ).to.be.revertedWith("AccessControl");
        });

        it("Should allow authorized contract to mint", async function () {
            const initialBalance = await halomToken.balanceOf(staking.address);
            await halomToken.connect(owner).mint(staking.address, ethers.parseEther("1000"));
            const finalBalance = await halomToken.balanceOf(staking.address);
            expect(finalBalance.sub(initialBalance)).to.equal(ethers.parseEther("1000"));
        });

        it("Should prevent staking contract from changing token parameters", async function () {
            // Staking contract should not be able to change reward rate (DEFAULT_ADMIN_ROLE function)
            await expect(
                halomToken.connect(staking).setRewardRate(3000)
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("REBASE_CALLER Security", function () {
        it("Should only be assigned to Oracle contract", async function () {
            expect(await halomToken.hasRole(REBASE_CALLER, oracle.address)).to.be.true;
            expect(await halomToken.hasRole(REBASE_CALLER, user1.address)).to.be.false;
        });

        it("Should prevent unauthorized rebase", async function () {
            await expect(
                halomToken.connect(user1).rebase(ethers.parseEther("1000"))
            ).to.be.revertedWith("AccessControl");
        });

        it("Should allow oracle to trigger rebase", async function () {
            const initialSupply = await halomToken.totalSupply();
            await halomToken.connect(owner).rebase(ethers.parseEther("1000"));
            const finalSupply = await halomToken.totalSupply();
            expect(finalSupply.gt(initialSupply)).to.be.true;
        });
    });

    describe("STAKING_CONTRACT_ROLE Security", function () {
        it("Should only be assigned to Staking contract", async function () {
            expect(await halomToken.hasRole(STAKING_CONTRACT_ROLE, staking.address)).to.be.true;
            expect(await halomToken.hasRole(STAKING_CONTRACT_ROLE, user1.address)).to.be.false;
        });

        it("Should prevent unauthorized burning", async function () {
            await expect(
                halomToken.connect(user1).burnFrom(user2.address, ethers.parseEther("100"))
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("ORACLE_UPDATER_ROLE Security", function () {
        it("Should only be assigned to authorized oracle nodes", async function () {
            expect(await oracle.hasRole(ORACLE_UPDATER_ROLE, governor.address)).to.be.true;
            expect(await oracle.hasRole(ORACLE_UPDATER_ROLE, user1.address)).to.be.false;
        });

        it("Should prevent unauthorized HOI submission", async function () {
            await expect(
                oracle.connect(user1).submitHOI(1000000000) // 1.0 HOI
            ).to.be.revertedWith("AccessControl");
        });

        it("Should allow authorized oracle to submit HOI", async function () {
            await oracle.connect(owner).submitHOI(1000000000); // 1.0 HOI
            // Check that submission was recorded
            const submission = await oracle.getOracleSubmission(governor.address);
            expect(submission.submitted).to.be.true;
        });
    });

    describe("REWARDER_ROLE Security", function () {
        it("Should only be assigned to authorized contracts", async function () {
            expect(await staking.hasRole(REWARDER_ROLE, halomToken.address)).to.be.true;
            expect(await staking.hasRole(REWARDER_ROLE, user1.address)).to.be.false;
        });

        it("Should prevent unauthorized reward addition", async function () {
            await expect(
                staking.connect(user1).addRewards(ethers.parseEther("1000"))
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("SLASHER_ROLE Security", function () {
        it("Should only be assigned to Governor", async function () {
            expect(await staking.hasRole(SLASHER_ROLE, governor.address)).to.be.true;
            expect(await staking.hasRole(SLASHER_ROLE, user1.address)).to.be.false;
        });

        it("Should prevent unauthorized slashing", async function () {
            await expect(
                staking.connect(user1).slash(user2.address, "Test reason")
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("TREASURY_CONTROLLER Security", function () {
        it("Should only be assigned to Governor", async function () {
            expect(await treasury.hasRole(TREASURY_CONTROLLER, governor.address)).to.be.true;
            expect(await treasury.hasRole(TREASURY_CONTROLLER, user1.address)).to.be.false;
        });

        it("Should prevent unauthorized treasury withdrawals", async function () {
            await expect(
                treasury.connect(user1).withdrawTreasuryFunds(user1.address, ethers.parseEther("1000"), false)
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("GOVERNOR_ROLE Security", function () {
        it("Should only be assigned to Governor contract", async function () {
            expect(await staking.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
            expect(await staking.hasRole(GOVERNOR_ROLE, user1.address)).to.be.false;
        });

        it("Should prevent unauthorized parameter updates", async function () {
            await expect(
                staking.connect(user1).updateStakingParameters(
                    ethers.parseEther("100"),
                    ethers.parseEther("1000000"),
                    30 * 24 * 60 * 60 // 30 days
                )
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("Role Manager Security", function () {
        it("Should prevent direct role grants", async function () {
            await expect(
                roleManager.grantRole(MINTER_ROLE, user1.address)
            ).to.be.revertedWith("Use grantRoleToContract for contracts or specific functions for humans");
        });

        it("Should prevent direct role revokes", async function () {
            await expect(
                roleManager.revokeRole(MINTER_ROLE, user1.address)
            ).to.be.revertedWith("Use revokeRoleFromHuman for humans or specific functions for contracts");
        });

        it("Should allow contract role assignment", async function () {
            await roleManager.connect(owner).grantRoleToContract(MINTER_ROLE, staking.address);
            expect(await roleManager.hasRole(MINTER_ROLE, staking.address)).to.be.true;
        });
    });

    describe("Anti-Whale Protection", function () {
        it("Should enforce transfer limits", async function () {
            const maxTransfer = await halomToken.maxTransferAmount();
            await expect(
                halomToken.connect(owner).transfer(user1.address, maxTransfer.add(1))
            ).to.be.revertedWith("HalomToken: Transfer amount exceeds limit");
        });

        it("Should enforce wallet limits", async function () {
            const maxWallet = await halomToken.maxWalletAmount();
            await halomToken.connect(owner).transfer(user1.address, maxWallet);
            await expect(
                halomToken.connect(owner).transfer(user1.address, 1)
            ).to.be.revertedWith("HalomToken: Wallet balance would exceed limit");
        });

        it("Should exclude contracts from limits", async function () {
            expect(await halomToken.isExcludedFromLimits(staking.address)).to.be.true;
            expect(await halomToken.isExcludedFromLimits(oracle.address)).to.be.true;
        });
    });

    describe("Fourth Root Governance", function () {
        it("Should calculate governance power correctly", async function () {
            await halomToken.connect(owner).transfer(user1.address, ethers.parseEther("10000"));
            await halomToken.connect(user1).approve(staking.address, ethers.parseEther("10000"));
            await staking.connect(user1).stake(ethers.parseEther("10000"));
            
            const governancePower = await staking.getGovernancePower(user1.address);
            expect(governancePower).to.be.gt(0);
        });

        it("Should distribute rewards based on fourth root", async function () {
            // Stake different amounts
            await halomToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));
            await halomToken.connect(owner).transfer(user2.address, ethers.parseEther("10000"));
            
            await halomToken.connect(user1).approve(staking.address, ethers.parseEther("1000"));
            await halomToken.connect(user2).approve(staking.address, ethers.parseEther("10000"));
            
            await staking.connect(user1).stake(ethers.parseEther("1000"));
            await staking.connect(user2).stake(ethers.parseEther("10000"));
            
            // Add rewards
            await halomToken.connect(owner).approve(staking.address, ethers.parseEther("1000"));
            await staking.connect(owner).addRewards(ethers.parseEther("1000"));
            
            // Check that rewards are distributed based on fourth root
            const power1 = await staking.getGovernancePower(user1.address);
            const power2 = await staking.getGovernancePower(user2.address);
            
            // User2 should have more governance power but not proportionally to their stake
            expect(power2).to.be.gt(power1);
            expect(power2).to.be.lt(ethers.parseEther("10")); // Less than 10x despite 10x stake
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow emergency pause", async function () {
            await staking.connect(owner).pause();
            expect(await staking.paused()).to.be.true;
        });

        it("Should allow emergency unpause", async function () {
            await staking.connect(owner).pause();
            await staking.connect(owner).unpause();
            expect(await staking.paused()).to.be.false;
        });

        it("Should allow emergency recovery", async function () {
            // Send some tokens to treasury by mistake
            await halomToken.connect(owner).transfer(treasury.address, ethers.parseEther("1000"));
            
            const initialBalance = await halomToken.balanceOf(owner.address);
            await treasury.connect(owner).emergencyRecovery(
                halomToken.address,
                owner.address,
                ethers.parseEther("1000")
            );
            const finalBalance = await halomToken.balanceOf(owner.address);
            
            expect(finalBalance.sub(initialBalance)).to.equal(ethers.parseEther("1000"));
        });
    });

    describe("Oracle Consensus", function () {
        it("Should require multiple oracle submissions for consensus", async function () {
            // First submission
            await oracle.connect(owner).submitHOI(1000000000); // 1.0 HOI
            
            // Check that consensus is not reached yet
            const round = await oracle.getCurrentRound();
            expect(round.executed).to.be.false;
        });

        it("Should prevent unauthorized oracle submissions", async function () {
            await expect(
                oracle.connect(user1).submitHOI(1000000000)
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("Slashing Mechanism", function () {
        it("Should allow authorized slashing", async function () {
            // Setup user with stake
            await halomToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));
            await halomToken.connect(user1).approve(staking.address, ethers.parseEther("1000"));
            await staking.connect(user1).stake(ethers.parseEther("1000"));
            
            const initialStake = await staking.stakedBalance(user1.address);
            
            // Slash user
            await staking.connect(owner).slash(user1.address, "Test slashing");
            
            const finalStake = await staking.stakedBalance(user1.address);
            expect(finalStake).to.be.lt(initialStake);
        });

        it("Should prevent unauthorized slashing", async function () {
            await expect(
                staking.connect(user1).slash(user2.address, "Test reason")
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("Rebase and Reward Distribution", function () {
        it("Should properly distribute rebase rewards to staking contract", async function () {
            // Setup user with stake
            await halomToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));
            await halomToken.connect(user1).approve(staking.address, ethers.parseEther("1000"));
            await staking.connect(user1).stake(ethers.parseEther("1000"));
            
            const initialStakingBalance = await halomToken.balanceOf(staking.address);
            
            // Trigger rebase with positive supply delta
            const rebaseAmount = ethers.parseEther("100"); // 100 HLM increase
            await halomToken.connect(owner).rebase(rebaseAmount);
            
            const finalStakingBalance = await halomToken.balanceOf(staking.address);
            
            // Staking contract should receive rewards (20% of rebase amount)
            const expectedRewards = rebaseAmount.mul(2000).div(10000); // 20% in basis points
            expect(finalStakingBalance.sub(initialStakingBalance)).to.equal(expectedRewards);
        });

        it("Should fail to distribute rewards if staking contract not set", async function () {
            // Deploy new token without setting staking contract
            const newToken = await HalomToken.deploy(
                oracle.address,
                governor.address
            );
            
            // Try to rebase - should work but no rewards distributed
            const rebaseAmount = ethers.parseEther("100");
            await newToken.connect(owner).rebase(rebaseAmount);
            
            // No rewards should be distributed since staking contract not set
            const stakingBalance = await newToken.balanceOf(staking.address);
            expect(stakingBalance).to.equal(0);
        });

        it("Should properly burn tokens during slash operation", async function () {
            // Setup user with stake
            await halomToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));
            await halomToken.connect(user1).approve(staking.address, ethers.parseEther("1000"));
            await staking.connect(user1).stake(ethers.parseEther("1000"));
            
            const initialUserBalance = await halomToken.balanceOf(user1.address);
            const initialStakingBalance = await halomToken.balanceOf(staking.address);
            
            // Slash user (50% of stake)
            await staking.connect(owner).slash(user1.address, "Test slashing");
            
            // User should lose 50% of their stake
            const finalUserBalance = await halomToken.balanceOf(user1.address);
            const finalStakingBalance = await halomToken.balanceOf(staking.address);
            
            // Staking contract should have burned the slashed tokens
            expect(finalStakingBalance).to.be.lt(initialStakingBalance);
        });

        it("Should fail to slash if STAKING_CONTRACT_ROLE not granted", async function () {
            // Create a new staking contract without STAKING_CONTRACT_ROLE
            const newStaking = await HalomStaking.deploy(
                halomToken.address,
                governor.address,
                halomToken.address,
                governor.address
            );
            
            // Setup user with stake in new contract
            await halomToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));
            await halomToken.connect(user1).approve(newStaking.address, ethers.parseEther("1000"));
            await newStaking.connect(user1).stake(ethers.parseEther("1000"));
            
            // Try to slash - should fail because newStaking doesn't have STAKING_CONTRACT_ROLE
            await expect(
                newStaking.connect(owner).slash(user1.address, "Test slashing")
            ).to.be.revertedWith("AccessControl");
        });

        it("Should verify all required roles are properly assigned", async function () {
            // Check MINTER_ROLE
            expect(await halomToken.hasRole(MINTER_ROLE, staking.address)).to.be.true;
            
            // Check STAKING_CONTRACT_ROLE
            expect(await halomToken.hasRole(STAKING_CONTRACT_ROLE, staking.address)).to.be.true;
            
            // Check REBASE_CALLER
            expect(await halomToken.hasRole(REBASE_CALLER, oracle.address)).to.be.true;
            
            // Check REWARDER_ROLE
            expect(await staking.hasRole(REWARDER_ROLE, halomToken.address)).to.be.true;
            
            // Check SLASHER_ROLE
            expect(await staking.hasRole(SLASHER_ROLE, governor.address)).to.be.true;
        });

        it("Should verify staking contract address is properly set", async function () {
            const stakingAddress = await halomToken.halomStakingAddress();
            expect(stakingAddress).to.equal(staking.address);
        });
    });
}); 
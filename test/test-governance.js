const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Halom Governance System", function () {
    let halomToken, timelock, governor, treasury, oracle, staking, lpStaking;
    let deployer, user1, user2, user3, multisig;
    let initialSupply, lockAmount;

    beforeEach(async function () {
        [deployer, user1, user2, user3, multisig] = await ethers.getSigners();
        
        // Deploy contracts
        const HalomToken = await ethers.getContractFactory("HalomToken");
        halomToken = await HalomToken.deploy(deployer.address, deployer.address);
        await halomToken.deployed();

        const TimelockController = await ethers.getContractFactory("TimelockController");
        timelock = await TimelockController.deploy(86400, [], [], deployer.address);
        await timelock.deployed();

        const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
        governor = await HalomGovernor.deploy(halomToken.address, timelock.address);
        await governor.deployed();

        const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
        treasury = await HalomTreasury.deploy(
            halomToken.address,
            halomToken.address, // Using halomToken as stablecoin for testing
            deployer.address,
            deployer.address,
            deployer.address
        );
        await treasury.deployed();

        const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
        oracle = await HalomOracleV2.deploy(
            deployer.address,
            deployer.address,
            deployer.address
        );
        await oracle.deployed();

        const HalomStaking = await ethers.getContractFactory("HalomStaking");
        staking = await HalomStaking.deploy(
            halomToken.address,
            deployer.address,
            deployer.address,
            deployer.address
        );
        await staking.deployed();

        const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(
            halomToken.address,
            halomToken.address,
            deployer.address,
            deployer.address
        );
        await lpStaking.deployed();

        // Setup roles
        const proposerRole = await timelock.PROPOSER_ROLE();
        const executorRole = await timelock.EXECUTOR_ROLE();
        const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

        await timelock.grantRole(proposerRole, governor.address);
        await timelock.grantRole(executorRole, governor.address);

        // Mint initial tokens
        initialSupply = ethers.utils.parseEther("10000000"); // 10M HLM
        await halomToken.mint(deployer.address, initialSupply);
        
        // Transfer tokens to users for testing
        const userAmount = ethers.utils.parseEther("100000"); // 100K HLM each
        await halomToken.transfer(user1.address, userAmount);
        await halomToken.transfer(user2.address, userAmount);
        await halomToken.transfer(user3.address, userAmount);

        lockAmount = ethers.utils.parseEther("10000"); // 10K HLM for locking
    });

    describe("Timelock Configuration", function () {
        it("Should have correct initial configuration", async function () {
            expect(await timelock.getMinDelay()).to.equal(86400); // 24 hours
            expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), governor.address)).to.be.true;
            expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), governor.address)).to.be.true;
            expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).to.be.true;
        });

        it("Should allow admin role transfer to multisig", async function () {
            const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
            
            await timelock.grantRole(adminRole, multisig.address);
            await timelock.revokeRole(adminRole, deployer.address);
            
            expect(await timelock.hasRole(adminRole, multisig.address)).to.be.true;
            expect(await timelock.hasRole(adminRole, deployer.address)).to.be.false;
        });

        it("Should prevent non-admin from changing roles", async function () {
            const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
            
            await expect(
                timelock.connect(user1).grantRole(adminRole, user1.address)
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("Governor Configuration", function () {
        it("Should have correct initial configuration", async function () {
            expect(await governor.votingDelay()).to.equal(1);
            expect(await governor.votingPeriod()).to.equal(45818);
            expect(await governor.proposalThreshold()).to.equal(ethers.utils.parseEther("1000"));
            expect(await governor.quorumNumerator()).to.equal(4);
        });

        it("Should allow root power updates by governance", async function () {
            // First, lock tokens to get voting power
            await halomToken.approve(governor.address, lockAmount);
            await governor.lockTokens(lockAmount);
            
            // Create proposal to update root power
            const targets = [governor.address];
            const values = [0];
            const calldatas = [governor.interface.encodeFunctionData("setRootPower", [5])];
            const description = "Update root power to 5";
            
            await governor.propose(targets, values, calldatas, description);
            
            // Vote and execute (simplified for testing)
            const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
            
            // Fast forward and vote
            await ethers.provider.send("evm_mine", []);
            await governor.castVote(proposalId, 1); // For
            
            // Fast forward to voting end
            for (let i = 0; i < 45818; i++) {
                await ethers.provider.send("evm_mine", []);
            }
            
            // Queue and execute
            await governor.queue(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
            
            // Fast forward timelock delay
            await ethers.provider.send("evm_increaseTime", [86400]);
            await ethers.provider.send("evm_mine", []);
            
            await governor.execute(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
            
            expect(await governor.rootPower()).to.equal(5);
        });
    });

    describe("Token Locking and Voting Power", function () {
        it("Should allow users to lock tokens", async function () {
            await halomToken.approve(governor.address, lockAmount);
            await governor.lockTokens(lockAmount);
            
            expect(await governor.lockedTokens(user1.address)).to.equal(lockAmount);
            expect(await governor.lockTime(user1.address)).to.be.gt(0);
        });

        it("Should calculate voting power using fourth root", async function () {
            await halomToken.approve(governor.address, lockAmount);
            await governor.lockTokens(lockAmount);
            
            const votingPower = await governor.getVotePower(user1.address);
            const expectedPower = Math.floor(Math.pow(ethers.utils.formatEther(lockAmount), 1/4) * 1e18);
            
            expect(votingPower).to.be.closeTo(expectedPower, expectedPower * 0.01); // 1% tolerance
        });

        it("Should not allow voting after lock expires", async function () {
            await halomToken.approve(governor.address, lockAmount);
            await governor.lockTokens(lockAmount);
            
            // Fast forward 5 years + 1 day
            await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 86400]);
            await ethers.provider.send("evm_mine", []);
            
            expect(await governor.getVotePower(user1.address)).to.equal(0);
        });

        it("Should allow token unlocking after lock period", async function () {
            await halomToken.approve(governor.address, lockAmount);
            await governor.lockTokens(lockAmount);
            
            // Fast forward 5 years + 1 day
            await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 86400]);
            await ethers.provider.send("evm_mine", []);
            
            const balanceBefore = await halomToken.balanceOf(user1.address);
            await governor.unlockTokens();
            const balanceAfter = await halomToken.balanceOf(user1.address);
            
            expect(balanceAfter.sub(balanceBefore)).to.equal(lockAmount);
            expect(await governor.lockedTokens(user1.address)).to.equal(0);
        });
    });

    describe("Treasury Governance", function () {
        it("Should allow fee distribution address updates", async function () {
            await treasury.updateFeeDistributionAddresses(
                staking.address,
                lpStaking.address,
                multisig.address
            );
            
            expect(await treasury.stakingAddress()).to.equal(staking.address);
            expect(await treasury.lpStakingAddress()).to.equal(lpStaking.address);
            expect(await treasury.daoReserveAddress()).to.equal(multisig.address);
        });

        it("Should prevent zero address assignments", async function () {
            await expect(
                treasury.updateFeeDistributionAddresses(
                    ethers.constants.AddressZero,
                    lpStaking.address,
                    multisig.address
                )
            ).to.be.revertedWith("Staking address cannot be zero");
        });

        it("Should validate fee percentage updates", async function () {
            await expect(
                treasury.updateFeePercentages(5000, 3000, 3000) // Sum > 100%
            ).to.be.revertedWith("Percentages must sum to 100%");
            
            await expect(
                treasury.updateFeePercentages(0, 5000, 5000) // Zero percentage
            ).to.be.revertedWith("Staking percentage must be greater than 0");
        });

        it("Should distribute fees correctly", async function () {
            // Setup addresses
            await treasury.updateFeeDistributionAddresses(
                staking.address,
                lpStaking.address,
                multisig.address
            );
            
            // Fund treasury
            const treasuryAmount = ethers.utils.parseEther("10000");
            await halomToken.transfer(treasury.address, treasuryAmount);
            
            // Distribute fees
            await treasury.distributeCollectedFees();
            
            const stakingBalance = await halomToken.balanceOf(staking.address);
            const lpStakingBalance = await halomToken.balanceOf(lpStaking.address);
            const multisigBalance = await halomToken.balanceOf(multisig.address);
            
            // Should be distributed according to default percentages (60%, 20%, 20%)
            expect(stakingBalance).to.equal(treasuryAmount.mul(60).div(100));
            expect(lpStakingBalance).to.equal(treasuryAmount.mul(20).div(100));
            expect(multisigBalance).to.equal(treasuryAmount.mul(20).div(100));
        });
    });

    describe("Oracle Governance", function () {
        it("Should allow governance role assignment", async function () {
            const GOVERNOR_ROLE = await oracle.GOVERNOR_ROLE();
            await oracle.grantRole(GOVERNOR_ROLE, governor.address);
            
            expect(await oracle.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
        });

        it("Should prevent unauthorized role changes", async function () {
            const GOVERNOR_ROLE = await oracle.GOVERNOR_ROLE();
            
            await expect(
                oracle.connect(user1).grantRole(GOVERNOR_ROLE, user1.address)
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("Staking Governance", function () {
        it("Should allow governance role assignment", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            await staking.grantRole(GOVERNOR_ROLE, governor.address);
            
            expect(await staking.hasRole(GOVERNOR_ROLE, governor.address)).to.be.true;
        });

        it("Should prevent unauthorized role changes", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            
            await expect(
                staking.connect(user1).grantRole(GOVERNOR_ROLE, user1.address)
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow emergency recovery by governor", async function () {
            const recoveryAmount = ethers.utils.parseEther("1000");
            await halomToken.transfer(treasury.address, recoveryAmount);
            
            await treasury.emergencyRecovery(halomToken.address, user1.address, recoveryAmount);
            
            expect(await halomToken.balanceOf(user1.address)).to.equal(recoveryAmount);
        });

        it("Should prevent emergency recovery to zero address", async function () {
            await expect(
                treasury.emergencyRecovery(halomToken.address, ethers.constants.AddressZero, 1000)
            ).to.be.revertedWith("Cannot recover to zero address");
        });

        it("Should allow pausing by authorized pauser", async function () {
            await treasury.pause();
            expect(await treasury.paused()).to.be.true;
        });

        it("Should allow unpausing by governor", async function () {
            await treasury.pause();
            await treasury.unpause();
            expect(await treasury.paused()).to.be.false;
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete governance flow", async function () {
            // 1. Lock tokens for voting power
            await halomToken.approve(governor.address, lockAmount);
            await governor.lockTokens(lockAmount);
            
            // 2. Create proposal to update treasury fee distribution
            const targets = [treasury.address];
            const values = [0];
            const calldatas = [
                treasury.interface.encodeFunctionData("updateFeePercentages", [7000, 2000, 1000])
            ];
            const description = "Update treasury fee distribution to 70% staking, 20% LP, 10% DAO";
            
            await governor.propose(targets, values, calldatas, description);
            
            // 3. Vote on proposal
            const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
            
            await ethers.provider.send("evm_mine", []);
            await governor.castVote(proposalId, 1); // For
            
            // 4. Wait for voting to end
            for (let i = 0; i < 45818; i++) {
                await ethers.provider.send("evm_mine", []);
            }
            
            // 5. Queue proposal
            await governor.queue(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
            
            // 6. Wait for timelock delay
            await ethers.provider.send("evm_increaseTime", [86400]);
            await ethers.provider.send("evm_mine", []);
            
            // 7. Execute proposal
            await governor.execute(targets, values, calldatas, ethers.utils.keccak256(ethers.utils.toUtf8Bytes(description)));
            
            // 8. Verify changes
            expect(await treasury.stakingFeePercentage()).to.equal(7000);
            expect(await treasury.lpStakingFeePercentage()).to.equal(2000);
            expect(await treasury.daoReserveFeePercentage()).to.equal(1000);
        });
    });
}); 
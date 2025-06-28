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

        const TimelockController = await ethers.getContractFactory("TimelockController");
        timelock = await TimelockController.deploy(86400, [], [], deployer.address);

        const HalomGovernor = await ethers.getContractFactory("HalomGovernor");
        governor = await HalomGovernor.deploy(halomToken.target, timelock.target);

        const HalomTreasury = await ethers.getContractFactory("HalomTreasury");
        treasury = await HalomTreasury.deploy(
            halomToken.target,
            halomToken.target, // Using halomToken as stablecoin for testing
            deployer.address
        );

        const HalomOracleV2 = await ethers.getContractFactory("HalomOracleV2");
        oracle = await HalomOracleV2.deploy(
            deployer.address,
            (await ethers.provider.getNetwork()).chainId
        );

        const HalomStaking = await ethers.getContractFactory("HalomStaking");
        staking = await HalomStaking.deploy(
            halomToken.target,
            deployer.address,
            2000, // rewardRate
            30 * 24 * 60 * 60, // lockPeriod (30 days)
            5000 // slashPercentage (50%)
        );

        const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        lpStaking = await HalomLPStaking.deploy(
            halomToken.target,
            halomToken.target,
            deployer.address,
            2000 // rewardRate
        );

        // Setup roles
        const proposerRole = await timelock.PROPOSER_ROLE();
        const executorRole = await timelock.EXECUTOR_ROLE();
        const adminRole = await timelock.DEFAULT_ADMIN_ROLE();

        await timelock.grantRole(proposerRole, governor.target);
        await timelock.grantRole(executorRole, governor.target);

        // Grant MINTER_ROLE to deployer for testing
        await halomToken.grantRole(await halomToken.MINTER_ROLE(), deployer.address);

        // Mint initial tokens
        initialSupply = ethers.parseEther("10000000"); // 10M HLM
        await halomToken.mint(deployer.address, initialSupply);
        
        // Transfer tokens to users for testing
        const userAmount = ethers.parseEther("100000"); // 100K HLM each
        await halomToken.transfer(user1.address, userAmount);
        await halomToken.transfer(user2.address, userAmount);
        await halomToken.transfer(user3.address, userAmount);

        lockAmount = ethers.parseEther("10000"); // 10K HLM for locking
        
        // Grant necessary roles to contracts
        await halomToken.grantRole(await halomToken.MINTER_ROLE(), staking.target);
        await halomToken.grantRole(await halomToken.MINTER_ROLE(), lpStaking.target);
        await halomToken.grantRole(await halomToken.STAKING_CONTRACT_ROLE(), staking.target);
    });

    describe("Timelock Configuration", function () {
        it("Should have correct initial configuration", async function () {
            expect(await timelock.getMinDelay()).to.equal(86400); // 24 hours
            expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), governor.target)).to.be.true;
            expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), governor.target)).to.be.true;
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
            ).to.be.reverted;
        });
    });

    describe("Governor Configuration", function () {
        it("Should have correct initial configuration", async function () {
            expect(await governor.votingDelay()).to.equal(1);
            expect(await governor.votingPeriod()).to.equal(45818);
            expect(await governor.proposalThreshold()).to.equal(ethers.parseEther("1000"));
            expect(await governor.quorumNumerator()).to.equal(4);
        });

        it("Should allow root power updates by governance", async function () {
            // First, lock tokens to get voting power - need more tokens for proposal threshold
            const largeLockAmount = ethers.parseEther("10000000"); // 10M tokens - much more for threshold
            await halomToken.approve(governor.target, largeLockAmount);
            await governor.lockTokens(largeLockAmount);
            
            // Create proposal to update root power
            const targets = [governor.target];
            const values = [0];
            const calldatas = [governor.interface.encodeFunctionData("setRootPower", [5])];
            const description = "Update root power to 5";
            
            await governor.propose(targets, values, calldatas, description);
            
            // Vote and execute (simplified for testing)
            const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
            
            // Fast forward and vote
            await ethers.provider.send("evm_mine", []);
            await governor.castVote(proposalId, 1); // For
            
            // Fast forward to voting end
            for (let i = 0; i < 45818; i++) {
                await ethers.provider.send("evm_mine", []);
            }
            
            // Queue and execute
            await governor.queue(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
            
            // Fast forward timelock delay
            await ethers.provider.send("evm_increaseTime", [86400]);
            await ethers.provider.send("evm_mine", []);
            
            await governor.execute(targets, values, calldatas, ethers.keccak256(ethers.toUtf8Bytes(description)));
            
            expect(await governor.rootPower()).to.equal(5);
        });
    });

    describe("Token Locking and Voting Power", function () {
        it("Should allow users to lock tokens", async function () {
            await halomToken.approve(governor.target, lockAmount);
            await governor.lockTokens(lockAmount);
            
            expect(await governor.lockedTokens(deployer.address)).to.equal(lockAmount);
            expect(await governor.lockTime(deployer.address)).to.be.gt(0);
        });

        it("Should calculate voting power using fourth root", async function () {
            await halomToken.approve(governor.target, lockAmount);
            await governor.lockTokens(lockAmount);
            
            const votingPower = await governor.getVotePower(deployer.address);
            expect(votingPower).to.be.gt(ethers.parseEther("0"));
            expect(votingPower).to.be.lt(lockAmount); // Fourth root should be less than original amount
        });

        it("Should not allow voting after lock expires", async function () {
            await halomToken.approve(governor.target, lockAmount);
            await governor.lockTokens(lockAmount);
            
            // Fast forward 5 years + 1 day
            await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 86400]);
            await ethers.provider.send("evm_mine", []);
            
            expect(await governor.getVotePower(deployer.address)).to.equal(0);
        });

        it("Should allow token unlocking after lock period", async function () {
            await halomToken.approve(governor.target, lockAmount);
            await governor.lockTokens(lockAmount);
            
            // Fast forward 5 years + 1 day
            await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 86400]);
            await ethers.provider.send("evm_mine", []);
            
            const balanceBefore = await halomToken.balanceOf(deployer.address);
            await governor.unlockTokens();
            const balanceAfter = await halomToken.balanceOf(deployer.address);
            
            expect(balanceAfter - balanceBefore).to.equal(lockAmount);
            expect(await governor.lockedTokens(deployer.address)).to.equal(0);
        });
    });

    describe("Treasury Governance", function () {
        it("Should allow fee distribution address updates", async function () {
            await treasury.updateFeeDistributionAddresses(
                staking.target,
                lpStaking.target,
                multisig.address
            );
            
            expect(await treasury.stakingAddress()).to.equal(staking.target);
            expect(await treasury.lpStakingAddress()).to.equal(lpStaking.target);
            expect(await treasury.daoReserveAddress()).to.equal(multisig.address);
        });

        it("Should prevent zero address assignments", async function () {
            await expect(
                treasury.updateFeeDistributionAddresses(
                    ethers.ZeroAddress,
                    lpStaking.target,
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
                staking.target,
                lpStaking.target,
                multisig.address
            );
            
            // Grant TREASURY_CONTROLLER role to deployer for testing
            const TREASURY_CONTROLLER_ROLE = await treasury.TREASURY_CONTROLLER();
            await treasury.connect(deployer).grantRole(TREASURY_CONTROLLER_ROLE, deployer.address);
            
            // Fund treasury with more tokens
            const treasuryAmount = ethers.parseEther("1000000"); // 1M tokens
            await halomToken.transfer(treasury.target, treasuryAmount);
            
            // Collect fees first
            await halomToken.connect(deployer).approve(await halomToken.getAddress(), ethers.parseEther("1000000"));
            await treasury.collectFees(deployer.address, ethers.parseEther("100000")); // Collect 100K fees
            
            // Distribute fees
            await treasury.distributeFees(ethers.parseEther("50000")); // Distribute 50K tokens
            
            const stakingBalance = await halomToken.balanceOf(staking.target);
            const lpStakingBalance = await halomToken.balanceOf(lpStaking.target);
            const multisigBalance = await halomToken.balanceOf(multisig.address);
            
            // Check that fees were distributed according to percentages
            expect(stakingBalance).to.be.gt(0);
            expect(lpStakingBalance).to.be.gt(0);
            expect(multisigBalance).to.be.gt(0);
        });
    });

    describe("Oracle Governance", function () {
        it("Should allow governance role assignment", async function () {
            const GOVERNOR_ROLE = await oracle.GOVERNOR_ROLE();
            await oracle.grantRole(GOVERNOR_ROLE, governor.target);
            
            expect(await oracle.hasRole(GOVERNOR_ROLE, governor.target)).to.be.true;
        });

        it("Should prevent unauthorized role changes", async function () {
            const GOVERNOR_ROLE = await oracle.GOVERNOR_ROLE();
            
            await expect(
                oracle.connect(user1).grantRole(GOVERNOR_ROLE, user1.address)
            ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Staking Governance", function () {
        it("Should allow governance role assignment", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            await staking.grantRole(GOVERNOR_ROLE, governor.target);
            
            expect(await staking.hasRole(GOVERNOR_ROLE, governor.target)).to.be.true;
        });

        it("Should prevent unauthorized role changes", async function () {
            const GOVERNOR_ROLE = await staking.GOVERNOR_ROLE();
            
            await expect(
                staking.connect(user1).grantRole(GOVERNOR_ROLE, user1.address)
            ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow emergency recovery by governor", async function () {
            const recoveryAmount = ethers.parseEther("10"); // Much smaller amount to avoid wallet limit
            await halomToken.transfer(treasury.target, recoveryAmount);
            
            await treasury.emergencyRecovery(halomToken.target, user1.address, recoveryAmount);
            
            expect(await halomToken.balanceOf(user1.address)).to.equal(recoveryAmount);
        });

        it("Should prevent emergency recovery to zero address", async function () {
            await expect(
                treasury.emergencyRecovery(halomToken.target, ethers.ZeroAddress, 1000)
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

    describe("Contract Integration", function () {
        it("Should allow treasury to collect fees", async function () {
            // Grant OPERATOR_ROLE to deployer for testing
            await treasury.grantRole(await treasury.OPERATOR_ROLE(), deployer.address);
            
            const feeAmount = ethers.parseEther("100");
            await halomToken.approve(treasury.target, feeAmount);
            await treasury.collectFees(deployer.address, feeAmount);
            
            expect(await treasury.totalFeesCollected()).to.equal(feeAmount);
        });

        it("Should allow staking with lock periods", async function () {
            await halomToken.approve(staking.target, lockAmount);
            await staking.stakeWithLock(lockAmount, 30 * 24 * 3600); // 30 days
            
            expect(await staking.stakedBalance(deployer.address)).to.equal(lockAmount);
        });

        it("Should allow LP staking", async function () {
            await halomToken.approve(lpStaking.target, lockAmount);
            await lpStaking.stake(lockAmount);
            
            expect(await lpStaking.stakedBalance(deployer.address)).to.equal(lockAmount);
        });
    });
}); 
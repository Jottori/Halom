const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomStakingV2 - Delegation", function () {
    let staking, token, owner, user1, user2, user3, user4;
    let validator1, validator2, delegator1, delegator2;

    beforeEach(async function () {
        [owner, user1, user2, user3, user4, validator1, validator2, delegator1, delegator2] = await ethers.getSigners();

        // Deploy token
        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("Halom Token", "HALOM");
        await token.deployed();

        // Deploy staking contract
        const StakingV2 = await ethers.getContractFactory("HalomStakingV2");
        staking = await StakingV2.deploy(token.address, owner.address);
        await staking.deployed();

        // Setup initial balances
        await token.mint(validator1.address, ethers.utils.parseEther("10000"));
        await token.mint(validator2.address, ethers.utils.parseEther("10000"));
        await token.mint(delegator1.address, ethers.utils.parseEther("5000"));
        await token.mint(delegator2.address, ethers.utils.parseEther("5000"));
        await token.mint(user1.address, ethers.utils.parseEther("1000"));
        await token.mint(user2.address, ethers.utils.parseEther("1000"));
    });

    describe("Validator Registration", function () {
        beforeEach(async function () {
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
        });

        it("Should register validator successfully", async function () {
            await staking.connect(validator1).registerValidator(1000); // 10% commission

            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.isActive).to.be.true;
            expect(validatorInfo.commissionRate).to.equal(1000);
            expect(validatorInfo.ownStake).to.equal(ethers.utils.parseEther("1000"));
        });

        it("Should revert if insufficient stake", async function () {
            await expect(staking.connect(user1).registerValidator(1000))
                .to.be.revertedWithCustomError(staking, "Staking__InsufficientDelegation");
        });

        it("Should revert if commission rate too high", async function () {
            await expect(staking.connect(validator1).registerValidator(2500)) // 25%
                .to.be.revertedWithCustomError(staking, "Staking__InvalidCommissionRate");
        });

        it("Should emit ValidatorRegistered event", async function () {
            await expect(staking.connect(validator1).registerValidator(1000))
                .to.emit(staking, "ValidatorRegistered")
                .withArgs(validator1.address, 1000);
        });
    });

    describe("Delegation Process", function () {
        beforeEach(async function () {
            // Setup validators
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            await token.connect(validator2).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator2).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator2).registerValidator(1500); // 15% commission

            // Setup delegators
            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );

            await token.connect(delegator2).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator2).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );
        });

        it("Should delegate successfully", async function () {
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));

            expect(await staking.delegates(delegator1.address)).to.equal(validator1.address);
            expect(await staking.delegatorStakes(delegator1.address, validator1.address)).to.equal(ethers.utils.parseEther("500"));
        });

        it("Should revert if delegating to self", async function () {
            await expect(staking.connect(delegator1).delegate(delegator1.address, ethers.utils.parseEther("500")))
                .to.be.revertedWithCustomError(staking, "Staking__SelfDelegation");
        });

        it("Should revert if validator not active", async function () {
            await expect(staking.connect(delegator1).delegate(user1.address, ethers.utils.parseEther("500")))
                .to.be.revertedWithCustomError(staking, "Staking__InvalidValidator");
        });

        it("Should revert if insufficient stake", async function () {
            await expect(staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("1500")))
                .to.be.revertedWithCustomError(staking, "Staking__InsufficientStake");
        });

        it("Should revert if already delegated", async function () {
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));
            await expect(staking.connect(delegator1).delegate(validator2.address, ethers.utils.parseEther("300")))
                .to.be.revertedWithCustomError(staking, "Staking__AlreadyDelegated");
        });

        it("Should update validator delegation totals", async function () {
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));
            await staking.connect(delegator2).delegate(validator1.address, ethers.utils.parseEther("300"));

            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.totalDelegated).to.equal(ethers.utils.parseEther("800"));
            expect(validatorInfo.totalDelegators).to.equal(2);
        });

        it("Should emit Delegated event", async function () {
            await expect(staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500")))
                .to.emit(staking, "Delegated")
                .withArgs(delegator1.address, validator1.address, ethers.utils.parseEther("500"));
        });
    });

    describe("Undelegation Process", function () {
        beforeEach(async function () {
            // Setup validator and delegation
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));
        });

        it("Should undelegate successfully", async function () {
            await staking.connect(delegator1).undelegate();

            expect(await staking.delegates(delegator1.address)).to.equal(ethers.constants.AddressZero);
            expect(await staking.delegatorStakes(delegator1.address, validator1.address)).to.equal(0);
        });

        it("Should revert if not delegated", async function () {
            await staking.connect(delegator1).undelegate();
            await expect(staking.connect(delegator1).undelegate())
                .to.be.revertedWithCustomError(staking, "Staking__NoDelegation");
        });

        it("Should update validator delegation totals", async function () {
            const beforeInfo = await staking.getValidatorInfo(validator1.address);
            expect(beforeInfo.totalDelegated).to.equal(ethers.utils.parseEther("500"));

            await staking.connect(delegator1).undelegate();

            const afterInfo = await staking.getValidatorInfo(validator1.address);
            expect(afterInfo.totalDelegated).to.equal(0);
            expect(afterInfo.totalDelegators).to.equal(0);
        });

        it("Should emit Undelegated event", async function () {
            await expect(staking.connect(delegator1).undelegate())
                .to.emit(staking, "Undelegated")
                .withArgs(delegator1.address, validator1.address, ethers.utils.parseEther("500"));
        });
    });

    describe("Voting Power Management", function () {
        beforeEach(async function () {
            // Setup validator
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            // Setup delegators
            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));

            await token.connect(delegator2).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator2).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );
            await staking.connect(delegator2).delegate(validator1.address, ethers.utils.parseEther("300"));
        });

        it("Should calculate voting power correctly", async function () {
            const validatorVotingPower = await staking.getVotes(validator1.address);
            expect(validatorVotingPower).to.be.gt(0);
        });

        it("Should include delegated stake in voting power", async function () {
            const validatorVotingPower = await staking.getVotes(validator1.address);
            const ownStake = await staking.getEffectiveStake(validator1.address);
            const delegatedStake = ethers.utils.parseEther("800"); // 500 + 300

            expect(validatorVotingPower).to.equal(ownStake.add(delegatedStake));
        });

        it("Should update voting power after delegation changes", async function () {
            const beforeVotingPower = await staking.getVotes(validator1.address);
            
            await staking.connect(delegator1).undelegate();
            
            const afterVotingPower = await staking.getVotes(validator1.address);
            expect(afterVotingPower).to.be.lt(beforeVotingPower);
        });

        it("Should provide historical voting power", async function () {
            const currentVotingPower = await staking.getVotes(validator1.address);
            const pastVotingPower = await staking.getPastVotes(validator1.address, await ethers.provider.getBlockNumber());
            
            expect(pastVotingPower).to.equal(currentVotingPower);
        });
    });

    describe("Commission System", function () {
        beforeEach(async function () {
            // Setup validator
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000); // 10% commission
        });

        it("Should allow commission rate updates", async function () {
            await staking.connect(validator1).updateCommissionRate(1500); // 15%

            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.commissionRate).to.equal(1500);
        });

        it("Should revert if commission rate too high", async function () {
            await expect(staking.connect(validator1).updateCommissionRate(2500)) // 25%
                .to.be.revertedWithCustomError(staking, "Staking__InvalidCommissionRate");
        });

        it("Should revert if not a validator", async function () {
            await expect(staking.connect(user1).updateCommissionRate(1500))
                .to.be.revertedWithCustomError(staking, "Staking__NotValidator");
        });

        it("Should emit CommissionUpdated event", async function () {
            await expect(staking.connect(validator1).updateCommissionRate(1500))
                .to.emit(staking, "CommissionUpdated")
                .withArgs(validator1.address, 1000, 1500);
        });
    });

    describe("Validator Deregistration", function () {
        beforeEach(async function () {
            // Setup validator
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);
        });

        it("Should deregister validator successfully", async function () {
            await staking.connect(validator1).deregisterValidator();

            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.isActive).to.be.false;
        });

        it("Should revert if not a validator", async function () {
            await expect(staking.connect(user1).deregisterValidator())
                .to.be.revertedWithCustomError(staking, "Staking__NotValidator");
        });

        it("Should revert if has active delegations", async function () {
            // Add delegation
            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));

            await expect(staking.connect(validator1).deregisterValidator())
                .to.be.revertedWithCustomError(staking, "Staking__InsufficientDelegation");
        });

        it("Should emit ValidatorDeregistered event", async function () {
            await expect(staking.connect(validator1).deregisterValidator())
                .to.emit(staking, "ValidatorDeregistered")
                .withArgs(validator1.address);
        });
    });

    describe("Reward Distribution", function () {
        beforeEach(async function () {
            // Setup validator and delegation
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));
        });

        it("Should distribute rewards to validator", async function () {
            // Add rewards to the pool
            await token.mint(staking.address, ethers.utils.parseEther("100"));
            await staking.addRewards(ethers.utils.parseEther("100"));

            const beforeBalance = await token.balanceOf(validator1.address);
            await staking.connect(validator1).claimRewards();
            const afterBalance = await token.balanceOf(validator1.address);

            expect(afterBalance).to.be.gt(beforeBalance);
        });

        it("Should calculate effective stake correctly", async function () {
            const effectiveStake = await staking.getEffectiveStake(validator1.address);
            expect(effectiveStake).to.be.gt(ethers.utils.parseEther("1000")); // Includes lock boost
        });

        it("Should include delegated stake in reward calculation", async function () {
            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.totalDelegated).to.equal(ethers.utils.parseEther("500"));
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle zero delegation amounts", async function () {
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );

            await expect(staking.connect(delegator1).delegate(validator1.address, 0))
                .to.be.revertedWithCustomError(staking, "Staking__InsufficientStake");
        });

        it("Should handle maximum delegation amounts", async function () {
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );

            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("1000"));
            
            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.totalDelegated).to.equal(ethers.utils.parseEther("1000"));
        });

        it("Should handle multiple validators", async function () {
            // Setup two validators
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            await token.connect(validator2).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator2).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator2).registerValidator(1500);

            // Delegate to both validators
            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );

            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));
            await staking.connect(delegator1).undelegate();
            await staking.connect(delegator1).delegate(validator2.address, ethers.utils.parseEther("500"));

            expect(await staking.delegates(delegator1.address)).to.equal(validator2.address);
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete delegation lifecycle", async function () {
            // 1. Register validator
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            // 2. Delegate stake
            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );
            await staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500"));

            // 3. Verify delegation
            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.totalDelegated).to.equal(ethers.utils.parseEther("500"));
            expect(validatorInfo.totalDelegators).to.equal(1);

            // 4. Update commission
            await staking.connect(validator1).updateCommissionRate(1500);

            // 5. Undelegate
            await staking.connect(delegator1).undelegate();

            // 6. Deregister validator
            await staking.connect(validator1).deregisterValidator();

            // 7. Verify final state
            const finalValidatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(finalValidatorInfo.isActive).to.be.false;
            expect(finalValidatorInfo.totalDelegated).to.equal(0);
        });

        it("Should handle concurrent delegations", async function () {
            // Setup validator
            await token.connect(validator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(validator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                2 // THREE_MONTHS
            );
            await staking.connect(validator1).registerValidator(1000);

            // Setup multiple delegators
            await token.connect(delegator1).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator1).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );

            await token.connect(delegator2).approve(staking.address, ethers.utils.parseEther("2000"));
            await staking.connect(delegator2).stakeWithLockPeriod(
                ethers.utils.parseEther("1000"),
                1 // ONE_MONTH
            );

            // Concurrent delegations
            await Promise.all([
                staking.connect(delegator1).delegate(validator1.address, ethers.utils.parseEther("500")),
                staking.connect(delegator2).delegate(validator1.address, ethers.utils.parseEther("300"))
            ]);

            const validatorInfo = await staking.getValidatorInfo(validator1.address);
            expect(validatorInfo.totalDelegated).to.equal(ethers.utils.parseEther("800"));
            expect(validatorInfo.totalDelegators).to.equal(2);
        });
    });
}); 
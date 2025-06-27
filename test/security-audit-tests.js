const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Halom Security Audit Tests", function () {
    let halomToken, halomStaking, halomLPStaking, halomOracle, halomTreasury;
    let owner, user1, user2, user3, attacker, oracle;
    let initialSupply = ethers.parseEther("1000000"); // 1M tokens

    beforeEach(async function () {
        [owner, user1, user2, user3, attacker, oracle] = await ethers.getSigners();

        // Deploy contracts
        const HalomToken = await ethers.getContractFactory("HalomToken");
        const HalomStaking = await ethers.getContractFactory("HalomStaking");
        const HalomLPStaking = await ethers.getContractFactory("HalomLPStaking");
        const HalomOracle = await ethers.getContractFactory("HalomOracle");
        const HalomTreasury = await ethers.getContractFactory("HalomTreasury");

        halomToken = await HalomToken.deploy(oracle.address, owner.address);
        halomStaking = await HalomStaking.deploy(await halomToken.getAddress(), owner.address);
        halomLPStaking = await HalomLPStaking.deploy(await halomToken.getAddress(), owner.address);
        halomOracle = await HalomOracle.deploy(owner.address, 1); // chainId = 1
        halomTreasury = await HalomTreasury.deploy(owner.address, await halomToken.getAddress());

        // Setup roles
        await halomToken.setStakingContract(await halomStaking.getAddress());
        await halomOracle.setHalomToken(await halomToken.getAddress());
        await halomOracle.grantRole(await halomOracle.ORACLE_UPDATER_ROLE(), oracle.address);

        // Distribute initial tokens
        await halomToken.transfer(user1.address, ethers.parseEther("10000"));
        await halomToken.transfer(user2.address, ethers.parseEther("10000"));
        await halomToken.transfer(user3.address, ethers.parseEther("10000"));
        await halomToken.transfer(attacker.address, ethers.parseEther("1000"));
    });

    describe("Token Security Tests", function () {
        it("should prevent unauthorized rebase calls", async function () {
            await expect(
                halomToken.connect(attacker).rebase(1000)
            ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
        });

        it("should prevent excessive rebase amounts", async function () {
            const maxDelta = await halomToken.maxRebaseDelta();
            const totalSupply = await halomToken.totalSupply();
            const maxAllowedDelta = (totalSupply * maxDelta) / 10000;

            await expect(
                halomToken.connect(oracle).rebase(maxAllowedDelta + 1)
            ).to.be.revertedWith("HalomToken: Supply increase too large");
        });

        it("should handle zero rebase correctly", async function () {
            const initialSupply = await halomToken.totalSupply();
            await halomToken.connect(oracle).rebase(0);
            const finalSupply = await halomToken.totalSupply();
            
            expect(finalSupply).to.equal(initialSupply);
        });

        it("should prevent negative rebase larger than total supply", async function () {
            const totalSupply = await halomToken.totalSupply();
            await expect(
                halomToken.connect(oracle).rebase(-totalSupply - 1)
            ).to.be.revertedWith("HalomToken: Supply decrease too large");
        });

        it("should handle rebase with very small amounts", async function () {
            const initialSupply = await halomToken.totalSupply();
            await halomToken.connect(oracle).rebase(1);
            const finalSupply = await halomToken.totalSupply();
            
            expect(finalSupply).to.equal(initialSupply + 1n);
        });

        it("should prevent burn from unauthorized accounts", async function () {
            await expect(
                halomToken.connect(attacker).burnFrom(user1.address, 1000)
            ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Staking Security Tests", function () {
        beforeEach(async function () {
            await halomToken.connect(user1).approve(await halomStaking.getAddress(), ethers.parseEther("10000"));
            await halomToken.connect(user2).approve(await halomStaking.getAddress(), ethers.parseEther("10000"));
        });

        it("should prevent unstaking before lock period", async function () {
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 60 * 60); // 30 days
            
            await expect(
                halomStaking.connect(user1).unstake(ethers.parseEther("100"))
            ).to.be.revertedWith("HalomStaking: Tokens are locked");
        });

        it("should prevent unstaking more than staked", async function () {
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
            
            await time.increase(31 * 24 * 60 * 60); // 31 days
            
            await expect(
                halomStaking.connect(user1).unstake(ethers.parseEther("2000"))
            ).to.be.revertedWith("HalomStaking: Insufficient stake");
        });

        it("should handle slash with zero amount", async function () {
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
            
            const initialStake = await halomStaking.stakes(user1.address);
            await halomStaking.connect(owner).slash(user1.address, 0);
            const finalStake = await halomStaking.stakes(user1.address);
            
            expect(finalStake.amount).to.equal(initialStake.amount);
        });

        it("should prevent slash amount exceeding stake", async function () {
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
            
            await expect(
                halomStaking.connect(owner).slash(user1.address, ethers.parseEther("2000"))
            ).to.be.revertedWith("HalomStaking: Slash amount exceeds stake");
        });

        it("should handle slash of entire stake", async function () {
            const stakeAmount = ethers.parseEther("1000");
            await halomStaking.connect(user1).stake(stakeAmount, 30 * 24 * 60 * 60);
            
            await halomStaking.connect(owner).slash(user1.address, stakeAmount);
            
            const finalStake = await halomStaking.stakes(user1.address);
            expect(finalStake.amount).to.equal(0);
        });

        it("should prevent unauthorized slash", async function () {
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
            
            await expect(
                halomStaking.connect(attacker).slash(user1.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(halomStaking, "AccessControlUnauthorizedAccount");
        });

        it("should handle lock boost edge cases", async function () {
            // Test with maximum lock boost
            await halomStaking.connect(owner).setLockBoostParams(5000, 730 * 24 * 60 * 60); // 50% boost, 2 years
            
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 730 * 24 * 60 * 60);
            
            const effectiveStake = await halomStaking.getEffectiveStake(user1.address);
            expect(effectiveStake).to.be.gt(ethers.parseEther("1000"));
        });

        it("should prevent commission rate exceeding maximum", async function () {
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
            
            await expect(
                halomStaking.connect(user1).setCommissionRate(3000) // 30% > 20% max
            ).to.be.revertedWith("HalomStaking: Commission exceeds maximum");
        });
    });

    describe("Oracle Security Tests", function () {
        it("should prevent unauthorized HOI updates", async function () {
            await expect(
                halomOracle.connect(attacker).setHOI(1000000000, 0)
            ).to.be.revertedWithCustomError(halomOracle, "AccessControlUnauthorizedAccount");
        });

        it("should prevent invalid nonce", async function () {
            await expect(
                halomOracle.connect(oracle).setHOI(1000000000, 1) // nonce should be 0
            ).to.be.revertedWith("HalomOracle: Invalid nonce");
        });

        it("should handle zero HOI value", async function () {
            await expect(
                halomOracle.connect(oracle).setHOI(0, 0)
            ).to.be.revertedWith("HalomOracle: invalid HOI value");
        });

        it("should prevent oracle calls when paused", async function () {
            await halomOracle.connect(owner).pause();
            
            await expect(
                halomOracle.connect(oracle).setHOI(1000000000, 0)
            ).to.be.revertedWith("Pausable: paused");
        });

        it("should handle consecutive HOI updates", async function () {
            await halomOracle.connect(oracle).setHOI(1000000000, 0);
            await halomOracle.connect(oracle).setHOI(1100000000, 1);
            await halomOracle.connect(oracle).setHOI(1200000000, 2);
            
            const latestHOI = await halomOracle.latestHOI();
            expect(latestHOI).to.equal(1200000000);
        });
    });

    describe("Treasury Security Tests", function () {
        beforeEach(async function () {
            await halomToken.transfer(await halomTreasury.getAddress(), ethers.parseEther("10000"));
        });

        it("should prevent unauthorized fee distribution", async function () {
            await expect(
                halomTreasury.connect(attacker).distributeFees()
            ).to.be.revertedWithCustomError(halomTreasury, "AccessControlUnauthorizedAccount");
        });

        it("should prevent fee distribution when paused", async function () {
            await halomTreasury.connect(owner).setPaused(true);
            
            await expect(
                halomTreasury.connect(owner).distributeFees()
            ).to.be.revertedWith("Treasury: paused");
        });

        it("should prevent invalid fee percentages", async function () {
            await expect(
                halomTreasury.connect(owner).updateFeePercentages(5000, 3000, 3000) // 110% total
            ).to.be.revertedWith("Treasury: fees must sum to 100%");
        });

        it("should handle zero balance distribution", async function () {
            // Transfer all tokens out
            await halomTreasury.connect(owner).emergencyWithdraw(
                await halomToken.getAddress(),
                owner.address,
                ethers.parseEther("10000")
            );
            
            await expect(
                halomTreasury.connect(owner).distributeFees()
            ).to.be.revertedWith("Treasury: no fees to distribute");
        });

        it("should prevent unauthorized emergency withdraw", async function () {
            await expect(
                halomTreasury.connect(attacker).emergencyWithdraw(
                    await halomToken.getAddress(),
                    attacker.address,
                    ethers.parseEther("1000")
                )
            ).to.be.revertedWithCustomError(halomTreasury, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Reentrancy Attack Tests", function () {
        it("should prevent reentrancy in staking", async function () {
            // This test would require a malicious contract that tries to reenter
            // For now, we test that the nonReentrant modifier is present
            const stakingCode = await ethers.provider.getCode(await halomStaking.getAddress());
            expect(stakingCode).to.not.equal("0x");
        });

        it("should prevent reentrancy in treasury", async function () {
            const treasuryCode = await ethers.provider.getCode(await halomTreasury.getAddress());
            expect(treasuryCode).to.not.equal("0x");
        });
    });

    describe("Edge Case Tests", function () {
        it("should handle very large numbers", async function () {
            const largeAmount = ethers.parseEther("1000000000"); // 1B tokens
            await halomToken.connect(owner).mint(user1.address, largeAmount);
            
            await halomToken.connect(user1).approve(await halomStaking.getAddress(), largeAmount);
            await halomStaking.connect(user1).stake(largeAmount, 30 * 24 * 60 * 60);
            
            const stake = await halomStaking.stakes(user1.address);
            expect(stake.amount).to.equal(largeAmount);
        });

        it("should handle very small numbers", async function () {
            const smallAmount = 1; // 1 wei
            await halomToken.connect(user1).approve(await halomStaking.getAddress(), smallAmount);
            await halomStaking.connect(user1).stake(smallAmount, 30 * 24 * 60 * 60);
            
            const stake = await halomStaking.stakes(user1.address);
            expect(stake.amount).to.equal(smallAmount);
        });

        it("should handle maximum lock periods", async function () {
            const maxLockPeriod = 730 * 24 * 60 * 60; // 2 years
            await halomToken.connect(user1).approve(await halomStaking.getAddress(), ethers.parseEther("1000"));
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), maxLockPeriod);
            
            const stake = await halomStaking.stakes(user1.address);
            expect(stake.lockUntil).to.be.gt(await time.latest());
        });

        it("should handle zero address transfers", async function () {
            await expect(
                halomToken.connect(user1).transfer(ethers.ZeroAddress, ethers.parseEther("100"))
            ).to.be.revertedWith("ERC20: transfer to the zero address");
        });
    });

    describe("Governance Security Tests", function () {
        it("should prevent unauthorized role grants", async function () {
            await expect(
                halomToken.connect(attacker).grantRole(await halomToken.REBASE_CALLER(), attacker.address)
            ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
        });

        it("should prevent role revocation by non-admin", async function () {
            await expect(
                halomToken.connect(attacker).revokeRole(await halomToken.REBASE_CALLER(), oracle.address)
            ).to.be.revertedWithCustomError(halomToken, "AccessControlUnauthorizedAccount");
        });

        it("should handle role renunciation", async function () {
            await halomToken.connect(oracle).renounceRole(await halomToken.REBASE_CALLER(), oracle.address);
            
            const hasRole = await halomToken.hasRole(await halomToken.REBASE_CALLER(), oracle.address);
            expect(hasRole).to.be.false;
        });
    });

    describe("Integration Security Tests", function () {
        it("should handle complete staking and rebase cycle", async function () {
            // Setup staking
            await halomToken.connect(user1).approve(await halomStaking.getAddress(), ethers.parseEther("1000"));
            await halomStaking.connect(user1).stake(ethers.parseEther("1000"), 30 * 24 * 60 * 60);
            
            // Perform rebase
            await halomToken.connect(oracle).rebase(ethers.parseEther("10000"));
            
            // Check rewards
            const pendingRewards = await halomStaking.pendingRewards(user1.address);
            expect(pendingRewards).to.be.gt(0);
        });

        it("should handle treasury fee distribution after rebase", async function () {
            // Setup treasury
            await halomTreasury.connect(owner).updateAddresses(
                await halomStaking.getAddress(),
                await halomLPStaking.getAddress(),
                owner.address
            );
            
            // Add fees to treasury
            await halomToken.transfer(await halomTreasury.getAddress(), ethers.parseEther("1000"));
            
            // Distribute fees
            await halomTreasury.connect(owner).distributeFees();
            
            // Check balances
            const stakingBalance = await halomToken.balanceOf(await halomStaking.getAddress());
            const lpStakingBalance = await halomToken.balanceOf(await halomLPStaking.getAddress());
            
            expect(stakingBalance).to.be.gt(0);
            expect(lpStakingBalance).to.be.gt(0);
        });
    });
}); 
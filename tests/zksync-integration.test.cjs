const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomToken zkSync Integration", function () {
    let token, roles;
    let owner, user1, user2, paymaster, governor;
    let DEFAULT_ADMIN_ROLE, GOVERNOR_ROLE;

    beforeEach(async function () {
        [owner, user1, user2, paymaster, governor] = await ethers.getSigners();

        // Deploy Roles contract
        const Roles = await ethers.getContractFactory("Roles");
        roles = await Roles.deploy();
        await roles.initialize(owner.address);

        // Get role constants
        DEFAULT_ADMIN_ROLE = await roles.DEFAULT_ADMIN_ROLE();
        GOVERNOR_ROLE = await roles.GOVERNOR_ROLE();

        // Deploy Token contract
        const HalomToken = await ethers.getContractFactory("HalomToken");
        token = await HalomToken.deploy();
        await token.initialize("Halom Token", "HALOM", owner.address);

        // Grant roles
        await roles.grantRole(GOVERNOR_ROLE, governor.address);
        await token.grantRole(GOVERNOR_ROLE, governor.address);
        await token.grantRole(DEFAULT_ADMIN_ROLE, owner.address);

        // Mint tokens to users
        await token.mint(user1.address, ethers.parseEther("10000"));
        await token.mint(user2.address, ethers.parseEther("10000"));
    });

    describe("EIP-2612 Permit Functions", function () {
        let owner, spender, value, deadline, nonce;
        let signature;

        beforeEach(async function () {
            [owner, spender] = [user1, user2];
            value = ethers.parseEther("1000");
            deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            nonce = await token.nonces(owner.address);
        });

        it("Should create valid permit signature", async function () {
            const domain = {
                name: "Halom Token",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await token.getAddress()
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const message = {
                owner: owner.address,
                spender: spender.address,
                value: value,
                nonce: nonce,
                deadline: deadline
            };

            signature = await owner.signTypedData(domain, types, message);
        });

        it("Should execute permit with valid signature", async function () {
            await this.createValidPermitSignature();
            
            const { v, r, s } = ethers.Signature.from(signature);
            
            await token.permit(owner.address, spender.address, value, deadline, v, r, s);
            
            expect(await token.allowance(owner.address, spender.address)).to.equal(value);
        });

        it("Should reject permit with expired deadline", async function () {
            await this.createValidPermitSignature();
            
            const { v, r, s } = ethers.Signature.from(signature);
            const expiredDeadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
            
            await expect(
                token.permit(owner.address, spender.address, value, expiredDeadline, v, r, s)
            ).to.be.revertedWithCustomError(token, "PermitExpired");
        });

        it("Should reject permit with invalid signature", async function () {
            await this.createValidPermitSignature();
            
            const { v, r, s } = ethers.Signature.from(signature);
            
            await expect(
                token.permit(user2.address, spender.address, value, deadline, v, r, s)
            ).to.be.revertedWithCustomError(token, "InvalidSignature");
        });

        it("Should increment nonce after permit", async function () {
            await this.createValidPermitSignature();
            
            const { v, r, s } = ethers.Signature.from(signature);
            const initialNonce = await token.nonces(owner.address);
            
            await token.permit(owner.address, spender.address, value, deadline, v, r, s);
            
            expect(await token.nonces(owner.address)).to.equal(initialNonce + 1n);
        });

        it("Should reject permit with reused nonce", async function () {
            await this.createValidPermitSignature();
            
            const { v, r, s } = ethers.Signature.from(signature);
            
            // First permit should succeed
            await token.permit(owner.address, spender.address, value, deadline, v, r, s);
            
            // Second permit with same nonce should fail
            await expect(
                token.permit(owner.address, spender.address, value, deadline, v, r, s)
            ).to.be.revertedWithCustomError(token, "InvalidSignature");
        });
    });

    describe("zkSync Paymaster Functions", function () {
        const depositAmount = ethers.parseEther("1000");

        it("Should deposit tokens to paymaster", async function () {
            const initialBalance = await token.balanceOf(user1.address);
            const initialPaymasterBalance = await token.getPaymasterDeposit(user1.address, paymaster.address);
            
            await token.connect(user1).depositToPaymaster(paymaster.address, depositAmount);
            
            expect(await token.balanceOf(user1.address)).to.equal(initialBalance - depositAmount);
            expect(await token.getPaymasterDeposit(user1.address, paymaster.address)).to.equal(initialPaymasterBalance + depositAmount);
            expect(await token.getTotalPaymasterDeposits(paymaster.address)).to.equal(depositAmount);
        });

        it("Should withdraw tokens from paymaster", async function () {
            // First deposit
            await token.connect(user1).depositToPaymaster(paymaster.address, depositAmount);
            
            const withdrawAmount = ethers.parseEther("500");
            const initialBalance = await token.balanceOf(user1.address);
            const initialPaymasterBalance = await token.getPaymasterDeposit(user1.address, paymaster.address);
            
            await token.connect(user1).withdrawFromPaymaster(paymaster.address, withdrawAmount);
            
            expect(await token.balanceOf(user1.address)).to.equal(initialBalance + withdrawAmount);
            expect(await token.getPaymasterDeposit(user1.address, paymaster.address)).to.equal(initialPaymasterBalance - withdrawAmount);
            expect(await token.getTotalPaymasterDeposits(paymaster.address)).to.equal(depositAmount - withdrawAmount);
        });

        it("Should reject deposit with zero amount", async function () {
            await expect(
                token.connect(user1).depositToPaymaster(paymaster.address, 0)
            ).to.be.revertedWith("Invalid amount");
        });

        it("Should reject deposit with zero paymaster address", async function () {
            await expect(
                token.connect(user1).depositToPaymaster(ethers.ZeroAddress, depositAmount)
            ).to.be.revertedWithCustomError(token, "InvalidPaymaster");
        });

        it("Should reject deposit with insufficient balance", async function () {
            const largeAmount = ethers.parseEther("20000"); // More than user has
            await expect(
                token.connect(user1).depositToPaymaster(paymaster.address, largeAmount)
            ).to.be.revertedWithCustomError(token, "InsufficientBalance");
        });

        it("Should reject withdrawal with insufficient deposit", async function () {
            await token.connect(user1).depositToPaymaster(paymaster.address, depositAmount);
            
            const largeWithdrawAmount = ethers.parseEther("2000"); // More than deposited
            await expect(
                token.connect(user1).withdrawFromPaymaster(paymaster.address, largeWithdrawAmount)
            ).to.be.revertedWithCustomError(token, "InsufficientPaymasterDeposit");
        });

        it("Should reject withdrawal with zero amount", async function () {
            await token.connect(user1).depositToPaymaster(paymaster.address, depositAmount);
            
            await expect(
                token.connect(user1).withdrawFromPaymaster(paymaster.address, 0)
            ).to.be.revertedWith("Invalid amount");
        });

        it("Should track multiple paymaster deposits", async function () {
            const paymaster2 = user2.address;
            
            await token.connect(user1).depositToPaymaster(paymaster.address, depositAmount);
            await token.connect(user1).depositToPaymaster(paymaster2, depositAmount);
            
            expect(await token.getPaymasterDeposit(user1.address, paymaster.address)).to.equal(depositAmount);
            expect(await token.getPaymasterDeposit(user1.address, paymaster2)).to.equal(depositAmount);
            expect(await token.getTotalPaymasterDeposits(paymaster.address)).to.equal(depositAmount);
            expect(await token.getTotalPaymasterDeposits(paymaster2)).to.equal(depositAmount);
        });

        it("Should emit correct events", async function () {
            await expect(token.connect(user1).depositToPaymaster(paymaster.address, depositAmount))
                .to.emit(token, "PaymasterDeposited")
                .withArgs(user1.address, paymaster.address, depositAmount);

            await expect(token.connect(user1).withdrawFromPaymaster(paymaster.address, depositAmount))
                .to.emit(token, "PaymasterWithdrawn")
                .withArgs(user1.address, paymaster.address, depositAmount);
        });
    });

    describe("zkSync Full Exit Functions", function () {
        const accountId = 12345;
        const tokenAddress = await token.getAddress();

        it("Should request full exit", async function () {
            const initialBalance = await token.balanceOf(user1.address);
            const initialExitCount = await token.getExitRequestCount(accountId);
            
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            
            const exitInfo = await token.getFullExitReceipt(accountId, tokenAddress);
            expect(exitInfo.requested).to.be.true;
            expect(exitInfo.accountId).to.equal(accountId);
            expect(exitInfo.token).to.equal(tokenAddress);
            expect(exitInfo.amount).to.equal(initialBalance);
            expect(exitInfo.completed).to.be.false;
            
            expect(await token.balanceOf(user1.address)).to.equal(0);
            expect(await token.getExitRequestCount(accountId)).to.equal(initialExitCount + 1n);
        });

        it("Should reject full exit with zero account ID", async function () {
            await expect(
                token.connect(user1).requestFullExit(0, tokenAddress)
            ).to.be.revertedWithCustomError(token, "InvalidAccountId");
        });

        it("Should reject full exit with invalid token", async function () {
            const invalidToken = user2.address;
            await expect(
                token.connect(user1).requestFullExit(accountId, invalidToken)
            ).to.be.revertedWith("Invalid token");
        });

        it("Should reject full exit with zero balance", async function () {
            // First exit to zero balance
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            
            // Try to exit again
            await expect(
                token.connect(user1).requestFullExit(accountId, tokenAddress)
            ).to.be.revertedWithCustomError(token, "InsufficientBalance");
        });

        it("Should reject duplicate full exit request", async function () {
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            
            // Mint tokens back to user
            await token.mint(user1.address, ethers.parseEther("1000"));
            
            await expect(
                token.connect(user1).requestFullExit(accountId, tokenAddress)
            ).to.be.revertedWithCustomError(token, "ExitAlreadyRequested");
        });

        it("Should complete full exit", async function () {
            const exitAmount = ethers.parseEther("10000");
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            
            await token.connect(governor).completeFullExit(accountId, tokenAddress, user1.address, exitAmount);
            
            const exitInfo = await token.getFullExitReceipt(accountId, tokenAddress);
            expect(exitInfo.completed).to.be.true;
            expect(exitInfo.completionTime).to.be.gt(0);
            
            expect(await token.balanceOf(user1.address)).to.equal(exitAmount);
        });

        it("Should reject complete exit without governor role", async function () {
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            
            await expect(
                token.connect(user1).completeFullExit(accountId, tokenAddress, user1.address, ethers.parseEther("10000"))
            ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
        });

        it("Should reject complete exit for non-existent request", async function () {
            await expect(
                token.connect(governor).completeFullExit(accountId, tokenAddress, user1.address, ethers.parseEther("10000"))
            ).to.be.revertedWithCustomError(token, "ExitNotRequested");
        });

        it("Should reject complete exit for already completed request", async function () {
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            await token.connect(governor).completeFullExit(accountId, tokenAddress, user1.address, ethers.parseEther("10000"));
            
            await expect(
                token.connect(governor).completeFullExit(accountId, tokenAddress, user1.address, ethers.parseEther("10000"))
            ).to.be.revertedWith("Exit already completed");
        });

        it("Should emit correct events", async function () {
            const exitAmount = ethers.parseEther("10000");
            
            await expect(token.connect(user1).requestFullExit(accountId, tokenAddress))
                .to.emit(token, "FullExitRequested")
                .withArgs(accountId, tokenAddress, exitAmount);

            await expect(token.connect(governor).completeFullExit(accountId, tokenAddress, user1.address, exitAmount))
                .to.emit(token, "FullExitCompleted")
                .withArgs(accountId, tokenAddress, exitAmount);
        });

        it("Should track multiple exit requests", async function () {
            const accountId2 = 67890;
            
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            await token.connect(user2).requestFullExit(accountId2, tokenAddress);
            
            expect(await token.getExitRequestCount(accountId)).to.equal(1);
            expect(await token.getExitRequestCount(accountId2)).to.equal(1);
            
            const exitInfo1 = await token.getFullExitReceipt(accountId, tokenAddress);
            const exitInfo2 = await token.getFullExitReceipt(accountId2, tokenAddress);
            
            expect(exitInfo1.requested).to.be.true;
            expect(exitInfo2.requested).to.be.true;
            expect(exitInfo1.accountId).to.equal(accountId);
            expect(exitInfo2.accountId).to.equal(accountId2);
        });
    });

    describe("zkSync CREATE2 Helper", function () {
        it("Should compute CREATE2 address correctly", async function () {
            const sender = user1.address;
            const salt = ethers.keccak256(ethers.toUtf8Bytes("test salt"));
            const bytecodeHash = ethers.keccak256(ethers.toUtf8Bytes("test bytecode"));
            const constructorInputHash = ethers.keccak256(ethers.toUtf8Bytes("test constructor"));
            
            const computedAddress = await token.computeCreate2Address(
                sender,
                salt,
                bytecodeHash,
                constructorInputHash
            );
            
            // Verify the address is valid
            expect(computedAddress).to.not.equal(ethers.ZeroAddress);
            expect(computedAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
        });

        it("Should compute deterministic addresses", async function () {
            const sender = user1.address;
            const salt = ethers.keccak256(ethers.toUtf8Bytes("test salt"));
            const bytecodeHash = ethers.keccak256(ethers.toUtf8Bytes("test bytecode"));
            const constructorInputHash = ethers.keccak256(ethers.toUtf8Bytes("test constructor"));
            
            const address1 = await token.computeCreate2Address(
                sender,
                salt,
                bytecodeHash,
                constructorInputHash
            );
            
            const address2 = await token.computeCreate2Address(
                sender,
                salt,
                bytecodeHash,
                constructorInputHash
            );
            
            expect(address1).to.equal(address2);
        });

        it("Should compute different addresses for different inputs", async function () {
            const sender = user1.address;
            const salt = ethers.keccak256(ethers.toUtf8Bytes("test salt"));
            const bytecodeHash = ethers.keccak256(ethers.toUtf8Bytes("test bytecode"));
            const constructorInputHash1 = ethers.keccak256(ethers.toUtf8Bytes("test constructor 1"));
            const constructorInputHash2 = ethers.keccak256(ethers.toUtf8Bytes("test constructor 2"));
            
            const address1 = await token.computeCreate2Address(
                sender,
                salt,
                bytecodeHash,
                constructorInputHash1
            );
            
            const address2 = await token.computeCreate2Address(
                sender,
                salt,
                bytecodeHash,
                constructorInputHash2
            );
            
            expect(address1).to.not.equal(address2);
        });
    });

    describe("EIP-712 Domain Functions", function () {
        it("Should return correct domain separator", async function () {
            const domainSeparator = await token.DOMAIN_SEPARATOR();
            expect(domainSeparator).to.not.equal(ethers.ZeroHash);
        });

        it("Should return correct nonce for address", async function () {
            const nonce = await token.nonces(user1.address);
            expect(nonce).to.equal(0);
        });

        it("Should increment nonce after permit", async function () {
            // Create and execute permit
            const domain = {
                name: "Halom Token",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await token.getAddress()
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const message = {
                owner: user1.address,
                spender: user2.address,
                value: ethers.parseEther("1000"),
                nonce: 0,
                deadline: Math.floor(Date.now() / 1000) + 3600
            };

            const signature = await user1.signTypedData(domain, types, message);
            const { v, r, s } = ethers.Signature.from(signature);
            
            await token.permit(user1.address, user2.address, message.value, message.deadline, v, r, s);
            
            expect(await token.nonces(user1.address)).to.equal(1);
        });
    });

    describe("Integration Tests", function () {
        it("Should work with permit and paymaster together", async function () {
            // Create permit signature
            const domain = {
                name: "Halom Token",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await token.getAddress()
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const message = {
                owner: user1.address,
                spender: paymaster.address,
                value: ethers.parseEther("1000"),
                nonce: 0,
                deadline: Math.floor(Date.now() / 1000) + 3600
            };

            const signature = await user1.signTypedData(domain, types, message);
            const { v, r, s } = ethers.Signature.from(signature);
            
            // Execute permit
            await token.permit(user1.address, paymaster.address, message.value, message.deadline, v, r, s);
            
            // Transfer tokens to paymaster
            await token.connect(user1).transfer(paymaster.address, message.value);
            
            // Deposit to paymaster
            await token.connect(paymaster).depositToPaymaster(paymaster.address, message.value);
            
            expect(await token.getPaymasterDeposit(user1.address, paymaster.address)).to.equal(0);
            expect(await token.getTotalPaymasterDeposits(paymaster.address)).to.equal(message.value);
        });

        it("Should work with full exit and paymaster", async function () {
            const accountId = 12345;
            const tokenAddress = await token.getAddress();
            
            // Deposit to paymaster
            await token.connect(user1).depositToPaymaster(paymaster.address, ethers.parseEther("1000"));
            
            // Request full exit
            await token.connect(user1).requestFullExit(accountId, tokenAddress);
            
            // Complete exit
            await token.connect(governor).completeFullExit(accountId, tokenAddress, user1.address, ethers.parseEther("10000"));
            
            // Withdraw from paymaster
            await token.connect(user1).withdrawFromPaymaster(paymaster.address, ethers.parseEther("1000"));
            
            expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("10000"));
            expect(await token.getPaymasterDeposit(user1.address, paymaster.address)).to.equal(0);
        });
    });
}); 
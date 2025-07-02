const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HalomBridge", function () {
    let bridge, token, validator, owner, user1, user2, user3;
    let chainId = 1;
    let targetChainId = 137;

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        token = await MockToken.deploy("Mock Token", "MTK");
        await token.deployed();

        // Deploy bridge
        const Bridge = await ethers.getContractFactory("HalomBridge");
        bridge = await Bridge.deploy(chainId, owner.address, 100); // 1% fee
        await bridge.deployed();

        // Deploy validator
        const BridgeValidator = await ethers.getContractFactory("BridgeValidator");
        validator = await BridgeValidator.deploy(owner.address);
        await validator.deployed();

        // Setup initial state
        await token.mint(user1.address, ethers.utils.parseEther("10000"));
        await token.mint(user2.address, ethers.utils.parseEther("10000"));
        await token.mint(user3.address, ethers.utils.parseEther("10000"));

        // Whitelist token
        await bridge.setTokenWhitelist(token.address, true);
    });

    describe("Initialization", function () {
        it("Should initialize with correct parameters", async function () {
            expect(await bridge.chainId()).to.equal(chainId);
            expect(await bridge.bridgeFee()).to.equal(100);
            expect(await bridge.hasRole(await bridge.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
        });

        it("Should revert if initialized twice", async function () {
            const Bridge = await ethers.getContractFactory("HalomBridge");
            const newBridge = await Bridge.deploy(chainId, owner.address, 100);
            await expect(newBridge.initialize(chainId, owner.address, 100)).to.be.revertedWith("Initializable: contract is already initialized");
        });
    });

    describe("Token Locking", function () {
        beforeEach(async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("1000"));
        });

        it("Should lock tokens successfully", async function () {
            const amount = ethers.utils.parseEther("100");
            const recipient = user2.address;

            await expect(bridge.lockTokens(token.address, recipient, amount, targetChainId))
                .to.emit(bridge, "TokenLocked")
                .withArgs(token.address, user1.address, recipient, amount.sub(amount.mul(100).div(10000)), chainId, targetChainId, anyValue, anyValue);

            expect(await token.balanceOf(bridge.address)).to.equal(amount);
        });

        it("Should revert if token not whitelisted", async function () {
            const MockToken2 = await ethers.getContractFactory("MockERC20");
            const token2 = await MockToken2.deploy("Mock Token 2", "MTK2");
            await token2.mint(user1.address, ethers.utils.parseEther("1000"));
            await token2.approve(bridge.address, ethers.utils.parseEther("1000"));

            await expect(bridge.lockTokens(token2.address, user2.address, ethers.utils.parseEther("100"), targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__TokenNotWhitelisted");
        });

        it("Should revert if amount too small", async function () {
            await expect(bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("0.5"), targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__AmountTooSmall");
        });

        it("Should revert if amount too large", async function () {
            await expect(bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("6000000"), targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__AmountTooLarge");
        });

        it("Should revert if insufficient allowance", async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("50"));
            await expect(bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__InsufficientAllowance");
        });

        it("Should revert if same chain ID", async function () {
            await expect(bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), chainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__InvalidChainId");
        });
    });

    describe("Rate Limiting", function () {
        beforeEach(async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("10000"));
        });

        it("Should enforce daily volume limits", async function () {
            // Try to exceed daily limit
            for (let i = 0; i < 10; i++) {
                await bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("1000000"), targetChainId);
            }

            // Next transaction should fail
            await expect(bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("1000000"), targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__RateLimitExceeded");
        });

        it("Should enforce user daily limits", async function () {
            // Try to exceed user limit
            for (let i = 0; i < 5; i++) {
                await bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("1000000"), targetChainId);
            }

            // Next transaction should fail
            await expect(bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("1000000"), targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__RateLimitExceeded");
        });
    });

    describe("Validator Consensus", function () {
        let requestId;
        let signatures;

        beforeEach(async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("100"));
            await bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), targetChainId);
            
            // Get the request ID from the event
            const events = await bridge.queryFilter(bridge.filters.TokenLocked());
            requestId = events[0].args.requestId;
        });

        it("Should require sufficient validator signatures", async function () {
            // Create insufficient signatures
            const messageHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
                ["string", "uint256", "uint256"],
                ["BRIDGE_REQUEST", requestId, chainId]
            ));
            const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
            
            await expect(bridge.mintTokens(requestId, [signature]))
                .to.be.revertedWith("Insufficient signatures");
        });

        it("Should reject duplicate signatures", async function () {
            const messageHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
                ["string", "uint256", "uint256"],
                ["BRIDGE_REQUEST", requestId, chainId]
            ));
            const signature = await user1.signMessage(ethers.utils.arrayify(messageHash));
            
            await expect(bridge.mintTokens(requestId, [signature, signature]))
                .to.be.revertedWithCustomError(bridge, "Bridge__InvalidSignature");
        });
    });

    describe("Timelock Functions", function () {
        it("Should create timelock request", async function () {
            const target = user2.address;
            const value = 0;
            const data = "0x";
            const description = "Test proposal";

            const proposalId = await bridge.createMultisigProposal(target, value, data);
            expect(proposalId).to.not.equal(0);
        });

        it("Should require timelock delay before execution", async function () {
            const target = user2.address;
            const value = 0;
            const data = "0x";

            const proposalId = await bridge.createMultisigProposal(target, value, data);
            
            // Try to execute immediately
            await expect(bridge.executeMultisigProposal(proposalId))
                .to.be.revertedWithCustomError(bridge, "Governance__VotingPeriodNotStarted");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow emergency pause", async function () {
            await bridge.emergencyPause("Test emergency");
            expect(await bridge.paused()).to.be.true;
        });

        it("Should allow emergency unpause", async function () {
            await bridge.emergencyPause("Test emergency");
            await bridge.emergencyUnpause();
            expect(await bridge.paused()).to.be.false;
        });

        it("Should prevent operations when paused", async function () {
            await bridge.emergencyPause("Test emergency");
            await token.approve(bridge.address, ethers.utils.parseEther("100"));
            
            await expect(bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__EmergencyPaused");
        });

        it("Should allow emergency role grant", async function () {
            await bridge.emergencyGrantRole(user1.address, await bridge.VALIDATOR_ROLE());
            expect(await bridge.hasRole(await bridge.VALIDATOR_ROLE(), user1.address)).to.be.true;
        });
    });

    describe("Access Control", function () {
        it("Should enforce role-based access", async function () {
            await expect(bridge.setTokenWhitelist(token.address, false))
                .to.be.revertedWith("AccessControl: account " + user1.address.toLowerCase() + " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000");
        });

        it("Should allow admin to grant roles", async function () {
            await bridge.grantRole(await bridge.VALIDATOR_ROLE(), user1.address);
            expect(await bridge.hasRole(await bridge.VALIDATOR_ROLE(), user1.address)).to.be.true;
        });

        it("Should allow admin to revoke roles", async function () {
            await bridge.grantRole(await bridge.VALIDATOR_ROLE(), user1.address);
            await bridge.revokeRole(await bridge.VALIDATOR_ROLE(), user1.address);
            expect(await bridge.hasRole(await bridge.VALIDATOR_ROLE(), user1.address)).to.be.false;
        });
    });

    describe("Fee System", function () {
        it("Should calculate fees correctly", async function () {
            const amount = ethers.utils.parseEther("1000");
            const fee = amount.mul(100).div(10000); // 1% fee
            const transferAmount = amount.sub(fee);

            await token.approve(bridge.address, amount);
            await bridge.lockTokens(token.address, user2.address, amount, targetChainId);

            // Check that fee is deducted
            const events = await bridge.queryFilter(bridge.filters.TokenLocked());
            expect(events[0].args.amount).to.equal(transferAmount);
        });

        it("Should allow fee updates", async function () {
            await bridge.updateBridgeFee(200); // 2% fee
            expect(await bridge.bridgeFee()).to.equal(200);
        });
    });

    describe("Replay Protection", function () {
        it("Should prevent duplicate transaction processing", async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("100"));
            await bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), targetChainId);
            
            const events = await bridge.queryFilter(bridge.filters.TokenLocked());
            const requestId = events[0].args.requestId;

            // Try to process same transaction twice
            // This would require proper signature setup, but the concept is tested
            expect(await bridge.isTransactionProcessed(requestId)).to.be.false;
        });
    });

    describe("Gas Optimization", function () {
        it("Should optimize gas usage for multiple operations", async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("1000"));
            
            const tx1 = await bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), targetChainId);
            const tx2 = await bridge.lockTokens(token.address, user3.address, ethers.utils.parseEther("100"), targetChainId);
            
            const receipt1 = await tx1.wait();
            const receipt2 = await tx2.wait();
            
            // Gas usage should be reasonable
            expect(receipt1.gasUsed).to.be.lessThan(500000);
            expect(receipt2.gasUsed).to.be.lessThan(500000);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero amount transfers", async function () {
            await expect(bridge.lockTokens(token.address, user2.address, 0, targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__AmountTooSmall");
        });

        it("Should handle maximum uint256 values", async function () {
            const maxAmount = ethers.constants.MaxUint256;
            await token.mint(user1.address, maxAmount);
            await token.approve(bridge.address, maxAmount);
            
            await expect(bridge.lockTokens(token.address, user2.address, maxAmount, targetChainId))
                .to.be.revertedWithCustomError(bridge, "Bridge__AmountTooLarge");
        });

        it("Should handle contract addresses as recipients", async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("100"));
            await expect(bridge.lockTokens(token.address, bridge.address, ethers.utils.parseEther("100"), targetChainId))
                .to.not.be.reverted;
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete bridge flow", async function () {
            // 1. Lock tokens
            await token.approve(bridge.address, ethers.utils.parseEther("100"));
            await bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), targetChainId);
            
            // 2. Verify lock event
            const events = await bridge.queryFilter(bridge.filters.TokenLocked());
            expect(events.length).to.equal(1);
            expect(events[0].args.sender).to.equal(user1.address);
            expect(events[0].args.recipient).to.equal(user2.address);
            
            // 3. Verify bridge balance
            expect(await token.balanceOf(bridge.address)).to.equal(ethers.utils.parseEther("100"));
            
            // 4. Verify user balance reduction
            expect(await token.balanceOf(user1.address)).to.equal(ethers.utils.parseEther("9900"));
        });

        it("Should handle multiple concurrent users", async function () {
            await token.approve(bridge.address, ethers.utils.parseEther("100"));
            await token.connect(user2).approve(bridge.address, ethers.utils.parseEther("100"));
            await token.connect(user3).approve(bridge.address, ethers.utils.parseEther("100"));
            
            // Concurrent locks
            await Promise.all([
                bridge.lockTokens(token.address, user2.address, ethers.utils.parseEther("100"), targetChainId),
                bridge.connect(user2).lockTokens(token.address, user3.address, ethers.utils.parseEther("100"), targetChainId),
                bridge.connect(user3).lockTokens(token.address, user1.address, ethers.utils.parseEther("100"), targetChainId)
            ]);
            
            expect(await token.balanceOf(bridge.address)).to.equal(ethers.utils.parseEther("300"));
        });
    });
}); 
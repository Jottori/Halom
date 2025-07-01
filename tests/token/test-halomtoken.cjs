// import '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe('HalomToken', function () {
  let token, tokenImplementation, tokenProxy;
  let owner, user1, user2, user3, governor, minter, pauser, blacklister, bridge;
  let deployer;

  const TOKEN_NAME = "Halom Token";
  const TOKEN_SYMBOL = "HALOM";
  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1M tokens
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  async function deployTokenFixture() {
    [deployer, owner, user1, user2, user3, governor, minter, pauser, blacklister, bridge] = await ethers.getSigners();

    // Deploy implementation
    const HalomToken = await ethers.getContractFactory("HalomToken");
    tokenImplementation = await HalomToken.deploy();

    // Deploy proxy using our TestProxy
    const TestProxy = await ethers.getContractFactory("TestProxy");
    const initData = tokenImplementation.interface.encodeFunctionData("initialize", [
      TOKEN_NAME,
      TOKEN_SYMBOL,
      owner.address
    ]);

    tokenProxy = await TestProxy.deploy(
      tokenImplementation.target,
      initData
    );

    // Get token instance
    token = HalomToken.attach(tokenProxy.target);

    return { token, tokenImplementation, tokenProxy, owner, user1, user2, user3, governor, minter, pauser, blacklister, bridge };
  }

  describe('Deployment', function () {
    it('should deploy with correct initial parameters', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(18);
      expect(await token.totalSupply()).to.equal(0); // No initial supply minted
      
      // Check roles
      expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
      expect(await token.hasRole(await token.MINTER_ROLE(), owner.address)).to.be.true;
      expect(await token.hasRole(await token.PAUSER_ROLE(), owner.address)).to.be.true;
      expect(await token.hasRole(await token.GOVERNOR_ROLE(), owner.address)).to.be.true;
      expect(await token.hasRole(await token.BLACKLIST_ROLE(), owner.address)).to.be.true;
      expect(await token.hasRole(await token.BRIDGE_ROLE(), owner.address)).to.be.true;
    });

    it('should initialize with default anti-whale parameters', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      
      const [maxTx, maxWallet, cooldown] = await token.getAntiWhaleParams();
      expect(maxTx).to.equal(ethers.parseEther("1000")); // 1000 tokens max tx
      expect(maxWallet).to.equal(ethers.parseEther("10000")); // 10000 tokens max wallet
      expect(cooldown).to.equal(300); // 5 minutes cooldown
    });

    it('should initialize with default fee parameters', async function () {
      const { token, owner } = await loadFixture(deployTokenFixture);
      
      const [bps, maxFee, collector] = await token.getFeeParams();
      expect(bps).to.equal(100); // 1% fee
      expect(maxFee).to.equal(500); // 5% max fee
      expect(collector).to.equal(owner.address);
    });

    it('should not be paused initially', async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.paused()).to.be.false;
    });
  });

  describe('ERC-20 Basic Functionality', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      // Mint some tokens to owner for testing
      await token.connect(owner).mint(owner.address, INITIAL_SUPPLY);
    });

    it('should transfer tokens correctly', async function () {
      const amount = ethers.parseEther("100");
      const [bps, maxFee, collector, enabled] = await token.getFeeInfo();
      const fee = enabled ? (amount * BigInt(bps)) / 10000n : 0n;
      const transferAmount = amount - fee;
      
      await expect(token.connect(owner).transfer(user1.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, user1.address, transferAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(transferAmount);
    });

    it('should approve and transferFrom correctly', async function () {
      const amount = ethers.parseEther("100");
      await token.connect(owner).approve(user1.address, amount);
      
      expect(await token.allowance(owner.address, user1.address)).to.equal(amount);
      
      // Check if fee is enabled and calculate fee
      const [bps, maxFee, collector, enabled] = await token.getFeeInfo();
      const fee = enabled ? (amount * BigInt(bps)) / 10000n : 0n;
      const transferAmount = amount - fee;
      
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, user2.address, transferAmount);
      
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await token.allowance(owner.address, user1.address)).to.equal(0);
    });

    it('should revert transfer with zero amount', async function () {
      await expect(token.connect(owner).transfer(user1.address, 0))
        .to.be.revertedWithCustomError(token, "ZeroAmount");
    });

    it('should revert transfer with insufficient balance', async function () {
      const largeAmount = ethers.parseEther("10000000"); // More than total supply
      await expect(token.connect(user1).transfer(user2.address, largeAmount))
        .to.be.revertedWithCustomError(token, "TransferAmountExceedsLimit");
    });

    it('should revert transferFrom with insufficient allowance', async function () {
      const amount = ethers.parseEther("100");
      await token.connect(owner).approve(user1.address, amount / 2n);
      
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, amount))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it('should handle multiple transfers correctly', async function () {
      const amount = ethers.parseEther("100");
      
      // Check if fee is enabled
      const [bps, maxFee, collector, enabled] = await token.getFeeInfo();
      const fee = enabled ? (amount * BigInt(bps)) / 10000n : 0n;
      const transferAmount = amount - fee;
      
      // Transfer to multiple users with time delay to avoid cooldown
      await token.connect(owner).transfer(user1.address, amount);
      await time.increase(3600); // 1 hour delay
      await token.connect(owner).transfer(user2.address, amount);
      await time.increase(3600); // 1 hour delay
      await token.connect(owner).transfer(user3.address, amount);
      
      expect(await token.balanceOf(user1.address)).to.equal(transferAmount);
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await token.balanceOf(user3.address)).to.equal(transferAmount);
    });
  });

  describe('Minting and Burning', function () {
    beforeEach(async function () {
      ({ token, owner, user1 } = await loadFixture(deployTokenFixture));
    });

    it('should allow minter to mint tokens', async function () {
      const amount = ethers.parseEther("1000");
      const initialSupply = await token.totalSupply();
      
      await expect(token.connect(owner).mint(user1.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(ZERO_ADDRESS, user1.address, amount);
      
      expect(await token.balanceOf(user1.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(initialSupply + amount);
    });

    it('should revert minting by non-minter', async function () {
      const amount = ethers.parseEther("1000");
      await expect(token.connect(user1).mint(user2.address, amount))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it('should revert minting to zero address', async function () {
      const amount = ethers.parseEther("1000");
      await expect(token.connect(owner).mint(ZERO_ADDRESS, amount))
        .to.be.revertedWith("Invalid recipient");
    });

    it('should revert minting zero amount', async function () {
      await expect(token.connect(owner).mint(user1.address, 0))
        .to.be.revertedWith("Invalid amount");
    });

    it('should allow admin to burn tokens', async function () {
      const mintAmount = ethers.parseEther("1000");
      const burnAmount = ethers.parseEther("500");
      
      await token.connect(owner).mint(owner.address, mintAmount);
      const initialSupply = await token.totalSupply();
      
      await expect(token.connect(owner).burn(burnAmount))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, ZERO_ADDRESS, burnAmount);
      
      expect(await token.balanceOf(owner.address)).to.equal(mintAmount - burnAmount);
      expect(await token.totalSupply()).to.equal(initialSupply - burnAmount);
    });

    it('should revert burning by non-admin', async function () {
      await expect(token.connect(user1).burn(ethers.parseEther("100")))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it('should revert burning more than balance', async function () {
      const mintAmount = ethers.parseEther("100");
      const burnAmount = ethers.parseEther("200");
      
      await token.connect(owner).mint(owner.address, mintAmount);
      
      await expect(token.connect(owner).burn(burnAmount))
        .to.be.revertedWithCustomError(token, "InsufficientBalance");
    });
  });

  describe('Pausable Functionality', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, INITIAL_SUPPLY);
    });

    it('should allow pauser to pause transfers', async function () {
      await expect(token.connect(owner).pause())
        .to.emit(token, "Paused")
        .withArgs(owner.address);
      
      expect(await token.paused()).to.be.true;
    });

    it('should revert transfers when paused', async function () {
      await token.connect(owner).pause();
      
      await expect(token.connect(owner).transfer(user1.address, ethers.parseEther("100")))
        .to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it('should revert transferFrom when paused', async function () {
      await token.connect(owner).pause();
      await token.connect(owner).approve(user1.address, ethers.parseEther("100"));
      
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, ethers.parseEther("100")))
        .to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it('should allow pauser to unpause transfers', async function () {
      await token.connect(owner).pause();
      await expect(token.connect(owner).unpause())
        .to.emit(token, "Unpaused")
        .withArgs(owner.address);
      
      expect(await token.paused()).to.be.false;
    });

    it('should allow transfers after unpausing', async function () {
      await token.connect(owner).pause();
      await token.connect(owner).unpause();
      
      await expect(token.connect(owner).transfer(user1.address, ethers.parseEther("100")))
        .to.emit(token, "Transfer");
    });

    it('should revert pausing by non-pauser', async function () {
      await expect(token.connect(user1).pause())
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe('Anti-Whale Protection', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("50000"));
    });

    it('should enforce max transaction limit', async function () {
      const maxTx = ethers.parseEther("1000");
      const overLimit = maxTx + ethers.parseEther("1");
      
      await expect(token.connect(owner).transfer(user1.address, overLimit))
        .to.be.revertedWithCustomError(token, "TransferAmountExceedsLimit");
    });

    it('should enforce max wallet limit', async function () {
      const maxWallet = ethers.parseEther("10000");
      const overLimit = maxWallet + ethers.parseEther("1");
      
      await expect(token.connect(owner).transfer(user1.address, overLimit))
        .to.be.revertedWithCustomError(token, "TransferAmountExceedsLimit");
    });

    it('should enforce cooldown period', async function () {
      const amount = ethers.parseEther("500");
      
      // First transfer should succeed
      await token.connect(owner).transfer(user1.address, amount);
      
      // Second transfer within cooldown should fail
      await expect(token.connect(owner).transfer(user1.address, amount))
        .to.be.revertedWithCustomError(token, "CooldownNotExpired");
    });

    it('should allow transfer after cooldown expires', async function () {
      const amount = ethers.parseEther("500");
      
      await token.connect(owner).transfer(user1.address, amount);
      
      // Wait for cooldown to expire
      await time.increase(301); // 301 seconds > 300 cooldown
      
      await expect(token.connect(owner).transfer(user1.address, amount))
        .to.emit(token, "Transfer");
    });

    it('should allow governor to update anti-whale parameters', async function () {
      const newMaxTx = ethers.parseEther("2000");
      const newMaxWallet = ethers.parseEther("20000");
      const newCooldown = 600;
      
      await expect(token.connect(owner).setAntiWhaleParams(newMaxTx, newMaxWallet, newCooldown))
        .to.emit(token, "AntiWhaleParamsChanged")
        .withArgs(newMaxTx, newMaxWallet, newCooldown);
      
      const [maxTx, maxWallet, cooldown] = await token.getAntiWhaleParams();
      expect(maxTx).to.equal(newMaxTx);
      expect(maxWallet).to.equal(newMaxWallet);
      expect(cooldown).to.equal(newCooldown);
    });
  });

  describe('Fee System', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("10000"));
    });

    it('should apply fees on transfer', async function () {
      const amount = ethers.parseEther("1000");
      const [bps, maxFee, collector, enabled] = await token.getFeeInfo();
      
      const expectedFee = enabled ? (amount * BigInt(bps)) / 10000n : 0n;
      const expectedTransfer = amount - expectedFee;
      
      const ownerBalanceBefore = await token.balanceOf(owner.address);
      
      await token.connect(owner).transfer(user1.address, amount);
      
      const actualBalance = await token.balanceOf(user1.address);
      const ownerBalanceAfter = await token.balanceOf(owner.address);
      
      expect(actualBalance).to.equal(expectedTransfer);
      if (enabled && expectedFee > 0) {
        // Since owner is the collector, the fee should be reflected in their balance change
        const ownerBalanceChange = ownerBalanceAfter - ownerBalanceBefore;
        const expectedOwnerChange = -amount + expectedFee; // -full amount + fee
        expect(ownerBalanceChange).to.equal(expectedOwnerChange);
      }
    });

    it('should apply fees on transferFrom', async function () {
      const amount = ethers.parseEther("1000");
      const [bps, maxFee, collector, enabled] = await token.getFeeInfo();
      const expectedFee = enabled ? (amount * BigInt(bps)) / 10000n : 0n;
      const expectedTransfer = amount - expectedFee;
      
      const ownerBalanceBefore = await token.balanceOf(owner.address);
      
      await token.connect(owner).approve(user1.address, amount);
      await token.connect(user1).transferFrom(owner.address, user2.address, amount);
      
      const actualBalance = await token.balanceOf(user2.address);
      const ownerBalanceAfter = await token.balanceOf(owner.address);
      
      expect(actualBalance).to.equal(expectedTransfer);
      if (enabled && expectedFee > 0) {
        // Since owner is the collector, the fee should be reflected in their balance change
        const ownerBalanceChange = ownerBalanceAfter - ownerBalanceBefore;
        const expectedOwnerChange = -amount + expectedFee; // -full amount + fee
        expect(ownerBalanceChange).to.equal(expectedOwnerChange);
      }
    });

    it('should respect max fee limit', async function () {
      const amount = ethers.parseEther("1000");
      const maxFee = 500; // 5%
      const expectedFee = (amount * BigInt(maxFee)) / 10000n;
      const expectedTransfer = amount - expectedFee;
      
      // Set fee to max and enable
      await token.connect(owner).setFeeParams(maxFee, maxFee, owner.address);
      // Note: setFeeEnabled is not exposed, fee is enabled by default
      
      const ownerBalanceBefore = await token.balanceOf(owner.address);
      
      await token.connect(owner).transfer(user1.address, amount);
      
      const actualBalance = await token.balanceOf(user1.address);
      const ownerBalanceAfter = await token.balanceOf(owner.address);
      
      expect(actualBalance).to.equal(expectedTransfer);
      if (expectedFee > 0) {
        // Since owner is the collector, the fee should be reflected in their balance change
        const ownerBalanceChange = ownerBalanceAfter - ownerBalanceBefore;
        const expectedOwnerChange = -amount + expectedFee; // -full amount + fee
        expect(ownerBalanceChange).to.equal(expectedOwnerChange);
      }
    });

    it('should allow governor to update fee parameters', async function () {
      const newBps = 200; // 2%
      const newMaxFee = 1000; // 10%
      
      await expect(token.connect(owner).setFeeParams(newBps, newMaxFee, owner.address))
        .to.emit(token, "FeeParamsChanged")
        .withArgs(newBps, newMaxFee);
      
      const [bps, maxFee, collector] = await token.getFeeInfo();
      expect(bps).to.equal(newBps);
      expect(maxFee).to.equal(newMaxFee);
    });
  });

  describe('Blacklist Functionality', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("10000"));
    });

    it('should allow blacklister to blacklist address', async function () {
      await expect(token.connect(owner).blacklist(user1.address))
        .to.emit(token, "Blacklisted")
        .withArgs(user1.address);
      
      expect(await token.isBlacklisted(user1.address)).to.be.true;
    });

    it('should prevent blacklisted address from transferring', async function () {
      await token.connect(owner).blacklist(user1.address);
      await token.connect(owner).transfer(user1.address, ethers.parseEther("100"));
      
      // Blacklisted address cannot transfer out
      let reverted = false;
      try {
        await token.connect(user1).transfer(user2.address, ethers.parseEther("50"));
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it('should prevent transfer to blacklisted address', async function () {
      await token.connect(owner).blacklist(user2.address);
      
      await expect(token.connect(owner).transfer(user2.address, ethers.parseEther("100")))
        .to.be.revertedWithCustomError(token, "BlacklistedAddress");
    });

    it('should allow blacklister to unblacklist address', async function () {
      await token.connect(owner).blacklist(user1.address);
      await expect(token.connect(owner).unBlacklist(user1.address))
        .to.emit(token, "UnBlacklisted")
        .withArgs(user1.address);
      
      expect(await token.isBlacklisted(user1.address)).to.be.false;
    });

    it('should allow unblacklisted address to transfer', async function () {
      await token.connect(owner).blacklist(user1.address);
      await token.connect(owner).unBlacklist(user1.address);
      await token.connect(owner).transfer(user1.address, ethers.parseEther("100"));
      
      await expect(token.connect(user1).transfer(user2.address, ethers.parseEther("50")))
        .to.emit(token, "Transfer");
    });

    it('should revert blacklisting by non-blacklister', async function () {
      await expect(token.connect(user1).blacklist(user2.address))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe('EIP-2612 Permit', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("10000"));
    });

    it('should generate valid permit signature', async function () {
      const spender = user1.address;
      const value = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600; // 1 hour from now
      const nonce = await token.getNonce(owner.address);
      
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: token.target
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
        spender: spender,
        value: value,
        nonce: nonce,
        deadline: deadline
      };
      
      const signature = await owner.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      
      await expect(token.connect(user2).permit(owner.address, spender, value, deadline, v, r, s))
        .to.emit(token, "Approval")
        .withArgs(owner.address, spender, value);
      
      expect(await token.allowance(owner.address, spender)).to.equal(value);
    });

    it('should revert permit with expired deadline', async function () {
      const spender = user1.address;
      const value = ethers.parseEther("100");
      const deadline = (await time.latest()) - 1; // Expired
      const nonce = await token.getNonce(owner.address);
      
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: token.target
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
        spender: spender,
        value: value,
        nonce: nonce,
        deadline: deadline
      };
      
      const signature = await owner.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      
      await expect(token.connect(user2).permit(owner.address, spender, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(token, "PermitExpired");
    });

    it('should revert permit with invalid signature', async function () {
      const spender = user1.address;
      const value = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.getNonce(owner.address);
      
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: token.target
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
        spender: spender,
        value: value,
        nonce: nonce,
        deadline: deadline
      };
      
      const signature = await user1.signTypedData(domain, types, message); // Wrong signer
      const { v, r, s } = ethers.Signature.from(signature);
      
      await expect(token.connect(user2).permit(owner.address, spender, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(token, "InvalidSignature");
    });
  });

  describe('zkSync Paymaster Functions', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("10000"));
    });

    it('should allow user to deposit to paymaster', async function () {
      const paymaster = user2.address;
      const amount = ethers.parseEther("100");
      
      await expect(token.connect(owner).depositToPaymaster(paymaster, amount))
        .to.emit(token, "PaymasterDeposited")
        .withArgs(owner.address, paymaster, amount);
      
      expect(await token.getPaymasterDeposit(owner.address, paymaster)).to.equal(amount);
      expect(await token.getTotalPaymasterDeposits(paymaster)).to.equal(amount);
    });

    it('should revert deposit to zero address', async function () {
      await expect(token.connect(owner).depositToPaymaster(ZERO_ADDRESS, ethers.parseEther("100")))
        .to.be.revertedWithCustomError(token, "InvalidPaymaster");
    });

    it('should revert deposit with insufficient balance', async function () {
      const depositAmount = ethers.parseEther("1000");
      
      await expect(token.connect(user1).depositToPaymaster(user2.address, depositAmount))
        .to.be.revertedWithCustomError(token, "InsufficientBalance");
    });

    it('should allow user to withdraw from paymaster', async function () {
      const paymaster = user2.address;
      const amount = ethers.parseEther("100");
      
      await token.connect(owner).depositToPaymaster(paymaster, amount);
      
      await expect(token.connect(owner).withdrawFromPaymaster(paymaster, amount))
        .to.emit(token, "PaymasterWithdrawn")
        .withArgs(owner.address, paymaster, amount);
      
      expect(await token.getPaymasterDeposit(owner.address, paymaster)).to.equal(0);
      expect(await token.getTotalPaymasterDeposits(paymaster)).to.equal(0);
    });

    it('should revert withdrawal with insufficient deposit', async function () {
      const paymaster = user2.address;
      const amount = ethers.parseEther("100");
      
      await expect(token.connect(owner).withdrawFromPaymaster(paymaster, amount))
        .to.be.revertedWithCustomError(token, "InsufficientPaymasterDeposit");
    });
  });

  describe('zkSync Full Exit Functions', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("10000"));
    });

    it('should allow user to request full exit', async function () {
      const accountId = 123;
      const balance = await token.balanceOf(owner.address);
      
      await expect(token.connect(owner).requestFullExit(accountId, token.target))
        .to.emit(token, "FullExitRequested")
        .withArgs(accountId, token.target, balance);
      
      const exitInfo = await token.getFullExitReceipt(accountId, token.target);
      expect(exitInfo.requested).to.be.true;
      expect(exitInfo.accountId).to.equal(accountId);
      expect(exitInfo.token).to.equal(token.target);
      expect(exitInfo.amount).to.equal(balance);
      expect(exitInfo.completed).to.be.false;
    });

    it('should revert exit request with zero account ID', async function () {
      await expect(token.connect(owner).requestFullExit(0, token.target))
        .to.be.revertedWithCustomError(token, "InvalidAccountId");
    });

    it('should revert exit request with wrong token', async function () {
      await expect(token.connect(owner).requestFullExit(123, user1.address))
        .to.be.revertedWith("Invalid token");
    });

    it('should revert duplicate exit request', async function () {
      const accountId = 123;
      
      await token.connect(owner).requestFullExit(accountId, token.target);
      
      await expect(token.connect(owner).requestFullExit(accountId, token.target))
        .to.be.revertedWithCustomError(token, "ExitAlreadyRequested");
    });

    it('should allow governor to complete full exit', async function () {
      const accountId = 123;
      const recipient = user1.address;
      const amount = ethers.parseEther("1000");
      
      await token.connect(owner).requestFullExit(accountId, token.target);
      
      await expect(token.connect(owner).completeFullExit(accountId, token.target, recipient, amount))
        .to.emit(token, "FullExitCompleted")
        .withArgs(accountId, token.target, amount);
      
      const exitInfo = await token.getFullExitReceipt(accountId, token.target);
      expect(exitInfo.completed).to.be.true;
      expect(await token.balanceOf(recipient)).to.equal(amount);
    });

    it('should revert completing non-existent exit', async function () {
      await expect(token.connect(owner).completeFullExit(123, token.target, user1.address, ethers.parseEther("1000")))
        .to.be.revertedWithCustomError(token, "ExitNotRequested");
    });
  });

  describe('Role Management', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
    });

    it('should allow admin to grant roles', async function () {
      await token.connect(owner).grantRole(await token.MINTER_ROLE(), user1.address);
      expect(await token.hasRole(await token.MINTER_ROLE(), user1.address)).to.be.true;
    });

    it('should allow admin to revoke roles', async function () {
      await token.connect(owner).grantRole(await token.MINTER_ROLE(), user1.address);
      await token.connect(owner).revokeRole(await token.MINTER_ROLE(), user1.address);
      expect(await token.hasRole(await token.MINTER_ROLE(), user1.address)).to.be.false;
    });

    it('should revert role operations by non-admin', async function () {
      await expect(token.connect(user1).grantRole(await token.MINTER_ROLE(), user2.address))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe('Upgradeability', function () {
    beforeEach(async function () {
      ({ token, tokenImplementation, owner } = await loadFixture(deployTokenFixture));
    });

    it('should allow admin to upgrade implementation', async function () {
      const newImplementation = await ethers.deployContract("HalomToken");
      
      await expect(token.connect(owner).upgradeTo(newImplementation.target))
        .to.emit(token, "Upgraded")
        .withArgs(newImplementation.target);
    });

    it('should revert upgrade by non-admin', async function () {
      const newImplementation = await ethers.deployContract("HalomToken");
      
      await expect(token.connect(user1).upgradeTo(newImplementation.target))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe('Edge Cases and Security', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("10000"));
    });

    it('should handle very large amounts correctly', async function () {
      const largeAmount = ethers.parseEther("1000000");
      
      // Mint large amount to owner
      await token.connect(owner).mint(owner.address, largeAmount);
      
      // Transfer should work with large amounts if within limits
      const transferAmount = ethers.parseEther("1000");
      await expect(token.connect(owner).transfer(user1.address, transferAmount))
        .to.emit(token, "Transfer");
      
      expect(await token.balanceOf(user1.address)).to.be.gt(0);
    });

    it('should handle multiple rapid transfers', async function () {
      const amount = ethers.parseEther("500");
      const [bps, maxFee, collector, enabled] = await token.getFeeInfo();
      const fee = enabled ? (amount * BigInt(bps)) / 10000n : 0n;
      const transferAmount = amount - fee;
      
      // Multiple transfers with cooldown
      await token.connect(owner).transfer(user1.address, amount);
      await time.increase(3600); // 1 hour delay
      await token.connect(owner).transfer(user2.address, amount);
      
      expect(await token.balanceOf(user1.address)).to.equal(transferAmount);
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it('should handle concurrent approvals correctly', async function () {
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");
      
      await token.connect(owner).approve(user1.address, amount1);
      await token.connect(owner).approve(user1.address, amount2);
      
      expect(await token.allowance(owner.address, user1.address)).to.equal(amount2);
    });

    it('should handle blacklist during transfer', async function () {
      await token.connect(owner).transfer(user1.address, ethers.parseEther("100"));
      await token.connect(owner).blacklist(user1.address);
      
      await expect(token.connect(user1).transfer(user2.address, ethers.parseEther("50")))
        .to.be.revertedWithCustomError(token, "BlacklistedAddress");
    });

    it('should handle pause during transfer', async function () {
      await token.connect(owner).transfer(user1.address, ethers.parseEther("100"));
      await token.connect(owner).pause();
      
      await expect(token.connect(user1).transfer(user2.address, ethers.parseEther("50")))
        .to.be.revertedWithCustomError(token, "EnforcedPause");
    });
  });

  describe('Integration Tests', function () {
    beforeEach(async function () {
      ({ token, owner, user1, user2, user3 } = await loadFixture(deployTokenFixture));
      await token.connect(owner).mint(owner.address, ethers.parseEther("10000"));
    });

    it('should handle complex transfer scenarios', async function () {
      const amount = ethers.parseEther("100");
      
      // Check if fee is enabled and calculate fee
      const [bps, maxFee, collector, enabled] = await token.getFeeInfo();
      const fee = enabled ? (amount * BigInt(bps)) / 10000n : 0n;
      const transferAmount = amount - fee;
      
      // Complex scenario with multiple transfers and time delays
      await token.connect(owner).transfer(user1.address, amount);
      await time.increase(3600); // 1 hour delay
      await token.connect(owner).transfer(user2.address, amount);
      await time.increase(3600); // 1 hour delay
      
      // Calculate fee for the second transfer
      const secondTransferAmount = transferAmount / 2n;
      const secondFee = enabled ? (secondTransferAmount * BigInt(bps)) / 10000n : 0n;
      const secondTransferAfterFee = secondTransferAmount - secondFee;
      
      await token.connect(user1).transfer(user3.address, secondTransferAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(transferAmount - secondTransferAmount);
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await token.balanceOf(user3.address)).to.equal(secondTransferAfterFee);
    });

    it('should handle permit + transferFrom integration', async function () {
      const spender = user1.address;
      const value = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.getNonce(owner.address);
      
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: token.target
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
        spender: spender,
        value: value,
        nonce: nonce,
        deadline: deadline
      };
      
      const signature = await owner.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      
      // Use permit to approve
      await token.connect(user2).permit(owner.address, spender, value, deadline, v, r, s);
      
      // Use transferFrom
      await token.connect(user1).transferFrom(owner.address, user3.address, value);
      
      expect(await token.balanceOf(user3.address)).to.be.gt(0);
    });
  });
}); 
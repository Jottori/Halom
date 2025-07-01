// Bridge module tests
// ... add your Bridge tests here ...
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('Bridge', function () {
  let Bridge, bridge, MockERC20, token, owner, bridgeOperator, governor, user, other;
  const initialSupply = ethers.parseEther('1000000');
  const minLock = ethers.parseEther('10');
  const maxLock = ethers.parseEther('10000');
  const bridgeFee = ethers.parseEther('1');

  beforeEach(async function () {
    [owner, bridgeOperator, governor, user, other] = await ethers.getSigners();
    MockERC20 = await ethers.getContractFactory('MockERC20');
    token = await MockERC20.deploy('MockToken', 'MTK', initialSupply);
    await token.waitForDeployment();
    Bridge = await ethers.getContractFactory('Bridge');
    bridge = await upgrades.deployProxy(
      Bridge,
      [token.target, owner.address, minLock, maxLock, bridgeFee],
      { initializer: 'initialize' }
    );
    await bridge.waitForDeployment();
    // Grant roles
    await bridge.connect(owner).grantRole(await bridge.BRIDGE_ROLE(), bridgeOperator.address);
    await bridge.connect(owner).grantRole(await bridge.GOVERNOR_ROLE(), governor.address);
    // Mint tokens to user
    await token.mint(user.address, ethers.parseEther('1000'));
    await token.mint(bridge.target, ethers.parseEther('1000'));
  });

  it('should deploy with correct config', async function () {
    const config = await bridge.getBridgeConfig();
    expect(config[0]).to.equal(token.target);
    expect(config[1]).to.equal(minLock);
    expect(config[2]).to.equal(maxLock);
    expect(config[3]).to.equal(bridgeFee);
    expect(config[4]).to.equal(owner.address);
  });

  it('should allow locking tokens for supported chain', async function () {
    await bridge.connect(governor).setChainSupport(2, true);
    await token.connect(user).approve(bridge.target, minLock);
    await expect(
      bridge.connect(user).lockTokens(user.address, minLock, 2)
    ).to.emit(bridge, 'TokensLocked');
    expect(await token.balanceOf(bridge.target)).to.be.greaterThanOrEqual(minLock);
  });

  it('should revert lockTokens for unsupported chain', async function () {
    await token.connect(user).approve(bridge.target, minLock);
    await expect(
      bridge.connect(user).lockTokens(user.address, minLock, 999)
    ).to.be.revertedWithCustomError(bridge, 'UnsupportedChain');
  });

  it('should revert lockTokens for amount out of bounds', async function () {
    await bridge.connect(governor).setChainSupport(2, true);
    await token.connect(user).approve(bridge.target, minLock - 1n);
    await expect(
      bridge.connect(user).lockTokens(user.address, minLock - 1n, 2)
    ).to.be.revertedWithCustomError(bridge, 'InvalidAmount');
  });

  it('should allow burnForRedeem for supported chain', async function () {
    await bridge.connect(governor).setChainSupport(2, true);
    await token.connect(user).approve(bridge.target, minLock);
    expect(user.address).to.not.equal('0x0000000000000000000000000000000000000000');
    await expect(
      bridge.connect(user).burnForRedeem(minLock, 2)
    ).to.emit(bridge, 'TokensBurned');
    expect(await token.balanceOf(user.address)).to.be.lessThan(ethers.parseEther('1000'));
  });

  it('should revert burnForRedeem for unsupported chain', async function () {
    await token.connect(user).approve(bridge.target, minLock);
    await expect(
      bridge.connect(user).burnForRedeem(minLock, 999)
    ).to.be.revertedWithCustomError(bridge, 'UnsupportedChain');
  });

  it('should allow BRIDGE_ROLE to mintFromBridge', async function () {
    await expect(
      bridge.connect(bridgeOperator).mintFromBridge(user.address, minLock, 1)
    ).to.emit(bridge, 'TokensMinted');
    expect(await token.balanceOf(user.address)).to.be.greaterThan(0);
  });

  it('should revert mintFromBridge for non-bridge role', async function () {
    await expect(
      bridge.connect(user).mintFromBridge(user.address, minLock, 1)
    ).to.be.revertedWithCustomError(bridge, 'AccessControlUnauthorizedAccount');
  });

  it('should allow BRIDGE_ROLE to unlockTokens', async function () {
    await expect(
      bridge.connect(bridgeOperator).unlockTokens(user.address, minLock)
    ).to.emit(bridge, 'TokensUnlocked');
    expect(await token.balanceOf(user.address)).to.be.greaterThan(0);
  });

  it('should revert unlockTokens for non-bridge role', async function () {
    await expect(
      bridge.connect(user).unlockTokens(user.address, minLock)
    ).to.be.revertedWithCustomError(bridge, 'AccessControlUnauthorizedAccount');
  });

  it('should allow GOVERNOR_ROLE to set bridge fee', async function () {
    await expect(
      bridge.connect(governor).setBridgeFee(ethers.parseEther('2'))
    ).to.emit(bridge, 'BridgeFeeSet');
    expect((await bridge.getBridgeConfig())[3]).to.equal(ethers.parseEther('2'));
  });

  it('should revert setBridgeFee for non-governor', async function () {
    await expect(
      bridge.connect(user).setBridgeFee(ethers.parseEther('2'))
    ).to.be.revertedWithCustomError(bridge, 'AccessControlUnauthorizedAccount');
  });

  it('should allow pausing and unpausing by GOVERNOR_ROLE', async function () {
    await bridge.connect(governor).pause();
    await expect(
      bridge.connect(governor).unpause()
    ).to.not.be.reverted;
  });

  it('should revert actions when paused', async function () {
    await bridge.connect(governor).setChainSupport(2, true);
    await bridge.connect(governor).pause();
    await token.connect(user).approve(bridge.target, minLock);
    await expect(
      bridge.connect(user).lockTokens(user.address, minLock, 2)
    ).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
  });

  it('should upgrade the contract by admin', async function () {
    const BridgeV2 = await ethers.getContractFactory('Bridge');
    await expect(
      upgrades.upgradeProxy(bridge.target, BridgeV2.connect(owner))
    ).to.not.be.reverted;
  });

  it('should revert upgrade by non-admin', async function () {
    const BridgeV2 = await ethers.getContractFactory('Bridge');
    await expect(
      upgrades.upgradeProxy(bridge.target, BridgeV2.connect(user))
    ).to.be.reverted;
  });

  it('should return correct transaction details', async function () {
    await bridge.connect(governor).setChainSupport(2, true);
    await token.connect(user).approve(bridge.target, minLock);
    const tx = await bridge.connect(user).lockTokens(user.address, minLock, 2);
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => l.fragment && l.fragment.name === 'TokensLocked');
    const transactionId = event.args.transactionId;
    const details = await bridge.getTransaction(transactionId);
    expect(details.amount).to.equal(minLock);
    expect(details.from).to.equal(user.address);
  });

  it('should return correct bridge config', async function () {
    const config = await bridge.getBridgeConfig();
    expect(config[0]).to.equal(token.target);
    expect(config[1]).to.equal(minLock);
    expect(config[2]).to.equal(maxLock);
    expect(config[3]).to.equal(bridgeFee);
    expect(config[4]).to.equal(owner.address);
  });

  it('should return correct chain nonce', async function () {
    await bridge.connect(governor).setChainSupport(2, true);
    await token.connect(user).approve(bridge.target, minLock);
    await bridge.connect(user).lockTokens(user.address, minLock, 2);
    const nonce = await bridge.getChainNonce(2);
    expect(nonce).to.equal(1);
  });

  it('should return correct chain support status', async function () {
    await bridge.connect(governor).setChainSupport(2, true);
    expect(await bridge.isChainSupported(2)).to.equal(true);
    await bridge.connect(governor).setChainSupport(2, false);
    expect(await bridge.isChainSupported(2)).to.equal(false);
  });
}); 
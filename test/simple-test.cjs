const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Simple Test", function () {
  it("Should deploy a simple contract", async function () {
    const [owner] = await ethers.getSigners();
    
    // Try to deploy HalomToken (which has a simple constructor)
    const HalomToken = await ethers.getContractFactory("HalomToken");
    console.log("HalomToken factory created");
    
    const token = await HalomToken.deploy(owner.address, owner.address);
    console.log("HalomToken deployed at:", await token.getAddress());
    
    expect(await token.getAddress()).to.not.equal(ethers.ZeroAddress);
  });

  it("Should deploy HalomTimelock with correct parameters", async function () {
    const [owner] = await ethers.getSigners();
    
    const HalomTimelock = await ethers.getContractFactory("HalomTimelock");
    console.log("HalomTimelock factory created");
    
    // Check constructor inputs
    const constructorFragment = HalomTimelock.interface.fragments.find(f => f.type === 'constructor');
    console.log("HalomTimelock constructor inputs:", constructorFragment?.inputs);
    
    const timelock = await HalomTimelock.deploy(3600, [owner.address], [owner.address], owner.address);
    console.log("HalomTimelock deployed at:", await timelock.getAddress());
    
    expect(await timelock.getAddress()).to.not.equal(ethers.ZeroAddress);
  });

  it("Should deploy HalomRoleManager with correct parameters", async function () {
    const [owner] = await ethers.getSigners();
    
    const HalomRoleManager = await ethers.getContractFactory("HalomRoleManager");
    console.log("HalomRoleManager factory created");
    
    // Check constructor inputs
    const constructorFragment = HalomRoleManager.interface.fragments.find(f => f.type === 'constructor');
    console.log("HalomRoleManager constructor inputs:", constructorFragment?.inputs);
    
    const roleManager = await HalomRoleManager.deploy();
    console.log("HalomRoleManager deployed at:", await roleManager.getAddress());
    
    expect(await roleManager.getAddress()).to.not.equal(ethers.ZeroAddress);
  });
}); 
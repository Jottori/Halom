# Contract Upgrades - Halom Protocol

## Overview

This document explains how to use the [OpenZeppelin Hardhat Upgrades plugin](https://www.npmjs.com/package/@openzeppelin/hardhat-upgrades) to deploy and upgrade upgradeable contracts in the Halom Protocol.

## Installation

The plugin is already installed and configured in the project:

```bash
npm install --save-dev @openzeppelin/hardhat-upgrades@^3.9.0
```

## Configuration

The plugin is registered in `hardhat.config.js`:

```javascript
require('@openzeppelin/hardhat-upgrades');
```

## Upgradeable Contract Patterns

The Halom Protocol uses the **UUPS (Universal Upgradeable Proxy Standard)** pattern for upgradeable contracts. This pattern is more gas-efficient and secure than the transparent proxy pattern.

### Key Features of UUPS Proxies

1. **Gas Efficiency**: UUPS proxies are more gas-efficient than transparent proxies
2. **Security**: Upgrade logic is contained within the implementation contract
3. **Flexibility**: Can be upgraded by any authorized address
4. **Storage**: Storage layout must be compatible between versions

## Making Contracts Upgradeable

### 1. Import OpenZeppelin Upgradeable Contracts

```solidity
// Instead of regular OpenZeppelin contracts
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Use upgradeable versions
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
```

### 2. Initialize Instead of Constructor

```solidity
contract HalomToken is ERC20Upgradeable, AccessControlUpgradeable {
    // Remove constructor, use initializer
    function initialize(address _oracleAddress, address _governance) public initializer {
        __ERC20_init("Halom", "HOM");
        __AccessControl_init();
        
        // Your initialization logic here
    }
}
```

### 3. Add Upgrade Authorization

```solidity
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract HalomToken is ERC20Upgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
```

## Deployment

### Initial Deployment

Use `deployProxy` for the initial deployment:

```javascript
const { ethers, upgrades } = require("hardhat");

async function main() {
    const HalomToken = await ethers.getContractFactory("HalomToken");
    
    // Deploy proxy with initial parameters
    const token = await upgrades.deployProxy(HalomToken, [
        oracleAddress,
        governanceAddress
    ]);
    
    await token.deployed();
    console.log("HalomToken deployed to:", token.address);
}
```

### Upgrade Deployment

Use `upgradeProxy` to upgrade existing contracts:

```javascript
const { ethers, upgrades } = require("hardhat");

async function main() {
    const HalomTokenV2 = await ethers.getContractFactory("HalomTokenV2");
    
    // Upgrade existing proxy
    const upgradedToken = await upgrades.upgradeProxy(
        existingTokenAddress,
        HalomTokenV2
    );
    
    console.log("Token upgraded successfully");
}
```

## Available Scripts

### Upgrade Scripts

```bash
# Upgrade contracts on localhost
npm run upgrade:contracts

# Upgrade contracts on testnet
npm run upgrade:testnet

# Manual upgrade command
npx hardhat run scripts/upgrade_contracts.js --network <network>
```

### Deployment Scripts

```bash
# Deploy with proxies
npm run deploy:testnet

# Deploy governance (uses timelock for upgrades)
npm run deploy:governance
```

## Upgrade Safety

### Storage Layout Compatibility

The plugin automatically validates storage layout compatibility between contract versions. Key rules:

1. **Don't remove existing state variables**
2. **Don't change variable types**
3. **Don't change variable order**
4. **Only add new variables at the end**

### Example: Safe Upgrade

```solidity
// Version 1
contract HalomToken {
    uint256 public totalSupply;
    mapping(address => uint256) public balances;
}

// Version 2 - SAFE
contract HalomTokenV2 {
    uint256 public totalSupply;
    mapping(address => uint256) public balances;
    uint256 public newVariable; // Added at the end
}

// Version 2 - UNSAFE
contract HalomTokenV2 {
    uint256 public newVariable; // Added at the beginning - BREAKS STORAGE
    uint256 public totalSupply;
    mapping(address => uint256) public balances;
}
```

## Governance Integration

### Timelock for Upgrades

The Halom Protocol uses a timelock for governance-controlled upgrades:

```javascript
// Governance proposal to upgrade contracts
const targets = [proxyAddress];
const values = [0];
const calldatas = [
    // Upgrade call data
];

await governor.propose(targets, values, calldatas, description);
```

### Upgrade Authorization

Only authorized addresses can perform upgrades:

```solidity
function _authorizeUpgrade(address newImplementation) 
    internal 
    override 
    onlyRole(DEFAULT_ADMIN_ROLE) 
{
    // Additional checks can be added here
}
```

## Testing Upgrades

### Test Upgrade Process

```javascript
const { expect } = require("chai");

describe("HalomToken Upgrade", function() {
    it('should upgrade successfully', async () => {
        // Deploy initial version
        const HalomToken = await ethers.getContractFactory("HalomToken");
        const token = await upgrades.deployProxy(HalomToken, [oracle, governance]);
        
        // Upgrade to new version
        const HalomTokenV2 = await ethers.getContractFactory("HalomTokenV2");
        const upgradedToken = await upgrades.upgradeProxy(token.address, HalomTokenV2);
        
        // Verify upgrade worked
        expect(await upgradedToken.version()).to.equal("2.0.0");
    });
});
```

### Run Upgrade Tests

```bash
npm run test:governance
```

## Monitoring and Verification

### Check Implementation Address

```javascript
const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
console.log("Implementation:", implementationAddress);
```

### Check Admin Address

```javascript
const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);
console.log("Admin:", adminAddress);
```

### Verify on Block Explorer

After upgrading, verify the new implementation contract on the block explorer.

## Best Practices

### 1. Always Test Upgrades

```bash
# Test locally first
npm run upgrade:contracts

# Then test on testnet
npm run upgrade:testnet
```

### 2. Use Governance for Production

- All production upgrades should go through governance
- Use timelock for additional security
- Require community approval for major changes

### 3. Document Changes

- Document all upgrade changes
- Maintain upgrade history
- Test thoroughly before production

### 4. Emergency Upgrades

For emergency situations, the admin can upgrade directly:

```javascript
// Emergency upgrade (only for critical issues)
await upgrades.upgradeProxy(proxyAddress, NewImplementation);
```

## Troubleshooting

### Common Issues

1. **Storage Layout Incompatibility**
   - Error: "New storage layout is incompatible"
   - Solution: Check variable order and types

2. **Authorization Error**
   - Error: "AccessControl: account is missing role"
   - Solution: Ensure caller has DEFAULT_ADMIN_ROLE

3. **Initialization Error**
   - Error: "Contract is already initialized"
   - Solution: Use `reinitializer` for reinitialization

### Debug Commands

```bash
# Check contract validation
npx hardhat compile

# Validate upgrade safety
npx hardhat run scripts/validate_upgrade.js

# Check proxy info
npx hardhat run scripts/check_proxy.js
```

## Security Considerations

### 1. Access Control

- Only authorized addresses should be able to upgrade
- Use role-based access control
- Consider multi-signature requirements

### 2. Timelock

- Use timelock for governance upgrades
- Allow community time to review changes
- Provide emergency override mechanisms

### 3. Testing

- Test all upgrades thoroughly
- Use multiple test networks
- Simulate production conditions

### 4. Monitoring

- Monitor upgrade events
- Track implementation changes
- Alert on unauthorized upgrade attempts

## Resources

- [OpenZeppelin Upgrades Documentation](https://docs.openzeppelin.com/upgrades-plugins/)
- [Hardhat Upgrades Plugin](https://www.npmjs.com/package/@openzeppelin/hardhat-upgrades)
- [UUPS Proxy Pattern](https://docs.openzeppelin.com/contracts/4.x/api/proxy#UUPSUpgradeable)
- [Storage Layout](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#storage-gaps)

## Support

For questions about contract upgrades:

1. Check the [OpenZeppelin forum](https://forum.openzeppelin.com/)
2. Review the [GitHub repository](https://github.com/OpenZeppelin/openzeppelin-upgrades)
3. Consult the [documentation](https://docs.openzeppelin.com/upgrades-plugins/) 
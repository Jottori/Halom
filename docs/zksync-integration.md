# Halom Protocol - zkSync Integration

## 🎯 Overview

The Halom protocol has been enhanced with comprehensive zkSync Era compatibility, enabling seamless operation on zkSync's Layer 2 network. This document details all zkSync-specific features, their implementation, and usage guidelines.

## 🚀 zkSync Features Implemented

### 1. EIP-2612 Permit Support (Gasless Approvals)

**Purpose**: Enable gasless token approvals for improved user experience on zkSync.

**Functions**:
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `nonces(address owner)`
- `DOMAIN_SEPARATOR()`

**Implementation**:
```solidity
// EIP-2612 permit support
mapping(address => uint256) public nonces;
bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
```

**Usage Example**:
```javascript
// 1. Create permit signature off-chain
const domain = {
    name: "Halom Token",
    version: "1",
    chainId: 324, // zkSync Era mainnet
    verifyingContract: tokenAddress
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
    owner: userAddress,
    spender: spenderAddress,
    value: ethers.parseEther("1000"),
    nonce: await token.nonces(userAddress),
    deadline: Math.floor(Date.now() / 1000) + 3600
};

const signature = await user.signTypedData(domain, types, message);

// 2. Execute permit on-chain (anyone can call)
const { v, r, s } = ethers.Signature.from(signature);
await token.permit(userAddress, spenderAddress, message.value, message.deadline, v, r, s);
```

**Benefits**:
- **Gasless UX**: Users don't need ETH for approvals
- **Standard Compliance**: Full EIP-2612 implementation
- **Security**: Nonce-based replay protection
- **zkSync Native**: Optimized for zkSync's account abstraction

### 2. zkSync Paymaster Integration

**Purpose**: Allow users to pay gas fees with tokens instead of ETH.

**Functions**:
- `depositToPaymaster(address paymaster, uint256 amount)`
- `withdrawFromPaymaster(address paymaster, uint256 amount)`
- `getPaymasterDeposit(address user, address paymaster)`
- `getTotalPaymasterDeposits(address paymaster)`

**Implementation**:
```solidity
// zkSync paymaster support
mapping(address => mapping(address => uint256)) public paymasterDeposits; // user => paymaster => amount
mapping(address => uint256) public totalPaymasterDeposits; // paymaster => total amount
```

**Usage Example**:
```javascript
// 1. Deposit tokens to paymaster
await token.depositToPaymaster(paymasterAddress, ethers.parseEther("100"));

// 2. Check deposit balance
const deposit = await token.getPaymasterDeposit(userAddress, paymasterAddress);

// 3. Withdraw tokens from paymaster
await token.withdrawFromPaymaster(paymasterAddress, ethers.parseEther("50"));
```

**Benefits**:
- **Token Gas Fees**: Pay gas with any supported token
- **User Convenience**: No need to hold ETH for gas
- **Flexible Deposits**: Multiple paymaster support
- **Secure Withdrawals**: User-controlled deposit management

### 3. zkSync Full Exit Support

**Purpose**: Enable complete exit from zkSync L2 to Ethereum L1.

**Functions**:
- `requestFullExit(uint32 accountId, address token)`
- `getFullExitReceipt(uint32 accountId, address token)`
- `getExitRequestCount(uint32 accountId)`
- `completeFullExit(uint32 accountId, address token, address recipient, uint256 amount)`

**Implementation**:
```solidity
struct ExitInfo {
    bool requested;
    uint256 requestTime;
    uint32 accountId;
    address token;
    uint256 amount;
    bool completed;
    uint256 completionTime;
}

mapping(uint32 => mapping(address => ExitInfo)) public exitRequests;
mapping(uint32 => uint256) public exitRequestCount;
```

**Usage Example**:
```javascript
// 1. Request full exit
await token.requestFullExit(accountId, tokenAddress);

// 2. Check exit status
const exitInfo = await token.getFullExitReceipt(accountId, tokenAddress);
console.log("Exit requested:", exitInfo.requested);
console.log("Exit completed:", exitInfo.completed);

// 3. Complete exit (called by zkSync system)
await token.connect(governor).completeFullExit(accountId, tokenAddress, recipient, amount);
```

**Benefits**:
- **L2 to L1 Bridging**: Seamless exit to Ethereum
- **Exit Tracking**: Comprehensive exit request management
- **Automated Completion**: System-controlled exit finalization
- **Account Management**: Support for multiple account IDs

### 4. zkSync CREATE2 Helper

**Purpose**: Provide correct address computation for zkSync's CREATE2 implementation.

**Function**:
- `computeCreate2Address(address sender, bytes32 salt, bytes32 bytecodeHash, bytes32 constructorInputHash)`

**Implementation**:
```solidity
function computeCreate2Address(
    address sender,
    bytes32 salt,
    bytes32 bytecodeHash,
    bytes32 constructorInputHash
) public pure returns (address) {
    bytes32 hash = keccak256(
        abi.encodePacked(
            bytes1(0xff),
            sender,
            salt,
            bytecodeHash,
            constructorInputHash
        )
    );
    return address(uint160(uint256(hash)));
}
```

**Usage Example**:
```javascript
// Compute CREATE2 address for zkSync
const sender = deployerAddress;
const salt = ethers.keccak256(ethers.toUtf8Bytes("deployment salt"));
const bytecodeHash = ethers.keccak256(contractBytecode);
const constructorInputHash = ethers.keccak256(constructorArgs);

const predictedAddress = await token.computeCreate2Address(
    sender,
    salt,
    bytecodeHash,
    constructorInputHash
);
```

**Benefits**:
- **zkSync Compatibility**: Correct address computation
- **Factory Support**: Enable contract factory deployments
- **Predictable Addresses**: Deterministic contract addresses
- **Deployment Tools**: Support for deployment automation

## 🔧 Technical Implementation Details

### EIP-712 Domain Configuration

```solidity
function initialize(
    string memory name,
    string memory symbol,
    address admin
) public initializer {
    __EIP712_init(name, "1"); // Initialize EIP-712 with version "1"
    // ... other initialization
}
```

### Security Considerations

1. **Nonce Management**: Prevents replay attacks on permit signatures
2. **Deadline Validation**: Ensures permits expire appropriately
3. **Signature Verification**: ECDSA recovery for permit validation
4. **Access Control**: Role-based protection for critical functions
5. **Reentrancy Protection**: Secure paymaster and exit operations

### Error Handling

```solidity
error PermitExpired();
error InvalidSignature();
error InvalidPaymaster();
error InsufficientPaymasterDeposit();
error ExitAlreadyRequested();
error ExitNotRequested();
error InvalidAccountId();
```

## 📊 Function Distribution

### zkSync-Specific Functions: 11 Total

| Category | Functions | Role Required | Description |
|----------|-----------|---------------|-------------|
| **EIP-2612 Permit** | 3 | None | Gasless approvals |
| **Paymaster** | 4 | None | Token gas fee support |
| **Full Exit** | 3 | None (1 requires GOVERNOR_ROLE) | L2 to L1 bridging |
| **CREATE2 Helper** | 1 | None | Address computation |

### Integration with Existing Functions

All zkSync functions integrate seamlessly with existing role-based architecture:

- **Public Functions**: Most zkSync functions are public for user convenience
- **Role Protection**: Critical functions (like `completeFullExit`) require appropriate roles
- **Event Emission**: All zkSync operations emit appropriate events
- **State Management**: Proper state tracking for all zkSync features

## 🧪 Testing and Validation

### Test Coverage

The zkSync integration includes comprehensive tests covering:

1. **EIP-2612 Permit Tests**:
   - Valid signature execution
   - Expired deadline rejection
   - Invalid signature rejection
   - Nonce increment verification
   - Replay attack prevention

2. **Paymaster Tests**:
   - Deposit and withdrawal operations
   - Balance tracking verification
   - Multiple paymaster support
   - Error condition handling

3. **Full Exit Tests**:
   - Exit request creation
   - Exit completion process
   - State tracking verification
   - Role-based access control

4. **CREATE2 Helper Tests**:
   - Address computation accuracy
   - Deterministic results
   - Input validation

### Test File: `tests/zksync-integration.test.cjs`

```javascript
describe("HalomToken zkSync Integration", function () {
    // EIP-2612 Permit Tests
    describe("EIP-2612 Permit Functions", function () {
        // Test implementations
    });

    // Paymaster Tests
    describe("zkSync Paymaster Functions", function () {
        // Test implementations
    });

    // Full Exit Tests
    describe("zkSync Full Exit Functions", function () {
        // Test implementations
    });

    // Integration Tests
    describe("Integration Tests", function () {
        // Test implementations
    });
});
```

## 🚀 Deployment and Configuration

### zkSync-Specific Deployment

```javascript
// Deploy with zkSync compatibility
const token = await HalomToken.deploy();
await token.initialize("Halom Token", "HALOM", adminAddress);

// Configure for zkSync
await token.setFeeParams(100, 500); // 1% fee, 5% max
await token.setAntiWhaleParams(
    ethers.parseEther("1000"), // 1000 tokens max tx
    ethers.parseEther("10000"), // 10000 tokens max wallet
    300 // 5 minutes cooldown
);
```

### Network Configuration

**zkSync Era Mainnet**:
- Chain ID: 324
- RPC URL: `https://mainnet.era.zksync.io`
- Explorer: `https://explorer.zksync.io`

**zkSync Era Testnet**:
- Chain ID: 280
- RPC URL: `https://testnet.era.zksync.dev`
- Explorer: `https://goerli.explorer.zksync.io`

## 📈 Benefits and Use Cases

### 1. Enhanced User Experience
- **Gasless Operations**: Users can approve tokens without ETH
- **Token Gas Fees**: Pay gas fees with any supported token
- **Seamless Bridging**: Easy L2 to L1 transitions

### 2. zkSync Native Features
- **Account Abstraction**: Full support for zkSync's AA
- **Paymaster Integration**: Native token gas fee support
- **CREATE2 Compatibility**: Proper address computation

### 3. Developer Benefits
- **Standard Compliance**: EIP-2612 and EIP-712 standards
- **Comprehensive Testing**: Full test coverage
- **Clear Documentation**: Detailed implementation guides

### 4. Protocol Benefits
- **Multi-Chain Support**: Works on both Ethereum and zkSync
- **Scalability**: Leverages zkSync's L2 scaling
- **Cost Efficiency**: Reduced gas costs on L2

## 🔮 Future Enhancements

### Planned Features

1. **Advanced Paymaster Support**:
   - Multi-token paymaster support
   - Dynamic fee calculation
   - Batch paymaster operations

2. **Enhanced Exit Management**:
   - Partial exit support
   - Exit queue management
   - Automated exit processing

3. **zkSync Era 2.0 Features**:
   - Native account abstraction
   - Advanced rollup features
   - Cross-chain messaging

### Integration Roadmap

1. **Phase 1**: Basic zkSync compatibility ✅
2. **Phase 2**: Advanced paymaster features
3. **Phase 3**: Enhanced exit management
4. **Phase 4**: zkSync Era 2.0 integration

## 📋 Summary

The Halom protocol's zkSync integration provides:

- **Complete zkSync Compatibility**: Full support for zkSync Era features
- **Gasless User Experience**: EIP-2612 permit for gasless approvals
- **Token Gas Fee Support**: Paymaster integration for token-based gas fees
- **Seamless Bridging**: Full exit support for L2 to L1 transitions
- **Developer-Friendly**: Comprehensive testing and documentation

This integration positions the Halom protocol as a leading multi-chain DeFi solution with native zkSync support, enabling users to benefit from zkSync's scalability while maintaining full Ethereum compatibility. 
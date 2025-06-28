// 10. Setup token roles securely
console.log("\n10. Setting up token roles...");

// Set staking contract address in token (CRITICAL for rebase rewards)
await halomToken.setStakingContract(staking.address);
console.log("✅ Staking contract address set in token");

// Grant REBASE_CALLER role to oracle
const REBASE_CALLER = await halomToken.REBASE_CALLER();
await halomToken.grantRole(REBASE_CALLER, oracle.address);
console.log("✅ REBASE_CALLER role granted to oracle");

// Grant MINTER_ROLE to staking contract for rebase rewards (NOT DEFAULT_ADMIN_ROLE)
const MINTER_ROLE = await halomToken.MINTER_ROLE();
await halomToken.grantRole(MINTER_ROLE, staking.address);
console.log("✅ MINTER_ROLE granted to staking contract");

// Verify STAKING_CONTRACT_ROLE is automatically granted by setStakingContract
const STAKING_CONTRACT_ROLE = await halomToken.STAKING_CONTRACT_ROLE();
const hasStakingRole = await halomToken.hasRole(STAKING_CONTRACT_ROLE, staking.address);
if (!hasStakingRole) {
    throw new Error("STAKING_CONTRACT_ROLE not granted to staking contract");
}
console.log("✅ STAKING_CONTRACT_ROLE verified for staking contract");

console.log("✅ Token roles configured securely"); 
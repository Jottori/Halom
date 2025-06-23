# Workflow Examples

## 1. Rebase Workflow

1. **Oracle Updater** fetches macroeconomic data and calculates the new HOI value.
2. **Updater** submits the HOI to the `HalomOracle` contract via `setHOI`.
3. `HalomOracle` emits an event and calls `rebase` on the `HalomToken` contract.
4. `HalomToken` adjusts the total supply and updates all balances proportionally.

**Example:**
```js
// Off-chain updater (Python):
# python -m offchain.updater

// On-chain (Solidity):
// HalomOracle.setHOI(newHOI, nonce)
// HalomToken.rebase(delta)
```

## 2. Staking Workflow

1. User approves the staking contract to spend their HLM tokens.
2. User calls `stakeWithLockPeriod(amount, lockPeriod)` on `HalomStaking`.
3. User's tokens are locked, and they start earning rewards.
4. After the lock period, user calls `unstake(amount)` to withdraw tokens.
5. User can call `claimRewards()` at any time to collect earned rewards.

**Example:**
```js
await token.connect(user).approve(staking.target, amount);
await staking.connect(user).stakeWithLockPeriod(amount, 0); // 0 = 3 months
// ...
await staking.connect(user).unstake(amount);
await staking.connect(user).claimRewards();
```

## 3. Oracle Update Workflow

1. Off-chain updater fetches and calculates HOI.
2. Updater submits HOI to `HalomOracle` contract.
3. Only addresses with `ORACLE_UPDATER_ROLE` can call `setHOI`.
4. The contract checks the nonce and updates the HOI value.

**Example:**
```js
await oracle.connect(updater).setHOI(newHOI, nonce);
``` 
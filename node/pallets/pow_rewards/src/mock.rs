use crate as pallet_pow_rewards;
use frame_support::{
    parameter_types,
    traits::{ConstU16, ConstU64},
    PalletId,
};
use frame_system as system;
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage, Permill,
};
use pallet_halom_oracle;

type Block = frame_system::mocking::MockBlock<Test>;

// Configure a mock runtime to test the pallet.
frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        Balances: pallet_balances,
        HalomOracle: pallet_halom_oracle,
        PowRewards: pallet_pow_rewards,
    }
);

impl system::Config for Test {
    type BaseCallFilter = frame_support::traits::Everything;
    type BlockWeights = ();
    type BlockLength = ();
    type DbWeight = ();
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    type Nonce = u64;
    type Hash = H256;
    type Hashing = BlakeTwo256;
    type AccountId = u64;
    type Lookup = IdentityLookup<Self::AccountId>;
    type Block = Block;
    type RuntimeEvent = RuntimeEvent;
    type BlockHashCount = ConstU64<250>;
    type Version = ();
    type PalletInfo = PalletInfo;
    type AccountData = pallet_balances::AccountData<u64>;
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = ConstU16<42>;
    type OnSetCode = ();
    type MaxConsumers = frame_support::traits::ConstU32<16>;
}

impl pallet_balances::Config for Test {
    type MaxLocks = ();
    type MaxReserves = ();
    type ReserveIdentifier = [u8; 8];
    type Balance = u64;
    type RuntimeEvent = RuntimeEvent;
    type DustRemoval = ();
    type ExistentialDeposit = ConstU64<1>;
    type AccountStore = System;
    type WeightInfo = ();
    type FreezeIdentifier = ();
    type MaxFreezes = ();
    type RuntimeHoldReason = ();
    type MaxHolds = ();
}

impl pallet_halom_oracle::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type OracleUpdateInterval = ConstU64<10>;
}

parameter_types! {
    pub const BaseReward: u64 = 1_000;
    pub const MaxSupply: u64 = 21_000_000;
    pub const StandardLicensePrice: u64 = 1_000;
    pub const PremiumLicensePrice: u64 = 5_000;
    pub const EnterpriseLicensePrice: u64 = 20_000;
    pub const LicenseDuration: u64 = 100;
    pub const TreasuryPalletId: PalletId = PalletId(*b"py/trsry");
    pub const TreasuryFeePercent: Permill = Permill::from_percent(10);
}

impl pallet_pow_rewards::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type BaseReward = BaseReward;
    type MaxSupply = MaxSupply;
    type StandardLicensePrice = StandardLicensePrice;
    type PremiumLicensePrice = PremiumLicensePrice;
    type EnterpriseLicensePrice = EnterpriseLicensePrice;
    type LicenseDuration = LicenseDuration;
    type TreasuryPalletId = TreasuryPalletId;
    type TreasuryFeePercent = TreasuryFeePercent;
}

// Build genesis storage according to the mock runtime.
pub fn new_test_ext() -> sp_io::TestExternalities {
    let mut t = system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();

    pallet_balances::GenesisConfig::<Test> {
        balances: vec![
            (1, 10_000_000),  // Treasury
            (2, 10_000_000),  // Test account 1
            (3, 10_000_000),  // Test account 2
        ],
    }
    .assimilate_storage(&mut t)
    .unwrap();

    let mut ext = sp_io::TestExternalities::new(t);
    ext.execute_with(|| System::set_block_number(1));
    ext
} 
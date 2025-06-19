#![cfg_attr(not(feature = "std"), no_std)]
#![recursion_limit = "256"]

use codec::{Decode, Encode};
use frame_support::{
    construct_runtime, parameter_types,
    traits::{ConstU128, ConstU32, ConstU64, ConstU8, KeyOwnerProofSystem},
    weights::{
        constants::WEIGHT_REF_TIME_PER_SECOND, IdentityFee, Weight,
    },
    RuntimeDebug,
};
use frame_system::limits::{BlockLength, BlockWeights};
use sp_api::impl_runtime_apis;
use sp_core::{crypto::KeyTypeId, OpaqueMetadata};
use sp_runtime::{
    create_runtime_str, generic, impl_opaque_keys,
    traits::{AccountIdLookup, BlakeTwo256, Block as BlockT, NumberFor},
    transaction_validity::{TransactionSource, TransactionValidity},
    ApplyExtrinsicResult, Permill,
};
use sp_std::prelude::*;
use sp_version::RuntimeVersion;

pub use frame_system::Call as SystemCall;
pub use pallet_balances::Call as BalancesCall;
pub use pallet_timestamp::Call as TimestampCall;
pub use sp_runtime::{Perbill, Perquintill};

pub use pallet_halom_oracle;
pub use pallet_pow_rewards;

impl_opaque_keys! {
    pub struct SessionKeys {
        pub aura: Aura,
        pub grandpa: Grandpa,
    }
}

#[sp_version::runtime_version]
pub const VERSION: RuntimeVersion = RuntimeVersion {
    spec_name: create_runtime_str!("halom-node"),
    impl_name: create_runtime_str!("halom-node"),
    authoring_version: 1,
    spec_version: 100,
    impl_version: 1,
    apis: RUNTIME_API_VERSIONS,
    transaction_version: 1,
    state_version: 1,
};

pub const MILLISECS_PER_BLOCK: u64 = 6000;
pub const SLOT_DURATION: u64 = MILLISECS_PER_BLOCK;
pub const MINUTES: BlockNumber = 60_000 / (MILLISECS_PER_BLOCK as BlockNumber);
pub const HOURS: BlockNumber = MINUTES * 60;
pub const DAYS: BlockNumber = HOURS * 24;

pub type BlockNumber = u32;
pub type Header = generic::Header<BlockNumber, BlakeTwo256>;
pub type Block = generic::Block<Header, UncheckedExtrinsic>;
pub type UncheckedExtrinsic = generic::UncheckedExtrinsic<Address, RuntimeCall, Signature, SignedExtra>;

pub type SignedExtra = (
    frame_system::CheckNonZeroSender<Runtime>,
    frame_system::CheckSpecVersion<Runtime>,
    frame_system::CheckTxVersion<Runtime>,
    frame_system::CheckGenesis<Runtime>,
    frame_system::CheckEra<Runtime>,
    frame_system::CheckNonce<Runtime>,
    frame_system::CheckWeight<Runtime>,
    pallet_transaction_payment::ChargeTransactionPayment<Runtime>,
);

parameter_types! {
    pub const Version: RuntimeVersion = VERSION;
    pub RuntimeBlockLength: BlockLength =
        BlockLength::max_with_normal_ratio(5 * 1024 * 1024, NORMAL_DISPATCH_RATIO);
    pub RuntimeBlockWeights: BlockWeights =
        BlockWeights::builder()
            .base_block(BlockExecutionWeight::get())
            .for_class(DispatchClass::all(), |weights| {
                weights.base_extrinsic = ExtrinsicBaseWeight::get();
            })
            .for_class(DispatchClass::Normal, |weights| {
                weights.max_total = Some(NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT);
            })
            .for_class(DispatchClass::Operational, |weights| {
                weights.max_total = Some(MAXIMUM_BLOCK_WEIGHT);
                weights.reserved = Some(
                    MAXIMUM_BLOCK_WEIGHT - NORMAL_DISPATCH_RATIO * MAXIMUM_BLOCK_WEIGHT,
                );
            })
            .avg_block_initialization(AVERAGE_ON_INITIALIZE_RATIO)
            .build_or_panic();
}

parameter_types! {
    pub const BlockHashCount: BlockNumber = 2400;
    pub const SS58Prefix: u8 = 42;
}

impl frame_system::Config for Runtime {
    type BaseCallFilter = frame_support::traits::Everything;
    type BlockWeights = RuntimeBlockWeights;
    type BlockLength = RuntimeBlockLength;
    type DbWeight = ();
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    type Index = u32;
    type BlockNumber = BlockNumber;
    type Hash = Hash;
    type Hashing = BlakeTwo256;
    type AccountId = AccountId;
    type Lookup = AccountIdLookup<AccountId, ()>;
    type Header = Header;
    type RuntimeEvent = RuntimeEvent;
    type BlockHashCount = BlockHashCount;
    type Version = Version;
    type PalletInfo = PalletInfo;
    type AccountData = pallet_balances::AccountData<Balance>;
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = SS58Prefix;
    type OnSetCode = ();
    type MaxConsumers = frame_support::traits::ConstU32<16>;
}

parameter_types! {
    pub const OracleUpdateInterval: BlockNumber = DAYS;  // Update HOI daily
    pub const BaseReward: Balance = 1_000_000_000;  // 1 HOM
    pub const MaxSupply: Balance = 21_000_000_000_000_000;  // 21M HOM
    
    // License prices
    pub const StandardLicensePrice: Balance = 1_000_000_000_000;    // 1,000 HOM
    pub const PremiumLicensePrice: Balance = 5_000_000_000_000;     // 5,000 HOM
    pub const EnterpriseLicensePrice: Balance = 20_000_000_000_000; // 20,000 HOM
    
    // License duration (30 days)
    pub const LicenseDuration: BlockNumber = 2_628_000;  // ~1 év (6 másodperces blokkidővel)
    
    // Treasury
    pub const TreasuryPalletId: PalletId = PalletId(*b"py/trsry");
    pub const TreasuryFeePercent: Permill = Permill::from_percent(15);  // 15% treasury fee

    // Oracle parameters
    pub const MinUpdateInterval: BlockNumber = DAYS;  // Minimum 1 day
    pub const MaxUpdateInterval: BlockNumber = 7 * DAYS;  // Maximum 7 days
    pub const MinSourcesForConsensus: u32 = 2;  // At least 2 sources needed
    
    // Governance parameters
    pub const OracleCouncilMembers: u32 = 3;
    pub const OracleMotionDuration: BlockNumber = 3 * DAYS;
    pub const OracleMaxProposals: u32 = 100;
}

// Oracle Council implementation
pub struct OracleCouncil;
impl halom_oracle::IsCouncilMember<AccountId> for OracleCouncil {
    fn is_council_member(who: &AccountId) -> bool {
        // Initially use pallet_collective members
        pallet_collective::Pallet::<Runtime, pallet_collective::DefaultInstance>
            ::is_member(who)
    }
}

impl halom_oracle::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type OracleUpdateOrigin = EnsureRoot<AccountId>;
    type GovernanceOrigin = EnsureRoot<AccountId>;
    type CouncilMembers = OracleCouncil;
    type VotingPeriod = ConstU32<1000>; // ~2 óra
    type MinUpdateInterval = ConstU32<100>; // ~20 perc
    type MaxUpdateInterval = ConstU32<2400>; // ~8 óra
    type MinSourcesForConsensus = ConstU32<2>;
    type RequiredMajority = ConstU32<66>; // 66% többség szükséges
}

impl pallet_pow_rewards::Config for Runtime {
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
    type MinimumStake = MinimumStake;
    type StakingBonus = StakingBonus;
}

parameter_types! {
    pub const ExistentialDeposit: Balance = 1_000_000;  // 0.001 HOM
    pub const MaxLocks: u32 = 50;
    pub const MaxReserves: u32 = 50;
}

impl pallet_balances::Config for Runtime {
    type MaxLocks = MaxLocks;
    type MaxReserves = MaxReserves;
    type ReserveIdentifier = [u8; 8];
    type Balance = Balance;
    type RuntimeEvent = RuntimeEvent;
    type DustRemoval = ();
    type ExistentialDeposit = ExistentialDeposit;
    type AccountStore = System;
    type WeightInfo = pallet_balances::weights::SubstrateWeight<Runtime>;
    type FreezeIdentifier = ();
    type MaxFreezes = ();
    type RuntimeHoldReason = ();
    type MaxHolds = ();
}

construct_runtime!(
    pub enum Runtime where
        Block = Block,
        NodeBlock = opaque::Block,
        UncheckedExtrinsic = UncheckedExtrinsic
    {
        System: frame_system,
        Timestamp: pallet_timestamp,
        Aura: pallet_aura,
        Grandpa: pallet_grandpa,
        Balances: pallet_balances,
        TransactionPayment: pallet_transaction_payment,
        HalomOracle: pallet_halom_oracle::{Pallet, Call, Storage, Event<T>},
        PowRewards: pallet_pow_rewards,
        OracleCouncil: pallet_collective::<Instance1>::{Pallet, Call, Storage, Origin<T>, Event<T>, Config<T>},
    }
);

#[cfg(feature = "runtime-benchmarks")]
#[macro_use]
extern crate frame_benchmarking;

#[cfg(feature = "runtime-benchmarks")]
mod benches {
    define_benchmarks!(
        [frame_system, SystemBench::<Runtime>]
        [pallet_balances, Balances]
        [pallet_timestamp, Timestamp]
    );
}

impl_runtime_apis! {
    impl sp_api::Core<Block> for Runtime {
        fn version() -> RuntimeVersion {
            VERSION
        }

        fn execute_block(block: Block) {
            Executive::execute_block(block);
        }

        fn initialize_block(header: &<Block as BlockT>::Header) {
            Executive::initialize_block(header)
        }
    }

    impl sp_api::Metadata<Block> for Runtime {
        fn metadata() -> OpaqueMetadata {
            OpaqueMetadata::new(Runtime::metadata().into())
        }
    }

    impl sp_block_builder::BlockBuilder<Block> for Runtime {
        fn apply_extrinsic(extrinsic: <Block as BlockT>::Extrinsic) -> ApplyExtrinsicResult {
            Executive::apply_extrinsic(extrinsic)
        }

        fn finalize_block() -> <Block as BlockT>::Header {
            Executive::finalize_block()
        }

        fn inherent_extrinsics(data: sp_inherents::InherentData) -> Vec<<Block as BlockT>::Extrinsic> {
            data.create_extrinsics()
        }

        fn check_inherents(
            block: Block,
            data: sp_inherents::InherentData,
        ) -> sp_inherents::CheckInherentsResult {
            data.check_extrinsics(&block)
        }
    }

    impl sp_transaction_pool::runtime_api::TaggedTransactionQueue<Block> for Runtime {
        fn validate_transaction(
            source: TransactionSource,
            tx: <Block as BlockT>::Extrinsic,
            block_hash: <Block as BlockT>::Hash,
        ) -> TransactionValidity {
            Executive::validate_transaction(source, tx, block_hash)
        }
    }
}

impl pallet_collective::Config<OracleCouncilInstance> for Runtime {
    type RuntimeOrigin = RuntimeOrigin;
    type Proposal = RuntimeCall;
    type RuntimeEvent = RuntimeEvent;
    type MotionDuration = OracleMotionDuration;
    type MaxProposals = OracleMaxProposals;
    type MaxMembers = OracleCouncilMembers;
    type DefaultVote = pallet_collective::PrimeDefaultVote;
    type WeightInfo = pallet_collective::weights::SubstrateWeight<Runtime>;
} 
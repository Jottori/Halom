use crate as pallet_halom_oracle;
use frame_support::{
    parameter_types,
    traits::{ConstU32, ConstU64, EnsureOrigin},
};
use frame_system as system;
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage,
};

type Block = frame_system::mocking::MockBlock<Test>;

// Configure a mock runtime to test the pallet.
frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        HalomOracle: pallet_halom_oracle,
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
    type AccountData = ();
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = ();
    type OnSetCode = ();
    type MaxConsumers = ConstU32<16>;
}

// Mock council members
pub struct MockCouncilMembers;
impl pallet_halom_oracle::IsCouncilMember<u64> for MockCouncilMembers {
    fn is_council_member(who: &u64) -> bool {
        // Test accounts 1, 2, and 3 are council members
        matches!(who, 1 | 2 | 3)
    }
}

parameter_types! {
    pub const MinUpdateInterval: u64 = 10;
    pub const MaxUpdateInterval: u64 = 100;
    pub const MinSourcesForConsensus: u32 = 2;
    pub const VotingPeriod: u64 = 50;
    pub const RequiredMajority: u32 = 66;
}

pub struct MockOrigin;
impl EnsureOrigin<RuntimeOrigin> for MockOrigin {
    type Success = ();
    fn try_origin(o: RuntimeOrigin) -> Result<Self::Success, RuntimeOrigin> {
        if let Ok(who) = ensure_signed(o.clone()) {
            if MockCouncilMembers::is_council_member(&who) {
                return Ok(());
            }
        }
        Err(o)
    }
}

impl pallet_halom_oracle::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type OracleUpdateOrigin = MockOrigin;
    type GovernanceOrigin = MockOrigin;
    type CouncilMembers = MockCouncilMembers;
    type VotingPeriod = VotingPeriod;
    type MinUpdateInterval = MinUpdateInterval;
    type MaxUpdateInterval = MaxUpdateInterval;
    type MinSourcesForConsensus = MinSourcesForConsensus;
    type RequiredMajority = RequiredMajority;
}

// Helper function to build genesis storage
pub fn new_test_ext() -> sp_io::TestExternalities {
    let mut t = system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
        
    pallet_halom_oracle::GenesisConfig::<Test> {
        initial_sources: vec![
            b"KSH".to_vec(),
            b"MNB".to_vec(),
            b"EUROSTAT".to_vec(),
        ],
        _phantom: Default::default(),
    }
    .assimilate_storage(&mut t)
    .unwrap();
    
    t.into()
} 
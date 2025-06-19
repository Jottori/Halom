#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::{
        pallet_prelude::*,
        traits::{Get, EnsureOrigin},
        dispatch::DispatchResult,
        Blake2_128Concat,
    };
    use frame_system::pallet_prelude::*;
    use sp_runtime::{
        offchain::{
            http,
            storage::StorageValueRef,
            Duration,
        },
        traits::{Zero, Hash as HashT},
        RuntimeDebug,
    };
    use sp_std::prelude::*;
    use codec::{Decode, Encode};
    use scale_info::TypeInfo;

    // Új típusok a governance-hez
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo)]
    pub enum Parameter<BlockNumber> {
        UpdateInterval(BlockNumber),
        MinSources(u32),
        ConsensusThreshold(u32),
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo)]
    pub enum ProposalStatus {
        Active,
        Approved,
        Rejected,
        Expired,
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo)]
    pub struct Proposal<AccountId, BlockNumber> {
        proposer: AccountId,
        parameter: Parameter<BlockNumber>,
        votes_for: Vec<AccountId>,
        votes_against: Vec<AccountId>,
        end_block: BlockNumber,
        status: ProposalStatus,
    }

    pub trait IsCouncilMember<AccountId> {
        fn is_council_member(who: &AccountId) -> bool;
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo)]
    pub struct HOIPayload<Public> {
        pub hoi_value: u32,
        pub public: Public,
    }

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        
        /// The origin that is allowed to update HOI
        type OracleUpdateOrigin: EnsureOrigin<Self::RuntimeOrigin>;
        
        /// The origin that is allowed to update oracle parameters
        type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Council membership checking
        type CouncilMembers: IsCouncilMember<Self::AccountId>;
        
        /// Voting period for proposals
        #[pallet::constant]
        type VotingPeriod: Get<Self::BlockNumber>;
        
        /// Minimum update interval in blocks
        #[pallet::constant]
        type MinUpdateInterval: Get<Self::BlockNumber>;
        
        /// Maximum update interval in blocks
        #[pallet::constant]
        type MaxUpdateInterval: Get<Self::BlockNumber>;
        
        /// Minimum number of sources required for consensus
        #[pallet::constant]
        type MinSourcesForConsensus: Get<u32>;

        /// Required majority percentage for proposal approval (0-100)
        #[pallet::constant]
        type RequiredMajority: Get<u32>;
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::storage]
    #[pallet::getter(fn current_hoi)]
    pub type CurrentHOI<T> = StorageValue<_, u32, ValueQuery>;

    #[pallet::storage]
    #[pallet::getter(fn last_update)]
    pub type LastUpdate<T: Config> = StorageValue<_, T::BlockNumber, ValueQuery>;

    #[pallet::storage]
    #[pallet::getter(fn update_interval)]
    pub type UpdateInterval<T: Config> = StorageValue<_, T::BlockNumber, ValueQuery>;

    #[pallet::storage]
    #[pallet::getter(fn min_sources)]
    pub type MinSources<T: Config> = StorageValue<_, u32, ValueQuery>;

    #[pallet::storage]
    #[pallet::getter(fn allowed_sources)]
    pub type AllowedSources<T> = StorageValue<_, BoundedVec<Vec<u8>, ConstU32<10>>, ValueQuery>;

    #[pallet::storage]
    #[pallet::getter(fn source_values)]
    pub type SourceValues<T> = StorageMap<_, Blake2_128Concat, Vec<u8>, u32, ValueQuery>;

    #[pallet::storage]
    #[pallet::getter(fn proposals)]
    pub type Proposals<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        T::Hash,
        Proposal<T::AccountId, T::BlockNumber>,
        OptionQuery
    >;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// HOI value updated. [value]
        HOIUpdated { value: u32 },
        /// Oracle parameters updated
        ParametersUpdated {
            update_interval: T::BlockNumber,
            min_sources: u32,
        },
        /// Source added to allowed sources
        SourceAdded { source: Vec<u8> },
        /// Source removed from allowed sources
        SourceRemoved { source: Vec<u8> },
    }

    #[pallet::error]
    pub enum Error<T> {
        /// Not a council member
        NotCouncilMember,
        /// Invalid source
        InvalidSource,
        /// Proposal not found
        ProposalNotFound,
        /// Already voted
        AlreadyVoted,
        /// Proposal expired
        ProposalExpired,
        /// Invalid parameter value
        InvalidParameterValue,
        /// Insufficient sources for consensus
        InsufficientSources,
        /// Update interval too low
        UpdateIntervalTooLow,
        /// Update interval too high
        UpdateIntervalTooHigh,
        /// Too early to update
        TooEarlyToUpdate,
        /// Invalid number of minimum sources
        InvalidMinSources,
        /// Source already exists
        SourceAlreadyExists,
        /// Source not found
        SourceNotFound,
        /// Too many sources
        TooManySources,
    }

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        fn offchain_worker(block_number: T::BlockNumber) {
            if Self::should_fetch(block_number) {
                if let Err(e) = Self::fetch_hoi_info() {
                    log::error!("Error fetching HOI info: {:?}", e);
                }
            }
        }
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        #[pallet::weight(10_000)]
        pub fn submit_hoi(
            origin: OriginFor<T>,
            value: u32,
        ) -> DispatchResult {
            T::OracleUpdateOrigin::ensure_origin(origin)?;
            
            let now = frame_system::Pallet::<T>::block_number();
            let last_update = Self::last_update();
            let interval = Self::update_interval();
            
            ensure!(
                now >= last_update.saturating_add(interval),
                Error::<T>::TooEarlyToUpdate
            );
            
            <CurrentHOI<T>>::put(value);
            <LastUpdate<T>>::put(now);
            
            Self::deposit_event(Event::HOIUpdated { value });
            
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn update_parameters(
            origin: OriginFor<T>,
            new_interval: T::BlockNumber,
            new_min_sources: u32,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;
            
            ensure!(
                new_interval >= T::MinUpdateInterval::get(),
                Error::<T>::UpdateIntervalTooLow
            );
            
            ensure!(
                new_interval <= T::MaxUpdateInterval::get(),
                Error::<T>::UpdateIntervalTooHigh
            );
            
            ensure!(
                new_min_sources >= 1 && new_min_sources <= 10,
                Error::<T>::InvalidMinSources
            );
            
            <UpdateInterval<T>>::put(new_interval);
            <MinSources<T>>::put(new_min_sources);
            
            Self::deposit_event(Event::ParametersUpdated {
                update_interval: new_interval,
                min_sources: new_min_sources,
            });
            
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn add_source(
            origin: OriginFor<T>,
            source: Vec<u8>,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;
            
            let mut sources = Self::allowed_sources();
            ensure!(
                !sources.iter().any(|s| s == &source),
                Error::<T>::SourceAlreadyExists
            );
            
            sources.try_push(source.clone())
                .map_err(|_| Error::<T>::TooManySources)?;
            
            <AllowedSources<T>>::put(sources);
            
            Self::deposit_event(Event::SourceAdded { source });
            
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn remove_source(
            origin: OriginFor<T>,
            source: Vec<u8>,
        ) -> DispatchResult {
            T::GovernanceOrigin::ensure_origin(origin)?;
            
            let mut sources = Self::allowed_sources();
            let pos = sources.iter()
                .position(|s| s == &source)
                .ok_or(Error::<T>::SourceNotFound)?;
            
            sources.remove(pos);
            <AllowedSources<T>>::put(sources);
            
            Self::deposit_event(Event::SourceRemoved { source });
            
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn submit_source_value(
            origin: OriginFor<T>,
            source: Vec<u8>,
            value: u32,
        ) -> DispatchResult {
            T::OracleUpdateOrigin::ensure_origin(origin)?;
            ensure!(Self::is_allowed_source(&source), Error::<T>::InvalidSource);
            
            <SourceValues<T>>::insert(source, value);
            Self::try_consensus()?;
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn propose_parameter_change(
            origin: OriginFor<T>,
            parameter: Parameter<T::BlockNumber>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(T::CouncilMembers::is_council_member(&who), Error::<T>::NotCouncilMember);
            
            // Validate parameter
            match &parameter {
                Parameter::UpdateInterval(interval) => {
                    ensure!(*interval >= T::MinUpdateInterval::get(), Error::<T>::UpdateIntervalTooLow);
                    ensure!(*interval <= T::MaxUpdateInterval::get(), Error::<T>::UpdateIntervalTooHigh);
                },
                Parameter::MinSources(sources) => {
                    ensure!(*sources >= 1 && *sources <= 10, Error::<T>::InvalidMinSources);
                },
                Parameter::ConsensusThreshold(threshold) => {
                    ensure!(*threshold > 0 && *threshold <= 100, Error::<T>::InvalidParameterValue);
                },
            }
            
            let proposal = Proposal {
                proposer: who.clone(),
                parameter,
                votes_for: vec![who],
                votes_against: vec![],
                end_block: frame_system::Pallet::<T>::block_number() + T::VotingPeriod::get(),
                status: ProposalStatus::Active,
            };
            
            let hash = T::Hashing::hash_of(&proposal);
            <Proposals<T>>::insert(hash, proposal);
            
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn vote_on_proposal(
            origin: OriginFor<T>,
            proposal_hash: T::Hash,
            approve: bool,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(T::CouncilMembers::is_council_member(&who), Error::<T>::NotCouncilMember);
            
            let mut proposal = <Proposals<T>>::get(proposal_hash)
                .ok_or(Error::<T>::ProposalNotFound)?;
                
            ensure!(proposal.status == ProposalStatus::Active, Error::<T>::ProposalExpired);
            
            let current_block = frame_system::Pallet::<T>::block_number();
            ensure!(current_block <= proposal.end_block, Error::<T>::ProposalExpired);
            
            // Check if already voted
            ensure!(
                !proposal.votes_for.contains(&who) && !proposal.votes_against.contains(&who),
                Error::<T>::AlreadyVoted
            );
            
            if approve {
                proposal.votes_for.push(who);
            } else {
                proposal.votes_against.push(who);
            }
            
            // Check if proposal can be resolved
            if Self::should_resolve_proposal(&proposal) {
                Self::resolve_proposal(proposal_hash, &mut proposal)?;
            }
            
            <Proposals<T>>::insert(proposal_hash, proposal);
            Ok(())
        }
    }

    impl<T: Config> Pallet<T> {
        fn should_fetch(block_number: T::BlockNumber) -> bool {
            let last_update = Self::last_update();
            let interval = T::OracleUpdateInterval::get().into();
            
            if last_update.is_zero() {
                return true;
            }

            // Check if it's time for an update
            block_number > last_update + interval
        }

        fn fetch_hoi_info() -> Result<(), Error<T>> {
            // In a real implementation, this would fetch from an actual API
            // For now, we'll use a mock value
            let hoi_value = 105; // Example: 5% inflation

            // Submit transaction
            let call = Call::submit_hoi_value { hoi_value };
            let _ = SubmitTransaction::<T, Call<T>>::submit_unsigned_transaction(call.into())
                .map_err(|_| Error::<T>::FetchError)?;

            Ok(())
        }

        /// Initialize default values
        pub fn initialize_defaults() -> Weight {
            if !<UpdateInterval<T>>::exists() {
                <UpdateInterval<T>>::put(T::MinUpdateInterval::get());
            }
            
            if !<MinSources<T>>::exists() {
                <MinSources<T>>::put(T::MinSourcesForConsensus::get());
            }
            
            T::DbWeight::get().writes(2)
        }

        fn is_allowed_source(source: &[u8]) -> bool {
            Self::allowed_sources().iter().any(|s| s == source)
        }

        fn try_consensus() -> DispatchResult {
            let values = <SourceValues<T>>::iter().collect::<Vec<_>>();
            
            ensure!(
                values.len() >= T::MinSourcesForConsensus::get() as usize,
                Error::<T>::InsufficientSources
            );
            
            // Calculate weighted average
            let sum: u32 = values.iter().map(|(_, v)| v).sum();
            let avg = sum / (values.len() as u32);
            
            Self::submit_hoi(frame_system::RawOrigin::Root.into(), avg)
        }

        fn should_resolve_proposal(proposal: &Proposal<T::AccountId, T::BlockNumber>) -> bool {
            let total_votes = proposal.votes_for.len() + proposal.votes_against.len();
            let required_votes = T::RequiredMajority::get() as usize;
            
            proposal.votes_for.len() >= required_votes || 
            proposal.votes_against.len() >= required_votes ||
            total_votes >= T::RequiredMajority::get() as usize
        }

        fn resolve_proposal(
            proposal_hash: T::Hash,
            proposal: &mut Proposal<T::AccountId, T::BlockNumber>
        ) -> DispatchResult {
            let total_votes = proposal.votes_for.len() + proposal.votes_against.len();
            let approval_threshold = (total_votes * T::RequiredMajority::get() as usize) / 100;
            
            if proposal.votes_for.len() >= approval_threshold {
                proposal.status = ProposalStatus::Approved;
                Self::enact_proposal(proposal)?;
            } else {
                proposal.status = ProposalStatus::Rejected;
            }
            
            Ok(())
        }

        fn enact_proposal(proposal: &Proposal<T::AccountId, T::BlockNumber>) -> DispatchResult {
            match &proposal.parameter {
                Parameter::UpdateInterval(interval) => {
                    <UpdateInterval<T>>::put(interval);
                },
                Parameter::MinSources(sources) => {
                    <MinSources<T>>::put(sources);
                },
                Parameter::ConsensusThreshold(_threshold) => {
                    // Implement consensus threshold update
                },
            }
            Ok(())
        }
    }

    #[pallet::genesis_config]
    pub struct GenesisConfig<T: Config> {
        pub initial_sources: Vec<Vec<u8>>,
        pub _phantom: PhantomData<T>,
    }

    #[cfg(feature = "std")]
    impl<T: Config> Default for GenesisConfig<T> {
        fn default() -> Self {
            Self {
                initial_sources: Vec::new(),
                _phantom: PhantomData,
            }
        }
    }

    #[pallet::genesis_build]
    impl<T: Config> GenesisBuild<T> for GenesisConfig<T> {
        fn build(&self) {
            if let Ok(sources) = BoundedVec::try_from(self.initial_sources.clone()) {
                <AllowedSources<T>>::put(sources);
            }
            
            Pallet::<T>::initialize_defaults();
        }
    }

    #[pallet::validate_unsigned]
    impl<T: Config> ValidateUnsigned for Pallet<T> {
        type Call = Call<T>;

        fn validate_unsigned(_source: TransactionSource, call: &Self::Call) -> TransactionValidity {
            if let Call::submit_hoi_value { hoi_value } = call {
                if hoi_value > &0 {
                    return Ok(ValidTransaction::with_tag_prefix("HalomOracle")
                        .priority(100)
                        .and_provides(("hoi-oracle", *hoi_value))
                        .longevity(5)
                        .propagate(true)
                        .build());
                }
            }
            InvalidTransaction::Call.into()
        }
    }
} 
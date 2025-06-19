#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::{
        pallet_prelude::*,
        traits::{Currency, Get, ReservableCurrency, ExistenceRequirement},
        PalletId,
    };
    use frame_system::pallet_prelude::*;
    use sp_runtime::{
        traits::{Zero, Saturating, AccountIdConversion},
        Permill,
    };
    use sp_std::prelude::*;
    use pallet_halom_oracle::CurrentHOI;

    type BalanceOf<T> = <<T as Config>::Currency as Currency<<T as frame_system::Config>::AccountId>>::Balance;

    pub const INITIAL_SUPPLY: u128 = 10_000_000; // 10 millió kezdeti supply
    pub const MAX_SUPPLY: u128 = 100_000_000;    // 100 millió maximális supply
    pub const BASE_REWARD: u128 = 50;            // Alap blokk jutalom
    pub const BLOCKS_PER_YEAR: u32 = 2_628_000;  // ~6 másodperces blokkidővel

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo)]
    pub struct License<BlockNumber> {
        pub active: bool,
        pub expiry: BlockNumber,
        pub license_type: LicenseType,
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo)]
    pub enum LicenseType {
        Standard,    // 20% boost
        Premium,     // 35% boost
        Enterprise,  // 50% boost
    }

    impl Default for LicenseType {
        fn default() -> Self {
            Self::Standard
        }
    }

    impl LicenseType {
        fn get_boost(&self) -> Permill {
            match self {
                LicenseType::Standard => Permill::from_percent(20),
                LicenseType::Premium => Permill::from_percent(35),
                LicenseType::Enterprise => Permill::from_percent(50),
            }
        }

        fn get_price<T: Config>(&self) -> BalanceOf<T> {
            match self {
                // Új árak a 100M supply-hoz igazítva
                LicenseType::Standard => 5_000u128.into(),    // 5,000 HOM
                LicenseType::Premium => 25_000u128.into(),    // 25,000 HOM
                LicenseType::Enterprise => 100_000u128.into(), // 100,000 HOM
            }
        }
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo)]
    pub struct LicenseStake<Balance, BlockNumber> {
        pub stake_összeg: Balance,
        pub zárolási_idő: BlockNumber,
        pub megszerzett_jutalmak: Balance,
        pub utolsó_claim: BlockNumber,
    }

    #[pallet::config]
    pub trait Config: frame_system::Config + pallet_halom_oracle::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        
        type Currency: Currency<Self::AccountId> + ReservableCurrency<Self::AccountId>;
        
        #[pallet::constant]
        type TreasuryPalletId: Get<PalletId>;

        #[pallet::constant]
        type TreasuryFeePercent: Get<Permill>;

        #[pallet::constant]
        type LicenseDuration: Get<Self::BlockNumber>;

        // Új paraméterek
        #[pallet::constant]
        type MinimumStake: Get<BalanceOf<Self>>;

        #[pallet::constant]
        type StakingBonus: Get<Permill>;
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::storage]
    #[pallet::getter(fn licenses)]
    pub type Licenses<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        T::AccountId,
        License<T::BlockNumber>,
        ValueQuery,
    >;

    #[pallet::storage]
    #[pallet::getter(fn total_issuance)]
    pub type TotalIssuance<T: Config> = StorageValue<_, BalanceOf<T>, ValueQuery>;

    #[pallet::storage]
    pub type LicenseStakes<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        T::AccountId,
        LicenseStake<BalanceOf<T>, T::BlockNumber>,
        OptionQuery
    >;

    #[pallet::storage]
    #[pallet::getter(fn staking_info)]
    pub type StakingInfo<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        T::AccountId,
        BalanceOf<T>,
        ValueQuery
    >;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Reward issued to miner. [account, amount]
        RewardIssued { miner: T::AccountId, amount: BalanceOf<T> },
        /// License status changed. [account, status, expiry]
        LicenseUpdated { account: T::AccountId, license_type: LicenseType, expiry: T::BlockNumber },
        /// Treasury fee collected. [amount]
        TreasuryFeeCollected { amount: BalanceOf<T> },
        TokensStaked { account: T::AccountId, amount: BalanceOf<T> },
        TokensUnstaked { account: T::AccountId, amount: BalanceOf<T> },
    }

    #[pallet::error]
    pub enum Error<T> {
        /// Supply cap reached
        SupplyCapReached,
        /// Overflow in calculation
        Overflow,
        /// Insufficient balance for license
        InsufficientBalance,
        /// License already active
        LicenseAlreadyActive,
        InsufficientStake,
        NoStake,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        #[pallet::weight(10_000)]
        pub fn purchase_license(
            origin: OriginFor<T>,
            license_type: LicenseType,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            
            let current_license = Self::licenses(&who);
            ensure!(!current_license.active, Error::<T>::LicenseAlreadyActive);

            let price = license_type.get_price::<T>();
            let fee = T::TreasuryFeePercent::get() * price;
            let total_cost = price.saturating_add(fee);

            T::Currency::transfer(
                &who,
                &Self::treasury_account_id(),
                fee,
                ExistenceRequirement::KeepAlive,
            )?;

            let expiry = frame_system::Pallet::<T>::block_number()
                .saturating_add(T::LicenseDuration::get());

            <Licenses<T>>::insert(&who, License {
                active: true,
                expiry,
                license_type: license_type.clone(),
            });

            Self::deposit_event(Event::LicenseUpdated {
                account: who,
                license_type,
                expiry,
            });

            Self::deposit_event(Event::TreasuryFeeCollected { amount: fee });

            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn issue_reward(
            origin: OriginFor<T>,
            miner: T::AccountId,
        ) -> DispatchResult {
            ensure_signed(origin)?;

            let reward = Self::calculate_reward(&miner)?;
            
            let new_total = Self::total_issuance().saturating_add(reward);
            ensure!(new_total <= MAX_SUPPLY.into(), Error::<T>::SupplyCapReached);
            
            T::Currency::deposit_creating(&miner, reward);
            <TotalIssuance<T>>::put(new_total);
            
            Self::deposit_event(Event::RewardIssued { miner: miner.clone(), amount: reward });
            
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn stake_tokens(
            origin: OriginFor<T>,
            amount: BalanceOf<T>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            
            ensure!(amount >= T::MinimumStake::get(), Error::<T>::InsufficientStake);
            
            T::Currency::reserve(&who, amount)?;
            <StakingInfo<T>>::insert(&who, amount);
            
            Self::deposit_event(Event::TokensStaked { account: who, amount });
            
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn unstake_tokens(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            
            let staked = Self::staking_info(&who);
            ensure!(staked > Zero::zero(), Error::<T>::NoStake);
            
            T::Currency::unreserve(&who, staked);
            <StakingInfo<T>>::remove(&who);
            
            Self::deposit_event(Event::TokensUnstaked { account: who, amount: staked });
            
            Ok(())
        }
    }

    impl<T: Config> Pallet<T> {
        fn calculate_reward(
            miner: &T::AccountId,
            blocks_since_start: T::BlockNumber,
        ) -> Result<BalanceOf<T>, Error<T>> {
            let base_reward = BASE_REWARD.into();
            
            // Inflációs korrekció
            let hoi = <CurrentHOI<T>>::get();
            let inflation_bonus = Permill::from_parts(hoi as u32);
            let reward_with_inflation = base_reward.saturating_mul(inflation_bonus);
            
            // Licenc bónusz
            let license_bonus = if let Some(license) = Self::licenses(miner) {
                if license.active {
                    license.license_type.get_boost()
                } else {
                    Permill::zero()
                }
            } else {
                Permill::zero()
            };
            
            let reward_with_license = reward_with_inflation.saturating_mul(
                Permill::from_percent(100) + license_bonus
            );

            // Staking bónusz
            let staked = Self::staking_info(miner);
            let staking_bonus = if staked >= T::MinimumStake::get() {
                T::StakingBonus::get()
            } else {
                Permill::zero()
            };
            
            let final_reward = reward_with_license.saturating_mul(
                Permill::from_percent(100) + staking_bonus
            );

            // Supply cap ellenőrzés
            let new_total = Self::total_issuance().saturating_add(final_reward);
            ensure!(new_total <= MAX_SUPPLY.into(), Error::<T>::SupplyCapReached);

            Ok(final_reward)
        }

        fn treasury_account_id() -> T::AccountId {
            T::TreasuryPalletId::get().into_account_truncating()
        }
    }
} 
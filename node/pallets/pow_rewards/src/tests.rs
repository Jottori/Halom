use crate::{mock::*, Error, Event, License, LicenseType};
use frame_support::{assert_noop, assert_ok};
use sp_runtime::traits::BadOrigin;
use sp_runtime::traits::AccountIdConversion;

#[test]
fn test_set_license_status() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);

        // Only root can set license
        assert_noop!(
            PowRewards::set_license_status(RuntimeOrigin::signed(1), 1, true),
            BadOrigin
        );

        // Root can set license
        assert_ok!(PowRewards::set_license_status(RuntimeOrigin::root(), 1, true));

        // Check event was emitted
        System::assert_last_event(Event::LicenseStatusChanged {
            account: 1,
            status: true,
        }.into());

        // Check storage was updated
        assert!(PowRewards::licenses(1));
    });
}

#[test]
fn test_issue_reward_basic() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        
        // Set HOI to 105 (5% inflation)
        assert_ok!(HalomOracle::submit_hoi_value(RuntimeOrigin::signed(1), 105));

        // Issue reward without license
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 1));

        // Check balance was updated with base reward * inflation
        let expected_reward = (BaseReward::get() as f64 * 1.05) as u128;
        assert_eq!(Balances::free_balance(1), 10_000 + expected_reward);
    });
}

#[test]
fn test_issue_reward_with_license() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        
        // Set HOI to 105 (5% inflation)
        assert_ok!(HalomOracle::submit_hoi_value(RuntimeOrigin::signed(1), 105));

        // Set license
        assert_ok!(PowRewards::set_license_status(RuntimeOrigin::root(), 1, true));

        // Issue reward with license
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 1));

        // Check balance was updated with (base reward * inflation) * (1 + boost)
        let base_with_inflation = (BaseReward::get() as f64 * 1.05) as u128;
        let expected_reward = base_with_inflation + (base_with_inflation / 5); // 20% boost
        assert_eq!(Balances::free_balance(1), 10_000 + expected_reward);
    });
}

#[test]
fn test_supply_cap() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);

        // Set total issuance near max supply
        let near_max = MaxSupply::get() - BaseReward::get();
        PowRewards::set_total_issuance(near_max);

        // Try to issue reward that would exceed cap
        assert_noop!(
            PowRewards::issue_reward(RuntimeOrigin::signed(1), 1),
            Error::<Test>::SupplyCapReached
        );
    });
}

#[test]
fn test_reward_calculation() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);

        // Test different HOI values
        let test_cases = vec![
            (100, BaseReward::get()),  // No inflation
            (105, (BaseReward::get() as f64 * 1.05) as u128),  // 5% inflation
            (110, (BaseReward::get() as f64 * 1.10) as u128),  // 10% inflation
        ];

        for (hoi, expected_base) in test_cases {
            // Set HOI
            assert_ok!(HalomOracle::submit_hoi_value(RuntimeOrigin::signed(1), hoi));

            // Test without license
            assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(2), 2));
            assert_eq!(
                Balances::free_balance(2),
                20_000 + expected_base
            );

            // Set license and test with boost
            assert_ok!(PowRewards::set_license_status(RuntimeOrigin::root(), 2, true));
            assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(2), 2));
            
            let boosted_reward = expected_base + (expected_base / 5);  // 20% boost
            assert_eq!(
                Balances::free_balance(2),
                20_000 + expected_base + boosted_reward
            );
        }
    });
}

#[test]
fn test_issue_reward_works() {
    new_test_ext().execute_with(|| {
        // Set HOI to 100 (1.0)
        pallet_halom_oracle::CurrentHOI::<Test>::put(100);
        
        // Issue reward to account 2
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 2));
        
        // Check reward was issued correctly
        assert_eq!(Balances::free_balance(2), 11_000_000); // Initial 10M + 1000 reward
        
        // Check event was emitted
        System::assert_last_event(Event::RewardIssued { 
            miner: 2, 
            amount: 1_000 
        }.into());
    });
}

#[test]
fn test_issue_reward_with_standard_license() {
    new_test_ext().execute_with(|| {
        // Set HOI to 100 (1.0)
        pallet_halom_oracle::CurrentHOI::<Test>::put(100);
        
        // Purchase standard license for account 2
        assert_ok!(PowRewards::purchase_license(
            RuntimeOrigin::signed(2),
            LicenseType::Standard
        ));
        
        // Issue reward
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 2));
        
        // Check reward was boosted by 20%
        // Base reward: 1000
        // Standard boost: 20%
        // Expected: 1200
        assert_eq!(
            Balances::free_balance(2),
            10_000_000 - 1_000 - 100 + 1_200 // Initial - License price - Fee + Boosted reward
        );
    });
}

#[test]
fn test_issue_reward_with_premium_license() {
    new_test_ext().execute_with(|| {
        // Set HOI to 100 (1.0)
        pallet_halom_oracle::CurrentHOI::<Test>::put(100);
        
        // Purchase premium license for account 2
        assert_ok!(PowRewards::purchase_license(
            RuntimeOrigin::signed(2),
            LicenseType::Premium
        ));
        
        // Issue reward
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 2));
        
        // Check reward was boosted by 35%
        // Base reward: 1000
        // Premium boost: 35%
        // Expected: 1350
        assert_eq!(
            Balances::free_balance(2),
            10_000_000 - 5_000 - 500 + 1_350 // Initial - License price - Fee + Boosted reward
        );
    });
}

#[test]
fn test_issue_reward_with_enterprise_license() {
    new_test_ext().execute_with(|| {
        // Set HOI to 100 (1.0)
        pallet_halom_oracle::CurrentHOI::<Test>::put(100);
        
        // Purchase enterprise license for account 2
        assert_ok!(PowRewards::purchase_license(
            RuntimeOrigin::signed(2),
            LicenseType::Enterprise
        ));
        
        // Issue reward
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 2));
        
        // Check reward was boosted by 50%
        // Base reward: 1000
        // Enterprise boost: 50%
        // Expected: 1500
        assert_eq!(
            Balances::free_balance(2),
            10_000_000 - 20_000 - 2_000 + 1_500 // Initial - License price - Fee + Boosted reward
        );
    });
}

#[test]
fn test_license_expiry() {
    new_test_ext().execute_with(|| {
        // Set HOI to 100 (1.0)
        pallet_halom_oracle::CurrentHOI::<Test>::put(100);
        
        // Purchase standard license for account 2
        assert_ok!(PowRewards::purchase_license(
            RuntimeOrigin::signed(2),
            LicenseType::Standard
        ));
        
        // Fast forward to just before expiry
        System::set_block_number(99);
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 2));
        
        // Should still get boosted reward
        assert_eq!(
            Balances::free_balance(2),
            10_000_000 - 1_000 - 100 + 1_200 // Initial - License price - Fee + Boosted reward
        );
        
        // Fast forward past expiry
        System::set_block_number(101);
        assert_ok!(PowRewards::issue_reward(RuntimeOrigin::signed(1), 2));
        
        // Should get normal reward
        assert_eq!(
            Balances::free_balance(2),
            10_000_000 - 1_000 - 100 + 1_200 + 1_000 // Previous balance + Normal reward
        );
    });
}

#[test]
fn test_license_already_active() {
    new_test_ext().execute_with(|| {
        // Purchase standard license
        assert_ok!(PowRewards::purchase_license(
            RuntimeOrigin::signed(2),
            LicenseType::Standard
        ));
        
        // Try to purchase another license
        assert_noop!(
            PowRewards::purchase_license(RuntimeOrigin::signed(2), LicenseType::Premium),
            Error::<Test>::LicenseAlreadyActive
        );
    });
}

#[test]
fn test_treasury_fees() {
    new_test_ext().execute_with(|| {
        let treasury_account = PowRewards::treasury_account_id();
        let initial_treasury_balance = Balances::free_balance(&treasury_account);
        
        // Purchase standard license
        assert_ok!(PowRewards::purchase_license(
            RuntimeOrigin::signed(2),
            LicenseType::Standard
        ));
        
        // Check treasury received 10% fee
        assert_eq!(
            Balances::free_balance(&treasury_account),
            initial_treasury_balance + 100 // 10% of 1000
        );
        
        // Check event was emitted
        System::assert_has_event(Event::TreasuryFeeCollected { amount: 100 }.into());
    });
} 
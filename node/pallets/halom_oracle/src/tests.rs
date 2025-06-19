#![cfg(test)]

use crate::{mock::*, Error, Event, Parameter, ProposalStatus};
use frame_support::{assert_noop, assert_ok};
use sp_runtime::traits::BadOrigin;
use sp_runtime::traits::Hash;

#[test]
fn test_submit_hoi_value() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);

        // Test submitting a valid HOI value
        assert_ok!(HalomOracle::submit_hoi_value(RuntimeOrigin::signed(1), 105));

        // Check that the event was emitted
        System::assert_last_event(Event::HOIUpdated { value: 105 }.into());

        // Check that the storage was updated
        assert_eq!(HalomOracle::current_hoi(), 105);
        assert_eq!(HalomOracle::last_update(), 1);
    });
}

#[test]
fn test_invalid_hoi_value() {
    new_test_ext().execute_with(|| {
        // Test submitting an invalid HOI value (0)
        assert_noop!(
            HalomOracle::submit_hoi_value(RuntimeOrigin::signed(1), 0),
            Error::<Test>::InvalidHOIValue
        );
    });
}

#[test]
fn test_update_interval() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);

        // Submit initial value
        assert_ok!(HalomOracle::submit_hoi_value(RuntimeOrigin::signed(1), 105));

        // Check that should_fetch returns false before interval
        assert!(!HalomOracle::should_fetch(5));

        // Check that should_fetch returns true after interval
        assert!(HalomOracle::should_fetch(12));
    });
}

#[test]
fn test_unsigned_validation() {
    new_test_ext().execute_with(|| {
        // Test unsigned validation with valid value
        let call = crate::Call::submit_hoi_value { hoi_value: 105 };
        assert!(HalomOracle::validate_unsigned(sp_runtime::transaction_validity::TransactionSource::Local, &call).is_ok());

        // Test unsigned validation with invalid value
        let call = crate::Call::submit_hoi_value { hoi_value: 0 };
        assert!(HalomOracle::validate_unsigned(sp_runtime::transaction_validity::TransactionSource::Local, &call).is_err());
    });
}

#[test]
fn test_submit_source_value() {
    new_test_ext().execute_with(|| {
        // Submit value from KSH source
        assert_ok!(HalomOracle::submit_source_value(
            RuntimeOrigin::signed(1),
            b"KSH".to_vec(),
            520  // 5.2%
        ));
        
        // Check source value is stored
        assert_eq!(HalomOracle::source_values(b"KSH".to_vec()), 520);
        
        // Submit value from invalid source
        assert_noop!(
            HalomOracle::submit_source_value(
                RuntimeOrigin::signed(1),
                b"INVALID".to_vec(),
                520
            ),
            Error::<Test>::InvalidSource
        );
    });
}

#[test]
fn test_consensus_calculation() {
    new_test_ext().execute_with(|| {
        // Submit values from multiple sources
        assert_ok!(HalomOracle::submit_source_value(
            RuntimeOrigin::signed(1),
            b"KSH".to_vec(),
            520  // 5.2%
        ));
        
        assert_ok!(HalomOracle::submit_source_value(
            RuntimeOrigin::signed(1),
            b"MNB".to_vec(),
            540  // 5.4%
        ));
        
        // Check consensus value (average)
        assert_eq!(HalomOracle::current_hoi(), 530);  // 5.3%
    });
}

#[test]
fn test_propose_parameter_change() {
    new_test_ext().execute_with(|| {
        // Create proposal from council member
        assert_ok!(HalomOracle::propose_parameter_change(
            RuntimeOrigin::signed(1),
            Parameter::MinSources(3)
        ));
        
        // Try to create proposal from non-council member
        assert_noop!(
            HalomOracle::propose_parameter_change(
                RuntimeOrigin::signed(4),
                Parameter::MinSources(3)
            ),
            Error::<Test>::NotCouncilMember
        );
        
        // Try to create proposal with invalid value
        assert_noop!(
            HalomOracle::propose_parameter_change(
                RuntimeOrigin::signed(1),
                Parameter::MinSources(11)
            ),
            Error::<Test>::InvalidMinSources
        );
    });
}

#[test]
fn test_vote_on_proposal() {
    new_test_ext().execute_with(|| {
        // Create proposal
        assert_ok!(HalomOracle::propose_parameter_change(
            RuntimeOrigin::signed(1),
            Parameter::MinSources(3)
        ));
        
        // Get proposal hash
        let proposal = HalomOracle::proposals(0).unwrap();
        let hash = <Test as frame_system::Config>::Hashing::hash_of(&proposal);
        
        // Vote from another council member
        assert_ok!(HalomOracle::vote_on_proposal(
            RuntimeOrigin::signed(2),
            hash,
            true
        ));
        
        // Try to vote again
        assert_noop!(
            HalomOracle::vote_on_proposal(
                RuntimeOrigin::signed(2),
                hash,
                true
            ),
            Error::<Test>::AlreadyVoted
        );
        
        // Vote from non-council member
        assert_noop!(
            HalomOracle::vote_on_proposal(
                RuntimeOrigin::signed(4),
                hash,
                true
            ),
            Error::<Test>::NotCouncilMember
        );
    });
}

#[test]
fn test_proposal_approval() {
    new_test_ext().execute_with(|| {
        // Create proposal
        assert_ok!(HalomOracle::propose_parameter_change(
            RuntimeOrigin::signed(1),
            Parameter::MinSources(3)
        ));
        
        let proposal = HalomOracle::proposals(0).unwrap();
        let hash = <Test as frame_system::Config>::Hashing::hash_of(&proposal);
        
        // Get required votes for approval
        let required_votes = 2;  // 66% of 3 council members
        
        // Vote from council members
        assert_ok!(HalomOracle::vote_on_proposal(
            RuntimeOrigin::signed(2),
            hash,
            true
        ));
        
        // Check proposal is approved and parameter is updated
        let updated_proposal = HalomOracle::proposals(hash).unwrap();
        assert_eq!(updated_proposal.status, ProposalStatus::Approved);
        assert_eq!(HalomOracle::min_sources(), 3);
    });
}

#[test]
fn test_proposal_rejection() {
    new_test_ext().execute_with(|| {
        // Create proposal
        assert_ok!(HalomOracle::propose_parameter_change(
            RuntimeOrigin::signed(1),
            Parameter::MinSources(3)
        ));
        
        let proposal = HalomOracle::proposals(0).unwrap();
        let hash = <Test as frame_system::Config>::Hashing::hash_of(&proposal);
        
        // Vote against from council members
        assert_ok!(HalomOracle::vote_on_proposal(
            RuntimeOrigin::signed(2),
            hash,
            false
        ));
        
        assert_ok!(HalomOracle::vote_on_proposal(
            RuntimeOrigin::signed(3),
            hash,
            false
        ));
        
        // Check proposal is rejected
        let updated_proposal = HalomOracle::proposals(hash).unwrap();
        assert_eq!(updated_proposal.status, ProposalStatus::Rejected);
        
        // Check parameter is not updated
        assert_eq!(HalomOracle::min_sources(), 2);
    });
}

#[test]
fn test_proposal_expiry() {
    new_test_ext().execute_with(|| {
        // Create proposal
        assert_ok!(HalomOracle::propose_parameter_change(
            RuntimeOrigin::signed(1),
            Parameter::MinSources(3)
        ));
        
        let proposal = HalomOracle::proposals(0).unwrap();
        let hash = <Test as frame_system::Config>::Hashing::hash_of(&proposal);
        
        // Advance blocks past voting period
        let voting_period = VotingPeriod::get();
        for _ in 0..voting_period + 1 {
            System::set_block_number(System::block_number() + 1);
        }
        
        // Try to vote on expired proposal
        assert_noop!(
            HalomOracle::vote_on_proposal(
                RuntimeOrigin::signed(2),
                hash,
                true
            ),
            Error::<Test>::ProposalExpired
        );
    });
} 
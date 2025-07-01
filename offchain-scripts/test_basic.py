#!/usr/bin/env python3
"""
Basic tests for Halom Protocol offchain components
Simple tests that don't require external dependencies
"""

import pytest
import math


def test_basic_math():
    """Test basic mathematical operations"""
    assert 2 + 2 == 4
    assert 3 * 4 == 12
    assert 10 / 2 == 5
    assert 2 ** 3 == 8


def test_fourth_root_calculation():
    """Test fourth root calculations manually"""
    # Test perfect fourth powers
    assert abs(16 ** 0.25 - 2.0) < 1e-6
    assert abs(81 ** 0.25 - 3.0) < 1e-6
    assert abs(256 ** 0.25 - 4.0) < 1e-6
    
    # Test non-perfect fourth powers
    assert abs(20 ** 0.25 - 2.1147) < 1e-4
    assert abs(100 ** 0.25 - 3.1623) < 1e-4


def test_governance_power_calculation():
    """Test governance power calculations using fourth root"""
    def calculate_governance_power(stake_amount: float) -> float:
        """Calculate governance power based on fourth root of stake"""
        return stake_amount ** 0.25
    
    # Test with various stake amounts
    assert abs(calculate_governance_power(16) - 2.0) < 1e-6
    assert abs(calculate_governance_power(81) - 3.0) < 1e-6
    assert abs(calculate_governance_power(100) - 3.1623) < 1e-4
    assert abs(calculate_governance_power(1000) - 5.6234) < 1e-4


def test_reward_share_calculation():
    """Test reward share calculations"""
    def calculate_reward_share(user_stake: float, total_stakes: list) -> float:
        """Calculate user's reward share based on fourth root"""
        if not total_stakes or user_stake == 0:
            return 0.0
        
        user_fourth_root = user_stake ** 0.25
        total_fourth_root = sum(stake ** 0.25 for stake in total_stakes)
        
        if total_fourth_root == 0:
            return 0.0
        
        return (user_fourth_root / total_fourth_root) * 100
    
    # Test single user scenario
    share = calculate_reward_share(100, [100])
    assert abs(share - 100.0) < 1e-6
    
    # Test two equal users
    share = calculate_reward_share(100, [100, 100])
    assert abs(share - 50.0) < 1e-6
    
    # Test two unequal users (100 vs 1000)
    share = calculate_reward_share(100, [100, 1000])
    # Should be less than 50% due to fourth root effect
    assert share < 50.0
    assert share > 0.0


def test_anti_whale_effect():
    """Test anti-whale effect calculations"""
    def calculate_anti_whale_effect(stake_amounts: list) -> dict:
        """Calculate anti-whale effect statistics"""
        if not stake_amounts:
            return {}
        
        # Linear voting (traditional)
        total_linear = sum(stake_amounts)
        linear_shares = [(amount / total_linear * 100) if total_linear > 0 else 0 
                        for amount in stake_amounts]
        
        # Fourth root voting
        total_fourth_root = sum(amount ** 0.25 for amount in stake_amounts)
        fourth_root_shares = [(amount ** 0.25 / total_fourth_root * 100) 
                             if total_fourth_root > 0 else 0 for amount in stake_amounts]
        
        # Calculate reduction in voting power for largest holders
        largest_stake = max(stake_amounts)
        largest_linear_share = max(linear_shares)
        largest_fourth_root_share = max(fourth_root_shares)
        
        reduction_percentage = ((largest_linear_share - largest_fourth_root_share) / 
                              largest_linear_share * 100) if largest_linear_share > 0 else 0
        
        return {
            'largest_stake': largest_stake,
            'linear_voting_share': largest_linear_share,
            'fourth_root_voting_share': largest_fourth_root_share,
            'power_reduction_percentage': reduction_percentage
        }
    
    # Test with whale scenario (one large holder, many small holders)
    whale_stake = 10000
    small_stakes = [100] * 99  # 99 small holders
    all_stakes = [whale_stake] + small_stakes
    
    effect = calculate_anti_whale_effect(all_stakes)
    
    # Verify structure
    assert 'largest_stake' in effect
    assert 'linear_voting_share' in effect
    assert 'fourth_root_voting_share' in effect
    assert 'power_reduction_percentage' in effect
    
    # Verify anti-whale effect (fourth root should reduce whale power)
    assert effect['fourth_root_voting_share'] < effect['linear_voting_share']
    assert effect['power_reduction_percentage'] > 0


def test_reward_distribution_consistency():
    """Test that reward distribution sums to 100%"""
    def calculate_reward_share(user_stake: float, total_stakes: list) -> float:
        """Calculate user's reward share based on fourth root"""
        if not total_stakes or user_stake == 0:
            return 0.0
        
        user_fourth_root = user_stake ** 0.25
        total_fourth_root = sum(stake ** 0.25 for stake in total_stakes)
        
        if total_fourth_root == 0:
            return 0.0
        
        return (user_fourth_root / total_fourth_root) * 100
    
    stakes = [100, 200, 300, 400, 500]
    
    total_share = 0
    for stake in stakes:
        share = calculate_reward_share(stake, stakes)
        total_share += share
    
    # Total should be 100%
    assert abs(total_share - 100.0) < 1e-6


def test_mathematical_consistency():
    """Test mathematical consistency of operations"""
    # Test that fourth root of x^4 equals x
    test_values = [1, 2, 3, 4, 5]
    for x in test_values:
        x_to_fourth = x ** 4
        fourth_root_result = x_to_fourth ** 0.25
        assert abs(fourth_root_result - x) < 1e-6
    
    # Test that governance power is consistent with fourth root
    for stake in [100, 1000, 10000]:
        governance_power = stake ** 0.25
        fourth_root = stake ** 0.25
        assert abs(governance_power - fourth_root) < 1e-6


class TestHalomProtocol:
    """Test class for Halom Protocol basic functionality"""
    
    def test_protocol_constants(self):
        """Test protocol constants and parameters"""
        # Test root power (fourth root)
        root_power = 4
        assert root_power == 4
        
        # Test minimum and maximum root powers
        min_root_power = 2  # sqrt minimum
        max_root_power = 10  # maximum root power
        assert min_root_power == 2
        assert max_root_power == 10
        assert min_root_power <= root_power <= max_root_power
    
    def test_stake_validation(self):
        """Test stake amount validation"""
        def validate_stake(amount: float) -> bool:
            """Validate stake amount"""
            return amount > 0 and amount <= 1e18  # Maximum reasonable stake
        
        # Valid stakes
        assert validate_stake(100) == True
        assert validate_stake(1000) == True
        assert validate_stake(1e18) == True
        
        # Invalid stakes
        assert validate_stake(0) == False
        assert validate_stake(-100) == False
        assert validate_stake(1e19) == False
    
    def test_governance_power_scaling(self):
        """Test governance power scaling properties"""
        def calculate_governance_power(stake_amount: float) -> float:
            """Calculate governance power based on fourth root of stake"""
            return stake_amount ** 0.25
        
        # Test that larger stakes have higher governance power
        small_stake = 100
        large_stake = 10000
        
        small_power = calculate_governance_power(small_stake)
        large_power = calculate_governance_power(large_stake)
        
        assert large_power > small_power
        
        # Test that the increase is sublinear (anti-whale effect)
        stake_ratio = large_stake / small_stake  # 100x
        power_ratio = large_power / small_power  # Should be less than 100x
        
        assert power_ratio < stake_ratio
        assert power_ratio > 1  # But still positive


if __name__ == "__main__":
    pytest.main([__file__]) 
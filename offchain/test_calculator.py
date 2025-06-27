#!/usr/bin/env python3
"""
Tests for Halom Protocol Calculator
Tests fourth root based reward and governance power calculations
"""

import pytest
import math
from typing import List, Union
from calculator import HalomCalculator, UserStake, RewardPool


class TestHalomCalculator:
    """Test class for HalomCalculator functionality"""
    
    def setup_method(self):
        """Set up test fixtures before each test method"""
        self.calculator = HalomCalculator()
    
    def test_initialization(self):
        """Test calculator initialization"""
        calc = HalomCalculator()
        assert calc.root_power == 4
        assert calc.min_root_power == 2
        assert calc.max_root_power == 10
        
        # Test custom root power
        calc_custom = HalomCalculator(root_power=3)
        assert calc_custom.root_power == 3
    
    def test_nth_root_basic(self):
        """Test nth root calculations for basic cases"""
        # Test square root (n=2)
        assert abs(self.calculator.nth_root(4, 2) - 2.0) < 1e-6
        assert abs(self.calculator.nth_root(9, 2) - 3.0) < 1e-6
        
        # Test cube root (n=3)
        assert abs(self.calculator.nth_root(8, 3) - 2.0) < 1e-6
        assert abs(self.calculator.nth_root(27, 3) - 3.0) < 1e-6
        
        # Test fourth root (n=4)
        assert abs(self.calculator.nth_root(16, 4) - 2.0) < 1e-6
        assert abs(self.calculator.nth_root(81, 4) - 3.0) < 1e-6
    
    def test_nth_root_edge_cases(self):
        """Test nth root calculations for edge cases"""
        # Test zero
        assert self.calculator.nth_root(0, 4) == 0
        
        # Test one
        assert self.calculator.nth_root(1, 4) == 1
        
        # Test root power of 1
        assert self.calculator.nth_root(5, 1) == 5
    
    def test_fourth_root(self):
        """Test fourth root calculations"""
        # Test perfect fourth powers
        assert abs(self.calculator.fourth_root(16) - 2.0) < 1e-6
        assert abs(self.calculator.fourth_root(81) - 3.0) < 1e-6
        assert abs(self.calculator.fourth_root(256) - 4.0) < 1e-6
        
        # Test non-perfect fourth powers
        assert abs(self.calculator.fourth_root(20) - 2.1147) < 1e-4
        assert abs(self.calculator.fourth_root(100) - 3.1623) < 1e-4
    
    def test_calculate_governance_power(self):
        """Test governance power calculations"""
        # Test with perfect fourth powers
        assert abs(self.calculator.calculate_governance_power(16) - 2.0) < 1e-6
        assert abs(self.calculator.calculate_governance_power(81) - 3.0) < 1e-6
        
        # Test with regular amounts
        assert abs(self.calculator.calculate_governance_power(100) - 3.1623) < 1e-4
        assert abs(self.calculator.calculate_governance_power(1000) - 5.6234) < 1e-4
    
    def test_calculate_reward_share_basic(self):
        """Test reward share calculations with basic scenarios"""
        # Single user scenario
        user_stake = 100
        stakes_single: List[Union[int, float]] = [100]
        share = self.calculator.calculate_reward_share(user_stake, stakes_single)
        assert abs(share - 100.0) < 1e-6
        
        # Two equal users
        user_stake = 100
        stakes_equal: List[Union[int, float]] = [100, 100]
        share = self.calculator.calculate_reward_share(user_stake, stakes_equal)
        assert abs(share - 50.0) < 1e-6
        
        # Two unequal users (100 vs 1000)
        user_stake = 100
        stakes_unequal: List[Union[int, float]] = [100, 1000]
        share = self.calculator.calculate_reward_share(user_stake, stakes_unequal)
        # Should be less than 50% due to fourth root effect
        assert share < 50.0
        assert share > 0.0
    
    def test_calculate_reward_share_edge_cases(self):
        """Test reward share calculations for edge cases"""
        # Empty stakes list
        share = self.calculator.calculate_reward_share(100, [])
        assert share == 0.0
        
        # Zero user stake
        share = self.calculator.calculate_reward_share(0, [100, 200])
        assert share == 0.0
        
        # Zero total stakes
        share = self.calculator.calculate_reward_share(100, [0, 0])
        assert share == 0.0
    
    def test_calculate_expected_reward(self):
        """Test expected reward calculations"""
        user_stake = 100
        stakes_expected: List[Union[int, float]] = [100, 100]
        reward_pool = 1000
        
        expected_reward = self.calculator.calculate_expected_reward(user_stake, stakes_expected, reward_pool)
        # Should be 50% of reward pool due to equal fourth root power
        assert abs(expected_reward - 500.0) < 1e-6
    
    def test_anti_whale_effect(self):
        """Test anti-whale effect calculations"""
        # Test with whale scenario (one large holder, many small holders)
        whale_stake = 10000
        small_stakes: List[Union[int, float]] = [100] * 99  # 99 small holders
        all_stakes: List[Union[int, float]] = [whale_stake] + small_stakes
        
        effect = self.calculator.calculate_anti_whale_effect(all_stakes)
        
        # Verify structure
        assert 'largest_stake' in effect
        assert 'linear_voting_share' in effect
        assert 'fourth_root_voting_share' in effect
        assert 'power_reduction_percentage' in effect
        
        # Verify anti-whale effect (fourth root should reduce whale power)
        assert effect['fourth_root_voting_share'] < effect['linear_voting_share']
        assert effect['power_reduction_percentage'] > 0
    
    def test_anti_whale_effect_empty(self):
        """Test anti-whale effect with empty stakes"""
        effect = self.calculator.calculate_anti_whale_effect([])
        assert effect == {}
    
    def test_optimal_stake_distribution(self):
        """Test optimal stake distribution calculations"""
        total_value = 1000
        num_users = 10
        
        distribution = self.calculator.calculate_optimal_stake_distribution(total_value, num_users)
        
        # Should have correct number of users
        assert len(distribution) == num_users
        
        # Sum should be close to total value (allowing for variation)
        total_distributed = sum(distribution)
        assert abs(total_distributed - total_value) < total_value * 0.1  # Allow 10% variation
        
        # All stakes should be positive
        assert all(stake > 0 for stake in distribution)
    
    def test_optimal_stake_distribution_edge_cases(self):
        """Test optimal stake distribution edge cases"""
        # Zero users
        distribution = self.calculator.calculate_optimal_stake_distribution(1000, 0)
        assert distribution == []
        
        # Single user
        distribution = self.calculator.calculate_optimal_stake_distribution(1000, 1)
        assert len(distribution) == 1
        # Allow for variation in single user case
        assert abs(distribution[0] - 1000) < 100  # Allow 10% variation
    
    def test_compare_voting_systems(self):
        """Test voting system comparison"""
        stakes: List[Union[int, float]] = [100, 200, 500, 1000]
        
        comparison = self.calculator.compare_voting_systems(stakes)
        
        # Verify structure
        assert 'linear' in comparison
        assert 'fourth_root' in comparison
        assert 'sqrt' in comparison
        assert 'cubic' in comparison
        
        # Verify that fourth root reduces concentration
        linear_concentration = comparison['linear']['largest_share']
        fourth_root_concentration = comparison['fourth_root']['largest_share']
        assert fourth_root_concentration < linear_concentration
    
    def test_calculate_governance_efficiency(self):
        """Test governance efficiency calculations"""
        stakes: List[Union[int, float]] = [100, 200, 500, 1000]
        
        efficiency = self.calculator.calculate_governance_efficiency(stakes)
        
        # Verify structure
        assert 'total_stakers' in efficiency
        assert 'total_value' in efficiency
        assert 'average_stake' in efficiency
        assert 'gini_coefficient_linear' in efficiency
        assert 'gini_coefficient_fourth_root' in efficiency
        assert 'inequality_reduction' in efficiency
        assert 'decentralization_score' in efficiency
        
        # Verify reasonable values
        assert efficiency['total_stakers'] == 4
        assert efficiency['total_value'] == 1800
        assert 0 <= efficiency['gini_coefficient_linear'] <= 1
        assert 0 <= efficiency['gini_coefficient_fourth_root'] <= 1
        assert efficiency['decentralization_score'] >= 0


class TestUserStake:
    """Test class for UserStake dataclass"""
    
    def test_user_stake_creation(self):
        """Test UserStake dataclass creation"""
        user_stake = UserStake(
            address="0x1234567890123456789012345678901234567890",
            amount=1000.0,
            lock_time=1640995200,  # 2022-01-01
            lock_duration=365 * 24 * 3600  # 1 year
        )
        
        assert user_stake.address == "0x1234567890123456789012345678901234567890"
        assert user_stake.amount == 1000.0
        assert user_stake.lock_time == 1640995200
        assert user_stake.lock_duration == 365 * 24 * 3600


class TestRewardPool:
    """Test class for RewardPool dataclass"""
    
    def test_reward_pool_creation(self):
        """Test RewardPool dataclass creation"""
        reward_pool = RewardPool(
            total_rewards=10000.0,
            total_staked=50000.0,
            total_fourth_root_stake=1000.0
        )
        
        assert reward_pool.total_rewards == 10000.0
        assert reward_pool.total_staked == 50000.0
        assert reward_pool.total_fourth_root_stake == 1000.0


def test_calculator_math_consistency():
    """Test mathematical consistency of calculator operations"""
    calculator = HalomCalculator()
    
    # Test that fourth root of x^4 equals x
    test_values = [1, 2, 3, 4, 5]
    for x in test_values:
        x_to_fourth = x ** 4
        fourth_root_result = calculator.fourth_root(x_to_fourth)
        assert abs(fourth_root_result - x) < 1e-6
    
    # Test that governance power is consistent with fourth root
    for stake in [100, 1000, 10000]:
        governance_power = calculator.calculate_governance_power(stake)
        fourth_root = calculator.fourth_root(stake)
        assert abs(governance_power - fourth_root) < 1e-6


def test_reward_distribution_consistency():
    """Test that reward distribution sums to 100%"""
    calculator = HalomCalculator()
    stakes: List[Union[int, float]] = [100, 200, 300, 400, 500]
    
    total_share = 0
    for stake in stakes:
        share = calculator.calculate_reward_share(stake, stakes)
        total_share += share
    
    # Total should be 100%
    assert abs(total_share - 100.0) < 1e-6


if __name__ == "__main__":
    pytest.main([__file__]) 
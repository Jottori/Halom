#!/usr/bin/env python3
"""
Halom Protocol Calculator
Fourth Root Based Reward and Governance Power Calculator
"""

import math
from typing import Dict, List, Tuple, Union
from dataclasses import dataclass

@dataclass
class UserStake:
    """User staking data"""
    address: str
    amount: float
    lock_time: int
    lock_duration: int

@dataclass
class RewardPool:
    """Reward pool data"""
    total_rewards: float
    total_staked: float
    total_fourth_root_stake: float

class HalomCalculator:
    """Fourth root based calculator for Halom Protocol"""
    
    def __init__(self, root_power: int = 4):
        """
        Initialize calculator with root power
        
        Args:
            root_power: Root power for calculations (default: 4 = fourth root)
        """
        self.root_power = root_power
        self.min_root_power = 2  # sqrt minimum
        self.max_root_power = 10  # maximum root power
    
    def nth_root(self, x: float, n: int) -> float:
        """
        Calculate nth root using Babylonian method
        
        Args:
            x: Number to find root of
            n: Root power
            
        Returns:
            nth root of x
        """
        if x == 0:
            return 0
        if n == 1:
            return x
        if n == 2:
            return math.sqrt(x)
        
        z = x
        y = (z + n - 1) / n
        
        while y < z:
            z = y
            # Calculate y = ((n-1) * z + x / z^(n-1)) / n
            z_power = z
            for i in range(1, n - 1):
                z_power = z_power * z / 1e18  # Scale to avoid overflow
            y = ((n - 1) * z + x * 1e18 / z_power) / n
        
        return z
    
    def fourth_root(self, x: float) -> float:
        """
        Calculate fourth root
        
        Args:
            x: Number to find fourth root of
            
        Returns:
            Fourth root of x
        """
        return self.nth_root(x, 4)
    
    def calculate_governance_power(self, stake_amount: float) -> float:
        """
        Calculate governance power based on fourth root of stake
        
        Args:
            stake_amount: Amount of tokens staked
            
        Returns:
            Governance power (fourth root of stake)
        """
        return self.fourth_root(stake_amount)
    
    def calculate_reward_share(self, user_stake: float, total_stakes: List[Union[int, float]]) -> float:
        """
        Calculate user's reward share based on fourth root
        
        Args:
            user_stake: User's stake amount
            total_stakes: List of all user stakes
            
        Returns:
            User's reward share as percentage
        """
        if not total_stakes or user_stake == 0:
            return 0.0
        
        user_fourth_root = self.fourth_root(user_stake)
        total_fourth_root = sum(self.fourth_root(float(stake)) for stake in total_stakes)
        
        if total_fourth_root == 0:
            return 0.0
        
        return (user_fourth_root / total_fourth_root) * 100
    
    def calculate_expected_reward(self, user_stake: float, total_stakes: List[Union[int, float]], 
                                reward_pool: float) -> float:
        """
        Calculate expected reward for a user
        
        Args:
            user_stake: User's stake amount
            total_stakes: List of all user stakes
            reward_pool: Total reward pool amount
            
        Returns:
            Expected reward amount
        """
        reward_share = self.calculate_reward_share(user_stake, total_stakes)
        return (reward_share / 100) * reward_pool
    
    def calculate_anti_whale_effect(self, stake_amounts: List[Union[int, float]]) -> Dict[str, float]:
        """
        Calculate anti-whale effect statistics
        
        Args:
            stake_amounts: List of all stake amounts
            
        Returns:
            Dictionary with anti-whale statistics
        """
        if not stake_amounts:
            return {}
        
        # Convert to floats
        float_stakes = [float(amount) for amount in stake_amounts]
        
        # Linear voting (traditional)
        total_linear = sum(float_stakes)
        linear_shares = [(amount / total_linear * 100) if total_linear > 0 else 0 
                        for amount in float_stakes]
        
        # Fourth root voting
        total_fourth_root = sum(self.fourth_root(amount) for amount in float_stakes)
        fourth_root_shares = [(self.fourth_root(amount) / total_fourth_root * 100) 
                             if total_fourth_root > 0 else 0 for amount in float_stakes]
        
        # Calculate reduction in voting power for largest holders
        largest_stake = max(float_stakes)
        largest_linear_share = max(linear_shares)
        largest_fourth_root_share = max(fourth_root_shares)
        
        reduction_percentage = ((largest_linear_share - largest_fourth_root_share) / 
                              largest_linear_share * 100) if largest_linear_share > 0 else 0
        
        return {
            'largest_stake': largest_stake,
            'linear_voting_share': largest_linear_share,
            'fourth_root_voting_share': largest_fourth_root_share,
            'power_reduction_percentage': reduction_percentage,
            'total_stakes': len(float_stakes),
            'total_value': total_linear,
            'total_fourth_root_value': total_fourth_root
        }
    
    def calculate_optimal_stake_distribution(self, total_value: float, 
                                           num_users: int) -> List[float]:
        """
        Calculate optimal stake distribution for maximum decentralization
        
        Args:
            total_value: Total value to distribute
            num_users: Number of users
            
        Returns:
            List of optimal stake amounts
        """
        if num_users <= 0:
            return []
        
        # Equal distribution maximizes decentralization
        equal_stake = total_value / num_users
        
        # Add some variation to simulate real-world distribution
        stakes = []
        for i in range(num_users):
            # Add small random variation (±10%)
            variation = 1 + (i % 3 - 1) * 0.1  # -10%, 0%, +10%
            stake = equal_stake * variation
            stakes.append(max(stake, 0))
        
        return stakes
    
    def compare_voting_systems(self, stake_amounts: List[Union[int, float]]) -> Dict[str, Dict]:
        """
        Compare different voting systems
        
        Args:
            stake_amounts: List of stake amounts
            
        Returns:
            Dictionary comparing different voting systems
        """
        if not stake_amounts:
            return {}
        
        # Convert to floats
        float_stakes = [float(amount) for amount in stake_amounts]
        total_value = sum(float_stakes)
        
        # Linear voting (1:1)
        linear_voting = {
            'system': 'Linear (1:1)',
            'total_voting_power': total_value,
            'largest_share': max(float_stakes) / total_value * 100 if total_value > 0 else 0
        }
        
        # Square root voting (1:2)
        sqrt_voting = {
            'system': 'Square Root (1:2)',
            'total_voting_power': sum(math.sqrt(amount) for amount in float_stakes),
            'largest_share': (math.sqrt(max(float_stakes)) / 
                            sum(math.sqrt(amount) for amount in float_stakes) * 100) 
                            if total_value > 0 else 0
        }
        
        # Fourth root voting (1:4)
        fourth_root_voting = {
            'system': 'Fourth Root (1:4)',
            'total_voting_power': sum(self.fourth_root(amount) for amount in float_stakes),
            'largest_share': (self.fourth_root(max(float_stakes)) / 
                            sum(self.fourth_root(amount) for amount in float_stakes) * 100) 
                            if total_value > 0 else 0
        }
        
        # Cubic root voting (1:3)
        cubic_root_voting = {
            'system': 'Cubic Root (1:3)',
            'total_voting_power': sum(self.nth_root(amount, 3) for amount in float_stakes),
            'largest_share': (self.nth_root(max(float_stakes), 3) / 
                            sum(self.nth_root(amount, 3) for amount in float_stakes) * 100) 
                            if total_value > 0 else 0
        }
        
        return {
            'linear': linear_voting,
            'sqrt': sqrt_voting,
            'cubic': cubic_root_voting,
            'fourth_root': fourth_root_voting
        }
    
    def calculate_governance_efficiency(self, stake_amounts: List[Union[int, float]]) -> Dict[str, float]:
        """
        Calculate governance efficiency metrics
        
        Args:
            stake_amounts: List of stake amounts
            
        Returns:
            Dictionary with efficiency metrics
        """
        if not stake_amounts:
            return {}
        
        # Convert to floats
        float_stakes = [float(amount) for amount in stake_amounts]
        total_value = sum(float_stakes)
        num_stakers = len(float_stakes)
        
        # Gini coefficient for inequality measurement
        sorted_stakes = sorted(float_stakes)
        n = len(sorted_stakes)
        cumsum = 0
        for i, stake in enumerate(sorted_stakes):
            cumsum += (i + 1) * stake
        gini = (2 * cumsum) / (n * total_value) - (n + 1) / n if total_value > 0 else 0
        
        # Fourth root Gini coefficient
        fourth_root_stakes = [self.fourth_root(stake) for stake in float_stakes]
        total_fourth_root = sum(fourth_root_stakes)
        sorted_fourth_root = sorted(fourth_root_stakes)
        cumsum_fourth_root = 0
        for i, stake in enumerate(sorted_fourth_root):
            cumsum_fourth_root += (i + 1) * stake
        gini_fourth_root = (2 * cumsum_fourth_root) / (n * total_fourth_root) - (n + 1) / n if total_fourth_root > 0 else 0
        
        return {
            'total_stakers': num_stakers,
            'total_value': total_value,
            'average_stake': total_value / num_stakers if num_stakers > 0 else 0,
            'gini_coefficient_linear': gini,
            'gini_coefficient_fourth_root': gini_fourth_root,
            'inequality_reduction': (gini - gini_fourth_root) / gini * 100 if gini > 0 else 0,
            'decentralization_score': (1 - gini_fourth_root) * 100
        }

def main():
    """Example usage of the calculator"""
    calculator = HalomCalculator(root_power=4)
    
    # Example stake amounts (in HLM tokens) - converted to floats
    stake_amounts = [
        1000.0,    # Small staker
        5000.0,    # Medium staker
        25000.0,   # Large staker
        100000.0,  # Whale
        500000.0   # Mega whale
    ]
    
    print("=== Halom Protocol Calculator Demo ===\n")
    
    # Calculate governance power for each staker
    print("Governance Power (Fourth Root):")
    for i, stake in enumerate(stake_amounts):
        power = calculator.calculate_governance_power(stake)
        print(f"Staker {i+1} ({stake:,.0f} HLM): {power:.2f} voting power")
    
    print()
    
    # Calculate reward shares
    reward_pool = 10000.0  # 10,000 HLM reward pool
    print(f"Reward Distribution (Pool: {reward_pool:,.0f} HLM):")
    for i, stake in enumerate(stake_amounts):
        share = calculator.calculate_reward_share(stake, stake_amounts)
        reward = calculator.calculate_expected_reward(stake, stake_amounts, reward_pool)
        print(f"Staker {i+1}: {share:.2f}% share = {reward:.2f} HLM")
    
    print()
    
    # Anti-whale effect
    anti_whale = calculator.calculate_anti_whale_effect(stake_amounts)
    print("Anti-Whale Effect:")
    print(f"Largest stake: {anti_whale['largest_stake']:,.0f} HLM")
    print(f"Linear voting share: {anti_whale['linear_voting_share']:.2f}%")
    print(f"Fourth root voting share: {anti_whale['fourth_root_voting_share']:.2f}%")
    print(f"Power reduction: {anti_whale['power_reduction_percentage']:.2f}%")
    
    print()
    
    # Compare voting systems
    voting_systems = calculator.compare_voting_systems(stake_amounts)
    print("Voting System Comparison:")
    for system_name, system_data in voting_systems.items():
        print(f"{system_data['system']}:")
        print(f"  Total voting power: {system_data['total_voting_power']:.2f}")
        print(f"  Largest share: {system_data['largest_share']:.2f}%")
    
    print()
    
    # Governance efficiency
    efficiency = calculator.calculate_governance_efficiency(stake_amounts)
    print("Governance Efficiency:")
    print(f"Total stakers: {efficiency['total_stakers']}")
    print(f"Total value: {efficiency['total_value']:,.0f} HLM")
    print(f"Gini coefficient (linear): {efficiency['gini_coefficient_linear']:.4f}")
    print(f"Gini coefficient (fourth root): {efficiency['gini_coefficient_fourth_root']:.4f}")
    print(f"Inequality reduction: {efficiency['inequality_reduction']:.2f}%")
    print(f"Decentralization score: {efficiency['decentralization_score']:.2f}%")

if __name__ == "__main__":
    main() 
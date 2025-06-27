#!/usr/bin/env python3
"""
Tests for Halom Oracle Index (HOI) Engine
Tests HOI calculations and data assembly functions
"""

import pytest
import pandas as pd
from datetime import datetime
from unittest.mock import patch, MagicMock
from hoi_engine import get_values_for_year, assemble_data_for_hoi, calculate_hoi


class TestGetValuesForYear:
    """Test class for get_values_for_year function"""
    
    def test_get_values_for_year_with_datetime_index(self):
        """Test extracting values for a specific year with DatetimeIndex"""
        # Create a test series with DatetimeIndex
        dates = pd.date_range('2020-01-01', '2023-12-31', freq='M')
        values = [100 + i for i in range(len(dates))]
        series = pd.Series(values, index=dates)
        
        # Test getting value for 2021
        result = get_values_for_year(series, 2021)
        assert result == 112  # Should be the last value for 2021 (December)
        
        # Test getting value for 2020
        result = get_values_for_year(series, 2020)
        assert result == 100  # Should be the first value for 2020 (January)
    
    def test_get_values_for_year_no_data_for_year(self):
        """Test behavior when no data exists for the requested year"""
        # Create a test series with only 2020-2021 data
        dates = pd.date_range('2020-01-01', '2021-12-31', freq='M')
        values = [100 + i for i in range(len(dates))]
        series = pd.Series(values, index=dates)
        
        # Test getting value for 2023 (should fall back to latest)
        result = get_values_for_year(series, 2023)
        assert result == 123  # Should be the last available value (December 2021)
    
    def test_get_values_for_year_empty_series(self):
        """Test behavior with empty series"""
        empty_series = pd.Series(dtype=float)
        result = get_values_for_year(empty_series, 2020)
        assert result is None
    
    def test_get_values_for_year_non_datetime_index(self):
        """Test behavior with non-DatetimeIndex"""
        # Create a series with regular integer index
        series = pd.Series([100, 200, 300], index=[0, 1, 2])
        result = get_values_for_year(series, 2020)
        assert result == 300  # Should return the last value


class TestAssembleDataForHoi:
    """Test class for assemble_data_for_hoi function"""
    
    @patch('hoi_engine.fetch_aic_per_capita')
    @patch('hoi_engine.fetch_housing_cost_overburden')
    @patch('hoi_engine.fetch_real_minimum_wage')
    @patch('hoi_engine.fetch_household_saving_rate')
    @patch('hoi_engine.fetch_gini_index')
    @patch('hoi_engine.fetch_employment_ratio')
    def test_assemble_data_for_hoi_success(self, mock_emp, mock_gini, mock_save, 
                                          mock_wage, mock_housing, mock_aic):
        """Test successful data assembly"""
        # Mock the data fetching functions
        mock_aic.return_value = pd.Series([100, 110, 120], 
                                         index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_housing.return_value = pd.Series([10, 11, 12], 
                                             index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_wage.return_value = pd.Series([1000, 1100, 1200], 
                                          index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_save.return_value = pd.Series([5, 6, 7], 
                                          index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_gini.return_value = pd.Series([30, 31, 32], 
                                          index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_emp.return_value = pd.Series([60, 61, 62], 
                                         index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        
        # Call the function
        result = assemble_data_for_hoi()
        
        # Verify the structure
        expected_keys = [
            'AIC_2020', 'AIC_t', 'MinWage_2020', 'MinWage_t',
            'Hous_2020', 'Hous_t', 'Save_2020', 'Save_t',
            'Gini_2020', 'Gini_t', 'Emp_2020', 'Emp_t'
        ]
        
        for key in expected_keys:
            assert key in result
            assert result[key] is not None
        
        # Verify the values
        assert result['AIC_2020'] == 100
        assert result['AIC_t'] == 120
        assert result['MinWage_2020'] == 1000
        assert result['MinWage_t'] == 1200
    
    @patch('hoi_engine.fetch_aic_per_capita')
    def test_assemble_data_for_hoi_empty_aic(self, mock_aic):
        """Test behavior when AIC data is empty"""
        mock_aic.return_value = pd.Series(dtype=float)
        
        with pytest.raises(ValueError, match="AIC data is empty"):
            assemble_data_for_hoi()
    
    @patch('hoi_engine.fetch_aic_per_capita')
    @patch('hoi_engine.fetch_housing_cost_overburden')
    @patch('hoi_engine.fetch_real_minimum_wage')
    @patch('hoi_engine.fetch_household_saving_rate')
    @patch('hoi_engine.fetch_gini_index')
    @patch('hoi_engine.fetch_employment_ratio')
    def test_assemble_data_for_hoi_missing_data(self, mock_emp, mock_gini, mock_save,
                                               mock_wage, mock_housing, mock_aic):
        """Test behavior when some data is missing"""
        # Mock AIC data (required for year determination)
        mock_aic.return_value = pd.Series([100, 110, 120], 
                                         index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        
        # Mock other data to return None for some values
        mock_housing.return_value = pd.Series([10, None, 12], 
                                             index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_wage.return_value = pd.Series([1000, 1100, 1200], 
                                          index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_save.return_value = pd.Series([5, 6, 7], 
                                          index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_gini.return_value = pd.Series([30, 31, 32], 
                                          index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        mock_emp.return_value = pd.Series([60, 61, 62], 
                                         index=pd.date_range('2020-01-01', '2022-01-01', freq='Y'))
        
        with pytest.raises(ValueError, match="Could not retrieve all necessary data"):
            assemble_data_for_hoi()


class TestCalculateHoi:
    """Test class for calculate_hoi function"""
    
    def test_calculate_hoi_basic(self):
        """Test basic HOI calculation"""
        # Test data with 2020 baseline and current year
        data = {
            'AIC_2020': 100,
            'AIC_t': 110,      # 10% increase
            'MinWage_2020': 1000,
            'MinWage_t': 1050, # 5% increase
            'Hous_2020': 10,
            'Hous_t': 9,       # 10% decrease (improvement)
            'Save_2020': 5,
            'Save_t': 6,       # 20% increase
            'Gini_2020': 30,   # 30%
            'Gini_t': 29,      # 29% (improvement)
            'Emp_2020': 60,
            'Emp_t': 62        # 3.33% increase
        }
        
        hoi = calculate_hoi(data)
        
        # HOI should be a positive number
        assert hoi > 0
        assert isinstance(hoi, float)
    
    def test_calculate_hoi_improvement_scenario(self):
        """Test HOI calculation with improving conditions"""
        # All indicators improving
        data = {
            'AIC_2020': 100,
            'AIC_t': 120,      # 20% increase
            'MinWage_2020': 1000,
            'MinWage_t': 1200, # 20% increase
            'Hous_2020': 15,
            'Hous_t': 10,      # 33% decrease (improvement)
            'Save_2020': 5,
            'Save_t': 8,       # 60% increase
            'Gini_2020': 40,   # 40%
            'Gini_t': 35,      # 35% (improvement)
            'Emp_2020': 60,
            'Emp_t': 65        # 8.33% increase
        }
        
        hoi = calculate_hoi(data)
        
        # HOI should be greater than 1 for improving conditions
        assert hoi > 1.0
    
    def test_calculate_hoi_decline_scenario(self):
        """Test HOI calculation with declining conditions"""
        # All indicators declining
        data = {
            'AIC_2020': 100,
            'AIC_t': 90,       # 10% decrease
            'MinWage_2020': 1000,
            'MinWage_t': 900,  # 10% decrease
            'Hous_2020': 10,
            'Hous_t': 15,      # 50% increase (worsening)
            'Save_2020': 8,
            'Save_t': 5,       # 37.5% decrease
            'Gini_2020': 30,   # 30%
            'Gini_t': 35,      # 35% (worsening)
            'Emp_2020': 65,
            'Emp_t': 60        # 7.69% decrease
        }
        
        hoi = calculate_hoi(data)
        
        # HOI should be less than 1 for declining conditions
        assert hoi < 1.0
    
    def test_calculate_hoi_gini_normalization(self):
        """Test that Gini values are properly normalized"""
        # Test with Gini values > 1 (should be divided by 100)
        data = {
            'AIC_2020': 100,
            'AIC_t': 110,
            'MinWage_2020': 1000,
            'MinWage_t': 1050,
            'Hous_2020': 10,
            'Hous_t': 9,
            'Save_2020': 5,
            'Save_t': 6,
            'Gini_2020': 3000, # 30% as integer
            'Gini_t': 2900,    # 29% as integer
            'Emp_2020': 60,
            'Emp_t': 62
        }
        
        hoi = calculate_hoi(data)
        assert hoi > 0
        assert isinstance(hoi, float)
    
    def test_calculate_hoi_identical_years(self):
        """Test HOI calculation when current year equals baseline"""
        # All values identical (2020 = current year)
        data = {
            'AIC_2020': 100,
            'AIC_t': 100,
            'MinWage_2020': 1000,
            'MinWage_t': 1000,
            'Hous_2020': 10,
            'Hous_t': 10,
            'Save_2020': 5,
            'Save_t': 5,
            'Gini_2020': 30,
            'Gini_t': 30,
            'Emp_2020': 60,
            'Emp_t': 60
        }
        
        hoi = calculate_hoi(data)
        
        # HOI should be close to 1.0 when conditions are identical
        assert abs(hoi - 1.0) < 1e-6


def test_hoi_mathematical_consistency():
    """Test mathematical consistency of HOI calculations"""
    # Test that HOI formula components are calculated correctly
    
    # Test data
    data = {
        'AIC_2020': 100,
        'AIC_t': 110,
        'MinWage_2020': 1000,
        'MinWage_t': 1050,
        'Hous_2020': 10,
        'Hous_t': 9,
        'Save_2020': 5,
        'Save_t': 6,
        'Gini_2020': 30,
        'Gini_t': 29,
        'Emp_2020': 60,
        'Emp_t': 62
    }
    
    # Manual calculation of components
    A_t = data['AIC_t'] / data['AIC_2020']  # 1.1
    M_t = data['MinWage_t'] / data['MinWage_2020']  # 1.05
    E_t = data['Emp_t'] / data['Emp_2020']  # 1.0333...
    H_t = data['Hous_t'] / data['Hous_2020']  # 0.9
    S_t = data['Save_t'] / data['Save_2020']  # 1.2
    G_t = (1 - 0.29) / (1 - 0.30)  # 0.71 / 0.70 = 1.0143...
    
    # Sub-indices
    Y_t = (M_t**0.4) * (E_t**0.3) * (S_t**0.3)
    C_t = (A_t**0.7) * (H_t**0.3)
    Q_t = G_t
    
    # Final HOI
    expected_hoi = (Y_t**0.50) * (C_t**-0.35) * (Q_t**0.15)
    
    # Compare with function result
    actual_hoi = calculate_hoi(data)
    
    # Should be very close
    assert abs(actual_hoi - expected_hoi) < 1e-6


if __name__ == "__main__":
    pytest.main([__file__]) 
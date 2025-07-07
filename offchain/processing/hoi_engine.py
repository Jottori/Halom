import pandas as pd
from datetime import datetime
from typing import cast
from ..collectors.data_collector import (
    fetch_aic_per_capita,
    fetch_housing_cost_overburden,
    fetch_real_minimum_wage,
    fetch_household_saving_rate,
    fetch_gini_index,
    fetch_employment_ratio
)

def get_values_for_year(series: pd.Series, year: int):
    """Extracts the latest available value for a given year from a time series."""
    if not isinstance(series.index, pd.DatetimeIndex):
        print(f"Warning: Series index is not a DatetimeIndex. Cannot filter by year.")
        return series.iloc[-1] if not series.empty else None

    datetime_index = cast(pd.DatetimeIndex, series.index)

    # Filter using the .year attribute, which is more robust for this case
    data_for_year = cast(pd.Series, series[datetime_index.to_series().dt.year == year])
    if not data_for_year.empty:
        return data_for_year.iloc[-1] # Return the last value for that year
    
    # Fallback: if no data for the specific year, return the last known value
    if not series.empty:
        last_date = cast(pd.Timestamp, datetime_index[-1])
        print(f"Warning: No data for year {year} in series. Falling back to latest available: {last_date.year}")
        return series.iloc[-1]
    return None


def assemble_data_for_hoi():
    """Fetches all data and assembles it into a dictionary for HOI calculation."""
    
    aic = fetch_aic_per_capita()
    housing = fetch_housing_cost_overburden()
    min_wage = fetch_real_minimum_wage()
    savings = fetch_household_saving_rate()
    gini = fetch_gini_index()
    employment = fetch_employment_ratio()

    # Use the latest year from the AIC data as the current year for calculation
    if aic.empty:
        raise ValueError("AIC data is empty, cannot determine current year.")
    
    datetime_index = cast(pd.DatetimeIndex, aic.index)
    latest_timestamp = cast(pd.Timestamp, datetime_index.max())
    current_year = latest_timestamp.year
    base_year = 2020

    print(f"Using data for Current Year: {current_year} and Base Year: {base_year}")

    data = {
        'AIC_2020': get_values_for_year(aic, base_year),
        'AIC_t': get_values_for_year(aic, current_year),
        'MinWage_2020': get_values_for_year(min_wage, base_year),
        'MinWage_t': get_values_for_year(min_wage, current_year),
        'Hous_2020': get_values_for_year(housing, base_year),
        'Hous_t': get_values_for_year(housing, current_year),
        'Save_2020': get_values_for_year(savings, base_year),
        'Save_t': get_values_for_year(savings, current_year),
        'Gini_2020': get_values_for_year(gini, base_year),
        'Gini_t': get_values_for_year(gini, current_year),
        'Emp_2020': get_values_for_year(employment, base_year),
        'Emp_t': get_values_for_year(employment, current_year),
    }
    
    # Validate that all data was fetched
    if any(v is None for v in data.values()):
        missing = [k for k, v in data.items() if v is None]
        raise ValueError(f"Could not retrieve all necessary data. Missing: {missing}")

    return data


def calculate_hoi(data: dict):
    """
    Calculates the Halom Oracle Index (HOI) based on input data.
    
    The data dictionary should contain current and 2020 baseline values for:
    - AIC_t, AIC_2020 (Actual Individual Consumption)
    - MinWage_t, MinWage_2020 (Real Minimum Wage)
    - Emp_t, Emp_2020 (Employment-to-population ratio)
    - Hous_t, Hous_2020 (Housing-cost overburden)
    - Save_t, Save_2020 (Household saving rate)
    - Gini_t, Gini_2020 (Gini index)
    """
    
    Gini_t = data['Gini_t'] / 100 if data['Gini_t'] > 1 else data['Gini_t']
    Gini_2020 = data['Gini_2020'] / 100 if data['Gini_2020'] > 1 else data['Gini_2020']

    # 3.1 HOI Normalization (2020 = 1)
    A_t = data['AIC_t'] / data['AIC_2020']
    M_t = data['MinWage_t'] / data['MinWage_2020']
    E_t = data['Emp_t'] / data['Emp_2020']
    H_t = data['Hous_t'] / data['Hous_2020']
    S_t = data['Save_t'] / data['Save_2020']
    G_t = (1 - Gini_t) / (1 - Gini_2020)
    
    # 3.2 Sub-indices and Aggregation
    Y_t = (M_t**0.4) * (E_t**0.3) * (S_t**0.3)
    C_t = (A_t**0.7) * (H_t**0.3)
    Q_t = G_t
    HOI_t = (Y_t**0.50) * (C_t**-0.35) * (Q_t**0.15)
    
    return HOI_t

if __name__ == '__main__':
    try:
        print("Assembling real data for HOI calculation...")
        real_data = assemble_data_for_hoi()
        print("Data assembled successfully:")
        print(real_data)

        hoi_value = calculate_hoi(real_data)
        print(f"\nCalculated HOI from real data: {hoi_value:.4f}")

    except Exception as e:
        print(f"\nAn error occurred during HOI calculation: {e}") 
import pandas as pd
import os
from typing import cast

# Get the directory where this script is located
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

def load_csv_data(filename: str, name: str) -> pd.Series:
    """Generic function to load and parse data from a local CSV file."""
    try:
        filepath = os.path.join(DATA_DIR, filename)
        data = pd.read_csv(
            filepath,
            index_col='TIME_PERIOD',
            parse_dates=True
        )
        print(f"Successfully loaded {name} from {filename}")
        return cast(pd.Series, data['OBS_VALUE'])
    except Exception as e:
        print(f"Could not load {name} from {filename}. Error: {e}")
        return pd.Series(dtype='float64')

def fetch_aic_per_capita() -> pd.Series:
    return load_csv_data("aic_per_capita.csv", "AIC per capita")

def fetch_housing_cost_overburden() -> pd.Series:
    return load_csv_data("housing_cost_overburden.csv", "Housing cost overburden")

def fetch_real_minimum_wage() -> pd.Series:
    return load_csv_data("real_minimum_wage.csv", "Real minimum wage")

def fetch_household_saving_rate() -> pd.Series:
    return load_csv_data("household_saving_rate.csv", "Household saving rate")

def fetch_gini_index() -> pd.Series:
    return load_csv_data("gini_index.csv", "Gini index")

def fetch_employment_ratio() -> pd.Series:
    return load_csv_data("employment_ratio.csv", "Employment ratio")


if __name__ == '__main__':
    print("--- Loading All Halom Oracle Data from Local CSVs ---")
    aic = fetch_aic_per_capita()
    print("AIC:\n", aic.tail(), "\n")
    
    housing_cost = fetch_housing_cost_overburden()
    print("Housing Cost Overburden:\n", housing_cost.tail(), "\n")

    min_wage = fetch_real_minimum_wage()
    print("Real Minimum Wage:\n", min_wage.tail(), "\n")

    savings = fetch_household_saving_rate()
    print("Household Savings Rate:\n", savings.tail(), "\n")

    gini = fetch_gini_index()
    print("Gini Index:\n", gini.tail(), "\n")
    
    employment = fetch_employment_ratio()
    print("Employment Ratio:\n", employment.tail(), "\n") 
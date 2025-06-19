from typing import List, Dict
from dataclasses import dataclass
from enum import Enum
import json

class DataSource(Enum):
    KSH = "ksh"                    # Hungarian Central Statistical Office
    EUROSTAT = "eurostat"          # European Statistical Office
    MNB = "mnb"                    # Hungarian National Bank
    WORLDBANK = "worldbank"        # World Bank
    IMF = "imf"                    # International Monetary Fund
    OECD = "oecd"                  # OECD
    NBP = "nbp"                    # National Bank of Poland (regional comparison)
    CNB = "cnb"                    # Czech National Bank (regional comparison)

class ConsensusStrategy(Enum):
    MEDIAN = "median"              # Use median value
    MEAN = "mean"                  # Use mean value
    WEIGHTED_MEAN = "weighted"     # Use weighted mean based on source reliability
    TRIMMED_MEAN = "trimmed"       # Use trimmed mean (exclude outliers)

@dataclass
class APIConfig:
    endpoint: str
    method: str
    headers: Dict[str, str]
    params: Dict[str, str]
    response_path: str             # JSON path to the inflation data
    weight: float = 1.0           # Source weight for weighted consensus
    timeout: int = 30            # Request timeout in seconds
    retries: int = 3            # Number of retry attempts
    
@dataclass
class ConsensusConfig:
    strategy: ConsensusStrategy
    min_sources: int              # Minimum number of sources needed
    max_deviation: float          # Maximum allowed deviation from consensus
    outlier_threshold: float      # Standard deviations for outlier detection
    weights: Dict[DataSource, float]  # Source weights for weighted mean

@dataclass
class ValidationConfig:
    min_value: float              # Minimum valid inflation rate
    max_value: float              # Maximum valid inflation rate
    max_change: float             # Maximum allowed change between updates
    required_sources: List[DataSource]  # Sources that must be available

@dataclass
class OracleConfig:
    # Data sources configuration
    sources: List[DataSource]
    api_configs: Dict[DataSource, APIConfig]
    
    # Update settings
    update_interval: int
    retry_interval: int           # Interval between retry attempts
    
    # Consensus settings
    consensus: ConsensusConfig
    
    # Validation settings
    validation: ValidationConfig
    
    # Node connection
    substrate_ws_url: str
    
    # Cache settings
    cache_duration: int           # How long to cache values
    historical_size: int          # Number of historical values to keep

# Default configuration
DEFAULT_CONFIG = OracleConfig(
    sources=[
        DataSource.KSH,
        DataSource.EUROSTAT,
        DataSource.MNB,
        DataSource.WORLDBANK,
        DataSource.IMF,
        DataSource.OECD,
        DataSource.NBP,
        DataSource.CNB
    ],
    api_configs={
        DataSource.KSH: APIConfig(
            endpoint="https://api.ksh.hu/v1/statistics",
            method="GET",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            params={
                "indicator": "consumer_price_index",
                "frequency": "monthly"
            },
            response_path="data.latest.value",
            weight=1.5  # Primary source for Hungary
        ),
        DataSource.EUROSTAT: APIConfig(
            endpoint="https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr",
            method="GET",
            headers={
                "Accept": "application/json"
            },
            params={
                "geo": "HU",
                "unit": "RCH_A",
                "lastTimePeriod": "1"
            },
            response_path="value.0.value",
            weight=1.2
        ),
        DataSource.MNB: APIConfig(
            endpoint="https://api.mnb.hu/v1/statistics",
            method="GET",
            headers={
                "Accept": "application/json"
            },
            params={
                "series": "CPI",
                "frequency": "monthly"
            },
            response_path="datasets.0.data.0.value",
            weight=1.3
        ),
        DataSource.WORLDBANK: APIConfig(
            endpoint="https://api.worldbank.org/v2/country/HUN/indicator/FP.CPI.TOTL.ZG",
            method="GET",
            headers={
                "Accept": "application/json"
            },
            params={
                "format": "json",
                "latest": "1"
            },
            response_path="1.0.value",
            weight=1.0
        ),
        DataSource.IMF: APIConfig(
            endpoint="https://www.imf.org/external/datamapper/api/v1/PCPIPCH/HUN",
            method="GET",
            headers={
                "Accept": "application/json"
            },
            params={},
            response_path="values.HUN.0",
            weight=1.0
        ),
        DataSource.OECD: APIConfig(
            endpoint="https://stats.oecd.org/sdmx-json/data/DP_LIVE/HUN.CPI.TOT.GY.M",
            method="GET",
            headers={
                "Accept": "application/json"
            },
            params={
                "lastNObservations": "1"
            },
            response_path="dataSets.0.observations.0.0",
            weight=1.0
        ),
        DataSource.NBP: APIConfig(
            endpoint="https://api.nbp.pl/api/statistics/inflation/current",
            method="GET",
            headers={
                "Accept": "application/json"
            },
            params={},
            response_path="value",
            weight=0.8
        ),
        DataSource.CNB: APIConfig(
            endpoint="https://api.cnb.cz/statistics/inflation/current",
            method="GET",
            headers={
                "Accept": "application/json"
            },
            params={},
            response_path="value",
            weight=0.8
        )
    },
    update_interval=3600,  # 1 hour
    retry_interval=300,    # 5 minutes
    
    consensus=ConsensusConfig(
        strategy=ConsensusStrategy.WEIGHTED_MEAN,
        min_sources=3,
        max_deviation=2.0,  # 2% maximum deviation
        outlier_threshold=2.0,  # 2 standard deviations
        weights={  # Additional weight multipliers for specific scenarios
            DataSource.KSH: 1.5,
            DataSource.MNB: 1.3,
            DataSource.EUROSTAT: 1.2,
            DataSource.WORLDBANK: 1.0,
            DataSource.IMF: 1.0,
            DataSource.OECD: 1.0,
            DataSource.NBP: 0.8,
            DataSource.CNB: 0.8
        }
    ),
    
    validation=ValidationConfig(
        min_value=-10.0,
        max_value=30.0,
        max_change=5.0,  # Maximum 5% change between updates
        required_sources=[DataSource.KSH, DataSource.MNB]  # These must be available
    ),
    
    substrate_ws_url="ws://127.0.0.1:9944",
    cache_duration=86400,  # 24 hours
    historical_size=30     # Keep last 30 values
) 
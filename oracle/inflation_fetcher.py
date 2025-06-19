import aiohttp
import asyncio
import logging
from typing import Optional, List, Dict
from datetime import datetime, timedelta
import json
from jsonpath_ng import parse

from config import OracleConfig, DataSource, APIConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class InflationFetcher:
    def __init__(self, config: OracleConfig):
        self.config = config
        self.historical_values: Dict[DataSource, List[float]] = {
            source: [] for source in config.sources
        }
        self.last_fetch_time: Dict[DataSource, Optional[datetime]] = {
            source: None for source in config.sources
        }
        
    async def fetch_from_source(self, source: DataSource) -> Optional[float]:
        """Fetch inflation data from a specific source"""
        api_config = self.config.api_configs[source]
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.request(
                    method=api_config.method,
                    url=api_config.endpoint,
                    headers=api_config.headers,
                    params=api_config.params
                ) as response:
                    if response.status != 200:
                        logger.error(f"Error fetching from {source.value}: {response.status}")
                        return None
                        
                    data = await response.json()
                    
                    # Extract value using JSONPath
                    jsonpath_expr = parse(api_config.response_path)
                    matches = jsonpath_expr.find(data)
                    
                    if not matches:
                        logger.error(f"No data found at path {api_config.response_path} for {source.value}")
                        return None
                        
                    value = float(matches[0].value)
                    
                    # Validate value
                    if not self.is_valid_inflation_rate(value):
                        logger.error(f"Invalid inflation rate from {source.value}: {value}")
                        return None
                        
                    return value
                    
        except Exception as e:
            logger.error(f"Error fetching from {source.value}: {str(e)}")
            return None
            
    def is_valid_inflation_rate(self, rate: float) -> bool:
        """Check if the inflation rate is within acceptable bounds"""
        return self.config.min_inflation_rate <= rate <= self.config.max_inflation_rate
        
    def update_historical_values(self, source: DataSource, value: float):
        """Update historical values for a source"""
        values = self.historical_values[source]
        values.append(value)
        
        # Keep only the last N values
        if len(values) > self.config.averaging_window:
            values.pop(0)
            
    def calculate_average(self, values: List[float]) -> float:
        """Calculate average of values"""
        return sum(values) / len(values) if values else 0.0
        
    async def fetch_inflation_data(self) -> Optional[float]:
        """Fetch inflation data from all sources and calculate final value"""
        current_time = datetime.now()
        valid_values = []
        
        for source in self.config.sources:
            # Check if we need to update this source
            last_fetch = self.last_fetch_time[source]
            if last_fetch and (current_time - last_fetch).total_seconds() < self.config.update_interval:
                # Use cached value
                if self.historical_values[source]:
                    valid_values.append(self.historical_values[source][-1])
                continue
                
            value = await self.fetch_from_source(source)
            if value is not None:
                self.update_historical_values(source, value)
                self.last_fetch_time[source] = current_time
                valid_values.append(value)
                
        if not valid_values:
            logger.error("No valid inflation data from any source")
            return None
            
        # Calculate final value (average across sources)
        final_value = self.calculate_average(valid_values)
        logger.info(f"Final inflation value: {final_value}%")
        
        return final_value
        
    def get_cached_value(self) -> Optional[float]:
        """Get the most recent valid value from any source"""
        valid_values = []
        
        for source in self.config.sources:
            if self.historical_values[source]:
                valid_values.append(self.historical_values[source][-1])
                
        return self.calculate_average(valid_values) if valid_values else None 
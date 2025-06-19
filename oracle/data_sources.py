from typing import Dict, List, Optional, Tuple
import aiohttp
import asyncio
import statistics
import logging
from datetime import datetime, timedelta
from config import DataSource, APIConfig, ConsensusConfig, ConsensusStrategy

logger = logging.getLogger(__name__)

class DataSourceManager:
    def __init__(self, config: Dict[DataSource, APIConfig], consensus_config: ConsensusConfig):
        self.config = config
        self.consensus_config = consensus_config
        self.cache: Dict[DataSource, Tuple[float, datetime]] = {}
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def fetch_source(self, source: DataSource) -> Optional[float]:
        """Fetch inflation data from a single source with retries and validation."""
        if source not in self.config:
            logger.error(f"No configuration found for source {source}")
            return None
            
        config = self.config[source]
        
        # Check cache
        if source in self.cache:
            value, timestamp = self.cache[source]
            if datetime.now() - timestamp < timedelta(seconds=config.timeout):
                return value
                
        for attempt in range(config.retries):
            try:
                async with self.session.request(
                    config.method,
                    config.endpoint,
                    headers=config.headers,
                    params=config.params,
                    timeout=config.timeout
                ) as response:
                    if response.status != 200:
                        logger.warning(f"Source {source} returned status {response.status}")
                        continue
                        
                    data = await response.json()
                    
                    # Extract value using response path
                    value = self._extract_value(data, config.response_path)
                    
                    if value is not None:
                        # Cache the result
                        self.cache[source] = (value, datetime.now())
                        return value
                        
            except asyncio.TimeoutError:
                logger.warning(f"Timeout while fetching from {source}")
            except Exception as e:
                logger.error(f"Error fetching from {source}: {str(e)}")
                
            if attempt < config.retries - 1:
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
                
        return None
        
    def _extract_value(self, data: dict, path: str) -> Optional[float]:
        """Extract value from nested JSON using dot notation path."""
        try:
            current = data
            for key in path.split('.'):
                if key.isdigit():
                    current = current[int(key)]
                else:
                    current = current[key]
            return float(current)
        except (KeyError, IndexError, ValueError, TypeError) as e:
            logger.error(f"Error extracting value using path {path}: {str(e)}")
            return None
            
    async def fetch_all_sources(self) -> Dict[DataSource, float]:
        """Fetch data from all configured sources concurrently."""
        tasks = []
        for source in self.config.keys():
            tasks.append(self.fetch_source(source))
            
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        return {
            source: result
            for source, result in zip(self.config.keys(), results)
            if isinstance(result, (int, float))
        }
        
    def calculate_consensus(self, values: Dict[DataSource, float]) -> Optional[float]:
        """Calculate consensus value using the configured strategy."""
        if len(values) < self.consensus_config.min_sources:
            logger.warning(f"Not enough sources available. Required: {self.consensus_config.min_sources}, Got: {len(values)}")
            return None
            
        # Get weighted values
        weighted_values = []
        for source, value in values.items():
            weight = self.config[source].weight * self.consensus_config.weights.get(source, 1.0)
            weighted_values.extend([value] * int(weight * 10))  # Multiply by 10 to handle decimal weights
            
        if not weighted_values:
            return None
            
        # Calculate based on strategy
        if self.consensus_config.strategy == ConsensusStrategy.MEDIAN:
            return statistics.median(weighted_values)
            
        elif self.consensus_config.strategy == ConsensusStrategy.MEAN:
            return statistics.mean(weighted_values)
            
        elif self.consensus_config.strategy == ConsensusStrategy.WEIGHTED_MEAN:
            return statistics.mean(weighted_values)
            
        elif self.consensus_config.strategy == ConsensusStrategy.TRIMMED_MEAN:
            # Remove outliers based on standard deviation
            mean = statistics.mean(weighted_values)
            stdev = statistics.stdev(weighted_values) if len(weighted_values) > 1 else 0
            threshold = stdev * self.consensus_config.outlier_threshold
            
            filtered_values = [
                v for v in weighted_values
                if abs(v - mean) <= threshold
            ]
            
            return statistics.mean(filtered_values) if filtered_values else None
            
        logger.error(f"Unknown consensus strategy: {self.consensus_config.strategy}")
        return None
        
    def validate_consensus(self, value: float, previous_value: Optional[float] = None) -> bool:
        """Validate the consensus value against configured thresholds."""
        if not self.consensus_config.min_value <= value <= self.consensus_config.max_value:
            logger.warning(f"Consensus value {value} outside valid range [{self.consensus_config.min_value}, {self.consensus_config.max_value}]")
            return False
            
        if previous_value is not None:
            change = abs(value - previous_value)
            if change > self.consensus_config.max_deviation:
                logger.warning(f"Change in consensus value ({change}) exceeds maximum allowed deviation ({self.consensus_config.max_deviation})")
                return False
                
        return True 
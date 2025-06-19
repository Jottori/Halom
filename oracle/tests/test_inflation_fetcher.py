import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from config import DataSource, APIConfig, ConsensusConfig, ConsensusStrategy
from data_sources import DataSourceManager

@pytest.fixture
def mock_config():
    return {
        DataSource.KSH: APIConfig(
            endpoint="https://api.ksh.hu/test",
            method="GET",
            headers={},
            params={},
            response_path="value",
            weight=1.5
        ),
        DataSource.MNB: APIConfig(
            endpoint="https://api.mnb.hu/test",
            method="GET",
            headers={},
            params={},
            response_path="value",
            weight=1.3
        )
    }

@pytest.fixture
def mock_consensus_config():
    return ConsensusConfig(
        strategy=ConsensusStrategy.WEIGHTED_MEAN,
        min_sources=1,
        max_deviation=2.0,
        outlier_threshold=2.0,
        weights={
            DataSource.KSH: 1.5,
            DataSource.MNB: 1.3
        }
    )

@pytest.fixture
async def data_manager(mock_config, mock_consensus_config):
    manager = DataSourceManager(mock_config, mock_consensus_config)
    manager.session = AsyncMock()
    return manager

@pytest.mark.asyncio
async def test_fetch_source_success(data_manager):
    # Mock successful response
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json.return_value = {"value": 5.2}
    
    data_manager.session.request = AsyncMock(
        return_value=mock_response
    )
    
    value = await data_manager.fetch_source(DataSource.KSH)
    assert value == 5.2
    
    # Check cache
    assert DataSource.KSH in data_manager.cache
    cached_value, timestamp = data_manager.cache[DataSource.KSH]
    assert cached_value == 5.2
    assert isinstance(timestamp, datetime)

@pytest.mark.asyncio
async def test_fetch_source_error(data_manager):
    # Mock error response
    mock_response = AsyncMock()
    mock_response.status = 500
    
    data_manager.session.request = AsyncMock(
        return_value=mock_response
    )
    
    value = await data_manager.fetch_source(DataSource.KSH)
    assert value is None
    assert DataSource.KSH not in data_manager.cache

@pytest.mark.asyncio
async def test_fetch_source_invalid_data(data_manager):
    # Mock invalid data response
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json.return_value = {"wrong_key": "invalid"}
    
    data_manager.session.request = AsyncMock(
        return_value=mock_response
    )
    
    value = await data_manager.fetch_source(DataSource.KSH)
    assert value is None
    assert DataSource.KSH not in data_manager.cache

@pytest.mark.asyncio
async def test_fetch_all_sources(data_manager):
    # Mock responses for both sources
    mock_responses = {
        DataSource.KSH: ({"value": 5.2}, 200),
        DataSource.MNB: ({"value": 5.4}, 200)
    }
    
    async def mock_request(*args, **kwargs):
        url = kwargs.get("url") or args[1]
        source = DataSource.KSH if "ksh" in url else DataSource.MNB
        data, status = mock_responses[source]
        
        response = AsyncMock()
        response.status = status
        response.json.return_value = data
        return response
        
    data_manager.session.request = AsyncMock(side_effect=mock_request)
    
    values = await data_manager.fetch_all_sources()
    assert len(values) == 2
    assert values[DataSource.KSH] == 5.2
    assert values[DataSource.MNB] == 5.4

@pytest.mark.asyncio
async def test_consensus_calculation(data_manager):
    # Test weighted mean consensus
    values = {
        DataSource.KSH: 5.2,
        DataSource.MNB: 5.4
    }
    
    consensus = data_manager.calculate_consensus(values)
    assert consensus is not None
    
    # Expected weighted mean:
    # (5.2 * 1.5 * 1.5 + 5.4 * 1.3 * 1.3) / (1.5 * 1.5 + 1.3 * 1.3)
    expected = (5.2 * 1.5 * 1.5 + 5.4 * 1.3 * 1.3) / (1.5 * 1.5 + 1.3 * 1.3)
    assert abs(consensus - expected) < 0.0001

@pytest.mark.asyncio
async def test_consensus_insufficient_sources(data_manager):
    # Test with empty values
    consensus = data_manager.calculate_consensus({})
    assert consensus is None
    
    # Test with single source when minimum is 2
    data_manager.consensus_config.min_sources = 2
    consensus = data_manager.calculate_consensus({DataSource.KSH: 5.2})
    assert consensus is None

@pytest.mark.asyncio
async def test_consensus_outlier_rejection(data_manager):
    # Test trimmed mean with outlier
    data_manager.consensus_config.strategy = ConsensusStrategy.TRIMMED_MEAN
    values = {
        DataSource.KSH: 5.2,
        DataSource.MNB: 15.0  # Outlier
    }
    
    consensus = data_manager.calculate_consensus(values)
    assert consensus is not None
    assert abs(consensus - 5.2) < 0.0001  # Should reject outlier

@pytest.mark.asyncio
async def test_cache_behavior(data_manager):
    # Mock successful response
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json.return_value = {"value": 5.2}
    
    data_manager.session.request = AsyncMock(
        return_value=mock_response
    )
    
    # First fetch
    value1 = await data_manager.fetch_source(DataSource.KSH)
    assert value1 == 5.2
    
    # Change mock response
    mock_response.json.return_value = {"value": 6.0}
    
    # Second fetch within cache timeout
    value2 = await data_manager.fetch_source(DataSource.KSH)
    assert value2 == 5.2  # Should return cached value
    
    # Expire cache
    data_manager.cache[DataSource.KSH] = (
        data_manager.cache[DataSource.KSH][0],
        datetime.now() - timedelta(hours=1)
    )
    
    # Third fetch after cache expiry
    value3 = await data_manager.fetch_source(DataSource.KSH)
    assert value3 == 6.0  # Should fetch new value 
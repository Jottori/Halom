import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime, timedelta

from ..config import DEFAULT_CONFIG
from ..main import OracleService
from config import DataSource, ConsensusStrategy
from governance import GovernanceManager, OracleCouncil, ProposalType, ProposalStatus
from data_sources import DataSourceManager

@pytest.fixture
def mock_substrate():
    substrate = Mock()
    substrate.compose_call = Mock(return_value=Mock())
    substrate.create_signed_extrinsic = Mock(return_value=Mock())
    substrate.submit_extrinsic = Mock(return_value=Mock(block_hash="0x1234"))
    return substrate

@pytest.fixture
def mock_fetcher():
    fetcher = AsyncMock()
    fetcher.fetch_inflation_data = AsyncMock(return_value=5.2)
    fetcher.get_cached_value = Mock(return_value=5.2)
    return fetcher

@pytest.fixture
def service(mock_substrate, mock_fetcher):
    with patch('substrateinterface.SubstrateInterface', return_value=mock_substrate):
        service = OracleService()
        service.fetcher = mock_fetcher
        return service

@pytest.fixture
def mock_council_members():
    return [
        "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",  # Alice
        "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",  # Bob
        "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y"   # Charlie
    ]

@pytest.fixture
def governance(mock_council_members):
    return GovernanceManager(mock_council_members)

@pytest.mark.asyncio
async def test_update_hoi_success(service, mock_substrate):
    # Test successful HOI update
    await service.update_hoi()
    
    # Check that fetcher was called
    service.fetcher.fetch_inflation_data.assert_called_once()
    
    # Check that substrate calls were made correctly
    mock_substrate.compose_call.assert_called_once_with(
        call_module='HalomOracle',
        call_function='submit_hoi',
        call_params={'value': 520}  # 5.2 * 100
    )
    
    mock_substrate.create_signed_extrinsic.assert_called_once()
    mock_substrate.submit_extrinsic.assert_called_once()

@pytest.mark.asyncio
async def test_update_hoi_fetch_failure(service, mock_substrate):
    # Mock fetch failure but successful cache retrieval
    service.fetcher.fetch_inflation_data.return_value = None
    
    await service.update_hoi()
    
    # Check that cache was used
    service.fetcher.get_cached_value.assert_called_once()
    
    # Check that substrate calls were still made
    mock_substrate.compose_call.assert_called_once()

@pytest.mark.asyncio
async def test_update_hoi_complete_failure(service, mock_substrate):
    # Mock both fetch and cache failure
    service.fetcher.fetch_inflation_data.return_value = None
    service.fetcher.get_cached_value.return_value = None
    
    await service.update_hoi()
    
    # Check that no substrate calls were made
    mock_substrate.compose_call.assert_not_called()
    mock_substrate.create_signed_extrinsic.assert_not_called()
    mock_substrate.submit_extrinsic.assert_not_called()

@pytest.mark.asyncio
async def test_update_hoi_substrate_error(service, mock_substrate):
    # Mock substrate error
    mock_substrate.submit_extrinsic.side_effect = Exception("Substrate error")
    
    await service.update_hoi()
    
    # Check that the error was handled gracefully
    mock_substrate.compose_call.assert_called_once()
    mock_substrate.create_signed_extrinsic.assert_called_once()
    mock_substrate.submit_extrinsic.assert_called_once()

@pytest.mark.asyncio
async def test_run_loop(service):
    # Mock the update_hoi method
    service.update_hoi = AsyncMock()
    
    # Create a task that runs for a short time
    task = asyncio.create_task(service.run())
    
    # Let it run for a bit
    await asyncio.sleep(0.1)
    
    # Cancel the task
    task.cancel()
    
    try:
        await task
    except asyncio.CancelledError:
        pass
    
    # Check that update_hoi was called at least once
    assert service.update_hoi.called 

@pytest.mark.asyncio
async def test_requires_approval(governance):
    # Test value within threshold
    assert await governance.requires_approval(3.0) == False
    
    # Test value exceeding threshold
    assert await governance.requires_approval(7.0) == True

@pytest.mark.asyncio
async def test_create_proposal(governance):
    proposal = governance.council.create_proposal(
        proposal_type=ProposalType.VALUE_UPDATE,
        proposer=governance.council.members[0],
        data={"value": 7.0}
    )
    
    assert proposal.id == 1
    assert proposal.type == ProposalType.VALUE_UPDATE
    assert proposal.status == ProposalStatus.PENDING
    assert proposal.data["value"] == 7.0

@pytest.mark.asyncio
async def test_vote_approval(governance):
    proposal = governance.council.create_proposal(
        proposal_type=ProposalType.VALUE_UPDATE,
        proposer=governance.council.members[0],
        data={"value": 7.0}
    )
    
    # Two members approve
    result1 = governance.council.vote(proposal.id, governance.council.members[0], True)
    assert result1 is None  # Not enough votes yet
    
    result2 = governance.council.vote(proposal.id, governance.council.members[1], True)
    assert result2 is True  # Proposal approved
    
    assert proposal.status == ProposalStatus.APPROVED

@pytest.mark.asyncio
async def test_vote_rejection(governance):
    proposal = governance.council.create_proposal(
        proposal_type=ProposalType.VALUE_UPDATE,
        proposer=governance.council.members[0],
        data={"value": 7.0}
    )
    
    # Two members reject
    result1 = governance.council.vote(proposal.id, governance.council.members[0], False)
    assert result1 is None  # Not enough votes yet
    
    result2 = governance.council.vote(proposal.id, governance.council.members[1], False)
    assert result2 is False  # Proposal rejected
    
    assert proposal.status == ProposalStatus.REJECTED

@pytest.mark.asyncio
async def test_wait_for_approval_timeout(governance):
    # Create proposal
    async def delayed_vote():
        await asyncio.sleep(0.5)  # Delay longer than timeout
        return False
        
    with patch.object(governance, 'wait_for_approval', side_effect=delayed_vote):
        result = await governance.wait_for_approval(7.0, timeout=0.1)
        assert result is False

@pytest.mark.asyncio
async def test_add_data_source(governance):
    source_config = {
        "name": "TEST_SOURCE",
        "endpoint": "https://test.api/inflation",
        "method": "GET",
        "headers": {},
        "params": {},
        "response_path": "value"
    }
    
    # Mock approval
    with patch.object(governance, 'wait_for_approval', return_value=True):
        result = await governance.add_data_source(source_config)
        assert result is True

@pytest.mark.asyncio
async def test_remove_data_source(governance):
    # Mock approval
    with patch.object(governance, 'wait_for_approval', return_value=True):
        result = await governance.remove_data_source("TEST_SOURCE")
        assert result is True

@pytest.mark.asyncio
async def test_update_parameter(governance):
    # Mock approval
    with patch.object(governance, 'wait_for_approval', return_value=True):
        result = await governance.update_parameter(
            "consensus_threshold",
            {"min_sources": 3}
        )
        assert result is True

@pytest.mark.asyncio
async def test_proposal_expiry(governance):
    proposal = governance.council.create_proposal(
        proposal_type=ProposalType.VALUE_UPDATE,
        proposer=governance.council.members[0],
        data={"value": 7.0}
    )
    
    # Set creation time to 8 days ago
    proposal.created_at = datetime.now() - timedelta(days=8)
    
    # Clean up expired proposals
    governance.council.cleanup_expired_proposals()
    
    assert proposal.status == ProposalStatus.EXPIRED

@pytest.mark.asyncio
async def test_invalid_votes(governance):
    proposal = governance.council.create_proposal(
        proposal_type=ProposalType.VALUE_UPDATE,
        proposer=governance.council.members[0],
        data={"value": 7.0}
    )
    
    # Test invalid member
    with pytest.raises(ValueError):
        governance.council.vote(proposal.id, "INVALID_MEMBER", True)
        
    # Test invalid proposal ID
    with pytest.raises(ValueError):
        governance.council.vote(999, governance.council.members[0], True)
        
    # Test voting on resolved proposal
    proposal.status = ProposalStatus.APPROVED
    with pytest.raises(ValueError):
        governance.council.vote(proposal.id, governance.council.members[0], True) 
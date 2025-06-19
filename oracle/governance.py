from typing import List, Optional, Dict
import logging
from substrateinterface import SubstrateInterface
from substrateinterface.exceptions import SubstrateRequestException
import asyncio
from datetime import datetime, timedelta
from enum import Enum

logger = logging.getLogger(__name__)

class ProposalStatus(Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"

class ProposalType(Enum):
    VALUE_UPDATE = "value_update"
    SOURCE_ADD = "source_add"
    SOURCE_REMOVE = "source_remove"
    PARAMETER_UPDATE = "parameter_update"

class Proposal:
    def __init__(self, 
                 id: int,
                 proposal_type: ProposalType,
                 proposer: str,
                 data: Dict,
                 created_at: datetime):
        self.id = id
        self.type = proposal_type
        self.proposer = proposer
        self.data = data
        self.created_at = created_at
        self.votes: Dict[str, bool] = {}  # member_id -> vote (True=approve, False=reject)
        self.status = ProposalStatus.PENDING
        self.resolved_at: Optional[datetime] = None

class OracleCouncil:
    def __init__(self, members: List[str], quorum: int = 2):
        self.members = members
        self.quorum = quorum
        self.proposals: Dict[int, Proposal] = {}
        self.next_proposal_id = 1
        
    def create_proposal(self, 
                       proposal_type: ProposalType,
                       proposer: str,
                       data: Dict) -> Proposal:
        """Create a new proposal."""
        if proposer not in self.members:
            raise ValueError("Only council members can create proposals")
            
        proposal = Proposal(
            id=self.next_proposal_id,
            proposal_type=proposal_type,
            proposer=proposer,
            data=data,
            created_at=datetime.now()
        )
        
        self.proposals[proposal.id] = proposal
        self.next_proposal_id += 1
        
        logger.info(f"Created proposal {proposal.id} of type {proposal_type.value}")
        return proposal
        
    def vote(self, proposal_id: int, member: str, approve: bool) -> bool:
        """Cast a vote on a proposal."""
        if member not in self.members:
            raise ValueError("Only council members can vote")
            
        if proposal_id not in self.proposals:
            raise ValueError("Invalid proposal ID")
            
        proposal = self.proposals[proposal_id]
        
        if proposal.status != ProposalStatus.PENDING:
            raise ValueError("Can only vote on pending proposals")
            
        # Record vote
        proposal.votes[member] = approve
        
        # Check if proposal can be resolved
        approve_count = sum(1 for v in proposal.votes.values() if v)
        reject_count = len(proposal.votes) - approve_count
        
        if approve_count >= self.quorum:
            proposal.status = ProposalStatus.APPROVED
            proposal.resolved_at = datetime.now()
            logger.info(f"Proposal {proposal_id} approved")
            return True
            
        elif reject_count >= self.quorum:
            proposal.status = ProposalStatus.REJECTED
            proposal.resolved_at = datetime.now()
            logger.info(f"Proposal {proposal_id} rejected")
            return False
            
        return None
        
    def get_proposal(self, proposal_id: int) -> Optional[Proposal]:
        """Get a proposal by ID."""
        return self.proposals.get(proposal_id)
        
    def get_pending_proposals(self) -> List[Proposal]:
        """Get all pending proposals."""
        return [p for p in self.proposals.values() if p.status == ProposalStatus.PENDING]
        
    def cleanup_expired_proposals(self, max_age: timedelta = timedelta(days=7)):
        """Mark old pending proposals as expired."""
        now = datetime.now()
        for proposal in self.proposals.values():
            if (proposal.status == ProposalStatus.PENDING and 
                now - proposal.created_at > max_age):
                proposal.status = ProposalStatus.EXPIRED
                proposal.resolved_at = now
                logger.info(f"Proposal {proposal.id} expired")

class GovernanceManager:
    def __init__(self, council_members: List[str] = None):
        if council_members is None:
            council_members = [
                "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",  # Alice
                "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",  # Bob
                "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y"   # Charlie
            ]
            
        self.council = OracleCouncil(council_members)
        self.value_threshold = 5.0  # Require approval for changes > 5%
        
    async def requires_approval(self, new_value: float) -> bool:
        """Check if a value update requires governance approval."""
        # TODO: Implement more sophisticated rules
        return abs(new_value) > self.value_threshold
        
    async def wait_for_approval(self, value: float, timeout: int = 3600) -> bool:
        """Wait for governance approval of a value update."""
        # Create proposal
        proposal = self.council.create_proposal(
            proposal_type=ProposalType.VALUE_UPDATE,
            proposer=self.council.members[0],  # Use first member as proposer
            data={"value": value}
        )
        
        # Wait for resolution
        start_time = datetime.now()
        while (datetime.now() - start_time).total_seconds() < timeout:
            if proposal.status == ProposalStatus.APPROVED:
                return True
            elif proposal.status in [ProposalStatus.REJECTED, ProposalStatus.EXPIRED]:
                return False
                
            await asyncio.sleep(10)  # Check every 10 seconds
            
        # Timeout
        logger.warning(f"Proposal {proposal.id} timed out waiting for approval")
        return False
        
    async def add_data_source(self, source_config: Dict) -> bool:
        """Propose adding a new data source."""
        proposal = self.council.create_proposal(
            proposal_type=ProposalType.SOURCE_ADD,
            proposer=self.council.members[0],
            data=source_config
        )
        
        # TODO: Implement actual source addition logic
        return await self.wait_for_approval(0, timeout=3600)  # Use dummy value
        
    async def remove_data_source(self, source_id: str) -> bool:
        """Propose removing a data source."""
        proposal = self.council.create_proposal(
            proposal_type=ProposalType.SOURCE_REMOVE,
            proposer=self.council.members[0],
            data={"source_id": source_id}
        )
        
        # TODO: Implement actual source removal logic
        return await self.wait_for_approval(0, timeout=3600)  # Use dummy value
        
    async def update_parameter(self, parameter: str, value: any) -> bool:
        """Propose updating a system parameter."""
        proposal = self.council.create_proposal(
            proposal_type=ProposalType.PARAMETER_UPDATE,
            proposer=self.council.members[0],
            data={
                "parameter": parameter,
                "value": value
            }
        )
        
        # TODO: Implement actual parameter update logic
        return await self.wait_for_approval(0, timeout=3600)  # Use dummy value

class OracleGovernance:
    def __init__(self, substrate: SubstrateInterface):
        self.substrate = substrate
        
    async def propose_parameter_update(
        self,
        new_interval: int,
        new_min_sources: int,
        threshold: int = 2  # Default threshold for proposals
    ) -> Optional[str]:
        """
        Create a proposal to update oracle parameters
        Returns the proposal hash if successful
        """
        try:
            # Create the call
            call = self.substrate.compose_call(
                call_module='HalomOracle',
                call_function='update_parameters',
                call_params={
                    'new_interval': new_interval,
                    'new_min_sources': new_min_sources
                }
            )
            
            # Create the proposal
            proposal = self.substrate.compose_call(
                call_module='OracleCouncil',
                call_function='propose',
                call_params={
                    'threshold': threshold,
                    'proposal': call,
                    'length_bound': 1000  # Maximum length of the proposal
                }
            )
            
            # Submit the proposal
            extrinsic = self.substrate.create_signed_extrinsic(
                call=proposal,
                keypair=self.substrate.key_pair
            )
            
            response = self.substrate.submit_extrinsic(
                extrinsic,
                wait_for_inclusion=True
            )
            
            logger.info(f"Parameter update proposal submitted: {response.extrinsic_hash}")
            return response.extrinsic_hash
            
        except SubstrateRequestException as e:
            logger.error(f"Failed to submit parameter update proposal: {e}")
            return None
            
    async def propose_add_source(
        self,
        source: str,
        threshold: int = 2
    ) -> Optional[str]:
        """
        Create a proposal to add a new data source
        Returns the proposal hash if successful
        """
        try:
            # Create the call
            call = self.substrate.compose_call(
                call_module='HalomOracle',
                call_function='add_source',
                call_params={
                    'source': source.encode()
                }
            )
            
            # Create the proposal
            proposal = self.substrate.compose_call(
                call_module='OracleCouncil',
                call_function='propose',
                call_params={
                    'threshold': threshold,
                    'proposal': call,
                    'length_bound': 1000
                }
            )
            
            # Submit the proposal
            extrinsic = self.substrate.create_signed_extrinsic(
                call=proposal,
                keypair=self.substrate.key_pair
            )
            
            response = self.substrate.submit_extrinsic(
                extrinsic,
                wait_for_inclusion=True
            )
            
            logger.info(f"Add source proposal submitted: {response.extrinsic_hash}")
            return response.extrinsic_hash
            
        except SubstrateRequestException as e:
            logger.error(f"Failed to submit add source proposal: {e}")
            return None
            
    async def propose_remove_source(
        self,
        source: str,
        threshold: int = 2
    ) -> Optional[str]:
        """
        Create a proposal to remove a data source
        Returns the proposal hash if successful
        """
        try:
            # Create the call
            call = self.substrate.compose_call(
                call_module='HalomOracle',
                call_function='remove_source',
                call_params={
                    'source': source.encode()
                }
            )
            
            # Create the proposal
            proposal = self.substrate.compose_call(
                call_module='OracleCouncil',
                call_function='propose',
                call_params={
                    'threshold': threshold,
                    'proposal': call,
                    'length_bound': 1000
                }
            )
            
            # Submit the proposal
            extrinsic = self.substrate.create_signed_extrinsic(
                call=proposal,
                keypair=self.substrate.key_pair
            )
            
            response = self.substrate.submit_extrinsic(
                extrinsic,
                wait_for_inclusion=True
            )
            
            logger.info(f"Remove source proposal submitted: {response.extrinsic_hash}")
            return response.extrinsic_hash
            
        except SubstrateRequestException as e:
            logger.error(f"Failed to submit remove source proposal: {e}")
            return None
            
    async def get_proposals(self) -> List[dict]:
        """
        Get all active proposals
        """
        try:
            # Query the OracleCouncil pallet storage
            proposals = self.substrate.query_map(
                module='OracleCouncil',
                storage_function='Proposals',
                params=[]
            )
            
            result = []
            for proposal_hash, proposal_data in proposals:
                result.append({
                    'hash': proposal_hash.value,
                    'threshold': proposal_data['threshold'],
                    'ayes': len(proposal_data['ayes']),
                    'nays': len(proposal_data['nays']),
                    'end': proposal_data['end']
                })
                
            return result
            
        except SubstrateRequestException as e:
            logger.error(f"Failed to fetch proposals: {e}")
            return []
            
    async def vote_on_proposal(
        self,
        proposal_hash: str,
        approve: bool,
        index: int
    ) -> bool:
        """
        Vote on a proposal
        Returns True if the vote was submitted successfully
        """
        try:
            # Create the vote call
            call = self.substrate.compose_call(
                call_module='OracleCouncil',
                call_function='vote',
                call_params={
                    'proposal': proposal_hash,
                    'index': index,
                    'approve': approve
                }
            )
            
            # Submit the vote
            extrinsic = self.substrate.create_signed_extrinsic(
                call=call,
                keypair=self.substrate.key_pair
            )
            
            response = self.substrate.submit_extrinsic(
                extrinsic,
                wait_for_inclusion=True
            )
            
            logger.info(f"Vote submitted: {response.extrinsic_hash}")
            return True
            
        except SubstrateRequestException as e:
            logger.error(f"Failed to submit vote: {e}")
            return False 
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import uvicorn
import os
from dotenv import load_dotenv
import asyncio
import logging
import time
from substrateinterface import SubstrateInterface
from config import DEFAULT_CONFIG, DataSource
from data_sources import DataSourceManager
from metrics import OracleMetrics
from governance import GovernanceManager

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Halom Oracle Service",
    description="Oracle service for the Halom project",
    version="1.0.0"
)

class OracleRequest(BaseModel):
    query_type: str
    parameters: dict
    callback_address: Optional[str] = None

@app.get("/")
async def root():
    return {"status": "healthy", "service": "Halom Oracle"}

@app.post("/oracle/query")
async def process_oracle_query(request: OracleRequest):
    try:
        # Placeholder for oracle query processing
        # TODO: Implement actual oracle logic based on query_type
        return {
            "status": "success",
            "query_type": request.query_type,
            "result": "Placeholder response"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class OracleService:
    def __init__(self):
        self.config = DEFAULT_CONFIG
        self.metrics = OracleMetrics()
        self.governance = GovernanceManager()
        self.last_update: Optional[datetime] = None
        self.last_value: Optional[float] = None
        self.data_manager: Optional[DataSourceManager] = None
        
    async def start(self):
        """Start the Oracle service."""
        logger.info("Starting Oracle service...")
        
        # Initialize metrics
        self.metrics.initialize()
        
        # Start update loop
        while True:
            try:
                await self.update_inflation_rate()
                
            except Exception as e:
                logger.error(f"Error in update loop: {str(e)}")
                self.metrics.record_error("update_loop")
                
            # Wait for next update interval
            await asyncio.sleep(self.config.update_interval)
            
    async def update_inflation_rate(self):
        """Fetch and process inflation data from all sources."""
        logger.info("Updating inflation rate...")
        
        # Skip if too early for next update
        if self.last_update and datetime.now() - self.last_update < timedelta(seconds=self.config.update_interval):
            logger.debug("Skipping update - too early")
            return
            
        async with DataSourceManager(self.config.api_configs, self.config.consensus) as data_manager:
            # Fetch data from all sources
            source_values = await data_manager.fetch_all_sources()
            
            # Record metrics for each source
            for source, value in source_values.items():
                if value is not None:
                    self.metrics.record_source_value(source.value, value)
                    
            # Calculate consensus value
            consensus_value = data_manager.calculate_consensus(source_values)
            
            if consensus_value is None:
                logger.warning("Failed to reach consensus on inflation rate")
                self.metrics.record_error("consensus_failed")
                return
                
            # Validate consensus value
            if not data_manager.validate_consensus(consensus_value, self.last_value):
                logger.warning("Consensus value failed validation")
                self.metrics.record_error("validation_failed")
                return
                
            # Check required sources
            required_sources = set(self.config.validation.required_sources)
            available_sources = set(source_values.keys())
            if not required_sources.issubset(available_sources):
                missing = required_sources - available_sources
                logger.warning(f"Missing required sources: {missing}")
                self.metrics.record_error("missing_required_sources")
                return
                
            # Update state
            self.last_value = consensus_value
            self.last_update = datetime.now()
            
            # Record metrics
            self.metrics.record_consensus_value(consensus_value)
            self.metrics.record_source_count(len(source_values))
            
            logger.info(f"Updated inflation rate: {consensus_value:.2f}%")
            
            # Submit to blockchain
            await self.submit_to_chain(consensus_value)
            
    async def submit_to_chain(self, value: float):
        """Submit the consensus value to the blockchain."""
        try:
            # Check if governance approval is needed
            if await self.governance.requires_approval(value):
                logger.info("Waiting for governance approval...")
                approved = await self.governance.wait_for_approval(value)
                if not approved:
                    logger.warning("Governance rejected the value")
                    self.metrics.record_error("governance_rejected")
                    return
                    
            # TODO: Implement actual blockchain submission
            logger.info(f"Submitting value to blockchain: {value}")
            self.metrics.record_submission_success()
            
        except Exception as e:
            logger.error(f"Error submitting to blockchain: {str(e)}")
            self.metrics.record_error("submission_failed")
            
async def main():
    """Main entry point."""
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Start Oracle service
    service = OracleService()
    await service.start()
    
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
    asyncio.run(main()) 
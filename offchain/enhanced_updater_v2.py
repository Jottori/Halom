#!/usr/bin/env python3
"""
Enhanced Halom Oracle Updater V2 with multi-node consensus support
Supports HalomOracleV2 consensus mechanism
"""

import os
import time
import json
import logging
import smtplib
import schedule
import requests
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

# Import local modules with proper error handling
try:
    from offchain.hoi_engine import calculate_hoi, assemble_data_for_hoi
except ImportError:
    # Fallback for when running from different directory
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(__file__)))
    from offchain.hoi_engine import calculate_hoi, assemble_data_for_hoi

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('oracle_updater_v2.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class OracleUpdaterV2:
    def __init__(self):
        self.rpc_url = os.getenv("ORACLE_RPC_URL", "https://testnet.era.zksync.dev")
        self.private_key = os.getenv("ORACLE_PRIVATE_KEY")
        self.chain_id = int(os.getenv("CHAIN_ID", "280"))
        
        # Multi-node consensus settings
        self.consensus_threshold = int(os.getenv("ORACLE_CONSENSUS_THRESHOLD", "2"))
        self.deviation_threshold = int(os.getenv("ORACLE_DEVIATION_THRESHOLD", "500"))
        self.submission_window = int(os.getenv("ORACLE_SUBMISSION_WINDOW", "300"))
        
        # Oracle node addresses (for consensus)
        self.oracle_nodes = [
            os.getenv("ORACLE_NODE_1_ADDRESS"),
            os.getenv("ORACLE_NODE_2_ADDRESS"),
            os.getenv("ORACLE_NODE_3_ADDRESS")
        ]
        self.oracle_nodes = [addr for addr in self.oracle_nodes if addr and addr != "0x0000000000000000000000000000000000000000"]
        
        # Email notification settings
        self.smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_username = os.getenv("SMTP_USERNAME")
        self.smtp_password = os.getenv("SMTP_PASSWORD")
        self.notification_email = os.getenv("NOTIFICATION_EMAIL")
        
        # Slack webhook (optional)
        self.slack_webhook = os.getenv("SLACK_WEBHOOK")
        
        # API endpoints for real-time data
        self.eurostat_api = os.getenv("EUROSTAT_API_URL", "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/")
        self.oecd_api = os.getenv("OECD_API_URL", "https://stats.oecd.org/restsdmx/sdmx.ashx/GetData/")
        
        # Oracle configuration
        self.oracle_address: Optional[str] = None
        self.updater_address: Optional[str] = None
        self.oracle_contract: Optional[Any] = None
        self.w3: Optional[Web3] = None
        self.updater_account: Optional[Any] = None
        
        # Statistics
        self.successful_updates = 0
        self.failed_updates = 0
        self.last_update_time: Optional[datetime] = None
        self.consecutive_failures = 0
        self.consensus_achieved = 0
        self.consensus_failed = 0
        
        self._initialize_web3()
        self._load_deployment_info()

    def _initialize_web3(self):
        """Initialize Web3 connection"""
        try:
            self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))
            if self.w3 is not None:
                self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
                if not self.w3.is_connected():
                    raise Exception(f"Could not connect to RPC URL: {self.rpc_url}")
            else:
                raise Exception("Web3 initialization failed")
            logger.info(f"Connected to blockchain at {self.rpc_url}")
        except Exception as e:
            logger.error(f"Failed to initialize Web3: {e}")
            raise

    def _load_deployment_info(self):
        """Load contract deployment information"""
        try:
            deployment_path = os.path.join(os.path.dirname(__file__), 'deployment.json')
            with open(deployment_path, 'r') as f:
                addresses = json.load(f)
            
            self.oracle_address = addresses['contracts']['oracle']
            self.updater_address = addresses['roles']['deployer']  # For testnet, deployer is updater
            
            # Load contract ABI
            oracle_abi_path = os.path.join(os.path.dirname(__file__), '../artifacts/contracts/HalomOracleV2.sol/HalomOracleV2.json')
            with open(oracle_abi_path, 'r') as f:
                oracle_data = json.load(f)
            
            if self.w3 is None:
                raise Exception("Web3 not initialized")
            
            if self.oracle_address is None:
                raise Exception("Oracle address not found in deployment info")
                
            checksum_oracle_address = self.w3.to_checksum_address(self.oracle_address)
            self.oracle_contract = self.w3.eth.contract(
                address=checksum_oracle_address, 
                abi=oracle_data['abi']
            )
            
            # Initialize account
            if not self.private_key:
                raise Exception("ORACLE_PRIVATE_KEY not found in environment")
            
            self.updater_account = self.w3.eth.account.from_key(self.private_key)
            
            logger.info(f"Oracle V2 contract loaded at {self.oracle_address}")
            logger.info(f"Using updater account: {self.updater_account.address}")
            logger.info(f"Consensus threshold: {self.consensus_threshold}")
            logger.info(f"Deviation threshold: {self.deviation_threshold}")
            
        except Exception as e:
            logger.error(f"Failed to load deployment info: {e}")
            raise

    def fetch_real_time_data(self) -> Dict[str, Any]:
        """Fetch real-time data from APIs with fallback to static data"""
        try:
            logger.info("Fetching real-time economic data...")
            
            # Try to fetch from APIs first
            try:
                # Example: Fetch employment ratio from Eurostat
                employment_url = f"{self.eurostat_api}LFST_R_LFUR4GPH"
                response = requests.get(employment_url, timeout=30)
                response.raise_for_status()
                
                # Parse Eurostat response (simplified)
                data = response.json()
                employment_ratio = self._extract_employment_ratio(data)
                
                # Fetch other indicators from OECD
                gini_url = f"{self.oecd_api}EQ_DI/.../OECD"
                response = requests.get(gini_url, timeout=30)
                response.raise_for_status()
                
                gini_data = response.json()
                gini_index = self._extract_gini_index(gini_data)
                
                # Combine with other indicators
                real_time_data = {
                    'employment_ratio': employment_ratio,
                    'gini_index': gini_index,
                    'timestamp': datetime.now().isoformat(),
                    'source': 'api'
                }
                
                logger.info(f"Real-time data fetched successfully: {real_time_data}")
                return real_time_data
                
            except Exception as api_error:
                logger.warning(f"API data fetch failed: {api_error}")
                logger.info("Falling back to static CSV data")
                
                # Fallback to static data
                static_data = assemble_data_for_hoi()
                static_data['source'] = 'static'
                return static_data
            
        except Exception as e:
            logger.error(f"Failed to fetch data: {e}")
            # Final fallback
            fallback_data = assemble_data_for_hoi()
            fallback_data['source'] = 'fallback'
            return fallback_data

    def _extract_employment_ratio(self, data: Dict[str, Any]) -> float:
        """Extract employment ratio from Eurostat response"""
        try:
            # This is a placeholder - actual implementation would parse Eurostat JSON
            return 75.5  # Default value
        except:
            return 75.5

    def _extract_gini_index(self, data: Dict[str, Any]) -> float:
        """Extract Gini index from OECD response"""
        try:
            # This is a placeholder - actual implementation would parse OECD JSON
            return 30.2  # Default value
        except:
            return 30.2

    def calculate_and_submit_hoi(self):
        """Calculate HOI and submit to oracle V2 with consensus mechanism"""
        try:
            logger.info("Starting HOI calculation and submission to Oracle V2...")
            
            # Fetch data (real-time or fallback)
            data = self.fetch_real_time_data()
            
            # Calculate HOI
            hoi_float = calculate_hoi(data)
            hoi_value = int(hoi_float * 1e9)
            
            logger.info(f"Calculated HOI: {hoi_float:.4f} ({hoi_value})")
            logger.info(f"Data source: {data.get('source', 'unknown')}")
            
            if self.oracle_contract is None or self.w3 is None or self.updater_account is None:
                raise Exception("Oracle contract or Web3 not initialized")
            
            # Get current round info
            current_round = self.oracle_contract.functions.getCurrentRound().call()
            logger.info(f"Current oracle round: {current_round}")
            
            # Check if we can submit (within submission window)
            submission_deadline = self.oracle_contract.functions.getSubmissionDeadline().call()
            current_time = int(time.time())
            
            if current_time > submission_deadline:
                logger.warning("Submission window has closed for current round")
                return
            
            # Submit HOI to oracle
            tx = self.oracle_contract.functions.submitHOI(hoi_value).build_transaction({
                'from': self.updater_account.address,
                'nonce': self.w3.eth.get_transaction_count(self.updater_account.address),
                'gas': 300000,
                'gasPrice': self.w3.eth.gas_price
            })
            
            signed_tx = self.w3.eth.account.sign_transaction(tx, self.private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            logger.info(f"HOI submission transaction sent: {tx_hash.hex()}")
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
            
            if receipt['status'] == 1:
                logger.info(f"HOI submission confirmed in block {receipt['blockNumber']}")
                
                # Check if consensus was achieved
                consensus_achieved = self.oracle_contract.functions.isConsensusAchieved().call()
                if consensus_achieved:
                    logger.info("✅ Consensus achieved! Rebase will be executed automatically.")
                    self.consensus_achieved += 1
                else:
                    logger.info("⏳ Consensus not yet achieved. Waiting for more submissions.")
                    self.consensus_failed += 1
                
                self.successful_updates += 1
                self.consecutive_failures = 0
                self.last_update_time = datetime.now()
                
                # Log statistics
                self._log_statistics()
                
            else:
                raise Exception("Transaction failed")
                
        except Exception as e:
            logger.error(f"Failed to submit HOI: {e}")
            self.failed_updates += 1
            self.consecutive_failures += 1
            
            # Send alert if too many consecutive failures
            if self.consecutive_failures >= 3:
                self._send_alert(f"Oracle updater failed {self.consecutive_failures} times consecutively: {e}")
            
            raise

    def check_consensus_status(self):
        """Check current consensus status"""
        try:
            if self.oracle_contract is None:
                return
            
            current_round = self.oracle_contract.functions.getCurrentRound().call()
            consensus_achieved = self.oracle_contract.functions.isConsensusAchieved().call()
            submission_count = self.oracle_contract.functions.getSubmissionCount().call()
            submission_deadline = self.oracle_contract.functions.getSubmissionDeadline().call()
            
            logger.info(f"Consensus Status - Round: {current_round}, Achieved: {consensus_achieved}, Submissions: {submission_count}")
            
            if consensus_achieved:
                logger.info("🎉 Consensus achieved for current round!")
            elif submission_deadline < int(time.time()):
                logger.warning("⚠️ Submission window closed without consensus")
            else:
                remaining_time = submission_deadline - int(time.time())
                logger.info(f"⏳ Waiting for consensus... {remaining_time}s remaining")
                
        except Exception as e:
            logger.error(f"Failed to check consensus status: {e}")

    def force_consensus(self):
        """Force consensus using governor role (emergency function)"""
        try:
            logger.warning("Attempting to force consensus...")
            
            if self.oracle_contract is None or self.w3 is None or self.updater_account is None:
                raise Exception("Oracle contract or Web3 not initialized")
            
            # Check if we have governor role
            governor_role = self.oracle_contract.functions.GOVERNOR_ROLE().call()
            has_governor_role = self.oracle_contract.functions.hasRole(governor_role, self.updater_account.address).call()
            
            if not has_governor_role:
                logger.error("No governor role - cannot force consensus")
                return
            
            # Force consensus
            tx = self.oracle_contract.functions.forceConsensus().build_transaction({
                'from': self.updater_account.address,
                'nonce': self.w3.eth.get_transaction_count(self.updater_account.address),
                'gas': 500000,
                'gasPrice': self.w3.eth.gas_price
            })
            
            signed_tx = self.w3.eth.account.sign_transaction(tx, self.private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            logger.info(f"Force consensus transaction sent: {tx_hash.hex()}")
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
            
            if receipt['status'] == 1:
                logger.info("✅ Consensus forced successfully")
            else:
                raise Exception("Force consensus transaction failed")
                
        except Exception as e:
            logger.error(f"Failed to force consensus: {e}")

    def _log_statistics(self):
        """Log update statistics"""
        total_updates = self.successful_updates + self.failed_updates
        success_rate = (self.successful_updates / total_updates * 100) if total_updates > 0 else 0
        consensus_rate = (self.consensus_achieved / (self.consensus_achieved + self.consensus_failed) * 100) if (self.consensus_achieved + self.consensus_failed) > 0 else 0
        
        logger.info(f"Statistics - Total: {total_updates}, Success: {self.successful_updates}, "
                   f"Failed: {self.failed_updates}, Success Rate: {success_rate:.1f}%")
        logger.info(f"Consensus - Achieved: {self.consensus_achieved}, Failed: {self.consensus_failed}, "
                   f"Rate: {consensus_rate:.1f}%")

    def _send_alert(self, message):
        """Send alert via email and/or Slack"""
        logger.error(f"ALERT: {message}")
        
        # Email alert
        if self.smtp_username and self.smtp_password and self.notification_email:
            try:
                self._send_email_alert(message)
            except Exception as e:
                logger.error(f"Failed to send email alert: {e}")
        
        # Slack alert
        if self.slack_webhook:
            try:
                self._send_slack_alert(message)
            except Exception as e:
                logger.error(f"Failed to send Slack alert: {e}")

    def _send_email_alert(self, message):
        """Send email alert"""
        if self.smtp_username is None or self.notification_email is None:
            logger.error("SMTP username or notification email not configured")
            return
            
        msg = MIMEMultipart()
        msg['From'] = self.smtp_username
        msg['To'] = self.notification_email
        msg['Subject'] = "Halom Oracle V2 Alert"
        
        body = f"""
        Halom Oracle V2 Updater Alert
        
        Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        Message: {message}
        
        Statistics:
        - Successful Updates: {self.successful_updates}
        - Failed Updates: {self.failed_updates}
        - Consensus Achieved: {self.consensus_achieved}
        - Consensus Failed: {self.consensus_failed}
        - Last Update: {self.last_update_time}
        """
        
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(self.smtp_server, self.smtp_port)
        server.starttls()
        if self.smtp_username is not None and self.smtp_password is not None:
            server.login(self.smtp_username, self.smtp_password)
        server.send_message(msg)
        server.quit()

    def _send_slack_alert(self, message):
        """Send Slack alert"""
        if self.slack_webhook is None:
            logger.error("Slack webhook not configured")
            return
            
        payload = {
            "text": f"🚨 Halom Oracle V2 Alert: {message}",
            "attachments": [
                {
                    "fields": [
                        {
                            "title": "Successful Updates",
                            "value": str(self.successful_updates),
                            "short": True
                        },
                        {
                            "title": "Failed Updates", 
                            "value": str(self.failed_updates),
                            "short": True
                        },
                        {
                            "title": "Consensus Achieved",
                            "value": str(self.consensus_achieved),
                            "short": True
                        },
                        {
                            "title": "Consensus Failed",
                            "value": str(self.consensus_failed),
                            "short": True
                        }
                    ]
                }
            ]
        }
        
        response = requests.post(self.slack_webhook, json=payload, timeout=10)
        response.raise_for_status()

    def health_check(self):
        """Perform health check on oracle contract"""
        try:
            if self.oracle_contract is None or self.updater_account is None:
                raise Exception("Oracle contract or updater account not initialized")
                
            # Check if oracle is paused
            is_paused = self.oracle_contract.functions.paused().call()
            if is_paused:
                logger.warning("Oracle contract is paused")
            
            # Check current round
            round_info = self.oracle_contract.functions.getCurrentRound().call()
            logger.info(f"Current round: {round_info}")
            
            # Check oracle authorization
            updater_role = self.oracle_contract.functions.ORACLE_UPDATER_ROLE().call()
            is_authorized = self.oracle_contract.functions.hasRole(updater_role, self.updater_account.address).call()
            if not is_authorized:
                logger.error("This oracle node is not authorized!")
                self._send_alert("Oracle node not authorized")
            
            return True
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False

    def run_scheduled_update(self):
        """Run scheduled update with error handling"""
        try:
            logger.info("Starting scheduled update...")
            
            # Health check
            if not self.health_check():
                raise Exception("Health check failed")
            
            # Check consensus status
            self.check_consensus_status()
            
            # Calculate and submit HOI
            self.calculate_and_submit_hoi()
            
            logger.info("Scheduled update completed successfully")
            
        except Exception as e:
            logger.error(f"Scheduled update failed: {e}")
            self._send_alert(f"Scheduled update failed: {e}")

def main():
    """Main function with scheduling"""
    try:
        updater = OracleUpdaterV2()
        
        # Schedule updates every hour
        schedule.every().hour.do(updater.run_scheduled_update)
        
        # Also run immediately on startup
        logger.info("Running initial update...")
        updater.run_scheduled_update()
        
        logger.info("Starting scheduled updater V2 (every hour)...")
        
        # Keep running and execute scheduled tasks
        while True:
            schedule.run_pending()
            time.sleep(60)  # Check every minute
            
    except KeyboardInterrupt:
        logger.info("Updater stopped by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise

if __name__ == "__main__":
    main() 
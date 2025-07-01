#!/usr/bin/env python3
"""
Enhanced Halom Oracle Updater with scheduling, logging, and monitoring
"""

import os
import time
import json
import logging
import smtplib
import schedule
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional
from dotenv import load_dotenv
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
import requests

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
        logging.FileHandler('oracle_updater.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class OracleUpdater:
    def __init__(self):
        self.rpc_url = os.getenv("RPC_URL", "http://localhost:8545")
        self.private_key = os.getenv("PRIVATE_KEY")
        self.chain_id = int(os.getenv("CHAIN_ID", "31337"))
        
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
            
            self.oracle_address = addresses['halomOracle']
            self.updater_address = addresses['roles']['updater']
            
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
                raise Exception("PRIVATE_KEY not found in environment")
            
            self.updater_account = self.w3.eth.account.from_key(self.private_key)
            
            if self.updater_account is not None and self.updater_address is not None:
                if self.updater_account.address.lower() != self.updater_address.lower():
                    logger.warning(f"Private key address ({self.updater_account.address}) doesn't match updater address ({self.updater_address})")
            
            logger.info(f"Oracle contract loaded at {self.oracle_address}")
            if self.updater_account is not None:
                logger.info(f"Using updater account: {self.updater_account.address}")
            
        except Exception as e:
            logger.error(f"Failed to load deployment info: {e}")
            raise

    def fetch_real_time_data(self) -> Dict[str, Any]:
        """Fetch real-time data from APIs instead of static CSV files"""
        try:
            logger.info("Fetching real-time economic data...")
            
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
                'timestamp': datetime.now().isoformat()
            }
            
            logger.info(f"Real-time data fetched: {real_time_data}")
            return real_time_data
            
        except Exception as e:
            logger.error(f"Failed to fetch real-time data: {e}")
            # Fallback to static data
            logger.info("Falling back to static CSV data")
            return assemble_data_for_hoi()

    def _extract_employment_ratio(self, data: Dict[str, Any]) -> float:
        """Extract employment ratio from Eurostat response"""
        # Simplified extraction - in production, parse the actual Eurostat format
        try:
            # This is a placeholder - actual implementation would parse Eurostat JSON
            return 75.5  # Default value
        except:
            return 75.5

    def _extract_gini_index(self, data: Dict[str, Any]) -> float:
        """Extract Gini index from OECD response"""
        # Simplified extraction - in production, parse the actual OECD format
        try:
            # This is a placeholder - actual implementation would parse OECD JSON
            return 30.2  # Default value
        except:
            return 30.2

    def calculate_and_submit_hoi(self):
        """Calculate HOI and submit to oracle"""
        try:
            logger.info("Starting HOI calculation and submission...")
            
            # Fetch data (real-time or fallback)
            data = self.fetch_real_time_data()
            
            # Calculate HOI
            hoi_float = calculate_hoi(data)
            hoi_value = int(hoi_float * 1e9)
            
            logger.info(f"Calculated HOI: {hoi_float:.4f} ({hoi_value})")
            
            if self.oracle_contract is None or self.w3 is None or self.updater_account is None:
                raise Exception("Oracle contract or Web3 not initialized")
            
            # Get current nonce
            current_nonce = self.oracle_contract.functions.nonce().call()
            logger.info(f"Current oracle nonce: {current_nonce}")
            
            # Build and send transaction
            tx = self.oracle_contract.functions.submitHOI(hoi_value).build_transaction({
                'from': self.updater_account.address,
                'nonce': self.w3.eth.get_transaction_count(self.updater_account.address),
                'gas': 300000,
                'gasPrice': self.w3.eth.gas_price
            })
            
            signed_tx = self.w3.eth.account.sign_transaction(tx, self.private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            logger.info(f"Transaction sent: {tx_hash.hex()}")
            
            # Wait for confirmation
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
            
            if receipt['status'] == 1:
                logger.info(f"Transaction confirmed in block {receipt['blockNumber']}")
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

    def _log_statistics(self):
        """Log update statistics"""
        total_updates = self.successful_updates + self.failed_updates
        success_rate = (self.successful_updates / total_updates * 100) if total_updates > 0 else 0
        
        logger.info(f"Statistics - Total: {total_updates}, Success: {self.successful_updates}, "
                   f"Failed: {self.failed_updates}, Success Rate: {success_rate:.1f}%")

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
        msg['Subject'] = "Halom Oracle Alert"
        
        body = f"""
        Halom Oracle Updater Alert
        
        Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        Message: {message}
        
        Statistics:
        - Successful Updates: {self.successful_updates}
        - Failed Updates: {self.failed_updates}
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
            "text": f"🚨 Halom Oracle Alert: {message}",
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
            is_authorized = self.oracle_contract.functions.authorizedOracles(self.updater_account.address).call()
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
            
            # Calculate and submit HOI
            self.calculate_and_submit_hoi()
            
            logger.info("Scheduled update completed successfully")
            
        except Exception as e:
            logger.error(f"Scheduled update failed: {e}")
            self._send_alert(f"Scheduled update failed: {e}")

def main():
    """Main function with scheduling"""
    try:
        updater = OracleUpdater()
        
        # Schedule updates every hour
        schedule.every().hour.do(updater.run_scheduled_update)
        
        # Also run immediately on startup
        logger.info("Running initial update...")
        updater.run_scheduled_update()
        
        logger.info("Starting scheduled updater (every hour)...")
        
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
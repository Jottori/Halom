import os
import time
import json
from dotenv import load_dotenv
from web3 import Web3
# Try to import geth_poa_middleware, fallback if not available
try:
    from web3.middleware.geth_poa import geth_poa_middleware  # type: ignore
except ImportError:
    geth_poa_middleware = None

from .hoi_engine import calculate_hoi, assemble_data_for_hoi

# Load environment variables from .env file
load_dotenv()

def get_contract_abi(file_path):
    """Loads a contract ABI from its JSON artifact."""
    with open(file_path, 'r') as f:
        data = json.load(f)
    return data['abi']

def main():
    # --- 1. Configuration ---
    RPC_URL = os.getenv("RPC_URL", "http://localhost:8545")
    PRIVATE_KEY = os.getenv("PRIVATE_KEY")

    deployment_path = os.path.join(os.path.dirname(__file__), 'deployment.json')
    try:
        with open(deployment_path, 'r') as f:
            addresses = json.load(f)
        ORACLE_ADDRESS = addresses['halomOracle']
        UPDATER_ADDRESS = addresses['roles']['updater']
    except (FileNotFoundError, KeyError) as e:
        print(f"Error: Could not read deployment data from {deployment_path}. Please deploy contracts first. Details: {e}")
        return

    # In a real environment, the updater key would be in a secure keystore.
    # For local dev, we check if the deployer's key matches the updater role from deployment.json
    if not PRIVATE_KEY:
        print("Error: PRIVATE_KEY not found in .env file.")
        return

    # --- 2. Connect to the network and load contract ---
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    # Only inject geth_poa_middleware if it's available
    if geth_poa_middleware is not None:
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    
    if not w3.is_connected():
        print(f"Error: Could not connect to the RPC URL at {RPC_URL}.")
        return

    updater_account = w3.eth.account.from_key(PRIVATE_KEY)
    if updater_account.address.lower() != UPDATER_ADDRESS.lower():
        print(f"Warning: The private key in .env ({updater_account.address}) does not match the UPDATER_ROLE address in deployment.json ({UPDATER_ADDRESS}).")

    print(f"Using updater account: {updater_account.address}")

    oracle_abi_path = os.path.join(os.path.dirname(__file__), '../artifacts/contracts/HalomOracle.sol/HalomOracle.json')
    oracle_abi = get_contract_abi(oracle_abi_path)
    checksum_oracle_address = w3.to_checksum_address(ORACLE_ADDRESS)
    oracle_contract = w3.eth.contract(address=checksum_oracle_address, abi=oracle_abi)

    # --- 3. Calculate HOI ---
    print("\nCalculating latest HOI value...")
    try:
        data = assemble_data_for_hoi()
        hoi_float = calculate_hoi(data)
    except Exception as e:
        print(f"Error calculating HOI: {e}")
        return

    hoi_value = int(hoi_float * 1e9)
    print(f"-> Calculated HOI (float): {hoi_float:.4f}")
    print(f"-> Calculated HOI (uint256): {hoi_value}")

    # --- 4. Fetch nonce and send transaction ---
    print("Fetching current nonce from oracle...")
    try:
        current_nonce = oracle_contract.functions.nonce().call()
        print(f"-> Current nonce: {current_nonce}")

        print("Building and sending transaction to setHOI...")
        tx = oracle_contract.functions.setHOI(hoi_value, current_nonce).build_transaction({
            'from': updater_account.address,
            'nonce': w3.eth.get_transaction_count(updater_account.address),
            'gas': 200000, # Estimated gas
            'gasPrice': w3.eth.gas_price
        })
        
        signed_tx = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
        
        print(f"-> Transaction sent! Hash: {tx_hash.hex()}")
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        print("-> Transaction confirmed in block:", receipt['blockNumber'])

    except Exception as e:
        print(f"\nAn error occurred during transaction: {e}")
        return

if __name__ == "__main__":
    while True:
        main()
        print("\nUpdater finished. Waiting for 60 seconds...")
        time.sleep(60) 
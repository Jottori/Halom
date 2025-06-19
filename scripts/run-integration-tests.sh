#!/bin/bash

# Hibakezelés beállítása
set -e

# Környezeti változók beállítása
export TEST_ORACLE_URL="http://localhost:8000"
export TEST_NODE_URL="http://localhost:9933"
export TEST_IPFS_URL="http://localhost:5001"

echo "Integrációs tesztek futtatása..."

# Oracle tesztek
echo "Oracle tesztek futtatása..."
cd oracle/tests
python -m pytest test_integration.py -v

# Node tesztek
echo "Node tesztek futtatása..."
cd ../../node
cargo test --test '*_integration' -- --test-threads=1

# Teljes rendszer tesztek
echo "Teljes rendszer tesztek futtatása..."
cd ../tests
python -m pytest test_system.py -v

# Licenc rendszer tesztek
echo "Licenc rendszer tesztek futtatása..."
cd ../node/pallets/pow_rewards/tests
cargo test --test '*_integration' -- --test-threads=1

# Oracle konszenzus tesztek
echo "Oracle konszenzus tesztek futtatása..."
cd ../../../../oracle/tests
python -m pytest test_consensus_integration.py -v

echo "Minden integrációs teszt sikeresen lefutott!" 
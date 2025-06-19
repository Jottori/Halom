#!/bin/bash

# Hibakezelés beállítása
set -e

# Környezeti változók beállítása
export TEST_DURATION=300  # 5 perc
export TEST_CONCURRENT_USERS=50
export TEST_ORACLE_URL="http://localhost:8000"
export TEST_NODE_URL="http://localhost:9933"

echo "Teljesítmény tesztek futtatása..."

# Oracle teljesítmény tesztek
echo "Oracle teljesítmény tesztek futtatása..."
cd oracle/tests
locust -f performance_test.py --headless -u $TEST_CONCURRENT_USERS -t ${TEST_DURATION}s --host $TEST_ORACLE_URL

# Node teljesítmény tesztek
echo "Node teljesítmény tesztek futtatása..."
cd ../../node/tests
cargo run --release --bin performance_test -- \
    --duration $TEST_DURATION \
    --concurrent-users $TEST_CONCURRENT_USERS \
    --node-url $TEST_NODE_URL

# Metrikák ellenőrzése
echo "Prometheus metrikák ellenőrzése..."
curl -s "http://localhost:9090/api/v1/query?query=rate(oracle_keres_ido_masodperc_sum[5m])" | jq .

# Eredmények összesítése
echo "Teljesítmény teszt eredmények összesítése..."
python ../scripts/analyze_performance.py \
    --oracle-results oracle/tests/locust_results.csv \
    --node-results node/tests/performance_results.json \
    --output performance_report.html

echo "Teljesítmény tesztek sikeresen lefutottak!" 
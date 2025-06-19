#!/bin/bash

# Maximális várakozási idő másodpercben
MAX_WAIT=300
WAIT_INTERVAL=5

# Oracle szolgáltatás elérhetőségének ellenőrzése
check_oracle() {
    curl -s http://localhost:8000/health > /dev/null
    return $?
}

# Node szolgáltatás elérhetőségének ellenőrzése
check_node() {
    curl -s http://localhost:9933 > /dev/null
    return $?
}

# IPFS szolgáltatás elérhetőségének ellenőrzése
check_ipfs() {
    curl -s http://localhost:5001/api/v0/version > /dev/null
    return $?
}

echo "Várakozás a szolgáltatások elindulására..."

ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if check_oracle && check_node && check_ipfs; then
        echo "Minden szolgáltatás elérhető!"
        exit 0
    fi
    
    echo "Még nem minden szolgáltatás érhető el, várakozás ${WAIT_INTERVAL} másodpercet..."
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))
done

echo "Időtúllépés: nem minden szolgáltatás indult el ${MAX_WAIT} másodpercen belül"
exit 1 
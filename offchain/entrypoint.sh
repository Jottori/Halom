#!/bin/sh
set -e

REQUIRED_VARS="PRIVATE_KEY NETWORK"
MISSING=0

for VAR in $REQUIRED_VARS; do
  if [ -z "$(eval echo \$$VAR)" ]; then
    echo "[ERROR] Required environment variable $VAR is not set!"
    MISSING=1
  fi
done

# Check at least one API key is set
if [ -z "$INFURA_API_KEY" ] && [ -z "$ALCHEMY_API_KEY" ] && [ -z "$DATA_SOURCE_API_KEY" ]; then
  echo "[ERROR] At least one API key (INFURA_API_KEY, ALCHEMY_API_KEY, DATA_SOURCE_API_KEY) must be set!"
  MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
  echo "[FATAL] Missing required environment variables. Exiting."
  exit 1
fi

exec "$@" 
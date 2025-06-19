# Halom Node

A Substrate-based blockchain node implementing the Halom Oracle Index (HOI) and inflation-adjusted mining rewards.

## Features

- Custom Oracle pallet for fetching and maintaining the Halom Oracle Index (HOI)
- Inflation-adjusted PoW mining rewards
- VPS license system with boosted rewards
- Supply cap enforcement
- Off-chain worker for external data integration

## Architecture

### Pallets

1. `pallet-halom-oracle`
   - Implements off-chain worker for fetching inflation data
   - Maintains the HOI (Halom Oracle Index)
   - Provides interface for other pallets to access inflation data

2. `pallet-pow-rewards`
   - Handles mining rewards distribution
   - Implements inflation adjustment based on HOI
   - Manages VPS license system and boosted rewards
   - Enforces maximum supply cap

## Development Setup

### Prerequisites

- Rust and Cargo
- Substrate development environment
- Docker and Docker Compose (for local testing)

### Building

```bash
# Build the node
cargo build --release

# Run tests
cargo test --all

# Run the node
./target/release/halom-node --dev
```

### Docker Support

Build and run using Docker:

```bash
# Build the Docker image
docker build -t halom-node .

# Run the node
docker run -p 30333:30333 -p 9933:9933 -p 9944:9944 halom-node
```

Or use Docker Compose for a complete development environment:

```bash
docker-compose up
```

## Configuration

Key configuration parameters in the runtime:

- `OracleUpdateInterval`: How often the HOI should be updated
- `BaseReward`: Base block reward before inflation adjustment
- `LicenseBoostFactor`: Reward multiplier for licensed miners
- `MaxSupply`: Maximum total supply of HOM tokens

## License System

The VPS license system is implemented in the `pallet-pow-rewards` module:

- Licenses are managed through the `set_license_status` extrinsic
- Licensed miners receive boosted rewards (configurable multiplier)
- License status is checked during reward calculation

## HOI Integration

The Halom Oracle Index (HOI) affects mining rewards:

1. Off-chain worker fetches inflation data
2. HOI is updated through the oracle pallet
3. Mining rewards are adjusted based on current HOI
4. Supply cap is enforced during reward issuance

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT License 
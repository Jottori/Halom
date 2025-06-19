# Halom Oracle Service

The Oracle service component of the Halom project, responsible for fetching and validating external data for the blockchain.

## Features

- RESTful API using FastAPI
- Modular query processing
- Blockchain callback support

## Local Development

### Prerequisites

- Python 3.11+
- pip

### Setup

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file:
```
PORT=8000
```

### Running the Service

```bash
python main.py
```

The API will be available at `http://localhost:8000`

### API Documentation

Once running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Docker

Build the image:
```bash
docker build -t halom-oracle .
```

Run the container:
```bash
docker run -p 8000:8000 halom-oracle
```

# Halom Whitepaper

## Abstract
Halom (HOM) introduces a revolutionary approach to cryptocurrency economics by creating the first truly inflation-hedged digital asset. By leveraging advanced oracle networks and dynamic tokenomics, HOM maintains its purchasing power while preserving the core principles of decentralization.

## 1. Introduction
### 1.1 Background
The cryptocurrency market, despite its innovation in digital scarcity, has failed to address one of the fundamental challenges of modern economics: inflation. While Bitcoin's fixed supply model created digital gold, it doesn't provide a solution for maintaining consistent purchasing power in an inflationary environment.

### 1.2 The Inflation Challenge
In 2023, global inflation averaged X%, highlighting the need for digital assets that can adapt to macroeconomic conditions. Traditional cryptocurrencies, with their fixed supply models, often experience deflationary pressure that makes them unsuitable as everyday stores of value.

## 2. The Halom Solution
### 2.1 Core Innovation
Halom introduces a unique synthesis of blockchain technology and economic principles:
- Dynamic block rewards adjusted by real-world inflation data
- License-based mining optimization
- Decentralized oracle network for reliable price feeds
- Maximum supply cap of 100M HOM

### 2.2 Technical Architecture
[Architecture Diagram]
The Halom network consists of three core components:
1. Substrate-based blockchain
2. Decentralized oracle network
3. IPFS data storage

## 3. Economic Model
### 3.1 Token Supply Dynamics
[Supply Growth Formula]
R(t) = R₀ * (1 + i(t))
Where:
- R(t) is the block reward at time t
- R₀ is the base block reward
- i(t) is the inflation rate at time t

### 3.2 License System
The innovative license NFT system creates a balanced incentive structure:
- Standard License: 5,000 HOM (20% bonus)
- Premium License: 25,000 HOM (35% bonus)
- Enterprise License: 100,000 HOM (50% bonus)

## 4. Market Analysis
### 4.1 Target Market
[Market Size Chart]
Primary segments:
1. Institutional investors seeking inflation hedges
2. Retail users in high-inflation economies
3. Mining operations looking for sustainable rewards

### 4.2 Competitive Landscape
[Comparison Matrix]
Analysis of existing solutions:
- Fixed-supply cryptocurrencies (Bitcoin, Litecoin)
- Stablecoins (USDT, USDC)
- Inflation-indexed products (Frax Price Index)

## 5. Technical Implementation
### 5.1 Oracle Network
The decentralized oracle network ensures reliable inflation data:
- Multiple independent data sources
- Consensus-based validation
- Automatic outlier detection

### 5.2 Mining Mechanism
[Mining Flowchart]
- PoW consensus with dynamic difficulty
- License-based reward optimization
- Treasury fee collection and distribution

## 6. Roadmap and Vision
### 6.1 Development Phases
[Timeline]
- Phase 1: Network Launch
- Phase 2: Exchange Integration
- Phase 3: Cross-chain Expansion

### 6.2 Future Development
Long-term objectives:
- Global adoption in high-inflation markets
- Integration with DeFi protocols
- Advanced governance mechanisms

## 7. Conclusion
Halom represents a fundamental innovation in cryptocurrency economics, offering a solution to the inflation challenge while maintaining the principles of decentralization and security. 
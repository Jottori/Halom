# Halom Protocol File Structure Guide

## Overview

This document defines the file structure and naming conventions for the Halom Protocol project, following the principles outlined by the [MIT Communication Lab](https://mitcommlab.mit.edu/broad/commkit/file-structure/).

## Core Principles

### 1. Separation of Concerns
Each folder contains files with similar functionality or purposes, making it easier to navigate and maintain the codebase.

### 2. Descriptive Naming
File and folder names should be descriptive and avoid ambiguity, using consistent delimiters and avoiding spaces.

### 3. Logical Hierarchy
The structure follows a logical hierarchy where the most important distinguishing factors are placed first in the path.

## File Structure

```
Halom/
├── contracts/                    # Smart contract source code
│   ├── core/                     # Core protocol contracts
│   │   ├── HalomToken.sol        # Main token contract
│   │   ├── HalomTreasury.sol     # Treasury management
│   │   └── __init__.py           # Python module initialization
│   ├── governance/               # Governance-related contracts
│   │   ├── HalomGovernor.sol     # Governance contract
│   │   ├── HalomTimelock.sol     # Timelock mechanism
│   │   └── __init__.py           # Python module initialization
│   ├── oracle/                   # Oracle contracts
│   │   ├── HalomOracle.sol       # Oracle v1
│   │   ├── HalomOracleV2.sol     # Oracle v2 (latest)
│   │   └── __init__.py           # Python module initialization
│   ├── staking/                  # Staking contracts
│   │   ├── HalomStaking.sol      # Main staking contract
│   │   ├── HalomLPStaking.sol    # LP staking contract
│   │   └── __init__.py           # Python module initialization
│   ├── access/                   # Access control contracts
│   │   ├── HalomSafeHarbor.sol   # Safe Harbor mechanism
│   │   └── __init__.py           # Python module initialization
│   ├── interfaces/               # Contract interfaces
│   │   └── __init__.py           # Python module initialization
│   └── __init__.py               # Main contracts module
│
├── scripts/                      # Deployment and maintenance scripts
│   ├── deployment/               # Contract deployment scripts
│   │   ├── deploy.js             # Main deployment script
│   │   └── __init__.py           # Python module initialization
│   ├── governance/               # Governance-related scripts
│   │   ├── deploy_governance.js  # Governance deployment
│   │   └── __init__.py           # Python module initialization
│   ├── oracle/                   # Oracle management scripts
│   │   └── __init__.py           # Python module initialization
│   ├── bridge/                   # Bridge-related scripts
│   │   └── __init__.py           # Python module initialization
│   ├── maintenance/              # Maintenance and setup scripts
│   │   ├── setup_mainnet_staking.js
│   │   └── __init__.py           # Python module initialization
│   └── __init__.py               # Main scripts module
│
├── test/                         # Test files
│   ├── test-token.js             # Token contract tests
│   ├── test-staking.js           # Staking contract tests
│   ├── test-oracle.js            # Oracle contract tests
│   ├── test-lp-staking.js        # LP staking tests
│   ├── security-audit-tests.js   # Security audit tests
│   └── __init__.py               # Python module initialization
│
├── offchain/                     # Off-chain data processing
│   ├── data/                     # Data files
│   │   ├── aic_per_capita.csv
│   │   ├── employment_ratio.csv
│   │   ├── gini_index.csv
│   │   ├── household_saving_rate.csv
│   │   ├── housing_cost_overburden.csv
│   │   ├── real_minimum_wage.csv
│   │   └── __init__.py           # Data module initialization
│   ├── data_collector.py         # Data collection scripts
│   ├── enhanced_updater.py       # Enhanced update mechanisms
│   ├── fetcher.py                # Data fetching utilities
│   ├── updater.py                # Data update scripts
│   ├── hoi_engine.py             # HOI calculation engine
│   ├── cron_setup.sh             # Cron job setup
│   ├── entrypoint.sh             # Docker entrypoint
│   └── __init__.py               # Python module initialization
│
├── offchain-scripts/             # Additional off-chain scripts
│   ├── tokenomics_simulator.py   # Tokenomics simulation
│   └── __init__.py               # Python module initialization
│
├── monitoring/                   # Monitoring and alerting
│   ├── prometheus/               # Prometheus configuration
│   │   ├── prometheus.yml        # Main Prometheus config
│   │   └── alert_rules.yml       # Alert rules
│   ├── grafana/                  # Grafana dashboards
│   │   └── dashboards/
│   │       └── halom-protocol-dashboard.json
│   ├── alertmanager/             # AlertManager configuration
│   │   └── alertmanager.yml      # Alert routing config
│   └── sla-sli-definitions.md    # SLA/SLI definitions
│
├── security/                     # Security-related files
│   └── threat-modeling/          # Threat modeling documents
│       ├── STRIDE-analysis.md    # STRIDE threat analysis
│       └── risk-matrix.md        # Risk assessment matrix
│
├── bounty/                       # Bug bounty program
│   └── bug-bounty-program.md     # Immunefi program details
│
├── docs/                         # Documentation
│   ├── deploy.md                 # Deployment guide
│   ├── offchain.md               # Off-chain documentation
│   ├── workflows.md              # Workflow documentation
│   ├── SECURITY_ANALYSIS.md      # Security analysis
│   ├── tokenomics-stress-testing.md # Tokenomics testing
│   └── file_structure_guide.md   # This file
│
├── audit/                        # Audit reports
│   └── audit-reports/            # Security audit reports
│
├── tokenomics_analysis/          # Tokenomics analysis
│   ├── monte_carlo_distribution.png
│   ├── risk_heatmap.png
│   └── sensitivity_analysis.png
│
├── .github/                      # GitHub-specific files
│   ├── workflows/                # GitHub Actions workflows
│   │   └── security-analysis.yml # Security analysis pipeline
│   └── scripts/                  # CI/CD scripts
│       ├── __init__.py           # Python module initialization
│       ├── security-comment.js   # Security comment posting
│       ├── fuzzing_tests.py      # Fuzzing test script
│       ├── manticore_analysis.py # Manticore analysis
│       ├── mythx_analysis.py     # MythX analysis
│       ├── coverage_report.py    # Coverage reporting
│       └── security_summary.py   # Security summary
│
├── .devcontainer/                # Development container config
├── deployments/                  # Deployment artifacts
├── cache/                        # Build cache
├── node_modules/                 # Node.js dependencies
├── .venv/                        # Python virtual environment
│
├── README.md                     # Main project documentation
├── README_GOVERNANCE.md          # Governance documentation
├── IMPLEMENTATION_SUMMARY.md     # Implementation summary
├── LICENSE                       # Project license
├── package.json                  # Node.js dependencies
├── package-lock.json             # Locked dependencies
├── requirements.txt              # Python dependencies
├── requirements.in               # Python dependency sources
├── hardhat.config.js             # Hardhat configuration
├── slither.config.json           # Slither configuration
├── docker-compose.yml            # Docker Compose configuration
├── Dockerfile.hardhat            # Hardhat Docker image
├── Dockerfile.python             # Python Docker image
├── env.example                   # Environment variables template
├── .gitignore                    # Git ignore rules
├── fuzzing_report.md             # Fuzzing test reports
├── fuzzing_results.json          # Fuzzing test results
├── coverage_report.html          # Coverage reports
├── coverage_results.json         # Coverage results
└── tokenomics_analysis_results.json # Tokenomics results
```

## Naming Conventions

### File Names
- **Use underscores (`_`) as primary delimiters** for multi-word names
- **Use camelCase** for compound words within a single concept
- **Use hyphens (`-`)** for version numbers or descriptive suffixes
- **Never use spaces** in file or folder names
- **Use descriptive names** that clearly indicate the file's purpose

### Examples
```
✅ Good:
- HalomToken.sol
- deploy_governance.js
- test-staking.js
- halom-protocol-dashboard.json
- STRIDE-analysis.md

❌ Bad:
- token.sol
- deploy.js
- test.js
- dashboard.json
- analysis.md
```

### Version Naming
- Use simple version sequences: `_v1`, `_v2`, `_v3`
- Avoid: `_final`, `_finalfinal`, `_reallyfinal`
- For contracts: `HalomOracle.sol` → `HalomOracleV2.sol`

### Date Formatting
- Use **YYYY_MM_DD** format for dates
- Example: `2025_01_07_audit_report.md`

## Folder Organization Principles

### 1. Function-Based Organization
Folders are organized by function rather than file type:
- `contracts/` contains all smart contracts
- `scripts/` contains all deployment and maintenance scripts
- `test/` contains all test files

### 2. Subcategorization
Within functional folders, files are further organized by purpose:
- `contracts/core/` - Core protocol contracts
- `contracts/governance/` - Governance-related contracts
- `scripts/deployment/` - Deployment scripts
- `scripts/maintenance/` - Maintenance scripts

### 3. Clear Hierarchy
The most important distinguishing factor comes first:
- Contract type (core, governance, oracle, staking)
- Script purpose (deployment, governance, maintenance)
- File type (test, config, documentation)

## File Path Sentences

Each file path should form a logical "sentence" that helps users identify the file:

```
contracts/governance/HalomGovernor.sol
│         │          │
│         │          └─ Contract name
│         └─ Contract category
└─ File type

scripts/deployment/deploy.js
│        │          │
│        │          └─ Script name
│        └─ Script purpose
└─ File type

test/test-staking.js
│    │
│    └─ Test target
└─ File type
```

## Best Practices

### 1. Consistency
- Maintain consistent naming within each category
- Use the same delimiter style throughout the project
- Follow established patterns for similar files

### 2. Clarity
- Names should be self-explanatory
- Avoid abbreviations unless they are widely understood
- Use context from parent folders to avoid redundancy

### 3. Maintainability
- Structure should be easy to navigate
- New team members should quickly understand the organization
- Changes should be easy to implement without breaking existing structure

### 4. Scalability
- Structure should accommodate growth
- New categories can be added without major reorganization
- Version control should be straightforward

## Migration Guidelines

When reorganizing files:
1. **Plan the new structure** before making changes
2. **Update import statements** in all affected files
3. **Update documentation** to reflect new paths
4. **Test thoroughly** to ensure nothing is broken
5. **Communicate changes** to the team

## Conclusion

This file structure follows the MIT Communication Lab's principles of consistency, clarity, and maintainability. The organization makes it easy for both current team members and future contributors to navigate the codebase and understand the project's architecture.

**Key Benefits:**
- **Easier navigation** for new team members
- **Consistent patterns** across the project
- **Clear separation** of concerns
- **Scalable structure** for future growth
- **Professional appearance** for external contributors 
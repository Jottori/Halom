# Halom Bug Bounty Policy

## Overview

The Halom Bug Bounty Program encourages security researchers to identify and report vulnerabilities in the Halom ecosystem. This program is designed to improve the security of our smart contracts and protect our users.

## Program Scope

### In-Scope Contracts
- **Token Contracts**: `contracts/token/HalomToken.sol`
- **Governance Contracts**: `contracts/governance/Governance.sol`, `contracts/governance/Timelock.sol`
- **Staking Contracts**: `contracts/staking/Staking.sol`, `contracts/staking/LPStaking.sol`
- **Oracle Contracts**: `contracts/oracle/Oracle.sol`
- **Utility Contracts**: `contracts/utils/AntiWhale.sol`, `contracts/utils/FeeOnTransfer.sol`, `contracts/utils/Blacklist.sol`, `contracts/utils/Treasury.sol`
- **Bridge Contracts**: `contracts/bridge/Bridge.sol`
- **Library Contracts**: `contracts/libraries/GovernanceErrors.sol`, `contracts/libraries/GovernanceMath.sol`
- **Test Contracts**: `contracts/test/MockERC20.sol`, `contracts/test/TestProxy.sol`

### Out-of-Scope
- Frontend applications
- Third-party integrations
- Social engineering attacks
- Physical security
- Network infrastructure
- Known vulnerabilities in dependencies

## Vulnerability Categories

### Critical (Up to $50,000)
- Direct theft of user funds
- Permanent freezing of funds
- Unauthorized minting of tokens
- Complete governance takeover
- Bridge fund theft
- Oracle manipulation leading to fund loss

### High (Up to $25,000)
- Temporary freezing of funds
- Unauthorized access to admin functions
- Reentrancy vulnerabilities
- Integer overflow/underflow
- Access control bypasses
- Oracle manipulation

### Medium (Up to $10,000)
- Logic errors in calculations
- Gas optimization issues
- Event emission failures
- Incorrect state updates
- Missing input validation

### Low (Up to $5,000)
- Informational disclosures
- Minor UI/UX issues
- Documentation errors
- Non-critical gas optimizations

## Submission Guidelines

### Required Information
1. **Vulnerability Description**: Clear explanation of the issue
2. **Impact Assessment**: Potential damage and affected users
3. **Proof of Concept**: Reproducible steps or code
4. **Mitigation Suggestions**: Recommended fixes
5. **Severity Classification**: Self-assessment of severity

### Submission Format
```markdown
## Vulnerability Report

**Title**: [Brief description]

**Severity**: [Critical/High/Medium/Low]

**Description**: [Detailed explanation]

**Impact**: [Potential consequences]

**Steps to Reproduce**:
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Proof of Concept**:
```solidity
// Code demonstrating the vulnerability
```

**Mitigation**: [Suggested fixes]

**Additional Notes**: [Any other relevant information]
```

## Safe Harbor

### Legal Protection
- Researchers acting in good faith are protected from legal action
- Responsible disclosure practices are encouraged
- No legal action will be taken against researchers who:
  - Follow responsible disclosure guidelines
  - Do not access or modify user data
  - Do not perform destructive testing
  - Report vulnerabilities promptly

### Responsible Disclosure
1. **Do not exploit vulnerabilities** beyond what's necessary to demonstrate the issue
2. **Do not access or modify** user data or funds
3. **Do not perform destructive testing** that could impact system stability
4. **Report vulnerabilities promptly** through official channels
5. **Allow reasonable time** for fixes before public disclosure

## Reward Structure

### Base Rewards
- **Critical**: $10,000 - $50,000
- **High**: $5,000 - $25,000
- **Medium**: $1,000 - $10,000
- **Low**: $100 - $5,000

### Bonus Factors
- **First Report**: 10% bonus for being the first to report a vulnerability
- **Quality**: Up to 20% bonus for exceptional report quality
- **Fix Suggestion**: Up to 10% bonus for providing effective mitigation
- **Impact**: Up to 15% bonus for high-impact vulnerabilities

### Payment Terms
- Rewards paid in ETH or stablecoins
- Payment within 30 days of vulnerability confirmation
- Minimum payout threshold: $100
- Maximum payout per researcher: $100,000 per year

## Evaluation Process

### 1. Initial Review
- Reports reviewed within 48 hours
- Preliminary assessment of severity
- Acknowledgment sent to researcher

### 2. Technical Assessment
- Detailed analysis by security team
- Reproduction of vulnerability
- Impact assessment
- Mitigation planning

### 3. Reward Determination
- Severity classification
- Bonus factor calculation
- Final reward amount
- Payment processing

### 4. Resolution
- Vulnerability fixed
- Public disclosure (if appropriate)
- Researcher recognition
- Lessons learned documentation

## Hall of Fame

### Recognition
- Public acknowledgment of researchers
- Hall of Fame listing on website
- Special recognition for significant contributions
- Invitation to security events

### Criteria for Hall of Fame
- Multiple high-quality reports
- Significant security improvements
- Consistent responsible disclosure
- Community contribution

## Program Rules

### Eligibility
- Open to all security researchers
- No geographic restrictions
- No affiliation requirements
- Must be 18 years or older

### Prohibited Activities
- Accessing or modifying user data
- Performing destructive testing
- Exploiting vulnerabilities beyond proof of concept
- Public disclosure before fix deployment
- Social engineering attacks

### Reporting Channels
- **Primary**: security@halom.com
- **Backup**: GitHub security advisories
- **Emergency**: security-emergency@halom.com

## Timeline

### Response Times
- **Initial Response**: 48 hours
- **Status Update**: 7 days
- **Resolution**: 30 days (typical)
- **Payment**: 30 days after confirmation

### Disclosure Timeline
- **Private Fix**: 30 days after report
- **Public Disclosure**: 90 days after report
- **Extended Timeline**: Available for complex fixes

## Quality Standards

### Report Quality
- Clear and concise descriptions
- Reproducible proof of concepts
- Accurate severity assessment
- Constructive mitigation suggestions

### Communication
- Professional and respectful tone
- Timely responses
- Clear status updates
- Transparent decision-making

## Continuous Improvement

### Program Updates
- Regular policy reviews
- Reward structure adjustments
- Scope expansion
- Process improvements

### Feedback
- Researcher feedback collection
- Program effectiveness evaluation
- Industry best practice adoption
- Community engagement

## Contact Information

### Security Team
- **Email**: security@halom.com
- **Emergency**: security-emergency@halom.com
- **Discord**: #security channel
- **Telegram**: @HalomSecurity

### Program Management
- **Program Lead**: [Name]
- **Technical Lead**: [Name]
- **Legal Contact**: [Name]

## Legal Disclaimer

This bug bounty program is subject to change at any time. Participation in this program constitutes acceptance of these terms and conditions. Halom reserves the right to modify, suspend, or terminate this program at any time.

### Jurisdiction
- Program governed by [Jurisdiction] law
- Disputes resolved through arbitration
- Maximum liability limited to reward amounts

### Tax Implications
- Researchers responsible for tax compliance
- No tax advice provided
- Consult with tax professionals

## Conclusion

The Halom Bug Bounty Program is committed to maintaining the highest security standards for our ecosystem. We value the contributions of security researchers and are committed to fair and timely reward distribution.

By participating in this program, researchers help us protect our users and improve the overall security of the DeFi ecosystem. We appreciate your efforts and look forward to working with the security community. 
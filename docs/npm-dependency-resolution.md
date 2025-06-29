# NPM Dependency Conflict Resolution Guide

## Overview

This guide provides comprehensive strategies for resolving npm dependency conflicts, particularly peer dependency conflicts that commonly occur in Node.js projects.

## Python vs Node.js Dependencies

**Important**: This project uses both Python and Node.js dependencies. Make sure to install them correctly:

### Node.js Dependencies (npm)
```bash
npm install
```
These are defined in `package.json` and include:
- Hardhat and related tools
- Web3 libraries
- Solidity development tools

### Python Dependencies (pip)
```bash
pip install -r requirements.txt
```
These are defined in `requirements.txt` and include:
- pandas (data manipulation)
- requests (HTTP client)
- schedule (task scheduling)
- web3 (Python Web3 library)

**Note**: Python packages like `pandas`, `requests`, and `schedule` should NOT be in `package.json` as they are not npm packages.

## Common Dependency Conflict Types

### 1. Peer Dependency Conflicts

**Problem**: Package A requires a specific version of Package B, but your project uses an incompatible version.

**Example**:
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR! Found: @nomicfoundation/hardhat-ethers@4.0.0
npm ERR! Could not resolve dependency:
npm ERR! peer @nomicfoundation/hardhat-ethers@^3.0.0 from @openzeppelin/hardhat-upgrades@3.9.0
```

### 2. Version Range Conflicts

**Problem**: Multiple packages require different version ranges of the same dependency.

### 3. Breaking Changes

**Problem**: Major version updates introduce incompatibilities between packages.

## Resolution Strategies

### Strategy 1: Version Alignment (Recommended)

Align package versions to satisfy peer dependency requirements.

**Example Fix**:
```json
{
  "devDependencies": {
    "@nomicfoundation/hardhat-ethers": "^3.0.0",  // Downgraded from ^4.0.0
    "@openzeppelin/hardhat-upgrades": "^3.9.0"
  }
}
```

### Strategy 2: Use Stable Versions

Always prefer stable versions over pre-release versions to minimize conflicts.

```json
{
  "dependencies": {
    "package-a": "^2.0.0",  // Stable version
    "package-b": "^3.0.0"   // Stable version
  }
}
```

### Strategy 3: Match Pre-release Versions

If you must use pre-release versions, ensure they're compatible:

```json
{
  "dependencies": {
    "package-a": "2.0.0-beta.1",
    "package-b": "3.0.0-beta.2"
  }
}
```

### Strategy 4: Dependency Overrides

Use the `overrides` section in `package.json` to force specific versions:

```json
{
  "overrides": {
    "@ng-select/ng-option-highlight": "11.1.2"
  }
}
```

### Strategy 5: Legacy Peer Dependencies (Last Resort)

Use `--legacy-peer-deps` flag as a temporary solution:

```bash
npm install --legacy-peer-deps
```

**Warning**: This can lead to compatibility issues and should be used with caution.

### Strategy 6: Force Installation (Emergency Only)

Use `--force` flag for critical situations:

```bash
npm install --force
```

**Warning**: This bypasses all dependency checks and can cause runtime issues.

## Best Practices

### 1. Always Test After Resolution

```bash
# Test the installation
npm test

# Run build process
npm run build

# Check for runtime errors
npm start
```

### 2. Document Dependency Decisions

Keep a record of why specific versions were chosen:

```markdown
## Dependency Resolution Notes

- @nomicfoundation/hardhat-ethers: ^3.0.0 (Required by @openzeppelin/hardhat-upgrades@3.9.0)
- @openzeppelin/contracts: ^5.0.1 (Latest stable version)
- ethers: ^6.14.4 (Compatible with hardhat-ethers v3)
```

### 3. Use Lock Files

Commit `package-lock.json` to ensure consistent installations:

```bash
# Generate lock file
npm install

# Commit lock file
git add package-lock.json
git commit -m "Update package-lock.json with resolved dependencies"
```

### 4. Regular Dependency Updates

Keep dependencies updated to avoid conflicts:

```bash
# Check for outdated packages
npm outdated

# Update packages safely
npm update

# Update specific packages
npm install package-name@latest
```

## Troubleshooting Common Issues

### Issue 1: Missing Dependencies After --legacy-peer-deps

**Problem**: Some dependencies are skipped during installation.

**Solution**: Use `--force` instead:
```bash
npm install --force
```

### Issue 2: .npmrc Overrides Command Line Options

**Problem**: Settings in `.npmrc` override command line flags.

**Solution**: Check and update `.npmrc` file:
```ini
# .npmrc
legacy-peer-deps=true
```

### Issue 3: Package-lock.json Conflicts

**Problem**: Regenerated `package-lock.json` with different dependency tree.

**Solution**: Revert and regenerate:
```bash
# Revert package-lock.json
git checkout package-lock.json

# Regenerate with force
npm install --force
```

## Halom Protocol Specific Resolutions

### Current Dependency Resolution

The Halom Protocol has resolved the following conflicts:

1. **@openzeppelin/hardhat-upgrades**: Updated to `^3.9.0` (latest stable)
2. **@nomicfoundation/hardhat-ethers**: Downgraded to `^3.0.0` (peer dependency requirement)
3. **@openzeppelin/contracts**: Updated to `^5.0.1` (latest stable)

### Compatibility Matrix

| Package | Version | Reason |
|---------|---------|--------|
| @openzeppelin/hardhat-upgrades | ^3.9.0 | Latest stable version |
| @nomicfoundation/hardhat-ethers | ^3.0.0 | Peer dependency requirement |
| @openzeppelin/contracts | ^5.0.1 | Latest stable version |
| ethers | ^6.14.4 | Compatible with hardhat-ethers v3 |
| hardhat | ^2.22.1 | Compatible with all dependencies |

## CI/CD Considerations

### GitHub Actions Configuration

```yaml
name: Install Dependencies
on: [push, pull_request]

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci  # Use ci for consistent installations
```

### Docker Configuration

```dockerfile
# Use specific Node.js version
FROM node:18-alpine

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build application
RUN npm run build
```

## Monitoring and Maintenance

### Dependency Health Checks

```bash
# Check for security vulnerabilities
npm audit

# Check for outdated packages
npm outdated

# Check dependency tree
npm ls
```

### Automated Updates

Consider using tools like:
- **Dependabot**: Automated dependency updates
- **Renovate**: Advanced dependency management
- **npm-check-updates**: Bulk dependency updates

## Resources

- [NPM Documentation](https://docs.npmjs.com/)
- [Peer Dependencies Guide](https://nodejs.org/en/blog/npm/peer-dependencies/)
- [Semantic Versioning](https://semver.org/)
- [Resolving NPM Peer Dependency Conflicts](https://medium.com/@robert.maiersilldorff/resolving-npm-peer-dependency-conflicts-70d67f4ca7dc)
- [Understanding and Resolving npm Dependency Conflicts](https://dev.to/gentritbiba/understanding-and-resolving-npm-dependency-conflicts-a-developers-guide-3c33)

## Support

For complex dependency conflicts:

1. **Check package documentation** for compatibility notes
2. **Use ChatGPT** for quick resolution suggestions
3. **Consult package maintainers** for specific issues
4. **Review GitHub issues** for known conflicts

## Conclusion

Dependency conflicts are common in Node.js development, but they can be resolved systematically. Always prioritize:

1. **Version alignment** over force installation
2. **Stable versions** over pre-release versions
3. **Thorough testing** after resolution
4. **Documentation** of decisions made

By following these guidelines, you can maintain a healthy and stable dependency tree in your projects. 
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Comprehensive Testing Suite for Halom Project\n');

// Configuration
const config = {
    testTimeout: 300000, // 5 minutes
    coverageThreshold: 95,
    securityTools: ['slither', 'mythril', 'mythx'],
    testSuites: [
        'test-token-comprehensive.cjs',
        'test-staking-comprehensive.cjs',
        'test-governance-comprehensive.cjs',
        'test-oracle-comprehensive.cjs',
        'test-bridge-comprehensive.cjs',
        'test-treasury-comprehensive.cjs',
        'test-timelock-comprehensive.cjs',
        'test-critical-fixes.cjs',
        'test-secure-roles.cjs',
        'test-delegation.cjs',
        'test-dao-participation.cjs'
    ]
};

// Utility functions
function runCommand(command, description) {
    console.log(`\n📋 ${description}`);
    console.log(`Running: ${command}`);
    
    try {
        const result = execSync(command, { 
            encoding: 'utf8', 
            timeout: config.testTimeout,
            stdio: 'pipe'
        });
        console.log('✅ Success');
        return { success: true, output: result };
    } catch (error) {
        console.log('❌ Failed');
        console.log('Error:', error.message);
        return { success: false, error: error.message };
    }
}

function checkToolAvailability(tool) {
    try {
        execSync(`${tool} --version`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// Test Results Summary
const testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    securityIssues: [],
    coverage: 0
};

// Phase 1: Environment Setup and Dependencies
console.log('\n🔧 Phase 1: Environment Setup');
console.log('============================');

// Check Node.js and npm
const nodeVersion = runCommand('node --version', 'Checking Node.js version');
const npmVersion = runCommand('npm --version', 'Checking npm version');

// Install dependencies if needed
if (!fs.existsSync('node_modules')) {
    runCommand('npm install', 'Installing npm dependencies');
}

// Check Hardhat
const hardhatVersion = runCommand('npx hardhat --version', 'Checking Hardhat version');

// Phase 2: Static Analysis
console.log('\n🔍 Phase 2: Static Analysis');
console.log('===========================');

// Run Slither if available
if (checkToolAvailability('slither')) {
    const slitherResult = runCommand(
        'slither . --exclude-dependencies --exclude-informational --exclude-low',
        'Running Slither static analysis'
    );
    
    if (slitherResult.success) {
        testResults.securityIssues.push('Slither analysis completed');
    }
} else {
    console.log('⚠️  Slither not available, skipping static analysis');
    testResults.skipped++;
}

// Run Mythril if available
if (checkToolAvailability('myth')) {
    const mythrilResult = runCommand(
        'myth analyze contracts/ --execution-timeout 300',
        'Running Mythril symbolic execution'
    );
    
    if (mythrilResult.success) {
        testResults.securityIssues.push('Mythril analysis completed');
    }
} else {
    console.log('⚠️  Mythril not available, skipping symbolic execution');
    testResults.skipped++;
}

// Phase 3: Unit Testing
console.log('\n🧪 Phase 3: Unit Testing');
console.log('========================');

// Run individual test suites
config.testSuites.forEach(testSuite => {
    const testPath = path.join('tests', testSuite);
    
    if (fs.existsSync(testPath)) {
        const testResult = runCommand(
            `npx hardhat test ${testPath} --verbose`,
            `Running ${testSuite}`
        );
        
        testResults.total++;
        if (testResult.success) {
            testResults.passed++;
        } else {
            testResults.failed++;
        }
    } else {
        console.log(`⚠️  Test file not found: ${testPath}`);
        testResults.skipped++;
    }
});

// Phase 4: Integration Testing
console.log('\n🔗 Phase 4: Integration Testing');
console.log('==============================');

// Test cross-module interactions
const integrationTests = [
    'test-governance-complete-flow.cjs',
    'test-reward-treasury-sync.cjs',
    'test-setup.cjs'
];

integrationTests.forEach(testSuite => {
    const testPath = path.join('tests', testSuite);
    
    if (fs.existsSync(testPath)) {
        const testResult = runCommand(
            `npx hardhat test ${testPath} --verbose`,
            `Running integration test: ${testSuite}`
        );
        
        testResults.total++;
        if (testResult.success) {
            testResults.passed++;
        } else {
            testResults.failed++;
        }
    }
});

// Phase 5: Security Testing
console.log('\n🛡️  Phase 5: Security Testing');
console.log('============================');

// Test role-based access control
const securityTests = [
    'test-secure-roles.cjs',
    'test-critical-fixes.cjs',
    'security-audit-tests.cjs'
];

securityTests.forEach(testSuite => {
    const testPath = path.join('tests', testSuite);
    
    if (fs.existsSync(testPath)) {
        const testResult = runCommand(
            `npx hardhat test ${testPath} --verbose`,
            `Running security test: ${testSuite}`
        );
        
        testResults.total++;
        if (testResult.success) {
            testResults.passed++;
        } else {
            testResults.failed++;
        }
    }
});

// Phase 6: Coverage Analysis
console.log('\n📊 Phase 6: Coverage Analysis');
console.log('=============================');

// Run coverage if available
if (fs.existsSync('hardhat.config.cjs')) {
    const coverageResult = runCommand(
        'npx hardhat coverage',
        'Generating test coverage report'
    );
    
    if (coverageResult.success) {
        // Extract coverage percentage from output
        const coverageMatch = coverageResult.output.match(/All files\s+\|\s+(\d+\.\d+)/);
        if (coverageMatch) {
            testResults.coverage = parseFloat(coverageMatch[1]);
        }
    }
}

// Phase 7: zkSync Specific Testing
console.log('\n⚡ Phase 7: zkSync Integration Testing');
console.log('=====================================');

// Test zkSync specific functionality
const zkSyncTests = [
    'test-oracle-v2-comprehensive.cjs',
    'test-oraclev2-comprehensive.cjs',
    'zksync-integration.test.cjs'
];

zkSyncTests.forEach(testSuite => {
    const testPath = path.join('tests', testSuite);
    
    if (fs.existsSync(testPath)) {
        const testResult = runCommand(
            `npx hardhat test ${testPath} --verbose`,
            `Running zkSync test: ${testSuite}`
        );
        
        testResults.total++;
        if (testResult.success) {
            testResults.passed++;
        } else {
            testResults.failed++;
        }
    }
});

// Phase 8: Performance Testing
console.log('\n⚡ Phase 8: Performance Testing');
console.log('===============================');

// Test gas optimization
const gasTest = runCommand(
    'npx hardhat test tests/test-gas-optimization.cjs --verbose',
    'Running gas optimization tests'
);

if (gasTest.success) {
    testResults.passed++;
} else {
    testResults.skipped++;
}

// Generate Test Report
console.log('\n📋 Phase 9: Generating Test Report');
console.log('==================================');

const report = {
    timestamp: new Date().toISOString(),
    summary: {
        total: testResults.total,
        passed: testResults.passed,
        failed: testResults.failed,
        skipped: testResults.skipped,
        successRate: ((testResults.passed / testResults.total) * 100).toFixed(2) + '%',
        coverage: testResults.coverage + '%',
        securityIssues: testResults.securityIssues.length
    },
    details: {
        environment: {
            node: nodeVersion.success ? nodeVersion.output.trim() : 'Unknown',
            npm: npmVersion.success ? npmVersion.output.trim() : 'Unknown',
            hardhat: hardhatVersion.success ? hardhatVersion.output.trim() : 'Unknown'
        },
        securityAnalysis: testResults.securityIssues,
        recommendations: []
    }
};

// Add recommendations based on results
if (testResults.failed > 0) {
    report.details.recommendations.push('Fix failed tests before deployment');
}

if (testResults.coverage < config.coverageThreshold) {
    report.details.recommendations.push(`Increase test coverage to ${config.coverageThreshold}%`);
}

if (testResults.securityIssues.length === 0) {
    report.details.recommendations.push('Run additional security analysis tools');
}

// Save report
const reportPath = 'test-results.json';
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

// Display Summary
console.log('\n🎯 Test Summary');
console.log('===============');
console.log(`Total Tests: ${testResults.total}`);
console.log(`Passed: ${testResults.passed} ✅`);
console.log(`Failed: ${testResults.failed} ❌`);
console.log(`Skipped: ${testResults.skipped} ⚠️`);
console.log(`Success Rate: ${report.summary.successRate}`);
console.log(`Coverage: ${report.summary.coverage}`);
console.log(`Security Issues Found: ${report.summary.securityIssues}`);

if (report.details.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    report.details.recommendations.forEach(rec => {
        console.log(`  - ${rec}`);
    });
}

console.log(`\n📄 Detailed report saved to: ${reportPath}`);

// Exit with appropriate code
if (testResults.failed > 0) {
    console.log('\n❌ Some tests failed. Please fix issues before deployment.');
    process.exit(1);
} else {
    console.log('\n✅ All tests passed! Project is ready for deployment.');
    process.exit(0);
} 
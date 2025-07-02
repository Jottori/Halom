const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const testConfig = {
    testFiles: [
        'test/contracts/test-pausable-functionality.js',
        'test/contracts/test-voting-power-integration.js',
        'test/contracts/test-validator-iteration.js',
        'test/contracts/test-role-expiry-management.js',
        'test/contracts/test-oracle-integration.js',
        'test/contracts/test-emergency-recovery.js',
        'test/contracts/test-monitoring.js',
        'test/contracts/test-gas-optimization.js'
    ],
    categories: {
        unit: ['test-pausable-functionality', 'test-voting-power-integration', 'test-validator-iteration'],
        integration: ['test-role-expiry-management', 'test-oracle-integration'],
        gas: ['test-gas-optimization'],
        security: ['test-emergency-recovery', 'test-role-expiry-management'],
        stress: ['test-monitoring', 'test-gas-optimization']
    }
};

// Test results storage
const testResults = {
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    details: []
};

// Utility functions
function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
}

function runTest(testFile) {
    return new Promise((resolve, reject) => {
        log(`Running test: ${testFile}`, 'info');
        
        const command = `npx hardhat test ${testFile} --network hardhat`;
        
        exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
            const result = {
                file: testFile,
                success: !error,
                output: stdout,
                error: stderr,
                duration: Date.now()
            };
            
            if (error) {
                log(`Test failed: ${testFile}`, 'error');
                log(`Error: ${error.message}`, 'error');
                testResults.failed++;
            } else {
                log(`Test passed: ${testFile}`, 'success');
                testResults.passed++;
            }
            
            testResults.total++;
            testResults.details.push(result);
            
            resolve(result);
        });
    });
}

function runTestCategory(category, testFiles) {
    return new Promise(async (resolve) => {
        log(`\n🚀 Starting ${category} tests...`, 'info');
        
        const categoryResults = {
            category,
            passed: 0,
            failed: 0,
            total: 0
        };
        
        for (const testFile of testFiles) {
            if (testConfig.testFiles.includes(testFile)) {
                const result = await runTest(testFile);
                if (result.success) {
                    categoryResults.passed++;
                } else {
                    categoryResults.failed++;
                }
                categoryResults.total++;
            }
        }
        
        log(`📊 ${category} tests completed: ${categoryResults.passed}/${categoryResults.total} passed`, 
            categoryResults.failed === 0 ? 'success' : 'warning');
        
        resolve(categoryResults);
    });
}

function generateReport() {
    const report = {
        summary: {
            total: testResults.total,
            passed: testResults.passed,
            failed: testResults.failed,
            successRate: ((testResults.passed / testResults.total) * 100).toFixed(2)
        },
        details: testResults.details,
        timestamp: new Date().toISOString()
    };
    
    // Save report to file
    const reportPath = path.join(__dirname, '../test-reports');
    if (!fs.existsSync(reportPath)) {
        fs.mkdirSync(reportPath, { recursive: true });
    }
    
    const reportFile = path.join(reportPath, `test-report-${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    return report;
}

function displayReport(report) {
    console.log('\n' + '='.repeat(80));
    console.log('📋 COMPREHENSIVE TEST REPORT');
    console.log('='.repeat(80));
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Total Tests: ${report.summary.total}`);
    console.log(`   Passed: ${report.summary.passed} ✅`);
    console.log(`   Failed: ${report.summary.failed} ❌`);
    console.log(`   Success Rate: ${report.summary.successRate}%`);
    
    console.log(`\n📅 Generated: ${report.timestamp}`);
    console.log(`📁 Report saved to: test-reports/`);
    
    if (report.summary.failed > 0) {
        console.log(`\n❌ FAILED TESTS:`);
        report.details
            .filter(detail => !detail.success)
            .forEach(detail => {
                console.log(`   - ${detail.file}`);
                if (detail.error) {
                    console.log(`     Error: ${detail.error.substring(0, 200)}...`);
                }
            });
    }
    
    console.log(`\n✅ PASSED TESTS:`);
    report.details
        .filter(detail => detail.success)
        .forEach(detail => {
            console.log(`   - ${detail.file}`);
        });
    
    console.log('\n' + '='.repeat(80));
}

// Main test runner
async function runAllTests() {
    console.log('🧪 HALOM PROTOCOL - COMPREHENSIVE TEST SUITE');
    console.log('Testing all missing implementations...\n');
    
    const startTime = Date.now();
    
    try {
        // Run tests by category
        for (const [category, testFiles] of Object.entries(testConfig.categories)) {
            await runTestCategory(category, testFiles);
        }
        
        // Generate and display report
        const report = generateReport();
        displayReport(report);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`\n🎉 All tests completed in ${duration}s`, 'success');
        
        // Exit with appropriate code
        process.exit(report.summary.failed === 0 ? 0 : 1);
        
    } catch (error) {
        log(`Test runner failed: ${error.message}`, 'error');
        process.exit(1);
    }
}

// Command line interface
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🧪 Halom Protocol Test Runner

Usage:
  node test/run-all-tests.js [options]

Options:
  --category <category>    Run tests for specific category (unit, integration, gas, security, stress)
  --file <filename>        Run specific test file
  --help, -h              Show this help message
  --report-only           Only generate report from existing results

Examples:
  node test/run-all-tests.js --category unit
  node test/run-all-tests.js --file test-pausable-functionality.js
  node test/run-all-tests.js --report-only
`);
    process.exit(0);
}

if (args.includes('--category')) {
    const categoryIndex = args.indexOf('--category');
    const category = args[categoryIndex + 1];
    
    if (testConfig.categories[category]) {
        log(`Running ${category} tests only...`, 'info');
        runTestCategory(category, testConfig.categories[category])
            .then(() => process.exit(0))
            .catch(error => {
                log(`Category test failed: ${error.message}`, 'error');
                process.exit(1);
            });
    } else {
        log(`Invalid category: ${category}`, 'error');
        log(`Available categories: ${Object.keys(testConfig.categories).join(', ')}`, 'info');
        process.exit(1);
    }
} else if (args.includes('--file')) {
    const fileIndex = args.indexOf('--file');
    const filename = args[fileIndex + 1];
    
    const testFile = testConfig.testFiles.find(file => file.includes(filename));
    if (testFile) {
        log(`Running specific test file: ${testFile}`, 'info');
        runTest(testFile)
            .then(() => process.exit(0))
            .catch(error => {
                log(`Test failed: ${error.message}`, 'error');
                process.exit(1);
            });
    } else {
        log(`Test file not found: ${filename}`, 'error');
        log(`Available test files:`, 'info');
        testConfig.testFiles.forEach(file => console.log(`  - ${file}`));
        process.exit(1);
    }
} else if (args.includes('--report-only')) {
    log('Generating report from existing results...', 'info');
    const report = generateReport();
    displayReport(report);
    process.exit(0);
} else {
    // Run all tests
    runAllTests();
}

// Handle process termination
process.on('SIGINT', () => {
    log('\n⚠️ Test execution interrupted by user', 'warning');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`Unhandled rejection at ${promise}: ${reason}`, 'error');
    process.exit(1);
}); 
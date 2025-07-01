import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    ignores: [
      'coverage/**/*',
      'node_modules/**/*',
      'artifacts/**/*',
      'cache/**/*',
      '.venv/**/*',
      '**/*.min.js',
      '**/*.bundle.js'
    ]
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.mocha,
        ...globals.ethers
      },
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // Error handling
      'no-console': 'warn',
      'no-debugger': 'error',

      // Code quality
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      'no-undef': 'error',
      'no-redeclare': 'error',

      // Best practices
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // Styling
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'no-trailing-spaces': 'error',
      'eol-last': 'error',

      // Hardhat specific
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error'
    }
  },
  {
    files: ['test/**/*.cjs'],
    rules: {
      'no-console': 'off', // Allow console in tests
      'no-unused-vars': 'off' // Allow unused variables in tests
    }
  },
  {
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off' // Allow console in scripts
    }
  }
];

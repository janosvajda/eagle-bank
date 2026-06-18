import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const productionTypeScript = [
  'src/**/*.ts',
  'infra/bin/**/*.ts',
  'infra/lib/**/*.ts',
  'prisma/**/*.ts',
];

const restrictedBusinessLiterals = [
  'ACTIVE',
  'CLOSED',
  'PENDING_LEDGER_CREATION',
  'LEDGER_CREATION_FAILED',
  'PENDING_LEDGER_CLOSURE',
  'LEDGER_CLOSURE_FAILED',
  'PROCESSING',
  'COMPLETED',
  'PUBLISHED',
  'FAILED',
  'DEAD',
  'CREDIT',
  'DEBIT',
  'GBP',
  'personal',
  'deposit',
  'withdrawal',
  'TransactionPosted',
  'Bearer',
  'account-reconciler',
  'api',
  'auth-service',
  'ledger-service',
  'asc',
  'String',
  'ok',
  'ready',
  'not_ready',
  'local',
  'test',
  'preprod',
  'prod',
];

const restrictedBusinessLiteralRules = restrictedBusinessLiterals.map(
  (value) => ({
    selector: `Literal[value='${value}']`,
    message: `Use the shared domain constant instead of '${value}'.`,
  }),
);

export default tseslint.config(
  {
    ignores: [
      'cdk.out/**',
      'coverage/**',
      'dist/**',
      'generated/**',
      'node_modules/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    rules: {
      quotes: ['error', 'single', { avoidEscape: true }],
    },
  },
  {
    files: productionTypeScript,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...restrictedBusinessLiteralRules],
      'no-magic-numbers': [
        'error',
        {
          detectObjects: false,
          enforceConst: true,
          ignore: [-1, 0, 1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-magic-numbers': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: [
      'infra/lib/eagle-bank-stack.ts',
      'infra/lib/deployment-config.ts',
      'infra/bin/eagle-bank.ts',
      'src/common/auth/auth.constants.ts',
      'src/common/aws/local-aws-config.ts',
      'src/common/config/runtime.constants.ts',
      'src/common/domain/banking.ts',
      'src/modules/health/health.constants.ts',
      'src/modules/ledger/domain/ledger.constants.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['eslint.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-magic-numbers': 'off',
    },
  },
);

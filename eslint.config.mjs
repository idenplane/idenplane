// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'test/**',
      '**/*.spec.ts',
      // Test-only mock utilities (use jest globals/types); excluded like specs.
      '**/*.mock.ts',
      '**/__mocks__/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // SessionIssuer is the only place an SSO session is created, so every
    // sign-in path records how it was established and sets the same cookie.
    files: ['src/**/*.ts'],
    ignores: ['src/login/session-issuer.service.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='createLoginSession']",
          message:
            'Create SSO sessions through SessionIssuer.issue() (src/login/session-issuer.service.ts).',
        },
      ],
    },
  },
);

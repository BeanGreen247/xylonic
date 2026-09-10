// Flat config (ESLint 9 + typescript-eslint 8). Non-type-checked for speed.
// WS-QUAL: no-console and no-empty are enforced as errors (the console.* → logger
// sweep and the empty-catch annotation pass are done); no-explicit-any /
// no-unused-vars / exhaustive-deps stay warnings and tighten to error over time.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'android/**',
      'ios/**',
      'releases/**',
      'public/**',
      'scripts/**',
      '*.config.*',
      'src/**/*.v1.*',
      'src/**/*.v2.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021, ...globals.worker },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // The logger is the one place console.* is legitimate.
    files: ['src/utils/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);

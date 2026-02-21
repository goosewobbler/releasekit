import tsParser from '@typescript-eslint/parser';
import vitest from '@vitest/eslint-plugin';

export default [
  {
    ignores: ['**/dist/**/*', '**/coverage/**/*', '**/out/**/*', '**/.turbo/**/*'],
  },
  {
    files: ['packages/**/test/**/*.spec.ts', 'packages/**/test/**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        project: './tsconfig.base.json',
      },
    },
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/prefer-called-exactly-once-with': 'off',
    },
  },
];

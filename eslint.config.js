import tsParser from '@typescript-eslint/parser';
import vitest from '@vitest/eslint-plugin';

// Bare `#NNN` refs in comments aren't clickable and rot as the code moves. Matches `#` and 2+ digits outside a URL
// fragment or identifier.
const noBareIssueRefs = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow bare #NNN issue references in comments; use a full URL or drop it.' },
    messages: {
      bareRef:
        "Bare issue reference '{{ref}}' in a comment — link it as a full URL (…/issues/{{num}}) or drop it; git history is the canonical trace.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const pattern = /(?<![\w/])#(\d{2,})\b/g;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          for (const match of comment.value.matchAll(pattern)) {
            context.report({ loc: comment.loc, messageId: 'bareRef', data: { ref: match[0], num: match[1] } });
          }
        }
      },
    };
  },
};

export default [
  {
    ignores: ['**/dist/**/*', '**/coverage/**/*', '**/out/**/*', '**/.turbo/**/*'],
  },
  {
    // Production sources only: test comments reference mock issue/PR numbers, which aren't citations.
    files: ['packages/**/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: {
      local: { rules: { 'no-bare-issue-refs': noBareIssueRefs } },
    },
    rules: {
      'local/no-bare-issue-refs': 'error',
    },
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
      'vitest/valid-title': [
        'error',
        { mustMatch: { it: '^should', test: '^should' }, mustNotMatch: { it: '#\\d', test: '#\\d' } },
      ],
    },
  },
];

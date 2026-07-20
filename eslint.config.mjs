import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import vitest from '@vitest/eslint-plugin';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import autoImports from './.wxt/eslint-auto-imports.mjs';

const sourceFiles = [
  'entrypoints/**/*.{ts,tsx}',
  'lib/**/*.{ts,tsx}',
  'tests/**/*.ts',
  // The audit's check functions are serialized into the browser, so these run
  // half in node and half in the page — they need both sets of globals. (The
  // other scripts/ files declare their own globals and are left alone.)
  'scripts/inputview-audit/*.mjs',
  'vitest.config.ts',
  'wxt.config*.ts',
];

export default tseslint.config(
  autoImports,
  {
    ignores: [
      'build/**',
      '.wxt/**',
      '.output/**',
      'node_modules/**',
      'public/**',
      'entrypoints/background/rime_emscripten.js',
      'entrypoints/background/rime_emscripten.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // ESLint-native formatting (replaces Prettier) — semicolons, single quotes,
  // 2-space indent.
  stylistic.configs.customize({ indent: 2, quotes: 'single', semi: true, jsx: true }),
  {
    rules: {
      // The codebase uses one-liner `if (cond) stmt;` throughout.
      '@stylistic/max-statements-per-line': 'off',
      '@stylistic/multiline-ternary': 'off',
      // Keep double quotes for strings containing single quotes (e.g. CSP).
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
    },
  },
  {
    // Type-aware linting for every TS file. projectService picks up files that
    // aren't listed in tsconfig.json (wxt.config*.ts) via an inferred project.
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['wxt.config.ts', 'wxt.config.base.ts', 'wxt.config.webstore.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react/prop-types': 'off',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],

      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      'no-console': 'off',
      'no-var': 'off',
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',

      // The codebase deliberately allows `any` (Chrome APIs, JSON payloads), so
      // the unsafe-* family and unbound-method are off; the promise/correctness
      // bug-catchers from recommendedTypeChecked stay on as errors.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      // Its autofix strips casts that narrow the loose any/{} returns of Chrome
      // APIs — the assertions are load-bearing for tsc, so leave them alone.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Async handlers on JSX props are idiomatic React; the rest of the rule
      // (promises in conditions, spreads, non-JSX arguments) stays an error.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Vitest test-quality rules (stray .only, disabled tests, invalid expect).
    files: ['tests/**/*.ts'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      // Asserting a discriminant then narrowing with `if (x.kind === ...)` to
      // reach variant fields is a safe TS idiom, not a vacuous conditional.
      'vitest/no-conditional-expect': 'off',
    },
  },
  {
    // Plain-JS / config files aren't part of the TS project.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);

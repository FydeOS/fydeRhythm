import autoImports from "./.wxt/eslint-auto-imports.mjs";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

const sourceFiles = [
  "entrypoints/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
  "tests/**/*.ts",
  "vitest.config.ts",
  "wxt.config*.ts",
];

export default tseslint.config(
  autoImports,
  {
    ignores: [
      "build/**",
      ".wxt/**",
      ".output/**",
      "node_modules/**",
      "public/**",
      "entrypoints/background/rime_emscripten.js",
      "entrypoints/background/rime_emscripten.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      "no-console": "off",
      "no-var": "off",
      "no-undef": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "warn",

      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        { "ts-expect-error": "allow-with-description" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);

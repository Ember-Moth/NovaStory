import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const files = ["**/*.{js,jsx,ts,tsx,mjs,cjs}"];
const tsFiles = ["**/*.{ts,tsx}"];

export default [
  {
    ignores: ["dist/", "out/"],
  },
  {
    files,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.nodeBuiltin,
        ...globals.node,
        Bun: "readonly",
      },
    },
  },
  {
    files: tsFiles,
    languageOptions: {
      parser: tsParser,
    },
  },
  {
    files,
    ...js.configs.recommended,
  },
  {
    files,
    ...react.configs.flat.recommended,
    ...react.configs.flat["jsx-runtime"],
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files,
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  {
    files,
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  eslintConfigPrettier,
];

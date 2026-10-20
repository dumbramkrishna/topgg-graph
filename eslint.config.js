import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// `import.meta.dirname` requires Node >= 20.11, but CI still tests Node 18.
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  js.configs.recommended,
  // ---- src/ : full strict type-checked rules ----
  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir,
      },
    },
  },
  // ---- tests/ and examples/ : basic rules, no type-checking ----
  // (tests reference devDeps like vitest; examples reference optional/peer deps
  //  that are not guaranteed to be installed — type-checking them here would
  //  produce spurious "unresolved module" errors on CI)
  {
    files: ["tests/**/*.ts", "examples/**/*.ts"],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // ---- Config files : type-checking disabled ----
  {
    files: ["eslint.config.js", "tsup.config.ts", "vitest.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
);

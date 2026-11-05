import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const nextConfigs = [...nextVitals, ...nextTs].map((config) => ({
  ...config,
  files: config.files ? config.files.map((pattern) => `apps/web/${pattern}`) : ["apps/web/**/*.{js,jsx,ts,tsx,mjs}"],
}));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "apps/api/drizzle/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  {
    files: ["apps/api/**/*.ts", "*.mjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  ...nextConfigs,
  {
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-console": ["warn", { allow: ["info", "warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    files: ["apps/api/src/**/*.schemas.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: [".*", "!zod"], message: "*.schemas.ts is shared with the web: import only zod." }] },
      ],
    },
  },
  {
    files: ["apps/api/test/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  prettier,
);

// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    "**/.wrangler/**",
    "**/.turbo/**",
    "**/node_modules/**",
    "**/worker-configuration.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },

  // React (las dos SPA y @delyra/ui)
  {
    files: ["**/*.tsx"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },

  // El logger estructurado es el único punto que escribe en consola.
  {
    files: ["apps/api/src/lib/logger.ts"],
    rules: { "no-console": "off" },
  },

  // Ficheros de configuración y JS sueltos: sin reglas que necesiten tipos.
  {
    files: ["**/*.{js,mjs,cjs}", "**/*.config.ts", "e2e/**/*.ts", "scripts/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  prettier,
);

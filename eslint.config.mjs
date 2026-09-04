import js from "@eslint/js"
import tsPlugin from "typescript-eslint"
import globals from "globals"

export default [
  {
    ignores: ["dist/**", "node_modules/**", ".wrangler/**", "public/**"],
  },
  js.configs.recommended,
  ...tsPlugin.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]

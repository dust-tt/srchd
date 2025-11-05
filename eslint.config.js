// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Enforce trailing commas wherever possible
      "comma-dangle": [
        "error",
        {
          arrays: "always-multiline",
          objects: "always-multiline",
          imports: "always-multiline",
          exports: "always-multiline",
          functions: "always-multiline",
        },
      ],
      // Allow explicit any types
      "@typescript-eslint/no-explicit-any": "off",
      // Allow @ts-ignore comments
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": "allow-with-description",
        },
      ],
      // Allow lexical declarations in case blocks
      "no-case-declarations": "off",
      // Allow switch cases without break when they have returns
      "no-fallthrough": [
        "error",
        {
          allowEmptyCase: true,
        },
      ],
      // Allow unused variables if they start with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);

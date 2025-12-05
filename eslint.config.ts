// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".prettierrc.js",
      "eslint.config.ts",
      "**/*.config.js",
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      "**/build/**",
      "**/migrations/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
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
    // Disable all 'any' type safety rules
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-base-to-string": "off",
    // Allow @ts-ignore comments
    "@typescript-eslint/ban-ts-comment": [
      "error",
      {
        "ts-ignore": "allow-with-description",
      },
    ],
    // Allow lexical declarations in case blocks
    "no-case-declarations": "off",
    // Prefer nullish coalescing operator (??) over logical OR (||)
    "@typescript-eslint/prefer-nullish-coalescing": "error",
    // Allow async functions without await
    "@typescript-eslint/require-await": "off",
    // Allow floating promises
    "@typescript-eslint/no-floating-promises": "off",
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
});

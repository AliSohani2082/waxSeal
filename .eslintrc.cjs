/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
    ecmaVersion: 2022,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  ignorePatterns: ["dist/", "node_modules/", "*.cjs"],
  overrides: [
    {
      // crypto-core must stay pure: no DOM globals, no browser/chrome extension APIs.
      // This is what lets it run identically in Node, the MV3 service worker, and
      // content scripts, and keeps the security-critical module independently auditable.
      files: ["packages/crypto-core/src/**/*.ts"],
      env: {
        browser: false,
      },
      rules: {
        "no-restricted-globals": [
          "error",
          "document",
          "window",
          "chrome",
          "browser",
        ],
      },
    },
  ],
};

// ESLint for every workspace (`npm run lint`): ESLint's recommended rules
// plus typescript-eslint's, for the TypeScript and TSX sources.
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { browser: true, node: true, es2022: true },
  ignorePatterns: ["dist/", "node_modules/"],
  rules: {
    // A leading underscore marks a parameter or variable kept on purpose.
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  },
};

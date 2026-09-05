const js = require("@eslint/js");

module.exports = [
  { ignores: ["node_modules/", "**/dist/"] },
  {
    ...js.configs.recommended,
    files: ["custom_components/openmap/frontend/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        customElements: "readonly",
        CustomEvent: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        getComputedStyle: "readonly",
        queueMicrotask: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];

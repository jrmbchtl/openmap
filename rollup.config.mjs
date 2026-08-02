import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

const DIST = "custom_components/openmap/frontend/dist";

export default {
  input: "custom_components/openmap/frontend/src/openmap-card.js",
  output: {
    file: `${DIST}/openmap-card.js`,
    format: "iife",
    name: "OpenMapCard",
    sourcemap: false,
  },
  plugins: [
    nodeResolve(),
    commonjs(),
    terser({
      format: {
        comments: false,
      },
    }),
  ],
};
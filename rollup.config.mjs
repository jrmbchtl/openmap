import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import { readdir, unlink, readFile, writeFile } from "node:fs/promises";

const DIST = "custom_components/openmap/frontend/dist";

export default {
  input: "custom_components/openmap/frontend/src/openmap-card.js",
  output: {
    dir: DIST,
    format: "es",
    entryFileNames: "openmap-card.js",
    chunkFileNames: "[name]-[hash].js",
    sourcemap: false,
  },
  plugins: [
    {
      name: "remove-obsolete-openmap-chunks",
      async writeBundle(_options, bundle) {
        for (const file of await readdir(DIST)) {
          if (/^(map-engine|openmap-card-editor)-[\w-]{8}\.js$/.test(file) && !Object.hasOwn(bundle, file)) await unlink(`${DIST}/${file}`);
        }
        const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
        const notices = ["Open Map bundled third-party notices\nAll runtime dependencies are listed conservatively, including tree-shaken packages.\n"];
        for (const [directory, pkg] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
          if (!directory || pkg.dev) continue;
          notices.push(`\n=== ${directory.replace(/^node_modules\//, "")} ${pkg.version} (${pkg.license || "see license"}) ===\n`);
          const files = (await readdir(directory)).filter(file => /^(licen[cs]e|copying)(\.|$)/i.test(file));
          for (const file of files) notices.push(await readFile(`${directory}/${file}`, "utf8"));
        }
        await writeFile(`${DIST}/THIRD_PARTY_NOTICES.txt`, notices.join("\n"));
      },
    },
    nodeResolve(),
    commonjs(),
    terser({
      format: {
        comments: false,
      },
    }),
  ],
};

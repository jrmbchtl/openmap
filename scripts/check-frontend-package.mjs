import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAst } from "rollup/parseAst";

export const DIST = "custom_components/openmap/frontend/dist";

// Read only the selected Git snapshot, never a working-directory fallback.
export function checkFrontendPackage(paths, readFile) {
  const files = new Set(paths);
  const errors = [];
  const visited = new Set();
  const pending = [`${DIST}/openmap-card.js`];
  if (!files.has(`${DIST}/THIRD_PARTY_NOTICES.txt`)) {
    errors.push(`Missing bundled notices: ${DIST}/THIRD_PARTY_NOTICES.txt`);
  }
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!files.has(file)) {
      errors.push(`Missing frontend module: ${file}`);
      continue;
    }
    let ast;
    try {
      ast = parseAst(readFile(file));
    } catch (error) {
      errors.push(`Cannot parse ${file}: ${error.message}`);
      continue;
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type) && node.source) {
        const specifier = node.source.value;
        if (node.source.type !== "Literal" || typeof specifier !== "string") {
          errors.push(`Nonliteral module import in ${file}`);
        } else if (!/^(\.\/|\.\.\/)/.test(specifier) || /[\\?#%]/.test(specifier)) {
          errors.push(`Unsupported external or encoded import in ${file}: ${specifier}`);
        } else {
          const target = posix.normalize(posix.join(posix.dirname(file), specifier));
          if (!target.startsWith(`${DIST}/`) || !target.endsWith(".js")) {
            errors.push(`Import leaves the JavaScript distribution in ${file}: ${specifier}`);
          } else if (!files.has(target)) {
            errors.push(`Missing frontend module: ${target} (imported by ${file})`);
          } else {
            pending.push(target);
          }
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") walk(value);
      }
    }
    walk(ast);
  }
  return { ok: errors.length === 0, errors, modules: visited.size };
}

export function checkGitPackage({ cwd = process.cwd(), ref = "HEAD", staged = false } = {}) {
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const tree = staged ? git(["write-tree"]).trim() : git(["rev-parse", "--verify", "--end-of-options", `${ref}^{tree}`]).trim();
  const paths = git(["ls-tree", "--full-tree", "-r", "--name-only", "-z", tree, "--", DIST]).split("\0").filter(Boolean);
  return { ...checkFrontendPackage(paths, file => git(["show", `${tree}:${file}`])), tree, source: staged ? "staged index" : ref };
}

function main(args) {
  const usage = "Usage: node scripts/check-frontend-package.mjs [--ref <git-ref> | --staged]";
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return;
  }
  let options = {};
  if (args.length === 1 && args[0] === "--staged") options = { staged: true };
  else if (args.length === 2 && args[0] === "--ref") options = { ref: args[1] };
  else if (args.length) throw new Error(usage);
  const result = checkGitPackage(options);
  if (!result.ok) {
    console.error(`Open Map frontend package is incomplete (${result.source}):\n${result.errors.map(error => `- ${error}`).join("\n")}`);
    console.error("Build, stage every generated dist file (including new chunks), and check --staged before committing.");
    process.exitCode = 1;
  } else {
    console.log(`Open Map frontend package complete: ${result.modules} modules (${result.source}).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

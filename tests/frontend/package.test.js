import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkFrontendPackage, checkGitPackage, DIST } from "../../scripts/check-frontend-package.mjs";

function fixture(overrides = {}) {
  const files = {
    "openmap-card.js": "import './editor.js'; import('./engine.js'); export const name = 'map';",
    "editor.js": "export { name } from './openmap-card.js'; export * from './shared.js';",
    "engine.js": "import './shared.js';",
    "shared.js": "export const value = 1;",
    "THIRD_PARTY_NOTICES.txt": "Bundled license notices",
    ...overrides,
  };
  return Object.fromEntries(Object.entries(files).filter(([, value]) => value !== null).map(([file, value]) => [`${DIST}/${file}`, value]));
}

const check = files => checkFrontendPackage(Object.keys(files), file => files[file]);

test("package check follows static/dynamic imports, re-exports and cycles", () => {
  const result = check(fixture());
  assert.equal(result.ok, true);
  assert.equal(result.modules, 4);
});

test("package check rejects missing entry and license notices", () => {
  const result = check(fixture({ "openmap-card.js": null, "THIRD_PARTY_NOTICES.txt": null }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("package check reports a missing lazy chunk and its importer", () => {
  const result = check(fixture({ "engine.js": null }));
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /engine\.js .*imported by .*openmap-card\.js/);
});

test("package check detects dependencies missing below an included chunk", () => {
  const result = check(fixture({ "shared.js": null }));
  assert.equal(result.ok, false);
  assert(result.errors.every(error => error.includes("shared.js")));
});

test("package check rejects computed, external and escaping imports", () => {
  for (const source of ["import(variable);", "import 'ol/Map.js';", "import '../outside.js';", "import './engine.js?cache=1';", "import './%65ngine.js';"]) {
    assert.equal(check(fixture({ "openmap-card.js": source })).ok, false, source);
  }
});

test("package check parses syntax and does not treat comments or text as imports", () => {
  assert.equal(check(fixture({ "openmap-card.js": "const text = \"import('./missing.js')\"; // import './missing.js'" })).ok, true);
  assert.equal(check(fixture({ "engine.js": "export {" })).ok, false);
});

test("Git package check cannot be satisfied by an untracked or unstaged chunk", () => {
  mkdirSync("/tmp/opencode", { recursive: true });
  const cwd = mkdtempSync("/tmp/opencode/openmap-package-check-");
  const git = args => execFileSync("git", args, { cwd, stdio: "pipe" });
  try {
    git(["init", "-q"]);
    mkdirSync(join(cwd, DIST), { recursive: true });
    const files = fixture();
    for (const [file, value] of Object.entries(files)) writeFileSync(join(cwd, file), value);
    git(["add", "--", `${DIST}/openmap-card.js`, `${DIST}/editor.js`, `${DIST}/shared.js`, `${DIST}/THIRD_PARTY_NOTICES.txt`]);
    assert.equal(checkGitPackage({ cwd, staged: true }).ok, false);
    git(["add", "--", `${DIST}/engine.js`]);
    assert.equal(checkGitPackage({ cwd, staged: true }).ok, true);
    writeFileSync(join(cwd, DIST, "engine.js"), "import './omitted-new-chunk.js';");
    assert.equal(checkGitPackage({ cwd, staged: true }).ok, true, "Unstaged source must not alter the snapshot");
    git(["add", "--", `${DIST}/engine.js`]);
    assert.equal(checkGitPackage({ cwd, staged: true }).ok, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

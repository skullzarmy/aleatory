/**
 * Identifier-shaped things the docs name in backticks, against the code.
 *
 * This is the check that would have caught `renderer_ref`, `prng` and
 * `added_at`: fields described in the architecture that no code ever had. A
 * name in backticks reads as a fact about the system, and an invented one is
 * indistinguishable from a real one to anybody who was not there.
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

// Everything the code actually contains.
const codeFiles = execSync(
  "git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'contract/*.py' 'netlify/**/*.mts' 'scripts/*.mts' 'scripts/*.mjs' 'isolate/*.html' 'public/templates/*/index.html' 'admin/src/**/*.ts' 'admin/src/**/*.tsx' '.env.example' 'package.json'",
  { encoding: "utf8" }).trim().split("\n").filter(existsSync);
const code = codeFiles.map(f => readFileSync(f, "utf8")).join("\n");

const docs = execSync("git ls-files '*.md'", { encoding: "utf8" }).trim().split("\n");

// Identifier-shaped things in backticks: snake_case, camelCase, CONST_CASE.
const IDENT = /`([A-Za-z_$][A-Za-z0-9_$]{3,40})`/g;
// systemd directives, named in the deploy guide and not defined by us.
const SYSTEMD = /^(EnvironmentFile|TimeoutStopSec|ExecStart|WantedBy|RestartSec|StandardOutput)$/;
const SKIP = new Set(["true","false","null","undefined","string","number","boolean","bytes","address","nat","mutez","timestamp","unit","main","node","npm","npx","this","self","https","http","json","html","index","README","LICENSE","admin","docs","scripts","contract","isolate","netlify","public","templates","vendor","dist","build","lib","src"]);

const missing = new Map();
for (const doc of docs) {
  const text = readFileSync(doc, "utf8");
  for (const m of text.matchAll(IDENT)) {
    const id = m[1];
    if (SKIP.has(id) || SKIP.has(id.toLowerCase())) continue;
    if (code.includes(id)) continue;
    if (SYSTEMD.test(id)) continue;
    if (!missing.has(id)) missing.set(id, new Set());
    missing.get(id).add(doc);
  }
}

if (missing.size === 0) {
  console.log("every identifier the docs name exists in the code");
} else {
  console.log(`${missing.size} identifiers named in docs and absent from the code:\n`);
  for (const [id, where] of [...missing].sort()) {
    console.log(`  ${id.padEnd(24)} ${[...where].join(", ")}`);
  }
}
process.exit(missing.size === 0 ? 0 : 1);

/**
 * Every relative link in every tracked markdown file, checked.
 *
 * A link into src/app/docs/interface resolves as a path and lands a reader on
 * a Next page directory rather than the spec, which is the kind of thing that
 * only looks fine to whoever wrote it.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const files = execSync("git ls-files '*.md'", { encoding: "utf8" }).trim().split("\n");
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const target = m[2].split("#")[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const p = resolve(dirname(f), target);
    if (!existsSync(p)) { bad++; console.log(`BROKEN  ${f}: ${m[2]}`); continue; }
    if (statSync(p).isDirectory() && !existsSync(join(p, "README.md"))) {
      bad++; console.log(`DIR     ${f}: ${m[2]}  (a directory with no README, reads as source)`);
    }
  }
}
console.log(bad === 0 ? "\nall relative links resolve" : `\n${bad} problem(s)`);

/**
 * isolate/index.html must be exactly what isolate/build.mjs produces from
 * isolate/index.src.html. The Netlify build regenerates it at deploy time, but
 * a PR that edits one without the other should fail here, not get discovered
 * live.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isolate = join(root, "isolate");

const before = readFileSync(join(isolate, "index.html"), "utf8");
execFileSync("node", ["build.mjs"], { cwd: isolate, stdio: "inherit" });
const after = readFileSync(join(isolate, "index.html"), "utf8");

if (before !== after) {
    console.error(
        "\nisolate/index.html does not match what isolate/build.mjs produces from " +
            "index.src.html. Run `node isolate/build.mjs` and commit the result.",
    );
    process.exit(1);
}

console.log("isolate/index.html matches its source");

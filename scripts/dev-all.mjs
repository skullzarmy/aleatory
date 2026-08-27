/**
 * Starts both local development services concurrently:
 *  1. The isolate host (scripts/dev-isolate.mjs) at http://localhost:4321
 *  2. The Next.js web application (next dev --turbopack) at http://localhost:3000
 *
 * Handles graceful shutdown on SIGINT/SIGTERM so no orphaned node processes remain.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const isolate = spawn(process.execPath, [join(here, "dev-isolate.mjs")], {
    cwd: root,
    stdio: "inherit",
});

const next = spawn("npx", ["next", "dev", "--turbopack"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
});

let exiting = false;
function shutdown(code = 0) {
    if (exiting) return;
    exiting = true;
    try {
        if (!isolate.killed) isolate.kill("SIGTERM");
        if (!next.killed) next.kill("SIGTERM");
    } catch {
        // ignore errors during cleanup
    }
    process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

isolate.on("exit", (code) => {
    if (!exiting && code !== 0 && code !== null) {
        console.error(`[dev:isolate] exited with code ${code}`);
        shutdown(code);
    }
});

next.on("exit", (code) => {
    if (!exiting && code !== 0 && code !== null) {
        console.error(`[next dev] exited with code ${code}`);
        shutdown(code);
    }
});

/**
 * The dependency proxy, and the things it must refuse.
 *
 * This route fetches a URL built from a query string and serves the result
 * from our own origin, which is the shape of an open proxy if the pieces are
 * not constrained. The validation cases below are the constraint, and they run
 * without a network.
 *
 * The one case that needs a network is the one that matters most: that a real
 * library arrives and its bytes hash to what was recorded. It is skipped
 * offline rather than failing, so a flight does not turn into a red suite.
 *
 * Run: npm test
 */

import { GET } from "@/app/api/dep/route";
import { THREE_DEP } from "./runtimes";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const q = (params: Record<string, string>) =>
    new Request(`http://local/api/dep?${new URLSearchParams(params)}`);

const GOOD = {
    id: THREE_DEP.id,
    version: THREE_DEP.version,
    path: THREE_DEP.registry.path,
    hash: THREE_DEP.hash,
};

async function run() {
    console.log("\nDependency proxy\n");

    // Refusals. None of these reach the network.
    const refusals: [string, Record<string, string>][] = [
        ["a missing hash is refused", { ...GOOD, hash: "" }],
        ["a short hash is refused", { ...GOOD, hash: "abc123" }],
        ["a traversing path is refused", { ...GOOD, path: "../../etc/passwd" }],
        ["an absolute path is refused", { ...GOOD, path: "//evil.example/x.js" }],
        ["a traversing id is refused", { ...GOOD, id: "../evil" }],
        ["a URL as an id is refused", { ...GOOD, id: "https://evil.example" }],
        ["a dist-tag instead of a version is refused", { ...GOOD, version: "latest" }],
        ["a range instead of a version is refused", { ...GOOD, version: "^1.0.0" }],
    ];

    for (const [name, params] of refusals) {
        const res = await GET(q(params));
        check(name, res.status === 400, `got ${res.status}`);
    }

    // A scoped package is legitimate and must not be caught by the above.
    {
        const res = await GET(q({ ...GOOD, id: "@scope/pkg", version: "1.0.0" }));
        check("a scoped package name is allowed through validation", res.status !== 400);
    }

    let online = true;
    try {
        await fetch("https://unpkg.com/", { method: "HEAD" });
    } catch {
        online = false;
    }

    if (!online) {
        console.log("  skip network checks, no connection\n");
    } else {
        {
            const res = await GET(q(GOOD));
            const text = res.status === 200 ? await res.text() : "";
            check(
                `${THREE_DEP.label} arrives and verifies`,
                res.status === 200 && text.length === THREE_DEP.approxBytes,
                `status ${res.status}, ${text.length} bytes`,
            );
            check(
                "the served bytes report the hash that was asked for",
                res.headers.get("x-alea-hash") === THREE_DEP.hash,
            );
        }

        {
            // The whole point: a mirror serving different bytes under a pinned
            // version is refused rather than passed along.
            const res = await GET(q({ ...GOOD, hash: "0".repeat(64) }));
            check("bytes that do not match the recorded hash are refused", res.status === 502);
        }
    }

    console.log(
        failures === 0
            ? "\nThe proxy serves only what verifies.\n"
            : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error("\nThe suite could not run:", e instanceof Error ? e.message : e);
    process.exit(1);
});

/**
 * What a generator's `content` is missing, and what patching it adds. Both
 * ends of the same decision: `missingTzipFields` says whether the "push an
 * update" button shows, `patchTzipFields` is what it sends.
 *
 * `symbol` is deliberately absent from these checks — it belongs on the
 * per-token document (provider/metadata.test.ts), not here.
 *
 * Run: npm test
 */

import { missingTzipFields, patchTzipFields } from "./tzip";
import { BRAND } from "./config";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

console.log("\nTZIP backfill\n");

// A generator deployed before any of this existed.
{
    const old = { name: "Old Generator", interfaces: ["TZIP-012", "TZIP-016", "ALEATORY-001"] };
    const missing = missingTzipFields(old);
    check(
        "homepage and TZIP-021 both flag on an old document",
        ["homepage", "TZIP-021"].every((f) => missing.includes(f)),
    );

    const patched = patchTzipFields(old);
    check("the patch sets homepage", patched.homepage === BRAND.url);
    check(
        "the patch adds TZIP-021 to interfaces",
        Array.isArray(patched.interfaces) && patched.interfaces.includes("TZIP-021"),
    );
    check(
        "the original interfaces are kept, not replaced",
        Array.isArray(patched.interfaces) &&
            ["TZIP-012", "TZIP-016", "ALEATORY-001"].every((i) =>
                (patched.interfaces as string[]).includes(i),
            ),
    );
    check("name passes through untouched", patched.name === "Old Generator");
    check("patching reports nothing missing afterward", missingTzipFields(patched).length === 0);
    check("the patch never adds a symbol key", !("symbol" in patched));
}

// A generator deployed after this shipped.
{
    const current = {
        name: "New Generator",
        interfaces: ["TZIP-012", "TZIP-016", "TZIP-021", "ALEATORY-001"],
        homepage: BRAND.url,
    };
    check("nothing is missing", missingTzipFields(current).length === 0);
}

// Only one field gone, from editing content directly rather than a fresh deploy.
{
    const partial = {
        name: "Partial",
        interfaces: ["TZIP-012", "TZIP-016", "ALEATORY-001"],
        homepage: BRAND.url,
    };
    const missing = missingTzipFields(partial);
    check("only TZIP-021 is reported missing", missing.length === 1 && missing[0] === "TZIP-021");
}

// An artist's own value is never overwritten, even if it differs from ours.
{
    const custom = { name: "Custom", homepage: "https://example.com" };
    const patched = patchTzipFields(custom);
    check(
        "an existing homepage is kept, not overwritten",
        patched.homepage === "https://example.com",
    );
}

// `interfaces` missing or malformed is a document that predates the key,
// not a crash.
{
    const noInterfaces = { name: "No interfaces" };
    const patched = patchTzipFields(noInterfaces);
    check(
        "a document with no interfaces array gets one with just TZIP-021",
        Array.isArray(patched.interfaces) && patched.interfaces.length === 1,
    );
}

// Keys this app has no typed model for still round-trip.
{
    const withExtra = { name: "Has extras", aleaCoverSeed: "deadbeef", tags: ["a", "b"] };
    const patched = patchTzipFields(withExtra);
    check("an unmodeled field survives the patch", patched.aleaCoverSeed === "deadbeef");
    check("tags survives the patch", JSON.stringify(patched.tags) === JSON.stringify(["a", "b"]));
}

console.log(
    failures === 0 ? "\nEvery document patches cleanly.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

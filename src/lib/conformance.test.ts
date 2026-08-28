/**
 * ALEATORY-001, checked against every place that implements it.
 *
 * The standard is only worth having if the implementations agree, and there
 * are four of them: the isolate that runs a piece on this site, the renderer
 * that produces the canonical image, the dev harness inside every template an
 * artist downloads, and the library resolvers on both sides of the wire.
 *
 * They drifted. The dev harness made none of the substitutions the other two
 * make, so a generator calling `Math.random` was genuinely random in an
 * artist's editor and seeded when it rendered, and one reading the clock drew
 * differently on a different day. That is discovered after publishing, which
 * is the worst moment, and nothing announced it.
 *
 * Source of truth is docs/interface.md. When the spec changes, this fails
 * until the implementations follow.
 *
 * Run: npm test
 */

import { readFileSync } from "node:fs";
import { CATALOGUE } from "./libraries";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const read = (p: string) => readFileSync(p, "utf8");

/** §7. The whole of `$alea`, and a renderer installs exactly this. */
const SURFACE = [
    "seed",
    "random",
    "rand",
    "randInt",
    "randBetween",
    "pick",
    "chance",
    "params",
    "param",
    "features",
    "ready",
];

/**
 * Everything that installs `$alea`.
 *
 * The templates are included deliberately. A dev harness that diverges is not
 * a lesser problem than a renderer that does: it is the one an artist actually
 * develops against.
 */
const HARNESSES: { name: string; path: string; renderer: boolean }[] = [
    { name: "isolate", path: "isolate/index.html", renderer: true },
    { name: "renderer", path: "netlify/functions/lib/render.mts", renderer: true },
    { name: "template vanilla", path: "public/templates/vanilla/index.html", renderer: false },
    { name: "template svg", path: "public/templates/svg/index.html", renderer: false },
    { name: "template p5", path: "public/templates/p5/index.html", renderer: false },
    { name: "template custom", path: "public/templates/custom/index.html", renderer: false },
];

function auditHarnesses() {
    console.log("\nThe render harness (§7)\n");

    for (const h of HARNESSES) {
        const src = read(h.path);

        const missing = SURFACE.filter(
            (m) => !new RegExp(`\\b${m}\\s*:`).test(src),
        );
        check(`${h.name}: installs the whole $alea surface`, missing.length === 0, `missing ${missing.join(", ")}`);

        // The two substitutions §7 requires of anything that renders, and
        // that a dev harness needs for local work to mean anything.
        check(
            `${h.name}: replaces Math.random with the seeded stream`,
            /Math\.random\s*=/.test(src),
        );
        check(
            `${h.name}: freezes Date`,
            /RealDate\s*=\s*Date/.test(src) && /static now\(\)/.test(src),
        );
        check(
            `${h.name}: freezes performance.now`,
            /performance\.now\s*=\s*function/.test(src),
        );

        // The seed is a base58 operation hash. parseInt of it in base 16 is
        // NaN, NaN coerced by an unsigned shift is 0, and every piece then
        // draws the same thing. This has happened.
        check(
            `${h.name}: never parses the seed as a number`,
            !/parseInt\s*\(\s*(seed|hash)/.test(src),
        );

        // One PRNG across all of them, or a seed pinned locally draws
        // something else on chain.
        check(
            `${h.name}: uses the same xmur3 seeding`,
            src.includes("1779033703") && src.includes("3432918353"),
        );
        check(
            `${h.name}: uses the same sfc32 stream`,
            src.includes("2246822507") && src.includes("3266489909"),
        );
    }
}

/** §1, declared libraries: the same rules on both sides of the wire. */
function auditLibraries() {
    console.log("\nDeclared libraries (§1)\n");

    for (const dep of CATALOGUE) {
        check(
            `${dep.label} ${dep.version}: recorded with everything a stranger needs`,
            Boolean(dep.id && dep.version && dep.registry.path && dep.hash),
            "id, version, path and hash are what make a mirror replaceable",
        );
    }

    const studio = read("src/lib/runtimes.ts");
    const renderer = read("netlify/functions/lib/libraries.mts");
    const proxy = read("src/app/api/dep/route.ts");

    check(
        "the studio verifies before it uses a library",
        /hash\s*!==\s*spec\.hash/.test(studio),
    );
    check(
        "the renderer verifies before it uses a library",
        /blake2bHex/.test(renderer) && /hash/.test(renderer),
    );
    check(
        "the proxy verifies before it serves a library",
        /got\s*!==\s*hash/.test(proxy),
    );
    check(
        "the proxy refuses to serve without a hash",
        /HASH\.test\(hash\)/.test(proxy),
    );

    // Both sides reach the same mirrors, so a library that resolves for the
    // studio resolves for anyone rendering the piece later.
    for (const mirror of ["unpkg.com", "cdn.jsdelivr.net"]) {
        check(`the renderer can reach ${mirror}`, renderer.includes(mirror));
        check(`the proxy can reach ${mirror}`, proxy.includes(mirror));
    }

    check(
        "the browser never reaches a mirror itself",
        !/unpkg\.com|cdn\.jsdelivr\.net\/npm/.test(studio),
        "connect-src is 'self'; a CDN in the page is a third party watching visitors",
    );
}

/** §7 conformance, and §5: a piece must not reach the network while rendering. */
function auditIsolation() {
    console.log("\nIsolation (§5, §7)\n");

    const isolate = read("isolate/index.html");
    check(
        "the isolate forbids the network structurally",
        /connect-src\s+'none'/.test(isolate),
        "the CSP is the control; the JS overrides are only reporting",
    );

    const spec = read("docs/interface.md");
    check(
        "the spec still says what this suite is checking",
        spec.includes("$alea.ready()") &&
            spec.includes("Math.random") &&
            spec.includes("clock is frozen"),
        "docs/interface.md changed shape; this suite may be checking the wrong thing",
    );
}

console.log("ALEATORY-001 conformance");
auditHarnesses();
auditLibraries();
auditIsolation();

console.log(
    failures === 0
        ? "\nEvery implementation agrees with the standard.\n"
        : `\n${failures} conformance failure(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);

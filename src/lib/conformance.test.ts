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
import { SUGGESTED, specFor } from "./libraries";

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

        // A template that writes `alea.` must have bound it, by assignment
        // or as a lifecycle argument. An unbound one is a ReferenceError at
        // the moment the piece would have signalled it was finished, so the
        // capture is of a blank frame and nothing says why.
        if (!h.renderer) {
            const usesShort = /(?<![$\w.])alea\s*\./.test(src);
            const binds =
                /\b(?:var|let|const)\s+alea\s*=/.test(src) ||
                /function\s*\(\s*alea\s*\)/.test(src) ||
                /\(\s*alea\s*\)\s*(?:=>|\{)/.test(src);
            check(
                `${h.name}: binds alea before using it`,
                !usesShort || binds,
                "alea. is written but never assigned or received",
            );
        }

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

    for (const coordinate of SUGGESTED) {
        check(`${coordinate} parses as a coordinate`, specFor(coordinate) !== null);
    }
    check("a version is required", specFor("p5") === null);
    check("a scoped package parses", specFor("@scope/pkg@1.0.0") !== null);
    check("a file may be named", specFor("d3@7.9.0/dist/d3.min.js") !== null);

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

/**
 * The documentation, against what is actually declarable.
 *
 * A list of libraries in prose goes stale the moment one is added, and an
 * artist reading it declares something that cannot load. The doc has to name
 * exactly the catalog.
 */
function auditDocs() {
    console.log("\nDocumentation (§1)\n");

    const doc = read("docs/libraries.md");
    check(
        "libraries.md says any npm package can be declared",
        /any package on npm|any npm package/i.test(doc),
        "the limit was ours and it is gone; the doc must not reinstate it",
    );
    check(
        "libraries.md does not describe a list of allowed libraries",
        !/not in the catalog/i.test(doc),
    );

    // The membership test, from the contract that enforces it.
    //
    // The spec said two views for as long as the registry asked for three, so
    // anyone implementing section 5 literally built a contract that register
    // rejects with NOT_A_PROVIDER. The spec is the document strangers build
    // against, which makes it the worst place for this to be wrong.
    {
        const contract = read("contract/aleatory.py");
        const register = contract.slice(
            contract.indexOf("def register(self, provider)"),
            contract.indexOf("def deregister(self, provider)"),
        );
        const required = [...register.matchAll(/sp\.view\(\s*\n?\s*"([a-z_]+)"/g)].map(
            (m) => m[1],
        );

        check("register asks for views at all", required.length > 0, "parser found none");

        for (const doc of ["docs/interface.md", "docs/provider.md"]) {
            const text = read(doc);
            for (const view of required) {
                check(
                    `${doc} names ${view}, which register requires`,
                    text.includes(view),
                    "a provider built from this document would fail to register",
                );
            }
        }
    }

    check(
        "the kit server resolves whatever is declared",
        /cdn\.jsdelivr\.net/.test(read("scripts/kit/serve.mjs")),
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
auditDocs();
auditIsolation();

console.log(
    failures === 0
        ? "\nEvery implementation agrees with the standard.\n"
        : `\n${failures} conformance failure(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);

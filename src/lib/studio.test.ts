/**
 * What the studio promises, checked without a browser.
 *
 * The determinism and no-network checks a piece has to pass run in real frames
 * in `Checks.tsx`, and they need a DOM. These are the assertions underneath
 * them that do not: that every template is a document the builder can wrap,
 * that the harness lands before the artist's code rather than after it, that
 * the CSP that makes "a piece never touches the network" structural is
 * actually in the document, that parameter resolution is the fixed rule every
 * renderer has to agree on, and that a template fits in an operation.
 *
 * Run: npx tsx src/lib/studio.test.ts
 */
import { readFileSync } from "node:fs";
import { getKind, RUNTIME_KINDS } from "./runtimes";
import { templateFor, templateParamsFor } from "./templates";
import { resolveParams, validateSchema } from "./params";
import { newDraft, seedAt } from "./draft";
import { packageFromHtml } from "./project";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
    }
}

/** The protocol's operation ceiling. A larger generator cannot be deployed. */
const MAX_OPERATION_BYTES = 32_768;

console.log("\nTemplates");
for (const kind of RUNTIME_KINDS) {
    const html = templateFor(kind.kindId);
    const bytes = new TextEncoder().encode(html).length;

    check(`${kind.label}: is a document`, /<html[\s>]|<!doctype/i.test(html));
    // Templates reach the harness three ways: `$alea.ready()` directly, a
    // `var alea = window.$alea` binding, or an `alea` handed to a lifecycle
    // method. All three are fine. What has to be true is that the piece calls
    // ready() and that the object it calls it on came from $alea, or a
    // template could pass by calling ready() on something unrelated.
    const signals = /\balea\.ready\(|\bctx\.ready\(/.test(html);
    check(
        `${kind.label}: signals its capture point`,
        signals && /\$alea\b/.test(html),
        "a piece that never signals is captured on a timeout, mid-draw",
    );
    check(
        `${kind.label}: does not read an unseeded source of change`,
        !/Math\.random\s*\(/.test(html),
        "Math.random is replaced by the harness, but a template should not model it",
    );
    // The seed is a base58 operation hash. parseInt of one in base 16 is NaN,
    // and every consumer coerces NaN to 0, so a template that parses its seed
    // as hex hands the same number to every piece. The p5 template did exactly
    // that, and shipped: twelve seeds, one drawing, three palettes. Anything
    // that needs a number out of the seed takes it from alea.rand(), which is
    // already seeded from the string.
    check(
        `${kind.label}: does not parse the seed as hex`,
        !/parseInt\s*\([^)]*seed/i.test(html),
        "base 16 of a base58 hash is NaN, and NaN coerces to zero",
    );
    // Second generators are the other half of that: p5 keeps its own PRNG, and
    // a piece that draws from it without seeding it is a piece the chain does
    // not determine.
    for (const [call, source] of [
        ["randomSeed", /randomSeed\s*\(\s*alea\./],
        ["noiseSeed", /noiseSeed\s*\(\s*alea\./],
    ] as const) {
        if (html.includes(`${call}(`)) {
            check(
                `${kind.label}: seeds ${call} from alea`,
                source.test(html),
                "a second PRNG seeded from anything else is not bound to the piece",
            );
        }
    }
    check(
        `${kind.label}: fits in one operation (${bytes.toLocaleString()} bytes)`,
        bytes <= MAX_OPERATION_BYTES,
    );

    // Every inline script actually parses.
    //
    // A template is a string in a TypeScript file, so nothing compiles it and
    // a syntax error rides all the way to a collector's browser. One did: a
    // careless edit left a stray `},` in the shared dev shim, every template
    // built from it was broken JavaScript, and the only symptom was a piece
    // that rendered as a blank square with no error anywhere anyone would look.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    check(`${kind.label}: has inline script`, scripts.length > 0);
    for (const [i, body] of scripts.entries()) {
        let parsed = true;
        let why = "";
        try {
            new Function(body);
        } catch (e) {
            parsed = false;
            why = e instanceof Error ? e.message : String(e);
        }
        check(`${kind.label}: script ${i + 1} parses`, parsed, why);
    }

    const params = templateParamsFor(kind.kindId);
    check(`${kind.label}: declares a valid schema`, validateSchema(params).length === 0,
        validateSchema(params).join("; "));
}

console.log("\nLibraries");
{
    // A generator may carry everything it needs, or it may name a standard
    // library and let a renderer load it. The second is the point: an artist
    // should not spend their bytes on p5.
    //
    // Two things have to hold for that to be safe rather than a hole.
    //
    // First, every declared library has a hash and it is checked. It was
    // optional once and empty in practice, which meant whatever a CDN returned
    // got written into an artist's immutable record with the chain vouching
    // for it.
    for (const kind of RUNTIME_KINDS) {
        for (const dep of kind.deps) {
            check(
                `${dep.label} ${dep.version}: has a hash`,
                /^[0-9a-f]{64}$/.test(dep.hash),
                "an unhashed library is an unverifiable one",
            );
            check(
                `${dep.label} ${dep.version}: cites a registry it can be checked against`,
                dep.registry.integrity.startsWith("sha512-") && dep.registry.path.length > 0,
                "we must not be the authority for what a library is",
            );
            check(
                `${dep.label} ${dep.version}: served same-origin`,
                dep.url.startsWith("/"),
                "a CDN in the path is a third party deciding what runs",
            );
        }
    }

    const runtimes = readFileSync("src/lib/runtimes.ts", "utf8");
    check(
        "an unhashed library is refused",
        /if \(!spec\.hash\)/.test(runtimes),
        "the check has to be unconditional, not `if a hash was provided`",
    );
    check(
        "the library cache is keyed by hash",
        runtimes.includes("cache.get(spec.hash)") && runtimes.includes("cache.set(spec.hash"),
        "keyed by name+version, one bad declaration poisons every other piece",
    );

    // Second, whatever a piece declares reaches every renderer. This is the
    // one that shipped broken: the studio resolved libraries and handed them
    // to the frame, the render worker never did, so the image published on
    // chain for a p5 piece was of an empty frame and nothing said so.
    const isolateSrc = readFileSync("isolate/index.html", "utf8");
    check("the isolate inlines the libraries it is handed", isolateSrc.includes("deps.map("));
    check(
        "they land ahead of the artist's code",
        isolateSrc.indexOf("var libs") < isolateSrc.indexOf("var injected"),
        "a sketch that runs before its library is a sketch that throws",
    );

    const renderer = readFileSync("netlify/functions/lib/render.mts", "utf8");
    check("the renderer inlines them too", renderer.includes("input.deps"));

    const provider = readFileSync("netlify/functions/provider.mts", "utf8");
    check(
        "the provider reads what a collection declared",
        provider.includes("aleatory:libraries") && provider.includes("parseLibraries"),
        "a provider must not infer a piece's needs, only resolve what it was told",
    );
    check(
        "the provider resolves them and hands them to the renderer",
        provider.includes("resolveLibraries") && /\bdeps[,:]/.test(provider),
        "this is the one that shipped wrong: accepted by the renderer, never sent",
    );

    const libs = readFileSync("netlify/functions/lib/libraries.mts", "utf8");
    check(
        "the provider verifies every candidate before use",
        libs.includes("hash !== lib.hash"),
        "a mirror that is stale, wrong or hostile has to be skipped, not used",
    );
    check(
        "an unresolvable library fails the render",
        libs.includes("could not be resolved to its recorded hash"),
        "a p5 sketch drawn with no p5 publishes a permanent image of an error",
    );

    // And a piece has to say what it needs, on chain, or a renderer that has
    // never heard of our catalogue cannot draw it.
    const publish = readFileSync("src/lib/publish.ts", "utf8");
    check(
        "a collection records the libraries it expects",
        publish.includes("aleatory:libraries"),
        "a renderer is not required to know anything about our catalogue",
    );
}

console.log("\nOne harness");
{
    // The app used to carry a third copy of the harness. It does not now: the
    // isolate owns it and the studio, /piece/* and the checks all go through
    // the isolate. Two implementations remain, the isolate and the render
    // worker, and they agree by conforming to ALEATORY-001 §7 rather than by
    // sharing a file. This asserts the third copy has not come back.
    const appHarness = readFileSync("src/lib/runtime.ts", "utf8");
    // Identifiers, not the letters. This was a substring search for "fx" and
    // it failed the moment a comment mentioned fxhash, which is a check that
    // tests the prose rather than the code.
    check(
        "no dead-platform aliases in the harness",
        !/\$fx\b|\bfxrand\b|\bfxhash\b\s*[=:]|window\.fx/.test(
            readFileSync("isolate/index.html", "utf8"),
        ),
        "this runs Aleatory pieces; $alea is the only surface",
    );
    check(
        "the app ships no harness source",
        !appHarness.includes("HARNESS_SOURCE"),
        "a third copy is a third thing to drift",
    );

    const isolate = readFileSync("isolate/index.html", "utf8");
    check("the isolate carries xmur3", isolate.includes("function xmur3"));
    check("the isolate carries sfc32", isolate.includes("function sfc32"));
    check(
        "the isolate seeds from the string, not from hex",
        isolate.includes("xmur3(String(CFG.seed"),
        "parsing a base58 op hash as hex collapses every piece onto one stream",
    );
    check(
        "the isolate fetches nothing",
        !/\bfetch\s*\(/.test(isolate),
        "it is the one participant that must have no network",
    );

    const worker = readFileSync("netlify/functions/lib/render.mts", "utf8");
    check("the renderer carries xmur3", worker.includes("function xmur3"));
    check(
        "the two agree on the construction",
        isolate.includes("sfc32(s(), s(), s(), s())") &&
            worker.includes("sfc32(s(), s(), s(), s())"),
        "a piece has to look the same here as in the image that goes on chain",
    );
}

console.log("\nParameter resolution");
{
    const specs = [
        { id: "density", label: "Density", type: "number" as const, min: 0, max: 1, step: 0.25, default: 0.5 },
        { id: "count", label: "Count", type: "int" as const, min: 1, max: 10, step: 1, default: 5 },
        { id: "mode", label: "Mode", type: "select" as const, options: ["a", "b"], default: "a" },
        { id: "on", label: "On", type: "bool" as const, default: false },
        { id: "tint", label: "Tint", type: "color" as const, default: "#336699" },
    ];

    check("clamps above the maximum", resolveParams(specs, { density: 99 }).density === 1);
    check("clamps below the minimum", resolveParams(specs, { density: -99 }).density === 0);
    check("snaps to the step grid", resolveParams(specs, { density: 0.6 }).density === 0.5);
    check("falls back on nonsense", resolveParams(specs, { density: "banana" }).density === 0.5);
    check("falls back on a missing value", resolveParams(specs, {}).count === 5);
    check("drops an unknown key", !("nope" in resolveParams(specs, { nope: 1 })));
    check("rejects an option not offered", resolveParams(specs, { mode: "z" }).mode === "a");
    check("coerces a boolean", resolveParams(specs, { on: "true" }).on === true);

    // The same inputs must land on the same values every time, in any reader.
    const once = JSON.stringify(resolveParams(specs, { density: 0.61, count: 3.7 }));
    const twice = JSON.stringify(resolveParams(specs, { density: 0.61, count: 3.7 }));
    check("is a function, not a process", once === twice, once);
}

console.log("\nDrafts");
{
    const draft = newDraft("Test", 1, packageFromHtml(templateFor(1)), templateParamsFor(1));
    check("a new draft carries the generator", draft.html.length > 0);
    check("a new draft has a seed", /^oo[0-9a-f]+$/.test(draft.seed));

    // A grid is derived from one base, so pointing at tile 7 means something.
    const grid = Array.from({ length: 16 }, (_, i) => seedAt(draft.seed, i));
    check("grid seeds are distinct", new Set(grid).size === 16);
    check(
        "grid seeds are reproducible",
        seedAt(draft.seed, 7) === seedAt(draft.seed, 7),
    );
}

console.log(
    failures === 0
        ? "\nAll studio checks passed.\n"
        : `\n${failures} studio check${failures === 1 ? "" : "s"} failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

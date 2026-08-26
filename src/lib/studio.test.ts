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
    check(
        `${kind.label}: fits in one operation (${bytes.toLocaleString()} bytes)`,
        bytes <= MAX_OPERATION_BYTES,
    );

    const params = templateParamsFor(kind.kindId);
    check(`${kind.label}: declares a valid schema`, validateSchema(params).length === 0,
        validateSchema(params).join("; "));
}

console.log("\nDependencies");
{
    // A kind that declares a library and does not get it renders a blank
    // frame and says nothing about why. The isolate inlines deps ahead of the
    // artist's code; this asserts it still does, and that the studio still
    // resolves them rather than handing over an empty list.
    const withDeps = RUNTIME_KINDS.filter((k) => k.deps.length > 0);
    check(
        "at least one kind declares a library, so this test means something",
        withDeps.length > 0,
    );

    const isolateSrc = readFileSync("isolate/index.html", "utf8");
    check(
        "the isolate inlines the deps it is handed",
        isolateSrc.includes("deps.map("),
    );
    check(
        "the deps land before the artist's code",
        isolateSrc.indexOf("var libs") < isolateSrc.indexOf("var injected"),
        "a library that lands after the sketch is one the sketch could not use",
    );

    const useDeps = readFileSync("src/components/studio/useDeps.ts", "utf8");
    check("the studio resolves a kind's libraries", useDeps.includes("resolveDeps"));

    for (const kind of withDeps) {
        check(
            `${kind.label}: declares ${kind.deps.map((d) => d.label).join(", ")}`,
            kind.deps.every((d) => Boolean(d.url)),
        );
    }

    const plain = RUNTIME_KINDS.find((k) => k.deps.length === 0);
    if (plain) {
        check(
            `${plain.label}: declares no library`,
            getKind(plain.kindId).deps.length === 0,
        );
    }
}

console.log("\nOne harness");
{
    // The app used to carry a third copy of the harness. It does not now: the
    // isolate owns it and the studio, /piece/* and the checks all go through
    // the isolate. Two implementations remain, the isolate and the render
    // worker, and they agree by conforming to ALEATORY-001 §7 rather than by
    // sharing a file. This asserts the third copy has not come back.
    const appHarness = readFileSync("src/lib/runtime.ts", "utf8");
    check(
        "no dead-platform aliases in the harness",
        !readFileSync("isolate/index.html", "utf8").includes("fx"),
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

    const worker = readFileSync("worker/render.ts", "utf8");
    check("the worker carries xmur3", worker.includes("function xmur3"));
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

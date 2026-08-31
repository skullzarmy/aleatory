/**
 * What the studio promises, checked without a browser.
 *
 * Everything here runs the code it is about. A template is parsed, a zip is
 * packaged, a schema is resolved, a draft is built. The determinism and
 * no-network checks need a DOM and run in real frames in `Checks.tsx`.
 *
 * Run: npx tsx src/lib/studio.test.ts
 */
import { getKind, RUNTIME_KINDS } from "./runtimes";
import { templateFor, templateParamsFor } from "./templates";
import { resolveParams, validateSchema } from "./params";
import { newDraft, seedAt } from "./draft";
import { packageFromHtml, packageFromZip } from "./project";
import { declaredIn, librariesIn, withLibraries } from "./libraries";
import { strToU8, zipSync } from "fflate";

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

console.log("\nPackaging a zip");
{
    const zip = (files: Record<string, string>) =>
        packageFromZip(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

    const flattened = zip({
        "index.html": `<html><head><link rel="stylesheet" href="style.css"></head><body><script src="sketch.js"></script></body></html>`,
        "style.css": `body{margin:0}`,
        "sketch.js": `$alea.ready();`,
    });
    check("inlines a stylesheet and a script", /<style>body\{margin:0\}<\/style>/.test(flattened.html) && /\$alea\.ready\(\);<\/script>/.test(flattened.html));
    check("counts what it actually inlined", flattened.notes.includes("Flattened 2 files into one document."), flattened.notes.join(" | "));
    check("has nothing left unresolved", flattened.unresolved.length === 0, flattened.unresolved.join(", "));

    // An <img> pointing at a file the package does not carry is the whole
    // reason to report anything: it renders as a hole, and silently.
    const holed = zip({
        "index.html": `<html><head><link rel="stylesheet" href="style.css"></head><body><img src="textures/gone.png"></body></html>`,
        "style.css": `body{background:url("textures/gone.png")}`,
    });
    check("reports a file the package does not carry", holed.unresolved.includes("textures/gone.png"), holed.unresolved.join(", "));
    check(
        "names each missing file once, however many times it is referenced",
        holed.unresolved.length === 1,
        holed.unresolved.join(", "),
    );
    check("still counts the stylesheet it did inline", holed.notes.includes("Flattened 1 file into one document."), holed.notes.join(" | "));

    // Only an <img> refers to it, so nothing else can report it on its behalf.
    const imageOnly = zip({
        "index.html": `<html><body><img src="textures/grain.png"></body></html>`,
    });
    check(
        "reports a missing image no stylesheet happens to mention",
        imageOnly.unresolved.includes("textures/grain.png"),
        imageOnly.unresolved.join(", ") || "(nothing reported)",
    );

    // A remote script cannot be inlined and is not missing from the package.
    // It is reported as what it is: something the sandbox will refuse later.
    const remote = zip({
        "index.html": `<html><body><script src="https://cdn.example.com/p5.js"></script></body></html>`,
    });
    check("leaves a remote script in place", /cdn\.example\.com/.test(remote.html));
    check("says so", remote.notes.some((n) => n.includes("remote script")), remote.notes.join(" | "));
    check("does not call a remote script a missing file", remote.unresolved.length === 0, remote.unresolved.join(", "));

    // What every OS produces when you zip a folder.
    const wrapped = zip({
        "my-piece/index.html": `<html><body><script src="sketch.js"></script></body></html>`,
        "my-piece/sketch.js": `$alea.ready();`,
    });
    check("finds index.html inside a wrapper folder", /\$alea\.ready\(\);<\/script>/.test(wrapped.html));
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

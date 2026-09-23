/**
 * What the studio promises, checked without a browser. The determinism and
 * no-network checks need a DOM and run in real frames in `Checks.tsx`.
 *
 * Run: npx tsx src/lib/studio.test.ts
 */
import { getKind, RUNTIME_KINDS } from "./runtimes";
import { templateFor, templateParamsFor } from "./templates";
import { resolveParams, validateSchema } from "./params";
import { newDraft, seedAt } from "./draft";
import { packageFromHtml, packageFromZip } from "./project";
import { declaredIn, librariesIn, recordFor, specFor, withLibraries } from "./libraries";
import { P5_DEP, THREE_DEP } from "./kinds";
import { detectParams } from "./detect";
import { MAX_PARAMS } from "./params";
import { MAX_CHUNK_BYTES, MAX_WALK_CHUNKS, publishPlan } from "./plan";
import { strToU8, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import blakejs from "blakejs";

const { blake2bHex } = blakejs;

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
    }
}

/**
 * The protocol's operation ceiling. A generator past it is still publishable —
 * it walks on chain a chunk at a time — but a starting template that costs an
 * artist four signatures is a bad first publish.
 */
const MAX_OPERATION_BYTES = 32_768;

console.log("\nTemplates");
for (const kind of RUNTIME_KINDS) {
    const html = templateFor(kind.kindId);
    const bytes = new TextEncoder().encode(html).length;

    check(`${kind.label}: is a document`, /<html[\s>]|<!doctype/i.test(html));
    // Templates reach the harness three ways: `$alea.ready()`, a
    // `var alea = window.$alea` binding, or an `alea` handed to a lifecycle
    // method. What has to hold is that ready() is called on something that came
    // from $alea, or a template passes by calling it on anything at all.
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
    // as hex hands the same number to every piece. A number out of the seed
    // comes from alea.rand(), which is already seeded from the string.
    check(
        `${kind.label}: does not parse the seed as hex`,
        !/parseInt\s*\([^)]*seed/i.test(html),
        "base 16 of a base58 hash is NaN, and NaN coerces to zero",
    );
    // p5 keeps its own PRNG, and a piece drawing from an unseeded one is a
    // piece the chain does not determine.
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

    // A template is a string in a TypeScript file, so nothing compiles it and a
    // syntax error rides all the way to a collector's browser, where it shows
    // as a blank square.
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
    check(
        `${kind.label}: declares a valid schema`,
        validateSchema(params).length === 0,
        validateSchema(params).join("; "),
    );
}

console.log("\nParameter resolution");
{
    const specs = [
        {
            id: "density",
            label: "Density",
            type: "number" as const,
            min: 0,
            max: 1,
            step: 0.25,
            default: 0.5,
        },
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

console.log("\nParameter detection in code");
{
    // The shape a real generator ships in: minified, unquoted keys, hints, a
    // select with five options, and the schema assigned again further down
    // under another name.
    const cosmicMasa = `<!doctype html><html><head><title>Cosmic Masa</title></head><body><script>
(function(){
if(!window.$alea){
window.$alea={rand:function(){return 0.5;},ready:function(){}};
window.$alea.paramsSchema=[
{id:"fold",label:"Fold Topology",type:"number",min:0.50,max:1.40,step:0.01,default:0.90,hint:"Hyperbolic paraboloid saddle curvature."},
{id:"blister",label:"Comal Heat",type:"number",min:0.20,max:0.85,step:0.01,default:0.55,hint:"Voronoi comal blister density and thermal charring."},
{id:"spice",label:"Salsa Chromatics",type:"number",min:0.20,max:0.80,step:0.01,default:0.45,hint:"Chili oil dispersion and fiery caustic glow."},
{id:"zest",label:"Micro Seasoning",type:"number",min:0.10,max:0.60,step:0.01,default:0.30,hint:"Mineral sea salt and cilantro seasoning flecks."},
{id:"roast",label:"Heirloom Palette",type:"select",options:["Masa Dorada","Salsa Verde","Al Pastor Sunset","Blue Corn Cosmic","Molcajete Noir"],default:"Masa Dorada",hint:"Culinary color palette selection."}
];
}
})();
window.ALEA_MAIN=piece;window.ALEA_PARAMS=Z;if(window.$alea&&window.ALEA_PARAMS){window.$alea.paramsSchema=window.ALEA_PARAMS;}
</script></body></html>`;

    const masa = detectParams(cosmicMasa);
    check(
        "reads all five params off a shipped generator",
        masa?.params.length === 5,
        String(masa?.params.length),
    );
    check(
        "keeps them in declaration order",
        masa?.params.map((p) => p.id).join(",") === "fold,blister,spice,zest,roast",
        masa?.params.map((p) => p.id).join(","),
    );
    check("keeps the artist's ranges", masa?.params[0].min === 0.5 && masa?.params[0].max === 1.4);
    check("keeps the artist's hints", masa?.params[0].hint?.startsWith("Hyperbolic") === true);
    check(
        "reads a select's options out of the code",
        masa?.params[4].options?.length === 5,
        String(masa?.params[4].options?.length),
    );
    check("reads a select's default", masa?.params[4].default === "Masa Dorada");

    // Reading is not running. The studio is the app's own origin, where the
    // artist's wallet session and their drafts live, and generator code only
    // ever runs in the isolate.
    const hostile = `<script>window.$alea.paramsSchema=[(globalThis.__alea_detect_ran__=true,{id:"fold",label:"Fold",type:"number",min:0,max:1,step:0.01,default:0.5})];</script>`;
    check(
        "declines a declaration it cannot read without running it",
        detectParams(hostile) === null,
    );
    check(
        "never executes an uploaded file",
        (globalThis as Record<string, unknown>).__alea_detect_ran__ === undefined,
        "detection evaluated code from the file",
    );
    check(
        "declines a schema built by a call",
        detectParams(`<script>$alea.paramsSchema=[makeParam("fold")];</script>`) === null,
    );

    // A hand-written declaration is JavaScript and not JSON: single quotes,
    // bare keys, trailing commas, a comment with a bracket in it, numbers JSON
    // would reject.
    const awkward = `<script>
      window.$alea.paramsSchema = [
        // the saddle [curvature] of the fold
        { 'id': 'fold', label: "Fold", type: 'number', min: .5, max: 1.4, step: 0.01, default: 9e-1 },
        { id: "dark", label: "Dark", type: "bool", default: true, }, /* and a comma */
      ];
    </script>`;
    const hand = detectParams(awkward);
    check(
        "reads a declaration written as ordinary JavaScript",
        hand?.params.length === 2,
        String(hand?.params.length),
    );
    check(
        "reads a number JSON would not accept",
        hand?.params[0].default === 0.9 && hand?.params[0].min === 0.5,
    );
    check("is not fooled by a bracket inside a comment", hand?.params[1].id === "dark");

    // Against the real starter kits, not a fixture. Every template carries
    // `window.$alea.paramsSchema = []` in its dev harness, so a file that began
    // life as one has that empty array above whatever the artist wrote.
    for (const kind of RUNTIME_KINDS) {
        const template = templateFor(kind.kindId);
        check(
            `${kind.name}: a pristine template declares nothing`,
            detectParams(template) === null,
            String(detectParams(template)?.params.length),
        );
        const declared = detectParams(
            `${template}<script>window.$alea.paramsSchema=[
                {id:"fold",label:"Fold",type:"number",min:0.5,max:1.4,step:0.01,default:0.9},
                {id:"roast",label:"Palette",type:"select",options:["A","B"],default:"A"}
            ];</script>`,
        );
        check(
            `${kind.name}: reads a declaration added under the harness`,
            declared?.params.map((p) => p.id).join(",") === "fold,roast",
            declared ? declared.params.map((p) => p.id).join(",") : "read nothing",
        );
    }

    // The other way an artist uses the kit: they fill in the harness line
    // itself, so there is one assignment and it is theirs.
    {
        const filled = templateFor(RUNTIME_KINDS[0].kindId).replace(
            "window.$alea.paramsSchema = [];",
            `window.$alea.paramsSchema = [{id:"grain",label:"Grain",type:"number",min:0,max:1,step:0.01,default:0.4}];`,
        );
        const read = detectParams(filled);
        check(
            "reads the harness line when the artist fills it in",
            read?.params[0].id === "grain",
            read ? read.params.map((p) => p.id).join(",") : "read nothing",
        );
    }

    // Last assignment wins, the way it does at runtime. An artist who clears
    // the schema on the last line meant to clear it.
    check(
        "an empty declaration written last is an answer, not a miss",
        detectParams(
            `<script>window.$alea.paramsSchema=[{id:"fold",label:"Fold",type:"number",min:0,max:1,step:0.01,default:0.5}];
             window.$alea.paramsSchema=[];</script>`,
        ) === null,
    );
    // A reassignment by reference is not a literal, so it cannot shadow one.
    check(
        "a reassignment by reference does not hide the literal",
        detectParams(
            `<script>window.$alea.paramsSchema=[{id:"fold",label:"Fold",type:"number",min:0,max:1,step:0.01,default:0.5}];
             window.ALEA_PARAMS=Z;window.$alea.paramsSchema=window.ALEA_PARAMS;</script>`,
        )?.params.length === 1,
    );

    // One unusable declaration costs that declaration and not the ones beside
    // it.
    const beside = `{id:"a",label:"A",type:"number",min:0,max:1,step:0.01,default:0.5}`;
    const spoiled = (bad: string) =>
        detectParams(`<script>window.$alea.paramsSchema=[${beside},${bad}];</script>`);

    const longId = spoiled(
        `{id:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",label:"Long",type:"number",min:0,max:1,step:0.01,default:0.5}`,
    );
    check(
        "keeps the good parameter beside an unusable name",
        longId?.params.map((p) => p.id).join(",") === "a",
        longId ? longId.params.map((p) => p.id).join(",") : "null",
    );
    check(
        "says why the name was dropped",
        (longId?.notes ?? []).some((n) => /not a usable name/.test(n)),
        (longId?.notes ?? []).join(" | ") || "(nothing said)",
    );

    const wideStep = spoiled(`{id:"c",label:"C",type:"number",min:0,max:1,step:5,default:0.5}`);
    check(
        "keeps the good parameter beside an impossible step",
        wideStep?.params.map((p) => p.id).join(",") === "a",
        wideStep ? wideStep.params.map((p) => p.id).join(",") : "null",
    );

    const collide = spoiled(
        `{id:"my-fold",label:"X",type:"number",min:0,max:1,step:0.01,default:0.5},{id:"my_fold",label:"Y",type:"number",min:0,max:1,step:0.01,default:0.5}`,
    );
    check(
        "keeps the first of two names that collide once cleaned",
        collide?.params.map((p) => p.id).join(",") === "a,my_fold",
        collide ? collide.params.map((p) => p.id).join(",") : "null",
    );
    check(
        "says the second was dropped",
        (collide?.notes ?? []).some((n) => /declared twice/.test(n)),
        (collide?.notes ?? []).join(" | ") || "(nothing said)",
    );

    // A default outside its own range is resolved the way every renderer
    // resolves an out-of-range value, and reported, because the schema is
    // immutable after publishing.
    const wideDefault = spoiled(`{id:"b",label:"B",type:"number",min:0,max:1,step:0.01,default:9}`);
    check(
        "repairs a default outside its own range",
        wideDefault?.params.length === 2,
        String(wideDefault?.params.length),
    );
    check(
        "clamps it onto the declared range",
        wideDefault?.params[1].default === 1,
        String(wideDefault?.params[1].default),
    );
    check(
        "says the default moved",
        (wideDefault?.notes ?? []).some((n) => /outside 0…1\. It starts at 1/.test(n)),
        (wideDefault?.notes ?? []).join(" | ") || "(nothing said)",
    );
    // A snap onto the step grid moves a value by less than the control holds.
    const snapped = spoiled(`{id:"d",label:"D",type:"number",min:0,max:1,step:0.01,default:0.503}`);
    check(
        "stays quiet about a snap onto the step grid",
        (snapped?.notes ?? []).length === 0,
        (snapped?.notes ?? []).join(" | "),
    );

    // A type with no equivalent here must not take the whole set down with it.
    const unreadable = spoiled(`{id:"t",label:"T",type:"string",default:"x"}`);
    check(
        "keeps the readable parameter beside an unreadable one",
        unreadable?.params.length === 1,
        String(unreadable?.params.length),
    );
    check(
        "says the unreadable one went",
        (unreadable?.notes ?? []).some((n) => /no equivalent here/.test(n)),
        (unreadable?.notes ?? []).join(" | ") || "(nothing said)",
    );

    const aleaParamsHtml = `<script>const ALEA_PARAMS = [{ id: "blister", label: "Heat", type: "number", min: 0.2, max: 0.8, step: 0.01, default: 0.5 }];</script>`;
    const named = detectParams(aleaParamsHtml);
    check(
        "detects ALEA_PARAMS in code",
        named?.params.length === 1 && named?.params[0].id === "blister",
    );

    const metaHtml = `<meta name="alea:params" content='[{"id":"density","label":"Density","type":"int","min":1,"max":50,"step":1,"default":12}]'>`;
    const meta = detectParams(metaHtml);
    check(
        "detects a meta tag declaration",
        meta?.params.length === 1 && meta?.params[0].type === "int",
    );

    const fxHtml = `<script>
        $fx.params([
          { id: "speed", name: "Speed", type: "number", options: { min: 1, max: 10, step: 1 }, default: 5 },
          { id: "dark", name: "Dark Mode", type: "boolean", default: true }
        ]);
      </script>`;
    const fx = detectParams(fxHtml);
    check("detects and converts $fx.params", fx?.params.length === 2);
    check(
        "maps an fx boolean onto bool",
        fx?.params[1].type === "bool" && fx?.params[1].default === true,
    );

    // validateSchema counts a sixth param as an error, so trimming comes first.
    const tooMany = `<script>window.$alea.paramsSchema=[${Array.from(
        { length: 6 },
        (_, i) => `{id:"p${i}",label:"P${i}",type:"number",min:0,max:1,step:0.01,default:0.5}`,
    ).join(",")}];</script>`;
    const capped = detectParams(tooMany);
    check(
        `keeps the first ${MAX_PARAMS} when more are declared`,
        capped?.params.length === MAX_PARAMS,
        String(capped?.params.length),
    );
    check(
        "says so rather than dropping them quietly",
        /Kept the first 5 of the 6/.test((capped?.notes ?? []).join(" ")),
        (capped?.notes ?? []).join(" "),
    );

    // fromFxParams counts what it could not bring over, and those notes have to
    // survive the trip through detectParams.
    const lossy = `<script>$fx.params([
        {id:"speed",name:"Speed",type:"number",options:{min:1,max:10,step:1},default:5},
        {id:"title",name:"Title",type:"string",default:"untitled"},
        {id:"dark",name:"Dark",type:"boolean",default:true},
        {id:"hue",name:"Hue",type:"color",default:"ff0000ff"},
        {id:"count",name:"Count",type:"bigint",options:{min:1,max:20},default:7},
        {id:"grain",name:"Grain",type:"number",options:{min:0,max:1},default:0.5},
        {id:"warp",name:"Warp",type:"number",options:{min:0,max:1},default:0.2}
      ]);</script>`;
    const converted = detectParams(lossy);
    check(
        "reports an fx param it could not bring over",
        (converted?.notes ?? []).some((n) => /string param/.test(n)),
        (converted?.notes ?? []).join(" | ") || "(nothing said)",
    );
    check(
        "reports the ones past the ceiling",
        (converted?.notes ?? []).some((n) => /Kept the first 5/.test(n)),
        (converted?.notes ?? []).join(" | ") || "(nothing said)",
    );
    check(
        "still keeps the five it could convert",
        converted?.params.length === MAX_PARAMS,
        String(converted?.params.length),
    );

    // The same rule on the fxhash path.
    const fxMoved = detectParams(`<script>$fx.params([
        {id:"speed",name:"Speed",type:"number",options:{min:1,max:10,step:1},default:99},
        {id:"palette",name:"Palette",type:"select",options:{options:["A","B"]},default:"Z"}
      ]);</script>`);
    check(
        "reports an fx default outside its range",
        (fxMoved?.notes ?? []).some((n) => /outside 1…10/.test(n)),
        (fxMoved?.notes ?? []).join(" | ") || "(nothing said)",
    );
    check(
        "reports an fx default that is not one of its options",
        (fxMoved?.notes ?? []).some((n) => /not one of its options/.test(n)),
        (fxMoved?.notes ?? []).join(" | ") || "(nothing said)",
    );

    check(
        "returns null when no params are declared",
        detectParams(`<script>window.$alea.ready();</script>`) === null,
    );
    check(
        "returns null rather than an empty declaration",
        detectParams(`<script>window.$alea.paramsSchema=[];</script>`) === null,
    );
}

console.log("\nPackaging a zip");
{
    const zip = (files: Record<string, string>) =>
        packageFromZip(
            zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))),
        );

    const flattened = zip({
        "index.html": `<html><head><link rel="stylesheet" href="style.css"></head><body><script src="sketch.js"></script></body></html>`,
        "style.css": `body{margin:0}`,
        "sketch.js": `$alea.ready();`,
    });
    check(
        "inlines a stylesheet and a script",
        /<style>body\{margin:0\}<\/style>/.test(flattened.html) &&
            /\$alea\.ready\(\);<\/script>/.test(flattened.html),
    );
    check(
        "counts what it actually inlined",
        flattened.notes.includes("Flattened 2 files into one document."),
        flattened.notes.join(" | "),
    );
    check(
        "has nothing left unresolved",
        flattened.unresolved.length === 0,
        flattened.unresolved.join(", "),
    );

    // An <img> pointing at a file the package does not carry renders as a hole,
    // silently.
    const holed = zip({
        "index.html": `<html><head><link rel="stylesheet" href="style.css"></head><body><img src="textures/gone.png"></body></html>`,
        "style.css": `body{background:url("textures/gone.png")}`,
    });
    check(
        "reports a file the package does not carry",
        holed.unresolved.includes("textures/gone.png"),
        holed.unresolved.join(", "),
    );
    check(
        "names each missing file once, however many times it is referenced",
        holed.unresolved.length === 1,
        holed.unresolved.join(", "),
    );
    check(
        "still counts the stylesheet it did inline",
        holed.notes.includes("Flattened 1 file into one document."),
        holed.notes.join(" | "),
    );

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
    // The sandbox refuses it later.
    const remote = zip({
        "index.html": `<html><body><script src="https://cdn.example.com/p5.js"></script></body></html>`,
    });
    check("leaves a remote script in place", /cdn\.example\.com/.test(remote.html));
    check(
        "says so",
        remote.notes.some((n) => n.includes("remote script")),
        remote.notes.join(" | "),
    );
    check(
        "does not call a remote script a missing file",
        remote.unresolved.length === 0,
        remote.unresolved.join(", "),
    );

    // What every OS produces when you zip a folder.
    const wrapped = zip({
        "my-piece/index.html": `<html><body><script src="sketch.js"></script></body></html>`,
        "my-piece/sketch.js": `$alea.ready();`,
    });
    check(
        "finds index.html inside a wrapper folder",
        /\$alea\.ready\(\);<\/script>/.test(wrapped.html),
    );
}

console.log("\nDrafts");
{
    const draft = newDraft("Test", 1, packageFromHtml(templateFor(1)), templateParamsFor(1));
    check("a new draft carries the generator", draft.html.length > 0);
    check("a new draft has a seed", /^oo[0-9a-f]+$/.test(draft.seed));

    // A grid is derived from one base, so pointing at tile 7 means something.
    const grid = Array.from({ length: 16 }, (_, i) => seedAt(draft.seed, i));
    check("grid seeds are distinct", new Set(grid).size === 16);
    check("grid seeds are reproducible", seedAt(draft.seed, 7) === seedAt(draft.seed, 7));
}

console.log("\nDeclared libraries");
{
    // The record is the document's. A kind cannot add to it or take from it,
    // and there is no setter once the generator exists.
    const three = recordFor(withLibraries(templateFor(1), ["three@0.160.1"]), [THREE_DEP]);
    check(
        "a document declaring three records three",
        three.ok && three.libraries.length === 1 && three.libraries[0].id === "three",
    );
    check(
        "and records the file and the digest a renderer checks",
        three.ok &&
            three.libraries[0].path === THREE_DEP.registry.path &&
            /^[0-9a-f]{64}$/.test(three.libraries[0].hash),
    );

    // The case that was wrong: the catalog said p5 and the document did not.
    const stripped = recordFor(withLibraries(templateFor(3), []), []);
    check(
        "a p5 draft that declares nothing records nothing",
        stripped.ok && stripped.libraries.length === 0,
    );

    const both = recordFor(withLibraries(templateFor(1), ["p5@1.5.0", "three@0.160.1"]), [
        THREE_DEP,
        P5_DEP,
    ]);
    check(
        "the record is in declaration order, because that is load order",
        both.ok && both.libraries.map((l) => l.id).join(",") === "p5,three",
    );

    const declaredP5 = withLibraries(templateFor(1), ["p5@1.5.0"]);
    check("an unresolved declaration blocks the record", !recordFor(declaredP5, []).ok);
    check(
        "a declaration resolved to another version blocks the record",
        !recordFor(withLibraries(templateFor(1), ["p5@2.0.0"]), [P5_DEP]).ok,
    );
    check(
        "an empty digest blocks the record",
        !recordFor(declaredP5, [{ ...P5_DEP, hash: "" }]).ok,
        "a renderer must refuse to draw without one",
    );
    check(
        "an empty path blocks the record",
        !recordFor(declaredP5, [{ ...P5_DEP, registry: { ...P5_DEP.registry, path: "" } }]).ok,
        "a renderer builds its URL from the path, so an empty one resolves nowhere",
    );
    check(
        "a malformed coordinate blocks the record",
        !recordFor(withLibraries(templateFor(1), ["p5"]), [P5_DEP]).ok,
    );

    // The pinned half: a digest checked by hand against npm, and the copy we
    // serve. A wrong value here makes the package unresolvable everywhere.
    const vendored = readFileSync("public/vendor/p5-1.5.0.min.js");
    check(
        "the vendored p5 is the file its recorded digest names",
        blake2bHex(vendored, undefined, 32) === P5_DEP.hash,
    );
    check("and the size the picker quotes is its size", vendored.length === P5_DEP.approxBytes);
    check(
        "a declared p5 resolves to the pinned spec, not an empty one",
        specFor("p5@1.5.0")?.hash === P5_DEP.hash,
    );
}

/**
 * What the studio tells an artist publishing will do.
 *
 * A 49KB generator was told it was too big to publish while the publisher was
 * willing to walk it on chain in four signatures: the studio compared the raw
 * source against one operation's ceiling and knew nothing about compression or
 * chunking. Both now read `publishPlan`, and these are the sizes either side of
 * each threshold.
 */
async function publishingChecks() {
    console.log("\nPublishing");

    // Incompressible, so a size here means what it says: repeated text gzips to
    // almost nothing and would take every route through the inline branch.
    const noise = (bytes: number) => {
        let out = "";
        let h = 1;
        while (out.length < bytes) {
            h = (Math.imul(h, 48271) % 2147483647) >>> 0;
            out += h.toString(36);
        }
        return out.slice(0, bytes);
    };
    const document = (bytes: number) =>
        `<!doctype html><html><body><script>/*${noise(bytes)}*/</script></body></html>`;

    const small = await publishPlan(templateFor(1));
    check(
        "a template publishes inline, in one signature",
        small.route === "inline" && small.signatures === 1,
    );
    check("and its burn is quoted on bytes that exist", small.codeBytes === small.rawBytes);

    // The size from the report.
    const reported = await publishPlan(document(49_000));
    check(
        `49KB walks on chain rather than being refused (${reported.route}, ${reported.signatures} signatures)`,
        reported.route === "walked" && reported.signatures === reported.chunks + 2,
        "this is the generator the studio called too big to publish",
    );
    check(
        "and it is compressed on the way, so storage is paid on less",
        reported.codeEncoding === "gzip" && reported.codeBytes < reported.rawBytes,
    );

    const huge = await publishPlan(document(400_000));
    check("past the walk budget it goes behind a pointer", huge.route === "pointer");
    check("and nothing is burned for code that is not in storage", huge.codeBytes === 0);

    // The pointer route pins the source, and the pinning endpoint used to cap
    // that at one operation's worth of bytes: every generator that needed a
    // pointer was refused by the only path that could carry it.
    const pin = readFileSync("src/app/api/pin/route.ts", "utf8");
    const ceiling = Number(/MAX_SOURCE_BYTES = ([\d_]+)/.exec(pin)?.[1].replace(/_/g, "") ?? 0);
    check(
        "the pinning endpoint accepts a generator large enough to need it",
        ceiling > MAX_CHUNK_BYTES * MAX_WALK_CHUNKS,
        `pin accepts ${ceiling.toLocaleString()}, the pointer route starts above ${(MAX_CHUNK_BYTES * MAX_WALK_CHUNKS).toLocaleString()}`,
    );
}

// Last, and asynchronous: gzip is a stream, and the rest of this file is not.
void publishingChecks().then(() => {
    console.log(
        failures === 0
            ? "\nAll studio checks passed.\n"
            : `\n${failures} studio check${failures === 1 ? "" : "s"} failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
});

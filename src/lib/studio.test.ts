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
import { existsSync, globSync, readFileSync } from "node:fs";
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
    // Every library, not only the ones a runtime kind depends on. The
    // catalog used to be a projection of kind.deps, so a library any kind
    // could declare went unchecked here simply by not being p5.
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
    // never heard of our catalog cannot draw it.
    // Resolving a library and never handing it to a frame looks exactly like
    // not resolving one: a p5 sketch with no p5 draws a blank square and says
    // nothing. The studio shipped that way for an afternoon because a revert
    // restored every consumer of useDeps except the one that calls it.
    const workspace = readFileSync("src/components/studio/Workspace.tsx", "utf8");
    check(
        "the workspace resolves the document's libraries",
        workspace.includes("useDeps("),
        "nothing else in the studio calls it",
    );
    for (const consumer of ["Frame", "SeedGrid", "Checks"]) {
        const at = workspace.indexOf(`<${consumer}`);
        check(
            `${consumer} is handed them`,
            at !== -1 && /deps=\{deps\}/.test(workspace.slice(at, at + 400)),
            "a frame without them renders blank with no error",
        );
    }
    check(
        "a library that will not load is reported",
        workspace.includes("depsError"),
        "silently blank is the worst of the available failures",
    );

    const publish = readFileSync("src/lib/publish.ts", "utf8");
    check(
        "a collection records the libraries it expects",
        publish.includes("aleatory:libraries"),
        "a renderer is not required to know anything about our catalog",
    );

    // The declaration lives in the document, so it survives a download, a week
    // in someone else's editor, and an upload. Anything held only beside the
    // file is lost on the first round trip.
    const doc = `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n</head>\n<body></body>\n</html>`;
    const added = withLibraries(doc, ["p5@1.5.0"]);
    check("a declaration can be written into a document", declaredIn(added).length === 1);
    check(
        "and removed without a trace",
        withLibraries(added, []) === doc,
        "switching library must not slowly accrete blank lines in the artist's file",
    );
    check(
        "an undeclared document asks for nothing",
        librariesIn(doc).specs.length === 0 && librariesIn(doc).unknown.length === 0,
    );
    check(
        "a package nobody has declared here before still resolves",
        librariesIn(withLibraries(doc, ["d3@7.9.0"])).specs.length === 1,
        "any package on npm can be declared; there is no list to be absent from",
    );
    check(
        "a coordinate with no version is reported, not dropped",
        librariesIn(withLibraries(doc, ["d3"])).unknown.length === 1,
        "a silently missing library is a blank frame with no explanation",
    );
}

console.log("\nSEO and accessibility");
{
    // Contrast, computed from the tokens rather than judged by eye. --border
    // was 1.00:1 in light mode where 1.4.11 needs 3:1, and it is the only
    // thing separating a card, a field or a row from the page.
    const css = readFileSync("src/app/globals.css", "utf8");
    const tok = (b: string) =>
        Object.fromEntries(
            [...b.matchAll(/--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)].map((m) => [
                m[1],
                [+m[2], +m[3], +m[4]] as [number, number, number],
            ]),
        );
    const rgb = ([h, sa, l]: [number, number, number]) => {
        sa /= 100; l /= 100;
        const k = (n: number) => (n + h / 30) % 12;
        const a = sa * Math.min(l, 1 - l);
        const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [f(0), f(8), f(4)] as [number, number, number];
    };
    const ch = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (c: [number, number, number]) => 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
    };

    const light = tok(css.slice(css.indexOf(":root"), css.indexOf(".dark")));
    const dark = tok(css.slice(css.indexOf(".dark")));
    const pairs: [string, string, number][] = [
        ["border", "background", 3],
        ["border", "card-background", 3],
        ["input", "background", 3],
        ["destructive", "background", 4.5],
        ["warning", "background", 4.5],
        ["foreground", "background", 4.5],
        ["muted-foreground", "background", 4.5],
        ["muted-foreground", "muted", 4.5],
    ];
    for (const [mode, set] of [["light", light], ["dark", dark]] as const) {
        for (const [fg, bg, need] of pairs) {
            const r = ratio(set[fg], set[bg]);
            check(
                `${mode}: --${fg} on --${bg} is ${r.toFixed(2)}:1 (needs ${need})`,
                r >= need,
                "WCAG 1.4.3 for text, 1.4.11 for anything that delineates a control",
            );
        }
    }

    check("a skip link exists (2.4.1)", readFileSync("src/app/layout.tsx", "utf8").includes('href="#main"'));
    check("focus is visible (2.4.7)", css.includes(":focus-visible"));
    check("the sticky header cannot hide focus (2.4.11)", css.includes("scroll-padding-top"));
    check("motion can be turned off (2.3.3)", css.includes("prefers-reduced-motion"));

    // Every route says what it is. Six of them are client components and
    // cannot export metadata themselves, so it lives in a layout beside them.
    for (const f of globSync("src/app/**/page.tsx")) {
        const layout = f.replace(/page\.tsx$/, "layout.tsx");
        const both = readFileSync(f, "utf8") + (existsSync(layout) ? readFileSync(layout, "utf8") : "");
        check(
            `${f.replace("src/app/", "").replace(/\/?page\.tsx$/, "") || "/"}: has metadata`,
            /export const metadata|generateMetadata/.test(both),
            "a page with none is a search result with no title",
        );
    }

    // A title is read by a person. "Drift #4 · Aleatory" does not say who made
    // it, and a tz1 would not either.
    const piecePage = readFileSync("src/app/piece/[contract]/[tokenId]/page.tsx", "utf8");
    check(
        "a piece is titled by its artist",
        /\$\{piece\.name\} by \$\{artist\}/.test(piecePage),
        "the root template appends the site name, so this is name by artist",
    );
    check(
        "the artist is resolved to a name",
        piecePage.includes("resolveName(piece.artist)"),
        "an address in a title tells a reader nothing",
    );

    check("there is a sitemap", existsSync("src/app/sitemap.ts"));
    check("there is a robots policy", existsSync("src/app/robots.ts"));
    check("there is a fallback share card", existsSync("src/app/opengraph-image.tsx"));
    const robots = readFileSync("src/app/robots.ts", "utf8");
    check(
        "a testnet deployment refuses indexing",
        /NETWORK !== "mainnet"/.test(robots) && /disallow: "\/"/.test(robots),
        "it carries the same routes and titles as production and would compete with it",
    );
    const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
    // Imported, not merely mentioned: the comment in that file names both of
    // these to explain why it does not use them.
    const imports = [...sitemap.matchAll(/import \{([^}]*)\} from/g)]
        .flatMap((m) => m[1].split(",").map((x) => x.trim()));
    check(
        "the sitemap does not walk gateways",
        !imports.includes("fetchRecentFeed") && !imports.includes("fetchAllCollections"),
        "both resolve a document and a cover per piece; a sitemap needs a URL and a date",
    );
}

console.log("\nDrafts survive being saved");
{
    // A write used to resolve on request.onsuccess, which fires when the
    // request succeeded and not when the transaction committed. A save could
    // resolve, the transaction could abort a moment later, and the draft was
    // gone while the studio said "Saved in this browser". Found by @webid
    // in PR #1.
    const draft = readFileSync("src/lib/draft.ts", "utf8");
    check(
        "a write resolves on the transaction, not the request",
        /transaction\.oncomplete/.test(draft) && /mode !== "readonly"/.test(draft),
        "onsuccess fires before the commit, so it can report a save that never landed",
    );
    check(
        "an aborted transaction rejects",
        draft.includes("transaction.onabort"),
        "otherwise a quota failure looks like success",
    );
    check(
        "the connection is dropped when a transaction fails",
        /connection = null/.test(draft),
        "a failed transaction can leave the connection unusable",
    );
    check(
        "one connection, reused",
        draft.includes("if (connection) return connection"),
        "opening per call is a handshake per keystroke once autosave runs",
    );
}

console.log("\nPages keep themselves current");
{
    // Every page here is server rendered on a revalidate timer, which makes
    // the server correct and leaves the screen stale until someone reloads.
    // Chain state moves on its own: a piece renders, an edition sells out, a
    // listing appears.
    const pages: [string, number][] = [
        ["src/app/page.tsx", 30],
        ["src/app/market/page.tsx", 15],
        ["src/app/collections/page.tsx", 60],
        ["src/app/collection/[address]/page.tsx", 30],
        ["src/app/piece/[contract]/[tokenId]/page.tsx", 30],
        ["src/app/wallet/[address]/page.tsx", 60],
    ];
    for (const [path, seconds] of pages) {
        const src = readFileSync(path, "utf8");
        const declared = src.match(/export const revalidate = (\d+)/)?.[1];
        check(
            `${path.replace("src/app/", "")}: refreshes itself`,
            src.includes("<LiveRefresh"),
            "otherwise it is only ever correct on the server",
        );
        check(
            `${path.replace("src/app/", "")}: at its own revalidate window (${seconds}s)`,
            src.includes(`<LiveRefresh seconds={${seconds}}`) && declared === String(seconds),
            "polling faster than the server will answer differently is just traffic",
        );
    }

    const live = readFileSync("src/components/LiveRefresh.tsx", "utf8");
    check(
        "a hidden tab stops polling",
        live.includes("visibilitychange") && live.includes("document.hidden"),
        "a background tab polling is battery and rate limit spent on nobody",
    );
    check(
        "it refreshes rather than reloads",
        live.includes("router.refresh()") && !live.includes("location.reload"),
        "a reload throws away scroll, focus and any open menu",
    );
}

console.log("\nOne document builder");
{
    // The provider assembled its own document inline, and it drifted from the
    // tested one: a bare "#4" for a name, no description, no code hash, and no
    // royalties, so nothing was paid on any secondary sale. buildPieceDocument
    // was golden-tested the whole time and had no production caller at all.
    const provider = readFileSync("netlify/functions/provider.mts", "utf8");
    check(
        "the provider publishes through the shared builder",
        provider.includes("buildPieceDocument"),
        "a second builder is a second thing to drift",
    );
    check(
        "and does not assemble a document itself",
        !/name:\s*`#\$\{/.test(provider),
        "that is the exact line that published a bare edition number",
    );
    check(
        "royalties reach the document",
        provider.includes("shares: piece.royalties"),
        "objkt and Teia read royalties from here, not from the contract",
    );
}

console.log("\nMarket operations");
{
    // Two entrypoints move a token the marketplace does not hold yet, so both
    // need the seller to grant it as an operator first. Derived from the
    // contract rather than remembered: anything transferring from sp.sender
    // needs the grant; from sp.self_address does not.
    const market = readFileSync("contract/marketplace.py", "utf8");
    const needsGrant = ["list_token", "delist", "buy", "accept_offer"].filter((ep) => {
        const body = market.slice(market.indexOf(`def ${ep}(self`));
        const end = body.indexOf("@sp.", 10);
        return /from_=sp\.sender/.test(end > 0 ? body.slice(0, end) : body);
    });
    check(
        `only list_token and accept_offer need an operator (${needsGrant.join(", ")})`,
        needsGrant.length === 2 && needsGrant.includes("list_token") && needsGrant.includes("accept_offer"),
        "if this changes, the batches below need to change with it",
    );

    const ops = readFileSync("src/lib/ops.ts", "utf8");
    for (const fn of ["listToken", "acceptOfferFor"]) {
        const body = ops.slice(ops.indexOf(`export async function ${fn}(`));
        const end = body.indexOf("\nexport ", 10);
        const block = end > 0 ? body.slice(0, end) : body;
        check(
            `${fn} grants, acts and revokes in one operation`,
            /add_operator/.test(block) && /remove_operator/.test(block) && /sendBatch/.test(block),
            "sent separately a wallet asks twice and the second can fail on its own, leaving the grant standing",
        );
    }
    check(
        "a batch is one request, so it is atomic",
        /requestOperation\(\{ operationDetails: calls\.map/.test(ops),
        "Tezos reverts the whole batch, which is what makes granting and using the grant safe together",
    );

    // The signature returns before the operation is in a block, and long
    // before an indexer has it. Clearing the form there shows "not listed" for
    // a token that is listed, and offers to list it again.
    const panel = readFileSync("src/components/piece/PieceMarket.tsx", "utf8");
    check(
        "controls stay disabled until the chain agrees",
        panel.includes("settling") && /disabled=\{busy !== null \|\| settling/.test(panel),
        "otherwise the same token gets listed three times",
    );
    check(
        "and the page refreshes until the server answers differently",
        panel.includes("router.refresh()") && panel.includes("settled.current"),
    );
}

console.log("\nOperation encoding");
{
    // Michelson pairs are positional and SmartPy lays a record out
    // alphabetically, not in declaration order. `list_token(collection,
    // token_id, price)` is `(collection, price, token_id)` on chain, so a
    // hand-built pair passed the price as the token id: listing at 1 tez asked
    // to move token 1,000,000 and the collection answered FA2_TOKEN_UNDEFINED.
    // `set_provider` had it too.
    //
    // Encoding through Taquito matches on field names against the type read
    // off the chain, so a reordering cannot go unnoticed. This asserts nobody
    // hand-builds one again.
    const ops = readFileSync("src/lib/ops.ts", "utf8");
    check(
        "no hand-built Michelson pairs",
        !/prim:\s*["']Pair["']/.test(ops),
        "positional encoding is what swapped price and token id",
    );
    check(
        "entrypoints are encoded by field name",
        /async function encode\(/.test(ops) && ops.includes("methodsObject"),
    );
}

console.log("\nThe published surface");
{
    // ALEATORY-001 §7 is what a third party builds against, so every harness
    // has to actually provide what it says. The spec documented $alea.random()
    // while the shim inside every downloadable template offered only rand(),
    // which meant a template written against our own published standard broke
    // the moment an artist opened it locally.
    const surface = [
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

    const spec = readFileSync("docs/interface.md", "utf8");
    const harnesses: [string, string][] = [
        ["isolate", readFileSync("isolate/index.html", "utf8")],
        ["renderer", readFileSync("netlify/functions/lib/render.mts", "utf8")],
        // The shim every template carries, which is what runs when an artist
        // opens the file they downloaded.
        ["template shim", templateFor(RUNTIME_KINDS[0].kindId)],
    ];

    for (const key of surface) {
        check(`$alea.${key}: documented`, spec.includes(`$alea.${key}`));
        for (const [name, src] of harnesses) {
            check(
                `$alea.${key}: in the ${name}`,
                new RegExp(`\\b${key}\\s*:`).test(src),
                "documented and missing is worse than undocumented",
            );
        }
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

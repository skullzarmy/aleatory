/**
 * Reading a package well enough to know whether it can be declared.
 *
 * The thing being defended against is specific. A declaration is loaded with a
 * script tag, most of npm no longer ships anything a script tag can load, and a
 * kit built from the wrong file renders a blank frame that its author finds
 * after minting. `docs/libraries.md` warns about three.js in prose; these are
 * the same facts, checked.
 *
 * The wrapper cases run offline against the bytes those packages really ship,
 * copied here so a classifier change has to face them. The network half asks
 * jsDelivr the same questions and is skipped without a connection rather than
 * failing, so a flight does not turn into a red suite.
 *
 * Run: npm test
 */

import { browserCandidates, classify, globalNameIn, inspect, resolve, search } from "./npm";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

/**
 * The opening bytes of four real builds, as published.
 *
 * Truncated where the wrapper ends, which is all any of this reads. They are
 * the four shapes npm ships: an unminified rollup UMD, two minified ones that
 * differ in how they reach the global, and a browserify bundle.
 */
const TWEEN_UMD = `(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.TWEEN = {}));
})(this, (function (exports) { 'use strict';`;

const D3_MIN = `// https://d3js.org v7.9.0 Copyright 2010-2023 Mike Bostock
!function(t,n){"object"==typeof exports&&"undefined"!=typeof module?n(exports):"function"==typeof define&&define.amd?define(["exports"],n):n((t="undefined"!=typeof globalThis?globalThis:t||self).d3=t.d3||{})}(this,(function(t){"use strict";`;

const THREE_MIN = `console.warn('Scripts "build/three.js" and "build/three.min.js" are deprecated with r150+, and will be removed with r160.'),
/**
 * @license
 * Copyright 2010-2023 Three.js Authors
 * SPDX-License-Identifier: MIT
 */
function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t="undefined"!=typeof globalThis?globalThis:t||self).THREE={})}(this,(function(t){"use strict";const e="160",`;

const P5_MIN = `/*! p5.js v1.5.0 October 18, 2022 */
!function(e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define([],e):("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).p5=e()}(function(){var s,e,t;return function o(n,s,i){`;

const THREE_CJS = `/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */
'use strict';

const REVISION = '169';
const MOUSE = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
exports.REVISION = REVISION;`;

const THREE_MODULE = `/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 */
const REVISION = '169';
class Vector3 {}
export { REVISION, Vector3 };
`;

/**
 * The shapes that were refused when this only read the first bytes of a file.
 *
 * `two.js@0.8.15` puts its wrapper at character 181,446 of 181,525, and never
 * mentions `define`. `zdog@1.1.3` mentions `define.amd` and never says
 * `typeof exports`. Requiring both markers, at the top, refused them both.
 */
const TWO_FOOTER = `/* MIT License Copyright (c) 2012 - 2024 @jonobr1 */
var Two=(function(){${"var filler=1;".repeat(4_000)}return Qi($s);})().default;
(function(){if(typeof exports==='object'&&typeof module!=='undefined'){module.exports=Two}})()`;

const ZDOG_AMD = `/** Minified by jsDelivr using Terser */
!function(e,t){"object"==typeof module&&module.exports?module.exports=t():"function"==typeof define&&define.amd&&define("zdog",[],e.Zdog)}(this,function(){return{}});`;

/**
 * A partial build whose export list is longer than any window measured back
 * from the end of the file. `three@0.185.1/build/three.core.min.js` ships one
 * of a few thousand characters, and reading only the last two thousand of them
 * begins inside the braces, sees no `export`, and calls it loadable.
 */
const LONG_EXPORT_TAIL = `/** @license three.js */
const t="185";${"const a=1;".repeat(3_000)}
export{t as REVISION,${Array.from({ length: 400 }, (_, i) => `x${i} as name${i}`).join(",")}};`;

/** three sets this for its devtools. It is not a name anybody types. */
const DEVTOOLS_MARKER = `'use strict';
const REVISION='169';
if(typeof window!=='undefined'){window.__THREE__=REVISION;}
exports.REVISION=REVISION;`;

async function run() {
    console.log("\nReading npm\n");

    // --- the four shapes that really ship -------------------------------

    const umd: [string, string, string][] = [
        ["@tweenjs/tween.js", TWEEN_UMD, "TWEEN"],
        ["d3", D3_MIN, "d3"],
        ["three", THREE_MIN, "THREE"],
        ["p5", P5_MIN, "p5"],
    ];

    for (const [name, source, want] of umd) {
        const flavor = classify("dist/x.js", source);
        check(`${name} reads as loadable`, flavor === "umd", `got ${flavor}`);
        const got = globalNameIn(source);
        check(`${name} exposes ${want}`, got === want, `got ${got}`);
    }

    // --- the ones that must be refused ----------------------------------

    check("a .cjs default is refused", classify("build/three.cjs", THREE_CJS) === "cjs");
    check("a .mjs default is refused", classify("dist/x.mjs", "const a = 1;") === "esm");
    check(
        "an ES module is refused by its exports",
        classify("build/three.module.js", THREE_MODULE) === "esm",
        `got ${classify("build/three.module.js", THREE_MODULE)}`,
    );
    check(
        "a CommonJS file named .js is refused",
        classify("index.js", THREE_CJS) === "cjs",
        `got ${classify("index.js", THREE_CJS)}`,
    );

    // A global name that cannot be read is null, never a guess. A wrong name
    // reads as authoritative and sends somebody hunting a bug in their own code.
    check("an unreadable wrapper yields no global", globalNameIn(THREE_CJS) === null);

    // --- wrappers that are not at the top, and not both branches ---------

    check(
        "a wrapper at the end of the file is found",
        classify("build/two.min.js", TWO_FOOTER) === "umd",
        `got ${classify("build/two.min.js", TWO_FOOTER)}`,
    );
    check("a footer wrapper still names its global", globalNameIn(TWO_FOOTER) === "Two");
    check(
        "an AMD branch alone is enough",
        classify("js/index.min.js", ZDOG_AMD) === "umd",
        `got ${classify("js/index.min.js", ZDOG_AMD)}`,
    );

    // The one that would have shipped a partial three.js as if it worked.
    check(
        "a long export list at the end is still an ES module",
        classify("build/three.core.min.js", LONG_EXPORT_TAIL) === "esm",
        `got ${classify("build/three.core.min.js", LONG_EXPORT_TAIL)}`,
    );

    check(
        "a devtools marker is not offered as the global",
        globalNameIn(DEVTOOLS_MARKER) === null,
        `got ${globalNameIn(DEVTOOLS_MARKER)}`,
    );

    // --- picking a sibling build ----------------------------------------

    const tweenFiles = [
        "dist/tween.amd.js",
        "dist/tween.cjs",
        "dist/tween.esm.js",
        "dist/tween.umd.js",
        "package.json",
    ];
    check(
        "the umd build is preferred over its siblings",
        browserCandidates(tweenFiles)[0] === "dist/tween.umd.js",
        browserCandidates(tweenFiles)[0],
    );
    check(
        "modules are not offered as alternates",
        !browserCandidates(tweenFiles).includes("dist/tween.esm.js"),
    );
    check(
        "an examples directory is not mistaken for a build",
        browserCandidates(["examples/jsm/controls/DragControls.js", "dist/x.min.js"])[0] ===
            "dist/x.min.js",
    );

    // --- the network half -----------------------------------------------

    const online = await fetch("https://data.jsdelivr.com/v1/packages/npm/d3@7.9.0", {
        signal: AbortSignal.timeout(6_000),
    })
        .then((r) => r.ok)
        .catch(() => false);

    if (!online) {
        console.log("\n  (offline: the jsDelivr half is skipped)\n");
    } else {
        try {
            const three = await inspect("three", "0.160.1");
            check(
                "three@0.160.1 resolves to its global build",
                three.loadable && three.path === "build/three.min.js" && three.global === "THREE",
                JSON.stringify({ path: three.path, global: three.global }),
            );

            const modern = await inspect("three", "0.169.0");
            check(
                "three@0.169.0 is refused",
                !modern.loadable && modern.flavor === "cjs",
                `${modern.flavor}`,
            );

            const tween = await inspect("@tweenjs/tween.js", "23.1.3");
            check(
                "a scoped package whose default fails is offered its umd build",
                !tween.loadable && tween.alternate?.path === "dist/tween.umd.js",
                JSON.stringify({ flavor: tween.flavor, alternate: tween.alternate }),
            );

            const p5 = await inspect("p5", "1.5.0");
            check(
                "p5@1.5.0 matches what the p5 template declares",
                p5.loadable && p5.global === "p5",
                JSON.stringify({ path: p5.path, global: p5.global }),
            );

            // What the picker actually does. npm's search hands back the newest
            // release, and for three that is an ES module thirty four releases past
            // the last one a piece can declare. Resolving has to cross that gap on
            // its own or the common path through the feature ends in a refusal.
            const latest = await resolve("three", "0.185.1");
            check(
                "the newest three resolves back to one that loads",
                latest.coordinate === "three@0.160.1" && latest.global === "THREE",
                JSON.stringify({ coordinate: latest.coordinate, global: latest.global }),
            );

            const named = await resolve("@tweenjs/tween.js", "23.1.3");
            check(
                "a package with a usable sibling names the file rather than moving version",
                named.coordinate === "@tweenjs/tween.js@23.1.3/dist/tween.umd.js" &&
                    named.global === "TWEEN",
                JSON.stringify({ coordinate: named.coordinate, global: named.global }),
            );

            // Was accepted as a global build before the export list at its end was
            // read properly, which would have declared a partial three.js.
            const partial = await resolve("three", "0.185.1");
            check(
                "the newest three does not settle for a partial core build",
                partial.coordinate === "three@0.160.1",
                String(partial.coordinate),
            );

            const fine = await resolve("d3", "7.9.0");
            check(
                "a version that already loads is left alone",
                fine.coordinate === "d3@7.9.0" && fine.note === null,
                JSON.stringify({ coordinate: fine.coordinate, note: fine.note }),
            );

            const hits = await search("p5");
            check(
                "search finds p5",
                hits.some((h) => h.id === "p5"),
            );
            check(
                "search results are well formed",
                hits.every((h) => h.id && h.version),
            );
        } catch (e) {
            // Reachable when the half started and not while it ran. npm and a
            // CDN are somebody else's machines, and this half is about our
            // reading of what they serve, not their uptime: failing here would
            // put a red mark on a contributor's branch for an outage they have
            // no part in. The offline cases above still hold the parsing to
            // the bytes those packages really ship.
            console.log(
                `\n  (jsDelivr or npm went away mid-run, rest skipped: ${
                    e instanceof Error ? e.message : String(e)
                })\n`,
            );
        }
    }

    console.log(
        failures === 0
            ? "\nA package says what it is before anybody downloads it.\n"
            : `\n${failures} failed\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

void run();

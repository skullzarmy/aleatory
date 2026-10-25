import assert from "node:assert";
import { blake2b256 } from "../src/libraries/integrity.js";
import { parseCoordinate, parseLibraries } from "../src/libraries/parser.js";

export function runLibraryTests() {
    console.log("Testing Libraries & Integrity...");

    // 1. Parsing coordinates
    const p1 = parseCoordinate("p5@1.5.0");
    assert.deepStrictEqual(p1, { id: "p5", version: "1.5.0", path: "", hash: undefined });

    const p2 = parseCoordinate("d3@7.9.0/dist/d3.min.js");
    assert.deepStrictEqual(p2, { id: "d3", version: "7.9.0", path: "dist/d3.min.js", hash: undefined });

    const p3 = parseCoordinate("@scope/pkg@2.0.1/lib/index.js", "abcd1234");
    assert.deepStrictEqual(p3, {
        id: "@scope/pkg",
        version: "2.0.1",
        path: "lib/index.js",
        hash: "abcd1234",
    });

    // 2. Extracting from HTML
    const html = `
    <html>
      <head>
        <!-- <meta name="alea:library" content="ignored@1.0.0"> -->
        <meta name="alea:library" content="p5@1.5.0">
        <meta name="alea:library" content="three@0.160.1">
      </head>
      <body></body>
    </html>
  `;
    const { specs, unknown } = parseLibraries(html);
    assert.strictEqual(specs.length, 2);
    assert.strictEqual(specs[0].id, "p5");
    assert.strictEqual(specs[1].id, "three");
    assert.strictEqual(unknown.length, 0);

    // 3. Blake2b-256 integrity calculation
    const digest = blake2b256("test-integrity-string");
    assert.strictEqual(typeof digest, "string");
    assert.strictEqual(digest.length, 64, "blake2b-256 hex string must be 64 characters");

    console.log("  ok: Library coordinates parsed and blake2b-256 verified");
}

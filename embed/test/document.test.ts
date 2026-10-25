import assert from "node:assert";
import { buildDocument } from "../src/core/document.js";

export function runDocumentTests() {
    console.log("Testing Document Assembler...");

    const code = `<!doctype html><html><head><title>Test</title></head><body><script>console.log("art");</script></body></html>`;
    const doc = buildDocument({
        code,
        seed: "opTest123",
        deps: ["// p5 mock library code"],
        liveClock: false,
        maxDpr: 1,
    });

    // 1. Verify CSP
    assert.ok(doc.includes("Content-Security-Policy"), "Document must contain CSP");
    assert.ok(doc.includes("connect-src 'none'"), "CSP must block network");

    // 2. Verify style reset
    assert.ok(doc.includes('id="alea-frame"'), "Document must include style reset");
    assert.ok(doc.includes("canvas{display:block}"), "Style reset must set canvas display block");

    // 3. Verify injection order: Harness MUST appear before inlined library scripts!
    const harnessIdx = doc.indexOf("Math.random = function");
    const libIdx = doc.indexOf("// p5 mock library code");
    const artIdx = doc.indexOf('console.log("art")');

    assert.ok(harnessIdx > 0, "Harness must be present");
    assert.ok(libIdx > 0, "Library must be present");
    assert.ok(artIdx > 0, "Art script must be present");
    assert.ok(
        harnessIdx < libIdx,
        "CRITICAL: Harness (Math.random override) must be injected BEFORE library dependencies",
    );
    assert.ok(libIdx < artIdx, "Library dependencies must be injected BEFORE artist code");

    // 4. Verify frozen clock
    assert.ok(doc.includes("Date = class extends RealDate"), "Clock must be frozen when liveClock is false");

    console.log("  ok: Document assembler enforces strict CSP, styles, and execution order");
}

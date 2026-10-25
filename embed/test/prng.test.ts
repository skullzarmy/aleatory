import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPrng, sfc32, xmur3 } from "../src/core/prng.js";

export function runPrngTests() {
    console.log("Testing PRNG...");

    // 1. Bit-for-bit draw comparison against isolate / harness-core reference
    const seed = "aleatory-conformance-fixed-seed";

    const s1 = xmur3(seed);
    const rand1 = sfc32(s1(), s1(), s1(), s1());
    const draws1: number[] = [];
    for (let i = 0; i < 10; i++) draws1.push(rand1());

    const prng = createPrng(seed);
    const draws2: number[] = [];
    for (let i = 0; i < 10; i++) draws2.push(prng.rand());

    assert.deepStrictEqual(draws1, draws2, "createPrng must match direct xmur3 + sfc32 draws");

    // 2. Compare against src/lib/harness-core.js in this repo
    const coreJs = readFileSync(join(process.cwd(), "..", "src/lib/harness-core.js"), "utf8");
    const runCore = new Function(
        coreJs +
            `\nvar s = xmur3(${JSON.stringify(seed)});\nvar rand = sfc32(s(), s(), s(), s());\nvar out = [];\nfor (var i = 0; i < 10; i++) out.push(rand());\nreturn out;`,
    ) as () => number[];
    const canonicalDraws = runCore();

    assert.deepStrictEqual(draws1, canonicalDraws, "embed PRNG must match canonical harness-core.js draws");

    // 3. Helper tests
    const intVal = prng.randInt(5, 15);
    assert.ok(intVal >= 5 && intVal <= 15 && Number.isInteger(intVal), "randInt inclusive bounds");

    const betweenVal = prng.randBetween(2.5, 4.5);
    assert.ok(betweenVal >= 2.5 && betweenVal < 4.5, "randBetween bounds");

    const picked = prng.pick(["a", "b", "c"]);
    assert.ok(["a", "b", "c"].includes(picked), "pick element");

    const chanceVal = prng.chance(1);
    assert.strictEqual(chanceVal, true, "chance(1) is true");

    console.log("  ok: PRNG matches canonical engine bit-for-bit with 0 warmups");
}

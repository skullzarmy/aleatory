/**
 * Golden tests for the royalty encoder.
 *
 * These bytes get pinned and their CID goes on chain, permanently, and a
 * mis-encoded royalty pays out wrong for the life of the collection. The form
 * works in relative terms and the standard stores absolute shares, so this
 * conversion is the thing worth pinning hardest.
 *
 *   npx tsx src/lib/metadata.test.ts
 */
import assert from "node:assert/strict";
import { encodeRoyalties, royaltyPreview, buildPieceDocument } from "./metadata";

const A = "tz1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "tz1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "tz1ccccccccccccccccccccccccccccccccccc";

let failures = 0;
function check(name: string, fn: () => void) {
    try {
        fn();
        console.log(`  ok  ${name}`);
    } catch (e) {
        failures++;
        console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
    }
}

console.log("royalty encoding");

check("single recipient takes the whole total", () => {
    const r = encodeRoyalties({ totalPercent: 10, recipients: [{ address: A, percent: 100 }] });
    assert.equal(r.decimals, 4);
    assert.deepEqual(r.shares, { [A]: 1000 });
});

check("25% split evenly is 1250 each", () => {
    const r = encodeRoyalties({
        totalPercent: 25,
        recipients: [
            { address: A, percent: 50 },
            { address: B, percent: 50 },
        ],
    });
    assert.deepEqual(r.shares, { [A]: 1250, [B]: 1250 });
});

check("thirds put the remainder on the first recipient and still sum exactly", () => {
    const r = encodeRoyalties({
        totalPercent: 10,
        recipients: [
            { address: A, percent: 33.34 },
            { address: B, percent: 33.33 },
            { address: C, percent: 33.33 },
        ],
    });
    const sum = Object.values(r.shares).reduce((n, v) => n + v, 0);
    assert.equal(sum, 1000, "shares must sum to the declared total");
    // 33.34% of 1000 floors to 333, the other two to 333 each, leaving 1.
    assert.equal(r.shares[A], 334, "the leftover goes to the first recipient");
});

check("zero royalty encodes to no recipients", () => {
    const r = encodeRoyalties({ totalPercent: 0, recipients: [{ address: A, percent: 100 }] });
    assert.deepEqual(r.shares, {});
});

check("the ceiling encodes exactly", () => {
    const r = encodeRoyalties({ totalPercent: 25, recipients: [{ address: A, percent: 100 }] });
    assert.deepEqual(r.shares, { [A]: 2500 });
});

check("ten recipients still sum to the total", () => {
    const recipients = Array.from({ length: 10 }, (_, i) => ({
        address: `tz1${String(i).repeat(33)}`,
        percent: 10,
    }));
    const r = encodeRoyalties({ totalPercent: 15, recipients });
    const sum = Object.values(r.shares).reduce((n, v) => n + v, 0);
    assert.equal(sum, 1500);
});

check("the same address twice accumulates", () => {
    const r = encodeRoyalties({
        totalPercent: 20,
        recipients: [
            { address: A, percent: 50 },
            { address: A, percent: 50 },
        ],
    });
    assert.deepEqual(r.shares, { [A]: 2000 });
});

check("preview reports share of sale, which is what a person is agreeing to", () => {
    const p = royaltyPreview({
        totalPercent: 25,
        recipients: [
            { address: A, percent: 50 },
            { address: B, percent: 50 },
        ],
    });
    assert.deepEqual(
        p.map((x) => x.percentOfSale),
        [12.5, 12.5],
    );
});

console.log("\npiece document");

check("edition numbers display 1-based over 0-based token ids", () => {
    const doc = buildPieceDocument({
        collectionName: "Drift",
        artist: A,
        placeholderImageUri: "ipfs://pending",
        split: { totalPercent: 10, recipients: [{ address: A, percent: 100 }] },
        tokenId: 0,
        artifactUri: "ipfs://code",
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
    });
    assert.equal(doc.name, "Drift #1");
});

check("parameters land in aleaParams and in attributes", () => {
    const doc = buildPieceDocument({
        collectionName: "Drift",
        artist: A,
        placeholderImageUri: "ipfs://pending",
        split: { totalPercent: 0, recipients: [] },
        tokenId: 41,
        artifactUri: "ipfs://code",
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        params: { density: 140, ink: "black" },
    });
    assert.equal(doc.name, "Drift #42");
    assert.equal(doc.aleaParams, '{"density":140,"ink":"black"}');
    assert.deepEqual(doc.attributes, [
        { name: "density", value: "140" },
        { name: "ink", value: "black" },
    ]);
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

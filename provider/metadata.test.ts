/**
 * Golden tests for the royalty encoder. These bytes get pinned and their CID
 * goes on chain permanently, so a mis-encoded royalty pays out wrong for the
 * life of the generator.
 *
 *   npx tsx provider/metadata.test.ts
 */
import assert from "node:assert/strict";
import {
    encodeRoyalties,
    royaltyPreview,
    buildPendingDocument,
    buildPieceDocument,
    cleanTags,
} from "./metadata";

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
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({
            totalPercent: 10,
            recipients: [{ address: A, percent: 100 }],
        }),
        tokenId: 0,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
    });
    assert.equal(doc.name, "Drift #1");
});

check("parameters land in aleaParams and in attributes", () => {
    const doc = buildPieceDocument({
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 41,
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

check("features land in attributes, ahead of params", () => {
    const doc = buildPieceDocument({
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 0,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        params: { density: 140 },
        features: { Palette: "warm", Count: 3 as unknown as string },
    });
    assert.deepEqual(doc.attributes, [
        { name: "Palette", value: "warm" },
        { name: "Count", value: "3" },
        { name: "density", value: "140" },
    ]);
});

check("no features reported is attributes built from params alone", () => {
    const doc = buildPieceDocument({
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 0,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        params: { density: 140 },
        features: {},
    });
    assert.deepEqual(doc.attributes, [{ name: "density", value: "140" }]);
});

console.log("\nper-piece names, opt-in");

check("not declared at all: the plain form, unaffected", () => {
    const doc = buildPieceDocument({
        generatorName: "Prancers",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 11,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        features: { Name: "Mochi Purrington" },
        // nameTrait omitted entirely.
    });
    assert.equal(doc.name, "Prancers #12");
});

check("declared and present: the trait value is appended", () => {
    const doc = buildPieceDocument({
        generatorName: "Prancers",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 11,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        features: { Name: "Mochi Purrington" },
        nameTrait: "Name",
    });
    assert.equal(doc.name, "Prancers #12 · Mochi Purrington");
});

check("declared, but this piece's features don't have it: falls back to plain", () => {
    const doc = buildPieceDocument({
        generatorName: "Prancers",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 11,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        features: { Temperament: "shy" },
        nameTrait: "Name",
    });
    assert.equal(doc.name, "Prancers #12");
});

check("declared, no features reported at all: falls back to plain", () => {
    const doc = buildPieceDocument({
        generatorName: "Prancers",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 11,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        nameTrait: "Name",
    });
    assert.equal(doc.name, "Prancers #12");
});

check(
    "declared, trait value is an empty string: falls back to plain, not a trailing separator",
    () => {
        const doc = buildPieceDocument({
            generatorName: "Prancers",
            artist: A,
            royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
            tokenId: 11,
            imageUri: "ipfs://image",
            seed: "oo1",
            codeHash: "aa",
            features: { Name: "   " },
            nameTrait: "Name",
        });
        assert.equal(doc.name, "Prancers #12");
    },
);

check("declared, trait value is a number: coerced to a string, not dropped", () => {
    const doc = buildPieceDocument({
        generatorName: "Prancers",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 11,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        features: { Lucky: 7 as unknown as string },
        nameTrait: "Lucky",
    });
    assert.equal(doc.name, "Prancers #12 · 7");
});

check("declared, trait value is absurdly long: truncated, never a broken or giant name", () => {
    const long = "x".repeat(500);
    const doc = buildPieceDocument({
        generatorName: "Prancers",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 11,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        features: { Name: long },
        nameTrait: "Name",
    });
    assert.ok(doc.name.length < 100, `name was ${doc.name.length} characters: ${doc.name}`);
    assert.ok(doc.name.startsWith("Prancers #12 · xxx"));
    assert.ok(doc.name.endsWith("…"));
});

console.log("\nartifactUri, objkt reads a missing one as no real content");

check("piece document: artifactUri always equals imageUri", () => {
    const doc = buildPieceDocument({
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 0,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
    });
    assert.equal(doc.artifactUri, "ipfs://image");
});

check("pending document: carries artifactUri too, same as displayUri/thumbnailUri", () => {
    const doc = buildPendingDocument({
        generatorName: "Drift",
        artist: A,
        placeholderImageUri: "ipfs://placeholder",
        split: { totalPercent: 0, recipients: [] },
    });
    assert.equal(doc.artifactUri, "ipfs://placeholder");
    assert.equal(doc.displayUri, "ipfs://placeholder");
    assert.equal(doc.thumbnailUri, "ipfs://placeholder");
});

console.log("\ntags");

check("not declared at all: no tags key on the document", () => {
    const doc = buildPieceDocument({
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 0,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
    });
    assert.ok(!("tags" in doc));
});

check("declared: lands on the document as-is", () => {
    const doc = buildPieceDocument({
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 0,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        tags: ["generative", "glitch"],
    });
    assert.deepEqual(doc.tags, ["generative", "glitch"]);
});

check("pending document: not declared at all: no tags key", () => {
    const doc = buildPendingDocument({
        generatorName: "Drift",
        artist: A,
        placeholderImageUri: "ipfs://placeholder",
        split: { totalPercent: 0, recipients: [] },
    });
    assert.ok(!("tags" in doc));
});

check("pending document: declared: lands on the document, cleaned", () => {
    const doc = buildPendingDocument({
        generatorName: "Drift",
        artist: A,
        placeholderImageUri: "ipfs://placeholder",
        split: { totalPercent: 0, recipients: [] },
        tags: ["Generative", "  glitch  ", "generative"],
    });
    assert.deepEqual(doc.tags, ["Generative", "glitch"]);
});

check("pending document: empty array: same as not declared", () => {
    const doc = buildPendingDocument({
        generatorName: "Drift",
        artist: A,
        placeholderImageUri: "ipfs://placeholder",
        split: { totalPercent: 0, recipients: [] },
        tags: [],
    });
    assert.ok(!("tags" in doc));
});

check("empty array: same as not declared, no tags key", () => {
    const doc = buildPieceDocument({
        generatorName: "Drift",
        artist: A,
        royalties: encodeRoyalties({ totalPercent: 0, recipients: [] }),
        tokenId: 0,
        imageUri: "ipfs://image",
        seed: "oo1",
        codeHash: "aa",
        tags: [],
    });
    assert.ok(!("tags" in doc));
});

check("cleanTags: not an array at all, never throws", () => {
    assert.deepEqual(cleanTags(undefined), []);
    assert.deepEqual(cleanTags(null), []);
    assert.deepEqual(cleanTags("generative"), []);
    assert.deepEqual(cleanTags({ 0: "generative" }), []);
});

check("cleanTags: non-string entries dropped, not coerced", () => {
    assert.deepEqual(cleanTags(["generative", 3, null, "glitch"]), ["generative", "glitch"]);
});

check("cleanTags: trimmed, empty strings dropped", () => {
    assert.deepEqual(cleanTags(["  generative  ", "   ", "glitch"]), ["generative", "glitch"]);
});

check("cleanTags: deduped case-insensitively, first spelling wins", () => {
    assert.deepEqual(cleanTags(["Generative", "generative", "GENERATIVE"]), ["Generative"]);
});

check("cleanTags: each tag capped at 32 characters", () => {
    const long = "x".repeat(50);
    const [tag] = cleanTags([long]);
    assert.equal(tag.length, 32);
});

check("cleanTags: a 32-character cap lands inside an emoji, the character survives whole", () => {
    // 31 ASCII characters, then a non-BMP emoji (two UTF-16 code units): a
    // plain .slice(0, 32) would keep only the leading surrogate and corrupt
    // the string. Array.from makes the cap count whole characters instead.
    const withEmoji = `${"x".repeat(31)}🎨🎨`;
    const [tag] = cleanTags([withEmoji]);
    assert.equal(tag, `${"x".repeat(31)}🎨`);
    assert.equal([...tag].length, 32);
});

check("cleanTags: a cap landing on a space leaves no trailing whitespace", () => {
    // 31 characters, then two spaces, then more text: the cap at 32 keeps
    // the first space and drops the rest, so the result needs a second trim.
    const [tag] = cleanTags([`${"x".repeat(31)}  more text here`]);
    assert.equal(tag, "x".repeat(31));
});

check("cleanTags: capped at 10 tags total, earliest kept", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    assert.equal(cleanTags(tags).length, 10);
    assert.deepEqual(cleanTags(tags), tags.slice(0, 10));
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

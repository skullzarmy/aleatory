import assert from "node:assert/strict";
import { parseSortKey, sortGenerators, remainingCount } from "./generator-sort";
import type { GeneratorSummary } from "./generator";

const mockGenerators: GeneratorSummary[] = [
    {
        address: "KT1A",
        name: "Echoes",
        artists: ["tz1Alice"],
        artistResolvedName: "alice.tez",
        minted: 10,
        editionSize: 50,
        firstActivity: "2024-01-01T00:00:00Z",
        paused: false,
        sealed: true,
        priceMutez: "5000000", // 5 tez
    },
    {
        address: "KT1B",
        name: "Fractals",
        artists: ["tz1Bob"],
        artistResolvedName: "bob.tez",
        minted: 50,
        editionSize: 50, // sold out (0 remaining)
        firstActivity: "2024-01-03T00:00:00Z",
        paused: false,
        sealed: true,
        priceMutez: "10000000", // 10 tez
    },
    {
        address: "KT1C",
        name: "Waves",
        artists: ["tz1Carol"],
        artistResolvedName: "carol.tez",
        minted: 2,
        editionSize: 10, // 8 remaining
        firstActivity: "2024-01-02T00:00:00Z",
        paused: false,
        sealed: true,
        priceMutez: "1000000", // 1 tez
    },
    {
        address: "KT1D",
        name: "Constellations",
        artists: ["tz1Dave"],
        artistResolvedName: "dave.tez",
        minted: 100,
        editionSize: 0, // open edition (Infinity remaining)
        firstActivity: "2024-01-04T00:00:00Z",
        paused: false,
        sealed: true,
        priceMutez: "0", // 0 tez
    },
];

console.log("\nGenerator sorting tests\n");

// Parse tests
assert.equal(parseSortKey(undefined), "created-desc");
assert.equal(parseSortKey("newest"), "created-desc");
assert.equal(parseSortKey("oldest"), "created-asc");
assert.equal(parseSortKey("price-desc"), "price-desc");
assert.equal(parseSortKey("price-asc"), "price-asc");
assert.equal(parseSortKey("price"), "price-asc");
assert.equal(parseSortKey("artist-asc"), "artist-asc");
assert.equal(parseSortKey("artist-desc"), "artist-desc");
assert.equal(parseSortKey("remaining-desc"), "remaining-desc");
assert.equal(parseSortKey("remaining-asc"), "remaining-asc");
assert.equal(parseSortKey("minted-desc"), "minted-desc");
assert.equal(parseSortKey("minted-asc"), "minted-asc");
console.log("  ok   parseSortKey handles aliases and defaults");

// Created date tests
const newest = sortGenerators(mockGenerators, "created-desc").map((g) => g.address);
assert.deepEqual(newest, ["KT1D", "KT1B", "KT1C", "KT1A"]);
console.log("  ok   created-desc sorts newest first");

const oldest = sortGenerators(mockGenerators, "created-asc").map((g) => g.address);
assert.deepEqual(oldest, ["KT1A", "KT1C", "KT1B", "KT1D"]);
console.log("  ok   created-asc sorts oldest first");

// Price tests
const priceHigh = sortGenerators(mockGenerators, "price-desc").map((g) => g.address);
assert.deepEqual(priceHigh, ["KT1B", "KT1A", "KT1C", "KT1D"]);
console.log("  ok   price-desc sorts highest price first");

const priceLow = sortGenerators(mockGenerators, "price-asc").map((g) => g.address);
assert.deepEqual(priceLow, ["KT1D", "KT1C", "KT1A", "KT1B"]);
console.log("  ok   price-asc sorts lowest price first");

// Minted count tests
const mintedHigh = sortGenerators(mockGenerators, "minted-desc").map((g) => g.address);
assert.deepEqual(mintedHigh, ["KT1D", "KT1B", "KT1A", "KT1C"]);
console.log("  ok   minted-desc sorts highest minted count first");

const mintedLow = sortGenerators(mockGenerators, "minted-asc").map((g) => g.address);
assert.deepEqual(mintedLow, ["KT1C", "KT1A", "KT1B", "KT1D"]);
console.log("  ok   minted-asc sorts lowest minted count first");

// Remaining count tests
assert.equal(remainingCount(mockGenerators[0]), 40);
assert.equal(remainingCount(mockGenerators[1]), 0);
assert.equal(remainingCount(mockGenerators[2]), 8);
assert.equal(remainingCount(mockGenerators[3]), Number.POSITIVE_INFINITY);

const remHigh = sortGenerators(mockGenerators, "remaining-desc").map((g) => g.address);
assert.deepEqual(remHigh, ["KT1D", "KT1A", "KT1C", "KT1B"]);
console.log("  ok   remaining-desc sorts highest remaining (open edition then 40, 8, 0)");

const remLow = sortGenerators(mockGenerators, "remaining-asc").map((g) => g.address);
// Active with lowest remaining (KT1C=8, KT1A=40, KT1D=Inf) then sold out (KT1B=0)
assert.deepEqual(remLow, ["KT1C", "KT1A", "KT1D", "KT1B"]);
console.log("  ok   remaining-asc prioritizes low active inventory over sold out");

// Artist name alphabetical tests
const artistAsc = sortGenerators(mockGenerators, "artist-asc").map((g) => g.address);
assert.deepEqual(artistAsc, ["KT1A", "KT1B", "KT1C", "KT1D"]);
console.log("  ok   artist-asc sorts A to Z");

const artistDesc = sortGenerators(mockGenerators, "artist-desc").map((g) => g.address);
assert.deepEqual(artistDesc, ["KT1D", "KT1C", "KT1B", "KT1A"]);
console.log("  ok   artist-desc sorts Z to A");

console.log("\nAll generator sorting checks passed.\n");

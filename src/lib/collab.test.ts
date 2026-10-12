/**
 * Collaborations against the generators that predate them.
 *
 * Every generator on chain before version 2 of the template has no `collab`
 * and no `template_version`, and the router keeps their factory listed on
 * purpose, so that shape is permanent rather than transitional. One
 * normalizer is the whole compatibility story, which makes it worth checking
 * directly: get it wrong and an existing generator credits nobody, or credits
 * the wrong person, on every page that reads it.
 *
 *   npx tsx src/lib/collab.test.ts
 */

import assert from "node:assert/strict";
import { normalizeCollab, paidNotCredited, unconfirmedCount } from "./collab";

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

console.log("a v1 generator, which is every generator deployed so far");

check("reads as version 1 when the field is absent", () => {
    assert.equal(normalizeCollab({ administrator: A }).templateVersion, 1);
});

check("reads as the one-member collaboration it is", () => {
    const { collab } = normalizeCollab({ administrator: A });
    assert.deepEqual(collab.shares, [{ address: A, bps: 10000 }]);
    assert.deepEqual(collab.confirmed, [A]);
});

check("has nobody awaiting credit", () => {
    assert.equal(unconfirmedCount(normalizeCollab({ administrator: A }).collab), 0);
});

check("an unparseable version still reads as 1, never as 0", () => {
    assert.equal(
        normalizeCollab({ administrator: A, template_version: "not a number" }).templateVersion,
        1,
    );
});

console.log("\na v2 generator");

check("one member at the whole share matches what v1 produces", () => {
    const v2 = normalizeCollab({
        administrator: A,
        template_version: "2",
        collab: { shares: { [A]: "10000" }, creditable: [A], confirmed: [A] },
    });
    const v1 = normalizeCollab({ administrator: A });
    assert.equal(v2.templateVersion, 2);
    assert.deepEqual(v2.collab, v1.collab, "a solo v2 generator reads identically to a v1 one");
});

check("shares are decoded as numbers, not strings", () => {
    const { collab } = normalizeCollab({
        administrator: A,
        template_version: "2",
        collab: { shares: { [A]: "6000", [B]: "4000" }, creditable: [A, B], confirmed: [A] },
    });
    assert.equal(
        collab.shares.reduce((n, s) => n + s.bps, 0),
        10000,
    );
});

check("confirmed is sorted, so two reads credit in the same order", () => {
    const { collab } = normalizeCollab({
        administrator: B,
        template_version: "2",
        collab: {
            shares: { [A]: "5000", [B]: "5000" },
            creditable: [A, B],
            confirmed: [B, A],
        },
    });
    assert.deepEqual(collab.confirmed, [A, B]);
});

check("a member who has not accepted is counted, and not credited", () => {
    const { collab } = normalizeCollab({
        administrator: A,
        template_version: "2",
        collab: {
            shares: { [A]: "5000", [B]: "3000", [C]: "2000" },
            creditable: [A, B, C],
            confirmed: [A],
        },
    });
    assert.deepEqual(collab.confirmed, [A], "only the deployer is credited");
    assert.equal(unconfirmedCount(collab), 2);
});

check("everyone accepting leaves nobody awaiting credit", () => {
    const { collab } = normalizeCollab({
        administrator: A,
        template_version: "2",
        collab: { shares: { [A]: "5000", [B]: "5000" }, creditable: [A, B], confirmed: [A, B] },
    });
    assert.equal(unconfirmedCount(collab), 0);
});

check("a collab subtree with nothing in it does not crash a page", () => {
    const { collab } = normalizeCollab({
        administrator: A,
        template_version: "2",
        collab: {},
    });
    assert.deepEqual(collab.shares, []);
    assert.deepEqual(collab.confirmed, []);
    assert.equal(unconfirmedCount(collab), 0);
});

console.log("\na cut is not a credit");

check("someone paid without being named is not a co-author", () => {
    const { collab } = normalizeCollab({
        administrator: A,
        template_version: "2",
        collab: {
            shares: { [A]: "6000", [B]: "3000", [C]: "1000" },
            creditable: [A, B],
            confirmed: [A],
        },
    });
    assert.deepEqual(
        paidNotCredited(collab).map((s) => s.address),
        [C],
        "C takes a cut and is not one of the artists",
    );
});

check("the waiting count is co-authors, not everyone being paid", () => {
    const { collab } = normalizeCollab({
        administrator: A,
        template_version: "2",
        collab: {
            shares: { [A]: "6000", [B]: "3000", [C]: "1000" },
            creditable: [A, B],
            confirmed: [A],
        },
    });
    assert.equal(unconfirmedCount(collab), 1, "only B is still to accept; C never was");
});

check("a v1 generator has nobody taking a cut", () => {
    const { collab } = normalizeCollab({ administrator: A });
    assert.deepEqual(paidNotCredited(collab), []);
    assert.deepEqual(collab.creditable, [A]);
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

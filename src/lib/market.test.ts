/**
 * Acting on a listing has to reach the contract that holds it.
 *
 * A listing lives in whichever marketplace it was made on, and that contract
 * keeps working after a newer one ships. Buying, delisting, cancelling and
 * accepting all have to name it. Sending any of them to the current
 * marketplace instead fails on a contract that never held the thing, after the
 * wallet has already asked the person to sign.
 *
 * Checked in the source, because the failure needs two deployed marketplaces
 * to reproduce and by then it has already cost somebody a signature.
 *
 * Run: npm test
 */

import { readFileSync } from "node:fs";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const ops = readFileSync("src/lib/ops.ts", "utf8");
const market = readFileSync("src/lib/market.ts", "utf8");
const piece = readFileSync("src/components/piece/PieceMarket.tsx", "utf8");
const router = readFileSync("src/lib/router.ts", "utf8");

console.log("\nMarketplace versioning\n");

// Everything that acts on something already made takes the address it lives at.
for (const fn of ["delist", "buyListing", "cancelOffer", "acceptOffer", "acceptOfferFor"]) {
    const body = ops.slice(ops.indexOf(`export async function ${fn}(`));
    const signature = body.slice(0, body.indexOf(")"));
    check(
        `${fn} is told which marketplace`,
        /market(placeAddress)?\s*:\s*string/.test(signature),
        "it would use the current one",
    );
}

// And the component passes the one on the row, not the one in state.
for (const [call, expected] of [
    ["ops.delist(", "listing.marketplace"],
    ["ops.buyListing(", "listing.marketplace"],
    ["ops.cancelOffer(", "o.marketplace"],
    ["ops.acceptOfferFor(", "o.marketplace"],
] as const) {
    // A window rather than up to the first ")": these calls nest
    // `await getClient()`, whose paren closes long before the argument list.
    const at = piece.indexOf(call);
    const args = at === -1 ? "" : piece.slice(at, at + 700);
    check(
        `PieceMarket passes ${expected} to ${call.replace("ops.", "").replace("(", "")}`,
        at !== -1 && args.includes(expected),
        at === -1 ? "call not found" : "passes something else",
    );
}

// Rows carry it, or the component has nothing to pass.
check("a listing records the marketplace holding it", /marketplace:\s*string/.test(market));
check(
    "toListing and toOffer are given it",
    /function toListing\([^)]*marketplace: string/.test(market) &&
        /function toOffer\([^)]*marketplace: string/.test(market),
);

// Reads span every marketplace.
check(
    "listings and offers are read across all of them",
    /acrossMarketplaces/.test(market),
    "only the current one would be read",
);

// The history comes from storage, not events: the first marketplace is set at
// origination and emits nothing, so an event scan loses it silently.
check(
    "the marketplace history comes from storage history",
    /storage\/history/.test(router),
    "events miss the marketplace set at origination",
);
check(
    "the current marketplace is the head of the list",
    /marketplaces\[0\]/.test(router),
);

console.log(
    failures === 0
        ? "\nEvery marketplace operation reaches the contract that holds it.\n"
        : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

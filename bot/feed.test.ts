/**
 * The market feed, run against an indexer that answers from fixtures. The
 * payloads are the shapes TzKT returns: `list` and `sale` as records, `delist`
 * as the bare listing id a one-field SmartPy record compiles to.
 *
 * Run: npm test
 */

import { idOf, newMarketEvents } from "./feed";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

const API = "http://tzkt.test";
const ROUTER = "KT1Router";
const MARKET = "KT1Market";
const GENERATOR = "KT1Generator";

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

const row = (id: number, tag: string, payload: unknown) => ({
    id,
    level: id,
    timestamp: "2026-10-04T00:00:00Z",
    contract: { address: MARKET },
    tag,
    payload,
    transactionId: id,
});

const listed = (id: number, listingId: string, tokenId: string, price: string) =>
    row(id, "list", {
        listing_id: listingId,
        seller: "tz1Seller",
        collection: GENERATOR,
        token_id: tokenId,
        price,
    });

/** The page `newMarketEvents` reads next, swapped per pass. */
let page: unknown[] = [];

const fixtures: Record<string, unknown> = {
    [`/v1/contracts/${ROUTER}/storage`]: { factories: [], marketplace: MARKET },
    [`/v1/contracts/${ROUTER}/storage/history?limit=200`]: [],
    [`/v1/contracts/${GENERATOR}/bigmaps/metadata/keys/content`]: {
        value: hex(JSON.stringify({ name: "Drift" })),
    },
    [`/v1/contracts/${GENERATOR}/storage`]: {
        administrator: "tz1Artist",
        sale: { edition_size: "64" },
    },
    // The fallback for a listing this process never saw created.
    [`/v1/contracts/events?contract=${MARKET}&tag=list&payload.listing_id=7&limit=1`]: [
        listed(10, "7", "3", "9000000"),
    ],
};

globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const path = url.slice(API.length);
    if (path.startsWith("/v1/contracts/events?contract.in=")) return Response.json(page);
    if (path.startsWith("/v1/tokens?")) {
        const tokenId = new URL(url).searchParams.get("tokenId");
        return Response.json([{ metadata: { name: `Drift #${Number(tokenId) + 1}` } }]);
    }
    if (path in fixtures) return Response.json(fixtures[path]);
    return new Response("not in the fixtures", { status: 404 });
}) as typeof fetch;

process.env.TZKT_API = API;
process.env.ALEA_ROUTER_ADDRESS = ROUTER;

async function run() {
    console.log("\nReading an id from a payload\n");

    check("a bare payload is the id", idOf("1", "listing_id") === "1");
    check("a record carries it by name", idOf({ listing_id: "4" }, "listing_id") === "4");
    check("listing zero is an id", idOf("0", "listing_id") === "0");
    check("a record without the field has none", idOf({ offer_id: "2" }, "listing_id") === "");
    check("nothing has none", idOf(undefined, "listing_id") === "");

    console.log("\nThe market feed\n");

    page = [listed(100, "1", "4", "5000000"), row(101, "delist", "1")];
    const first = await newMarketEvents(0);
    const cancelled = first.items.find((i) => i.kind === "cancelled");
    check(
        "a listing and its cancellation are both announced",
        first.items.map((i) => i.kind).join(",") === "listed,cancelled",
        first.items.map((i) => i.kind).join(","),
    );
    check(
        "the cancellation names what was listed",
        cancelled?.collection === GENERATOR &&
            cancelled.tokenId === "4" &&
            cancelled.seller === "tz1Seller" &&
            cancelled.priceMutez === 5_000_000,
        JSON.stringify(cancelled),
    );
    check(
        "the cancellation carries the piece and its generator",
        cancelled?.name === "Drift #5" &&
            cancelled.generatorName === "Drift" &&
            cancelled.artist === "tz1Artist" &&
            cancelled.editionSize === 64,
        JSON.stringify(cancelled),
    );
    check("the mark moves to the last row", first.consumed === 101, String(first.consumed));

    page = [row(102, "delist", "7")];
    const second = await newMarketEvents(101);
    const recovered = second.items[0];
    check(
        "a cancellation from before this process is read back from the log",
        recovered?.kind === "cancelled" &&
            recovered.tokenId === "3" &&
            recovered.priceMutez === 9_000_000,
        JSON.stringify(second.items),
    );

    page = [listed(103, "2", "6", "1000000"), row(104, "delist", { listing_id: "2" })];
    const third = await newMarketEvents(102);
    check(
        "a delist carried as a record is still read",
        third.items.map((i) => i.kind).join(",") === "listed,cancelled",
        third.items.map((i) => i.kind).join(","),
    );

    page = [row(105, "delist", "99")];
    const fourth = await newMarketEvents(104);
    check(
        "a cancellation with no listing anywhere is skipped and still consumed",
        fourth.items.length === 0 && fourth.consumed === 105,
        JSON.stringify(fourth),
    );

    console.log(
        failures === 0
            ? "\nEvery cancellation names the listing it ends.\n"
            : `\n${failures} check(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
    console.error("\nThe suite could not run:", e instanceof Error ? e.message : e);
    process.exit(1);
});

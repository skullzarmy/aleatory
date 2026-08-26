/**
 * Re-publish one piece.
 *
 *   npm run provider:retry -- KT1… 3
 *
 * The queue finds pieces still holding the collection's pending document, so
 * it cannot see a piece that already got a write. That is the whole reason
 * this exists: a publish whose confirmation was missed, a render that came out
 * wrong, a metadata document pinned somewhere that later went away. Every one
 * of those leaves a piece the queue considers finished.
 *
 * `set_token_metadata` is a plain write for the same reason. Who may write is
 * the bound, and that is the provider's current agent, asked live.
 */
import dotenv from "dotenv";
dotenv.config();

const { pieceAt, handle } = await import("../netlify/functions/provider.mts");

const [collection, tokenId] = process.argv.slice(2);

if (!collection || !tokenId) {
    console.log("\n  npm run provider:retry -- <collection> <tokenId>\n");
    process.exit(1);
}
if (!/^KT1[1-9A-HJ-NP-Za-km-z]{33}$/.test(collection)) {
    console.log(`\n  ${collection} is not a contract address.\n`);
    process.exit(1);
}
if (!/^\d+$/.test(tokenId)) {
    console.log(`\n  ${tokenId} is not a token id.\n`);
    process.exit(1);
}

console.log(`\nRebuilding ${collection} #${tokenId}`);

const piece = await pieceAt(collection, tokenId).catch((e: unknown) => {
    console.log(`  ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
});

console.log(`  seed    ${piece.seed}`);
console.log(`  params  ${piece.params || "(none)"}`);
console.log("  rendering…");

try {
    const hash = await handle(piece);
    console.log(`\n  published, op ${hash}\n`);
} catch (e) {
    console.log(`\n  FAILED: ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
}

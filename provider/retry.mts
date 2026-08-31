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

const { pieceAt, handle, collectionsServed, tokenIdsIn } = await import(
    "./provider.mts"
);

const [target, tokenId] = process.argv.slice(2);

if (!target) {
    console.log(`
  npm run provider:retry -- <collection> <tokenId>   one piece
  npm run provider:retry -- <collection>             a whole collection
  npm run provider:retry -- --all                    everything served
`);
    process.exit(1);
}
if (target !== "--all" && !/^KT1[1-9A-HJ-NP-Za-km-z]{33}$/.test(target)) {
    console.log(`\n  ${target} is not a contract address.\n`);
    process.exit(1);
}
if (tokenId !== undefined && !/^\d+$/.test(tokenId)) {
    console.log(`\n  ${tokenId} is not a token id.\n`);
    process.exit(1);
}

/** Every piece the run will touch, in order. */
async function targets(): Promise<{ collection: string; tokenId: string }[]> {
    if (target !== "--all" && tokenId !== undefined) {
        return [{ collection: target, tokenId }];
    }
    const collections = target === "--all" ? await collectionsServed() : [target];
    const out: { collection: string; tokenId: string }[] = [];
    for (const c of collections) {
        for (const t of await tokenIdsIn(c)) out.push({ collection: c, tokenId: t });
    }
    return out;
}

const work = await targets();
if (work.length === 0) {
    console.log("\n  Nothing to rebuild.\n");
    process.exit(0);
}

console.log(`\nRebuilding ${work.length} piece${work.length === 1 ? "" : "s"}`);

let done = 0;
let failed = 0;
for (const { collection, tokenId } of work) {
    process.stdout.write(`  ${collection} #${tokenId}  `);
    try {
        const piece = await pieceAt(collection, tokenId);
        const hash = await handle(piece);
        done++;
        console.log(`published ${hash}`);
    } catch (e) {
        failed++;
        console.log(`FAILED: ${e instanceof Error ? e.message : e}`);
    }
}

console.log(`\n  ${done} published, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * Re-publish one piece.
 *
 *   npm run provider:retry -- KT1… 3
 *
 * The queue finds pieces still holding the generator's pending document, so it
 * cannot see one that already got a write: a publish whose confirmation was
 * missed, a render that came out wrong, a metadata document that went away.
 *
 * `set_token_metadata` is a plain write, and who may write is the bound: the
 * provider's current agent, asked live.
 */
import dotenv from "dotenv";
dotenv.config();

const { pieceAt, handle, generatorsServed, tokenIdsIn } = await import("./provider.mts");

const [target, tokenId] = process.argv.slice(2);

if (!target) {
    console.log(`
  npm run provider:retry -- <generator> <tokenId>   one piece
  npm run provider:retry -- <generator>             a whole generator
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
async function targets(): Promise<{ generator: string; tokenId: string }[]> {
    if (target !== "--all" && tokenId !== undefined) {
        return [{ generator: target, tokenId }];
    }
    const generators = target === "--all" ? await generatorsServed() : [target];
    const out: { generator: string; tokenId: string }[] = [];
    for (const c of generators) {
        for (const t of await tokenIdsIn(c)) out.push({ generator: c, tokenId: t });
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
for (const { generator, tokenId } of work) {
    process.stdout.write(`  ${generator} #${tokenId}  `);
    try {
        const piece = await pieceAt(generator, tokenId);
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

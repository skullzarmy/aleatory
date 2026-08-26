/**
 * The render provider. A process that stays up.
 *
 *   npm run provider:daemon
 *
 * It watches the chain for pieces holding their collection's pending document
 * and renders them. A piece is minted, and seconds later it has its image.
 *
 * Polling rather than a subscription, because the queue rule is a comparison
 * against chain state and not an event: it finds new mints, pieces missed
 * while this was down, and pieces inherited from a provider an artist switched
 * away from, with no state of its own to keep in sync. An event stream would
 * be faster and would need a cursor, and a cursor is a thing that can be
 * wrong.
 *
 * A push endpoint can sit in front of this later so a mint UI can say "look
 * now" instead of waiting for the next tick, but polling has to work on its
 * own first, or a provider is only as reliable as whoever remembers to call
 * it.
 */
import dotenv from "dotenv";
dotenv.config();

const { collectionsServed, pendingIn, handle } = await import(
    "../netlify/functions/provider.mts"
);
const { renderConfigFromEnv } = await import("../netlify/functions/lib/render.mts");

/** How often to look when there is nothing to do. */
const IDLE_MS = Number(process.env.ALEA_POLL_MS || 15_000);
/** How long to wait after a failure, doubling, so a broken dependency is not hammered. */
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

function log(msg: string) {
    console.log(`${new Date().toISOString()}  ${msg}`);
}

const missing = [
    !process.env.ALEA_PROVIDER_ADDRESS && "ALEA_PROVIDER_ADDRESS",
    !process.env.ALEA_AGENT_SK && "ALEA_AGENT_SK",
    !process.env.PINATA_JWT && "PINATA_JWT",
    !renderConfigFromEnv() && "CF_ACCOUNT_ID / CF_API_TOKEN",
].filter(Boolean);

if (missing.length > 0) {
    console.log(`\nNot configured: ${missing.join(", ")}. See .env.example.\n`);
    process.exit(1);
}

log(`provider ${process.env.ALEA_PROVIDER_ADDRESS}`);
log(`polling every ${IDLE_MS / 1000}s`);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
        if (stopping) process.exit(1);
        stopping = true;
        // Finish the piece in flight rather than leaving it half published.
        log(`${sig}, stopping after the current piece`);
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let backoff = BACKOFF_MIN_MS;
let served: string[] = [];
let servedAt = 0;

while (!stopping) {
    try {
        // The set of collections changes rarely, and rescanning it every tick
        // is most of the work. Once a minute is often enough to pick up a
        // collection deployed a moment ago.
        if (Date.now() - servedAt > 60_000) {
            served = await collectionsServed();
            servedAt = Date.now();
        }

        let published = 0;
        for (const collection of served) {
            if (stopping) break;
            const waiting = await pendingIn(collection).catch((e) => {
                log(`scan ${collection}: ${e instanceof Error ? e.message : e}`);
                return [];
            });

            for (const piece of waiting) {
                if (stopping) break;
                log(`rendering ${piece.collection} #${piece.tokenId}`);
                try {
                    const hash = await handle(piece);
                    published++;
                    log(`  published ${hash}`);
                } catch (e) {
                    // One bad piece must not stop the queue. It stays pending,
                    // so the next pass tries it again, and `provider:retry`
                    // reaches it if it needs a hand.
                    log(`  FAILED: ${e instanceof Error ? e.message : e}`);
                }
            }
        }

        backoff = BACKOFF_MIN_MS;
        // Straight back round when there was work: a busy collection should
        // not wait a full interval between pieces.
        await sleep(published > 0 ? 1_000 : IDLE_MS);
    } catch (e) {
        // Whatever this was, it was not one piece. Back off rather than spin.
        log(`cycle failed: ${e instanceof Error ? e.message : e}`);
        log(`  retrying in ${backoff / 1000}s`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
}

log("stopped");
process.exit(0);

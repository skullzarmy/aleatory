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
import { createServer } from "node:http";
dotenv.config();

const { collectionsServed, pendingIn, handle } = await import(
    "./provider.mts"
);
const { renderConfigFromEnv } = await import("./render.mts");

/** How often to look when there is nothing to do. */
const IDLE_MS = Number(process.env.ALEA_POLL_MS || 15_000);
/**
 * The push endpoint, off until it is asked for.
 *
 * Loopback by default, so reaching it from outside is a decision somebody
 * makes on purpose.
 */
const PUSH_ON = /^(1|on|true|yes)$/i.test(process.env.ALEA_PROVIDER_PUSH || "");
const PUSH_PORT = Number(process.env.ALEA_PROVIDER_PORT || 8787);
const PUSH_BIND = process.env.ALEA_PROVIDER_BIND || "127.0.0.1";
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
        // The piece in flight finishes, so nothing is left half published.
        log(`${sig}, stopping after the current piece`);
        // Stop accepting pushes at once; a render already under way finishes.
        pushServer?.close();
        wake?.();
    });
}

/**
 * The wait between passes, woken early by a signal or a push.
 *
 * Most of this process's life is spent in here. A stop that was only checked
 * on the way round the loop would sit until the interval was up, and a push
 * that could not shorten it would be a notification nobody acted on.
 */
let wake: (() => void) | null = null;
const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
        const timer = setTimeout(finish, ms);
        function finish() {
            clearTimeout(timer);
            wake = null;
            resolve();
        }
        wake = finish;
    });

/**
 * The push endpoint this provider advertises.
 *
 * ALEATORY-001 §5: a provider may publish a URL, and a mint UI calls it when a
 * piece is minted. **It carries no authentication and cannot.** The UI doing
 * the calling holds none of this provider's secrets, and any UI is entitled to
 * call any provider, so a credential here would mean the endpoint only worked
 * for whoever we happened to share a secret with.
 *
 * So it is a shoulder tap from a stranger, and the design follows from that:
 * it may be ignored at any time with no loss. A tap sets a flag. The flag
 * shortens the wait before the next read of the chain, and the chain is what
 * decides the work. Nothing a caller sends is read, kept, or believed.
 *
 * Which makes a flood uninteresting. Taps are answered and dropped above
 * PUSH_FLOOR_MS, so the most a caller can buy is one early scan every few
 * seconds, which is a thing this process does on its own anyway.
 */
let pushServer: ReturnType<typeof createServer> | null = null;

/**
 * The soonest a tap may bring the next scan forward.
 *
 * The ceiling on what tapping achieves, and therefore the ceiling on what
 * flooding achieves. Below this a tap is answered and forgotten.
 */
const PUSH_FLOOR_MS = 5_000;
let lastTapAt = 0;

function listen(bind: string, port: number) {
    pushServer = createServer((req, res) => {
        if (req.method !== "POST") {
            req.socket.destroy();
            return;
        }

        // Answered either way, because a caller has done nothing wrong by
        // tapping twice and there is nothing here worth hiding from them.
        const now = Date.now();
        if (now - lastTapAt < PUSH_FLOOR_MS) {
            res.writeHead(202).end();
            return;
        }
        lastTapAt = now;
        res.writeHead(202).end();

        // A tap usually means a mint, and a mint into a collection deployed a
        // minute ago would otherwise wait for the next rescan.
        servedAt = 0;
        log("tapped, looking early");
        wake?.();
    });

    // Slow-loris and header-flood limits. Node's defaults suit a public web
    // server and are far too generous for a one-verb endpoint.
    pushServer.maxHeadersCount = 20;
    pushServer.headersTimeout = 3_000;
    pushServer.requestTimeout = 5_000;
    pushServer.keepAliveTimeout = 1_000;
    pushServer.maxRequestsPerSocket = 4;
    pushServer.on("clientError", (_e, socket) => socket.destroy());

    pushServer.listen(port, bind, () => {
        log(`push endpoint on ${bind}:${port}, unauthenticated by design`);
        if (bind !== "127.0.0.1" && bind !== "localhost") {
            log("  bound to a public interface, in plain HTTP.");
            log("  Put a reverse proxy in front for TLS and connection limits.");
            log("  See docs/provider.md, 'The push endpoint'.");
        }
    });
}

let backoff = BACKOFF_MIN_MS;
let served: string[] = [];
let servedAt = 0;

if (PUSH_ON) listen(PUSH_BIND, PUSH_PORT);
else log(`polling every ${IDLE_MS / 1000}s, no push endpoint`);

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
            const waiting = await pendingIn(collection).catch((e: unknown) => {
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

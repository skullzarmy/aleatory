/**
 * The render provider, as a process that stays up.
 *
 *   npm run provider:daemon
 *
 * It watches the chain for pieces holding their generator's pending document
 * and renders them.
 *
 * Polling, because the queue rule is a comparison against chain state and not
 * an event, so it keeps no cursor and finds new mints, pieces missed while this
 * was down, and pieces inherited from a provider an artist switched away from.
 * The push endpoint below only shortens the wait.
 */
import dotenv from "dotenv";
import { createServer } from "node:http";
dotenv.config();

const { generatorsServed, factoriesIgnored, pendingIn, handle } = await import("./provider.mts");
const { renderConfigFromEnv } = await import("./render.mts");
const { heartbeat } = await import("./heartbeat.ts");

/** How often to look when there is nothing to do. */
const IDLE_MS = Number(process.env.ALEA_POLL_MS || 15_000);
/** Off until asked for, and loopback by default. */
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

for (const f of await factoriesIgnored()) {
    log(`! ALEA_FACTORIES hides ${f}, which the router lists. Nothing it deploys will render.`);
}

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
        if (stopping) process.exit(1);
        stopping = true;
        // The piece in flight finishes, so nothing is left half published.
        log(`${sig}, stopping after the current piece`);
        pushServer?.close();
        wake?.();
    });
}

/**
 * The wait between passes, woken early by a signal or a push. Most of this
 * process's life is spent in here, so a stop checked only at the top of the
 * loop would sit until the interval was up.
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
 * The push endpoint this provider advertises (ALEATORY-001 §5).
 *
 * It carries no authentication and cannot: any UI is entitled to call any
 * provider, and the caller holds none of this provider's secrets, so a
 * credential would mean the endpoint worked only for whoever we shared one
 * with.
 *
 * A tap therefore does one thing, which is shorten the wait before the next
 * read of the chain. Nothing a caller sends is read, kept or believed, and the
 * chain decides the work, so a tap can be ignored at any time with no loss.
 */
let pushServer: ReturnType<typeof createServer> | null = null;

/**
 * The soonest a tap may bring the next scan forward, and so the ceiling on what
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

        // Answered either way. A caller has done nothing wrong by tapping twice.
        const now = Date.now();
        if (now - lastTapAt < PUSH_FLOOR_MS) {
            res.writeHead(202).end();
            return;
        }
        lastTapAt = now;
        res.writeHead(202).end();

        // A tap does not clear the generator-list interval below, which would
        // let a stranger pick how often this runs its heaviest query.
        log("tapped, looking early");
        wake?.();
    });

    // Slow-loris and header-flood limits. Node's defaults are sized for a
    // public web server, not a one-verb endpoint.
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

/**
 * Beaten on every piece of progress rather than once per pass.
 *
 * A pass is unbounded: it walks every pending piece across every generator it
 * serves, and one piece allows a twenty second capture, a gateway warm and a
 * publish that waits for a block. A drop of thirty mints is one pass that runs
 * for minutes and is perfectly healthy, so a beat only at the end would go
 * quiet exactly when the daemon is working hardest.
 */
const beat = heartbeat(process.env.ALEA_HEARTBEAT_URL);

if (PUSH_ON) listen(PUSH_BIND, PUSH_PORT);
else log(`polling every ${IDLE_MS / 1000}s, no push endpoint`);

while (!stopping) {
    try {
        // Rescanning this every tick is most of the work here.
        if (Date.now() - servedAt > 60_000) {
            served = await generatorsServed();
            servedAt = Date.now();
        }

        const startedAt = Date.now();
        let published = 0;
        let failed = 0;
        let scanned = 0;
        let scanFailed = 0;
        for (const generator of served) {
            if (stopping) break;
            scanned++;
            const waiting = await pendingIn(generator).catch((e: unknown) => {
                scanFailed++;
                log(`scan ${generator}: ${e instanceof Error ? e.message : e}`);
                return [];
            });

            for (const piece of waiting) {
                if (stopping) break;
                log(`rendering ${piece.generator} #${piece.tokenId}`);
                // Before the work, not only after it: a capture that takes
                // twenty seconds is progress and should sound like it.
                beat({ status: "up", msg: `rendering #${piece.tokenId}` });
                try {
                    const hash = await handle(piece);
                    published++;
                    log(`  published ${hash}`);
                    beat({ status: "up", msg: `published #${piece.tokenId}` });
                } catch (e) {
                    // One bad piece must not stop the queue. It stays pending
                    // and the next pass tries again.
                    failed++;
                    log(`  FAILED: ${e instanceof Error ? e.message : e}`);
                }
            }
        }

        // Every generator refusing to be read looks exactly like an empty
        // queue from in here: the scan is caught, the count stays zero and the
        // loop sleeps. That is the state worth waking somebody for.
        const blind = scanned > 0 && scanFailed === scanned;
        beat({
            status: blind ? "down" : "up",
            msg: blind
                ? `every scan failed (${scanned} generators)`
                : `${scanned} scanned, ${scanFailed} scan failed, ${published} published, ${failed} failed`,
            ping: Date.now() - startedAt,
        });

        backoff = BACKOFF_MIN_MS;
        // Straight back round when there was work, so a busy generator does
        // not wait a full interval between pieces.
        await sleep(published > 0 ? 1_000 : IDLE_MS);
    } catch (e) {
        // Not one piece, so back off rather than spin.
        log(`cycle failed: ${e instanceof Error ? e.message : e}`);
        log(`  retrying in ${backoff / 1000}s`);
        beat({ status: "down", msg: `cycle failed: ${e instanceof Error ? e.message : e}` });
        await sleep(backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
}

log("stopped");
process.exit(0);

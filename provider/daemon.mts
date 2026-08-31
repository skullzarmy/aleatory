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
import { timingSafeEqual } from "node:crypto";
dotenv.config();

const { collectionsServed, pendingIn, handle } = await import(
    "./provider.mts"
);
const { renderConfigFromEnv } = await import("./render.mts");

/** How often to look when there is nothing to do. */
const IDLE_MS = Number(process.env.ALEA_POLL_MS || 15_000);
/**
 * Where the push endpoint listens. Loopback by default, so exposing it is a
 * decision somebody makes on purpose.
 */
const PING_PORT = Number(process.env.ALEA_PROVIDER_PORT || 8787);
const PING_BIND = process.env.ALEA_PROVIDER_BIND || "127.0.0.1";
const PING_TOKEN = process.env.ALEA_PROVIDER_PING_TOKEN || "";
/** Short enough to guess is the same as no token at all. */
const MIN_TOKEN_CHARS = 32;
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
 * ALEATORY-001 §5 lets a provider put a URL in its TZIP-016 metadata, and a
 * mint UI reads that URL off the chain and calls it the moment a piece is
 * minted. Work is found by comparing chain state either way, so this shortens
 * one poll interval and carries no other meaning. Running without it is a
 * complete way to run a provider.
 *
 * **Everything about this listener assumes the caller is hostile.** It is an
 * open port on a machine holding an agent key, so a flood has to cost close to
 * nothing and a stranger has to learn close to nothing.
 *
 * A request is refused in the cheapest order the protocol allows: wrong
 * method, then a token that fails a constant-time compare. Either way the
 * socket is destroyed with no response written and no body read, so a
 * hammering client pays for a TCP handshake and learns nothing about which
 * check it failed.
 *
 * A valid push sets a flag. That is the entire effect, and it is idempotent
 * inside one interval, so the rate gate throws away everything past the first
 * without losing anything.
 *
 * The bind address defaults to loopback. Reaching it from the internet is then
 * a deliberate act by whoever runs it: a reverse proxy that terminates TLS and
 * rate limits, or a firewall rule. See docs/provider.md.
 */
let pushServer: ReturnType<typeof createServer> | null = null;

/**
 * Authenticated pushes acted on per second.
 *
 * A wake is idempotent inside one interval, so the rest are answered and
 * dropped. Counted after the token check, or an anonymous flood would spend
 * the allowance a real caller needs.
 */
const PUSH_RATE_PER_SEC = 2;
let gateAt = 0;
let gateCount = 0;

function overRate(): boolean {
    const now = Date.now();
    if (now - gateAt > 1_000) {
        gateAt = now;
        gateCount = 0;
    }
    return ++gateCount > PUSH_RATE_PER_SEC;
}

function listen(bind: string, port: number, token: string) {
    const expected = Buffer.from(token);

    pushServer = createServer((req, res) => {
        // Cheapest checks first, and a refusal never writes a response: a
        // destroyed socket costs one packet and tells a prober nothing about
        // whether the method, the path or the token was the problem.
        if (req.method !== "POST") {
            req.socket.destroy();
            return;
        }

        const given = Buffer.from((req.headers.authorization || "").replace(/^Bearer /, ""));
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
            req.socket.destroy();
            return;
        }

        // Rate limited after the token, so a flood of anonymous requests can
        // never consume the allowance a real caller needs. Answering is worth
        // one packet here: this caller is holding the token.
        if (overRate()) {
            res.writeHead(429, { "retry-after": "1" }).end();
            return;
        }

        // The body goes unread. Nothing a caller could say changes what
        // happens next.
        res.writeHead(202).end();

        // Drop the collection cache too: a push usually means a mint, and a
        // mint into a collection deployed a minute ago would otherwise wait
        // for the next rescan.
        servedAt = 0;
        log("push received");
        wake?.();
    });

    // Slow-loris and header-flood limits. Node's defaults are generous for a
    // public web server and far too generous for a one-verb endpoint.
    pushServer.maxHeadersCount = 20;
    pushServer.headersTimeout = 3_000;
    pushServer.requestTimeout = 5_000;
    pushServer.keepAliveTimeout = 1_000;
    pushServer.maxRequestsPerSocket = 4;
    pushServer.on("clientError", (_e, socket) => socket.destroy());

    pushServer.listen(port, bind, () => {
        log(`push endpoint on ${bind}:${port}`);
        if (bind !== "127.0.0.1" && bind !== "localhost") {
            log("  WARNING: bound to a public interface, in plain HTTP.");
            log("  WARNING: put TLS and a rate limiter in front, or bind 127.0.0.1.");
            log("  WARNING: see docs/provider.md, 'The push endpoint'.");
        }
    });
}

let backoff = BACKOFF_MIN_MS;
let served: string[] = [];
let servedAt = 0;

if (!PING_TOKEN) {
    log(`polling every ${IDLE_MS / 1000}s, no push endpoint`);
} else if (PING_TOKEN.length < MIN_TOKEN_CHARS) {
    // Refused rather than warned: a guessable token on an open port is worse
    // than the polling this replaces, and polling already works.
    console.log(
        `\nALEA_PROVIDER_PING_TOKEN is ${PING_TOKEN.length} characters. ` +
            `Use at least ${MIN_TOKEN_CHARS}:\n\n  openssl rand -hex 32\n\n` +
            `Or unset it and poll, which needs no open port.\n`,
    );
    process.exit(1);
} else {
    listen(PING_BIND, PING_PORT, PING_TOKEN);
}

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

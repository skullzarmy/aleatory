/**
 * The stats bot. A process that stays up.
 *
 *   npm run bot:daemon
 *
 * It reads the chain and writes the figures into Discord channel names, on a
 * clock. Nothing is received from Discord, so there is no gateway connection
 * and no socket to hold open: a rename is one REST call.
 *
 * **Ten minutes is a limit, not a preference.** Discord allows about two
 * channel renames per ten minutes, per channel. Polling faster would spend
 * that allowance on names that had not changed and leave none for the moment
 * one did.
 *
 * Runs anywhere with Node and an outbound connection, alongside the provider
 * or on its own. Nothing here imports from the site.
 */
import dotenv from "dotenv";
import { platformStats } from "./stats";
import { channelsFromEnv, writeAll } from "./discord";
import { network, router, provider } from "./chain";

dotenv.config();

/** Discord's rename allowance is the floor, so this cannot be tuned below it. */
const MIN_TICK_MS = 10 * 60_000;
const TICK_MS = Math.max(MIN_TICK_MS, Number(process.env.ALEA_BOT_TICK_MS || MIN_TICK_MS));
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

const log = (msg: string) => console.log(`${new Date().toISOString()}  ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const token = process.env.DISCORD_BOT_TOKEN || "";
    const channels = channelsFromEnv();

    const missing = [
        !router() && "ALEA_ROUTER_ADDRESS",
        !provider() && "ALEA_PROVIDER_ADDRESS",
        !token && "DISCORD_BOT_TOKEN",
        channels.length === 0 && "DISCORD_STAT_CHANNELS",
    ].filter(Boolean);

    if (missing.length > 0) {
        console.log(`\nNot configured: ${missing.join(", ")}. See bot/README.md.\n`);
        process.exit(1);
    }

    log(`${network()}, router ${router()}`);
    log(
        `${channels.length} channel${channels.length === 1 ? "" : "s"}, every ${TICK_MS / 60_000}m`,
    );

    let stopping = false;
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.on(sig, () => {
            if (stopping) process.exit(1);
            stopping = true;
            log(`${sig}, stopping after this pass`);
        });
    }

    let backoff = BACKOFF_MIN_MS;

    while (!stopping) {
        try {
            const stats = await platformStats();

            if (stats.problems.length > 0) {
                // Every figure that failed is zero, and a zero written over a
                // real number reads as the platform having lost everything.
                // Leave the last good names up and try again.
                log(`incomplete, nothing written: ${stats.problems.join("; ")}`);
            } else {
                const results = await writeAll(token, channels, stats);
                for (const r of results) {
                    if (r.outcome !== "unchanged") log(`${r.outcome} ${r.id} ${r.detail}`);
                }
                if (results.every((r) => r.outcome === "unchanged")) log("no figure changed");
                backoff = BACKOFF_MIN_MS;
            }

            if (stopping) break;
            await sleep(TICK_MS);
        } catch (e) {
            log(`pass failed: ${e instanceof Error ? e.message : e}`);
            if (stopping) break;
            await sleep(backoff);
            backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
        }
    }

    log("stopped");
}

main().catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
});

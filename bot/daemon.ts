/**
 * The stats bot, as a process that stays up.
 *
 *   npm run bot:daemon
 *
 * It reads the chain and writes the figures into Discord channel names on a
 * clock. Nothing is received from Discord, so there is no socket to hold open.
 *
 * Ten minutes is a limit, not a preference: Discord allows about two renames
 * per ten minutes, per channel, and polling faster spends that allowance on
 * names that did not change.
 *
 * Runs anywhere with Node and an outbound connection. Nothing here imports from
 * the site.
 */
import dotenv from "dotenv";
import { platformStats } from "./stats";
import { channelsFromEnv, writeAll } from "./discord";
import { network, router, provider } from "./chain";
import { announce, generatorsChannel, mintsChannel, type Marks } from "./announce";
import { highWaterMark } from "./feed";

dotenv.config();

/** Discord's rename allowance is the floor, so this cannot be tuned below it. */
const MIN_TICK_MS = 10 * 60_000;
const TICK_MS = Math.max(MIN_TICK_MS, Number(process.env.ALEA_BOT_TICK_MS || MIN_TICK_MS));

/**
 * Announcements run on their own clock. The rename limit says nothing about
 * posting a message, and a mint announced nine minutes late is not an
 * announcement. The floor is there because the chain reads are not free.
 */
const MIN_ANNOUNCE_MS = 15_000;
const ANNOUNCE_MS = Math.max(MIN_ANNOUNCE_MS, Number(process.env.ALEA_BOT_ANNOUNCE_MS || 60_000));

const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

const log = (msg: string) => console.log(`${new Date().toISOString()}  ${msg}`);

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

    // Where the chain is now. Everything before this point is history.
    const announcing = Boolean(generatorsChannel() || mintsChannel());
    let marks: Marks = { generators: 0, mints: 0 };
    if (announcing) {
        marks = await highWaterMark();
        log(
            `announcing from generator ${marks.generators}, mint ${marks.mints}, every ${ANNOUNCE_MS / 1000}s`,
        );
    } else {
        log("no announce channels, stats only");
    }

    let stopping = false;
    let wake: (() => void) | null = null;

    for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.on(sig, () => {
            if (stopping) process.exit(1);
            stopping = true;
            log(`${sig}, stopping after this pass`);
            // Most of this process's life is spent in the wait between passes,
            // so a stop that did not wake it would sit for the full tick.
            wake?.();
        });
    }

    /** Interruptible, so a signal is acted on when it arrives. */
    const wait = (ms: number) =>
        new Promise<void>((resolve) => {
            const timer = setTimeout(finish, ms);
            function finish() {
                clearTimeout(timer);
                wake = null;
                resolve();
            }
            wake = finish;
        });

    let backoff = BACKOFF_MIN_MS;
    // Renames are on the slow clock and announcements on the fast one, so the
    // loop runs at the fast rate and the slow half checks whether it is due.
    let statsDue = 0;
    const loopMs = announcing ? ANNOUNCE_MS : TICK_MS;

    while (!stopping) {
        try {
            if (Date.now() >= statsDue) {
                const stats = await platformStats();

                if (stats.problems.length > 0) {
                    // A figure that failed is zero, and a zero written over a
                    // real number reads as the platform having lost everything.
                    log(`incomplete, nothing written: ${stats.problems.join("; ")}`);
                } else {
                    const results = await writeAll(token, channels, stats);
                    for (const r of results) {
                        if (r.outcome !== "unchanged") log(`${r.outcome} ${r.id} ${r.detail}`);
                    }
                    if (results.every((r) => r.outcome === "unchanged")) log("no figure changed");
                }
                // Due again in a full tick either way: retrying an incomplete
                // read on the announcement clock is ten times the traffic.
                statsDue = Date.now() + TICK_MS;
                backoff = BACKOFF_MIN_MS;
            }

            if (announcing && !stopping) {
                const pass = await announce(token, marks);
                marks = pass.marks;
                for (const r of pass.results) {
                    if (r.outcome !== "wrote") log(`${r.outcome} ${r.id} ${r.detail}`);
                }
                if (pass.posted > 0) log(`announced ${pass.posted}`);
            }

            if (stopping) break;
            await wait(loopMs);
        } catch (e) {
            log(`pass failed: ${e instanceof Error ? e.message : e}`);
            if (stopping) break;
            await wait(backoff);
            backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
        }
    }

    log("stopped");
}

main().catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
});

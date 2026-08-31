import type { Config } from "@netlify/functions";
import { platformStats, render } from "../../src/lib/stats";

/**
 * Aleatory's numbers, as Discord channel names.
 *
 * The pattern is a category of locked voice channels whose names carry a
 * figure, so the sidebar shows the platform's state without anyone running a
 * command. Renaming a channel is one REST call, so this needs no gateway
 * connection and no process: a cron, a read of the chain, and a PATCH.
 *
 * **Discord rate-limits a channel rename to roughly two per ten minutes, per
 * channel.** That is the ceiling every stats bot lives under and it is why
 * these do not update live. The schedule is ten minutes, and a name that has
 * not changed is not written, so on a quiet day the whole budget stays unspent
 * and a burst of mints is reflected on the next tick instead of hitting a
 * limit that would delay it further.
 *
 * Configured entirely in the environment, so the wording of a channel is
 * yours to change without a deploy:
 *
 *   DISCORD_BOT_TOKEN        a bot with Manage Channels on these channels
 *   DISCORD_STAT_CHANNELS    [{"id": "123", "label": "🎨 Generators: {generators}"}]
 *
 * Placeholders are the keys of `render()` below. An unknown one is left as
 * written, so a typo shows up in the channel name as itself.
 */

const DISCORD = "https://discord.com/api/v10";
const TOKEN = process.env.DISCORD_BOT_TOKEN || "";

interface StatChannel {
    id: string;
    label: string;
}

/** Malformed config names no channels, so nothing is renamed and the run says so. */
function channels(): StatChannel[] {
    try {
        const parsed: unknown = JSON.parse(process.env.DISCORD_STAT_CHANNELS || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (c): c is StatChannel =>
                !!c &&
                typeof c === "object" &&
                typeof (c as StatChannel).id === "string" &&
                typeof (c as StatChannel).label === "string",
        );
    } catch {
        return [];
    }
}

async function discord(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${DISCORD}${path}`, {
        ...init,
        headers: {
            authorization: `Bot ${TOKEN}`,
            "content-type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
}

/**
 * Write a name, and only when it differs.
 *
 * The read costs a request against a far more generous bucket than the write,
 * so checking first is what keeps the two-per-ten-minutes budget for the times
 * a number actually moved.
 */
async function rename(channel: StatChannel, name: string): Promise<string> {
    const current = await discord(`/channels/${channel.id}`);
    if (!current.ok) {
        return `${channel.id}: could not be read (${current.status})`;
    }
    const { name: existing } = (await current.json()) as { name?: string };
    if (existing === name) return `${channel.id}: unchanged`;

    const res = await discord(`/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
    });

    if (res.status === 429) {
        // Expected under a burst rather than exceptional. The next tick writes
        // it, and saying how long Discord asked for makes a recurring one
        // legible in the logs.
        const { retry_after } = (await res.json().catch(() => ({}))) as { retry_after?: number };
        return `${channel.id}: rate limited, retry after ${retry_after ?? "?"}s`;
    }
    if (!res.ok) return `${channel.id}: refused (${res.status})`;
    return `${channel.id}: "${existing}" → "${name}"`;
}

export default async function handler(req: Request): Promise<Response> {
    const configured = channels();

    if (!TOKEN) return json({ error: "DISCORD_BOT_TOKEN is not set" }, 500);
    if (configured.length === 0) {
        return json({ error: "DISCORD_STAT_CHANNELS names no channels" }, 500);
    }

    const stats = await platformStats();

    // A read that failed leaves that figure at zero, and writing a zero over a
    // real number is worse than leaving yesterday's on screen.
    if (stats.problems.length > 0) {
        return json({ skipped: "the chain read was incomplete", problems: stats.problems }, 503);
    }

    // One at a time. Discord's limits are per channel, and a burst of parallel
    // writes is how a bot gets its whole token limited rather than one channel.
    const results: string[] = [];
    for (const channel of configured) {
        results.push(await rename(channel, render(channel.label, stats)));
    }

    return json({ stats, results, dryRun: req.headers.get("x-nf-event") !== "schedule" });
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
        status,
        headers: { "content-type": "application/json" },
    });

export const config: Config = {
    schedule: "*/10 * * * *",
};

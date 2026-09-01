import { render, type PlatformStats } from "./stats";

/**
 * Writing figures into Discord channel names.
 *
 * The pattern is a category of locked voice channels whose names carry a
 * number, so the sidebar shows the platform's state with nobody running
 * anything. Renaming is one REST call, so none of this needs a gateway
 * connection: a bot token and `PATCH /channels/{id}` is the whole interface.
 *
 * **Discord limits a channel rename to roughly two per ten minutes, per
 * channel.** That ceiling is why stat channels everywhere update on a slow
 * tick, and it is the reason `rename` reads before it writes: a name that has
 * not changed costs nothing from that budget, so a quiet week leaves the whole
 * allowance for the hour something actually happens.
 */

const API = "https://discord.com/api/v10";

export interface StatChannel {
    id: string;
    label: string;
}

/** A rename that was attempted, and what came of it. */
export interface Result {
    id: string;
    /** `wrote` means the name changed. Everything else left it alone. */
    outcome: "wrote" | "unchanged" | "limited" | "failed";
    detail: string;
}

/**
 * Channels to write, from the environment.
 *
 * Config rather than code so the wording of a channel changes without a
 * deploy. Anything malformed names no channels, and the caller says so, so a
 * broken edit is visible instead of half-applied.
 */
export function channelsFromEnv(raw = process.env.DISCORD_STAT_CHANNELS): StatChannel[] {
    try {
        const parsed: unknown = JSON.parse(raw || "[]");
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

function api(token: string, path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API}${path}`, {
        ...init,
        headers: {
            authorization: `Bot ${token}`,
            "content-type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
}

/**
 * Discord's own words for a refusal.
 *
 * Every failure here arrives as a 403 or a 404, and guessing at which
 * permission is behind one sends whoever reads the log to the wrong screen.
 * The body carries a numeric code that says exactly which, so it is quoted
 * rather than interpreted.
 */
async function refusal(res: Response): Promise<string> {
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
    const said = body.message ? `${body.message} (${body.code ?? res.status})` : `HTTP ${res.status}`;

    const meaning: Record<number, string> = {
        // Not in the server at all, or cannot see this channel.
        50001: "the bot is not in that server, or has no View Channel here",
        // In the channel, but not allowed to change it.
        50013: "it can see the channel but cannot rename it, so Manage Channel is missing",
        10003: "no channel with that id",
    };
    const why = body.code ? meaning[body.code] : undefined;
    return why ? `${said}, ${why}` : said;
}

/** Write a name, and only when it differs from the one already there. */
export async function rename(
    token: string,
    channel: StatChannel,
    name: string,
): Promise<Result> {
    const current = await api(token, `/channels/${channel.id}`);
    if (!current.ok) {
        // A read needs View Channel and nothing more, so a refusal here is
        // never about Manage Channel however much it looks like it.
        return { id: channel.id, outcome: "failed", detail: `read: ${await refusal(current)}` };
    }

    const { name: existing = "" } = (await current.json()) as { name?: string };
    if (existing === name) {
        return { id: channel.id, outcome: "unchanged", detail: name };
    }

    const res = await api(token, `/channels/${channel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
    });

    if (res.status === 429) {
        // Expected under a burst. The next tick writes it, and reporting the
        // wait Discord asked for is what makes a recurring one legible.
        const { retry_after } = (await res.json().catch(() => ({}))) as {
            retry_after?: number;
        };
        return {
            id: channel.id,
            outcome: "limited",
            detail: `retry after ${retry_after ?? "?"}s`,
        };
    }
    if (!res.ok) {
        return { id: channel.id, outcome: "failed", detail: `rename: ${await refusal(res)}` };
    }
    return { id: channel.id, outcome: "wrote", detail: `"${existing}" → "${name}"` };
}

/** A Discord embed. Only the fields we set. */
export interface Embed {
    title?: string;
    description?: string;
    url?: string;
    color?: number;
    timestamp?: string;
    author?: { name: string; url?: string };
    image?: { url: string };
    fields?: { name: string; value: string; inline?: boolean }[];
    footer?: { text: string };
}

/**
 * Say something in a channel.
 *
 * Still no gateway. A gateway is for hearing, and this bot only ever speaks,
 * so posting is `POST /channels/{id}/messages` and nothing is held open.
 *
 * Needs Send Messages and Embed Links on the channel, which is more than the
 * rename job ever asked for: a token that has been renaming names happily for
 * weeks can still fail the first time it tries to say something.
 */
export async function post(
    token: string,
    channelId: string,
    embed: Embed,
): Promise<Result> {
    const res = await api(token, `/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({ embeds: [embed] }),
    });

    if (res.status === 429) {
        const { retry_after } = (await res.json().catch(() => ({}))) as {
            retry_after?: number;
        };
        return {
            id: channelId,
            outcome: "limited",
            detail: `retry after ${retry_after ?? "?"}s`,
        };
    }
    if (!res.ok) {
        return { id: channelId, outcome: "failed", detail: `post: ${await refusal(res)}` };
    }
    return { id: channelId, outcome: "wrote", detail: embed.title ?? "" };
}

/**
 * One pass over every configured channel.
 *
 * Sequential, because Discord's limits are per channel and a burst of parallel
 * writes is how one bot token gets limited across all of them at once.
 */
export async function writeAll(
    token: string,
    channels: StatChannel[],
    stats: PlatformStats,
): Promise<Result[]> {
    const results: Result[] = [];
    for (const channel of channels) {
        results.push(await rename(token, channel, render(channel.label, stats)));
    }
    return results;
}

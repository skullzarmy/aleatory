/**
 * Saying what happened, once each.
 *
 * A new generator goes to one channel and a new mint goes to another. One
 * message per event: these are their own channels, and a channel that is only
 * ever announcements is a channel somebody can mute.
 *
 * **Forward only.** The daemon reads where the chain is when it starts and
 * carries the mark in memory from there. A mint happens once and is announced
 * once, so there is nothing to remember across restarts and no file to keep
 * honest. What the process was not running for, it does not announce.
 *
 * Within a pass the mark moves only past events that were actually posted, so
 * a refused post is tried again on the next pass rather than skipped.
 */
import { post, type Embed, type Result } from "./discord";
import { newGenerators, newMints } from "./feed";

/** The mark's gold, so a message is recognisably ours in a feed. */
const GOLD = 0xd9b46a;

export interface Marks {
    generators: number;
    mints: number;
}

export const site = (): string =>
    (process.env.ALEA_SITE_URL || "https://aleatory.art").replace(/\/+$/, "");

export const generatorsChannel = () => process.env.DISCORD_GENERATORS_CHANNEL || "";
export const mintsChannel = () => process.env.DISCORD_MINTS_CHANNEL || "";

/** tz1abc…wxyz, because a full address in an embed field wraps. */
function short(a: string): string {
    return !a || a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * A pinned URI, as something Discord can fetch.
 *
 * Through the site's own image route, which is the path the site already uses
 * and is already cached at the edge. A URI with a path inside it is not
 * something that route takes, and an embed with no picture is better than one
 * with a broken link in it.
 */
function image(uri: string): string | undefined {
    if (!uri.startsWith("ipfs://")) return undefined;
    const cid = uri.slice("ipfs://".length);
    if (!cid || cid.includes("/")) return undefined;
    return `${site()}/api/img/${cid}`;
}

export function generatorEmbed(g: {
    address: string;
    name: string;
    description: string;
    coverUri: string;
    artist: string;
    at: string;
}): Embed {
    const embed: Embed = {
        title: g.name || short(g.address),
        url: `${site()}/collection/${g.address}`,
        color: GOLD,
        timestamp: g.at,
        footer: { text: "New generator" },
        fields: [{ name: "Artist", value: short(g.artist) || "unknown", inline: true }],
    };
    if (g.description) embed.description = g.description.slice(0, 400);
    const picture = image(g.coverUri);
    if (picture) embed.image = { url: picture };
    return embed;
}

export function mintEmbed(m: {
    contract: string;
    tokenId: string;
    name: string;
    description: string;
    imageUri: string;
    collector: string;
    at: string;
}): Embed {
    const embed: Embed = {
        title: m.name || `#${Number(m.tokenId) + 1}`,
        url: `${site()}/piece/${m.contract}/${m.tokenId}`,
        color: GOLD,
        timestamp: m.at,
        footer: { text: "Minted" },
        fields: [
            { name: "Collector", value: short(m.collector) || "unknown", inline: true },
            {
                name: "Collection",
                value: `[${short(m.contract)}](${site()}/collection/${m.contract})`,
                inline: true,
            },
        ],
    };
    // A piece is minted before it is rendered, so this is often empty on the
    // pass that announces it. The link still goes to a page where the piece is
    // already running from its code and its seed.
    const picture = image(m.imageUri);
    if (picture) embed.image = { url: picture };
    return embed;
}

export interface Pass {
    posted: number;
    results: Result[];
    marks: Marks;
}

/**
 * One announcement pass, from the marks in, to the marks out.
 *
 * Never throws. Each half is caught on its own, so a chain read that fails
 * while fetching mints cannot discard a generator mark that has already moved.
 * Handing that failure upward would mean the caller kept the marks it came in
 * with, and everything posted in this pass would be posted again in the next.
 */
export async function announce(token: string, marks: Marks): Promise<Pass> {
    const next: Marks = { ...marks };
    const results: Result[] = [];
    let posted = 0;

    const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

    const generators = generatorsChannel();
    if (generators) {
        try {
            for (const g of await newGenerators(next.generators)) {
                const result = await post(token, generators, generatorEmbed(g));
                results.push(result);
                if (result.outcome !== "wrote") break;
                next.generators = g.cursor;
                posted++;
            }
        } catch (e) {
            results.push({ id: generators, outcome: "failed", detail: said(e) });
        }
    }

    const mints = mintsChannel();
    if (mints) {
        try {
            for (const m of await newMints(next.mints)) {
                const result = await post(token, mints, mintEmbed(m));
                results.push(result);
                if (result.outcome !== "wrote") break;
                next.mints = m.cursor;
                posted++;
            }
        } catch (e) {
            results.push({ id: mints, outcome: "failed", detail: said(e) });
        }
    }

    return { posted, results, marks: next };
}

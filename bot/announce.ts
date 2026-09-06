/**
 * Saying what happened, once each. A new generator goes to one channel and a
 * new mint to another, one message per event.
 *
 * Forward only. The daemon reads where the chain is when it starts and carries
 * the mark in memory, so there is no file to keep honest and nothing is
 * announced for the time the process was not running.
 *
 * Within a pass the mark moves only past events that were posted, so a refused
 * post is tried again on the next pass.
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

/** Mutez, as tez, without trailing zeroes. */
function tez(mutez: number): string {
    const value = mutez / 1_000_000;
    return `${value.toFixed(6).replace(/\.?0+$/, "")} ꜩ`;
}

/**
 * A pinned URI, as something Discord can fetch: the site's own image route,
 * which is already cached at the edge. That route takes a bare CID, so a URI
 * with a path inside it gets no picture rather than a broken link.
 */
function image(uri: string): string | undefined {
    if (!uri.startsWith("ipfs://")) return undefined;
    const cid = uri.slice("ipfs://".length);
    if (!cid || cid.includes("/")) return undefined;
    return `${site()}/api/img/${cid}`;
}

/** Discord's ceiling on one field's value. */
const MAX_FIELD = 1024;

/** Who made it, as the line above the title, linked to their page here. */
function by(artist: string): Embed["author"] {
    if (!artist) return undefined;
    return { name: short(artist), url: `${site()}/wallet/${artist}` };
}

/** Zero is the contract's way of saying there is no ceiling. */
const edition = (size: number) => (size > 0 ? `${size}` : "open");

/** Everything here except the name and the cover came out of the event. */
export function generatorEmbed(g: {
    address: string;
    name: string;
    description: string;
    coverUri: string;
    artist: string;
    editionSize: number;
    at: string;
}): Embed {
    const embed: Embed = {
        title: g.name || short(g.address),
        url: `${site()}/collection/${g.address}`,
        color: GOLD,
        timestamp: g.at,
        author: by(g.artist),
        footer: { text: "New generator" },
        fields: [{ name: "Edition", value: edition(g.editionSize), inline: true }],
    };
    if (g.description) embed.description = g.description.slice(0, 400);
    const picture = image(g.coverUri);
    if (picture) embed.image = { url: picture };
    return embed;
}

/** The collector, the price and the traits are the event's own words. */
export function mintEmbed(m: {
    contract: string;
    tokenId: string;
    name: string;
    imageUri: string;
    collector: string;
    paidMutez: number | null;
    params: Record<string, unknown>;
    collectionName: string;
    artist: string;
    editionSize: number;
    at: string;
}): Embed {
    const embed: Embed = {
        title: m.name || `#${Number(m.tokenId) + 1}`,
        url: `${site()}/piece/${m.contract}/${m.tokenId}`,
        color: GOLD,
        timestamp: m.at,
        author: by(m.artist),
        footer: { text: "Minted" },
        fields: [
            {
                name: "Edition",
                value: `${Number(m.tokenId) + 1} of ${edition(m.editionSize)}`,
                inline: true,
            },
            { name: "Collector", value: short(m.collector) || "unknown", inline: true },
            {
                name: "Collection",
                value: `[${m.collectionName || short(m.contract)}](${site()}/collection/${m.contract})`,
                inline: true,
            },
        ],
    };

    // Absent when only the render was seen, for a piece minted just before this
    // process started. The collection's current price is not what was paid.
    if (m.paidMutez !== null) {
        embed.fields?.push({ name: "Paid", value: tez(m.paidMutez), inline: true });
    }

    const traits = Object.entries(m.params)
        .map(([key, value]) => `${key} ${String(value)}`)
        .join(" · ");
    if (traits) {
        embed.fields?.push({ name: "Traits", value: traits.slice(0, MAX_FIELD) });
    }
    // Often empty on the pass that announces a mint, since a piece is minted
    // before it is rendered. The link still reaches a page that draws it.
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
 * Wait for a picture to be servable before saying anything about it.
 *
 * Discord fetches an embed's image once, when the message is posted, and caches
 * what it got against that URL, so a miss is permanent and editing the message
 * does not fix it. Each attempt here also warms `/api/img`, which caches for a
 * year once it has the bytes.
 *
 * Bounded: a mint is worth announcing without a picture.
 */
const READY_TIMEOUT_MS = 60_000;
const READY_INTERVAL_MS = 5_000;

async function servable(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        return res.ok;
    } catch {
        return false;
    }
}

async function waitForImage(url: string | undefined): Promise<void> {
    if (!url) return;
    const until = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < until) {
        if (await servable(url)) return;
        await new Promise((r) => setTimeout(r, READY_INTERVAL_MS));
    }
}

/**
 * One announcement pass, from the marks in to the marks out. Never throws: each
 * half is caught on its own, so a failed read while fetching mints cannot
 * discard a generator mark that has already moved and cause everything posted
 * this pass to be posted again next pass.
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
                const embed = generatorEmbed(g);
                await waitForImage(embed.image?.url);
                const result = await post(token, generators, embed);
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
            const { items, consumed } = await newMints(next.mints);
            let complete = true;
            for (const m of items) {
                const embed = mintEmbed(m);
                await waitForImage(embed.image?.url);
                const result = await post(token, mints, embed);
                results.push(result);
                if (result.outcome !== "wrote") {
                    complete = false;
                    break;
                }
                next.mints = m.cursor;
                posted++;
            }
            // Most rows here are mints being held for their render, which post
            // nothing and carry no cursor out. Without this the mark sits still
            // and those rows are re-read every pass until they fill the page.
            if (complete) next.mints = Math.max(next.mints, consumed);
        } catch (e) {
            results.push({ id: mints, outcome: "failed", detail: said(e) });
        }
    }

    return { posted, results, marks: next };
}

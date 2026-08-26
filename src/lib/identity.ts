/**
 * What to call an address.
 *
 * A tz1 is not a name, and a page full of them tells a collector nothing about
 * who made or holds anything. Three sources, in this order:
 *
 *   1. The Tezos Domains reverse record. There is at most one, it is set
 *      deliberately by the holder, and it points at their wallet rather than
 *      being merely owned by it. That makes it the closest thing to a declared
 *      identity, so it wins.
 *   2. A hack.tez subdomain they own. There is no primary flag yet, so the
 *      first one is taken.
 *   3. Their TzKT profile alias.
 *
 * The first two come from hack.tez's resolver in one call, whose `primary`
 * field is already that order. Its answers are CDN-cached, which matters when
 * a feed asks about forty addresses at once.
 *
 * Resolution is against mainnet regardless of the network the site is pointed
 * at, because a key is the same key on every chain and someone's name should
 * not disappear when they are testing. The alias is the exception: that is a
 * per-instance TzKT profile, so it comes from the network in use.
 */
import { tzktApi, tzktLink } from "./config";

const RESOLVER = process.env.NEXT_PUBLIC_HACKTEZ_API || "https://hacktez.com";

/** Long enough that a feed costs one request per address, short enough that a
 *  name set this morning shows up today. */
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 4_000;

/**
 * Who told us. Shown on a profile, because a name and a face that arrive from
 * somewhere are worth attributing, and because it tells a person where to go
 * and change them.
 */
export type Source = "tezos-domains" | "hacktez" | "objkt" | "tzkt";

export const SOURCE_LABEL: Record<Source, { name: string; href: (a: string) => string }> = {
    "tezos-domains": {
        name: "Tezos Domains",
        href: () => "https://tezos.domains",
    },
    hacktez: { name: "hack.tez", href: () => RESOLVER },
    objkt: { name: "objkt", href: (a) => `https://objkt.com/profile/${a}` },
    tzkt: { name: "TzKT", href: (a) => tzktLink(a) },
};

interface Resolved {
    name: string | null;
    /** Which of them answered, for attribution. */
    nameSource: Source | null;
    /**
     * The hack.tez domain that is this wallet's identity.
     *
     * A wallet can own several, and the owner marks one on chain. Not the
     * first of the list: that ordering carries no meaning, and taking it
     * showed the operator of hack.tez as their own admin bot rather than as
     * themselves.
     */
    handle: string | null;
}

interface Cached extends Resolved {
    at: number;
}

const cache = new Map<string, Cached>();
/** In-flight requests, so a grid of forty pieces by one artist asks once. */
const inflight = new Map<string, Promise<Resolved>>();

/**
 * How many addresses may be in flight at once.
 *
 * A feed of forty cards by forty different artists is forty lookups, and
 * firing them together buries the requests that actually matter, the chain
 * reads, behind a queue of decoration. Names arrive progressively instead,
 * which costs nothing: every one of them is already showing an address.
 */
const MAX_CONCURRENT = 6;
let active = 0;
const queue: (() => void)[] = [];

async function gate<T>(run: () => Promise<T>): Promise<T> {
    if (active >= MAX_CONCURRENT) {
        await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
        return await run();
    } finally {
        active--;
        queue.shift()?.();
    }
}

async function timed(url: string): Promise<Response | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: abort.signal });
        return res.ok ? res : null;
    } catch {
        // A name is decoration. Nothing here is worth failing a page over.
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function lookup(address: string): Promise<Resolved> {
    const res = await timed(`${RESOLVER}/api/v1/resolve/${address}`);
    let handle: string | null = null;
    if (res) {
        const body = (await res.json().catch(() => null)) as {
            primary?: string | null;
            hackTezPrimary?: string | null;
            hackTez?: string[];
        } | null;
        // `hackTez[0]` only as a last resort, for a resolver deployed before
        // primaries existed.
        handle = body?.hackTezPrimary ?? body?.hackTez?.[0] ?? null;
        // `primary` is already the reverse record, falling back to the
        // designated hack.tez domain, so it needs no reassembling here.
        const name = body?.primary ?? handle;
        if (name) {
            // The reverse record and the hack.tez domain arrive in the same
            // response, and only their equality tells them apart.
            return {
                name,
                nameSource: name === handle ? "hacktez" : "tezos-domains",
                handle,
            };
        }
    }

    const account = await timed(`${tzktApi()}/v1/accounts/${address}`);
    if (account) {
        const body = (await account.json().catch(() => null)) as { alias?: string } | null;
        if (body?.alias) return { name: body.alias, nameSource: "tzkt", handle };
    }

    return { name: null, nameSource: null, handle };
}

/** The whole answer, cached and deduped. `resolveName` is the common case of it. */
async function resolve(address: string): Promise<Resolved> {
    if (!address) return { name: null, nameSource: null, handle: null };

    const hit = cache.get(address);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;

    const pending = inflight.get(address);
    if (pending) return pending;

    const run = gate(() => lookup(address))
        .then((r) => {
            cache.set(address, { ...r, at: Date.now() });
            return r;
        })
        .catch(() => ({ name: null, nameSource: null, handle: null }) as Resolved)
        .finally(() => inflight.delete(address));

    inflight.set(address, run);
    return run;
}

/**
 * The best name for an address, or null when it has none.
 *
 * Callers show the truncated address when this is null rather than being given
 * one, so that the decision of how to abbreviate stays with the surface doing
 * the rendering.
 */
export async function resolveName(address: string): Promise<string | null> {
    return (await resolve(address)).name;
}

/**
 * Where what is on screen came from.
 *
 * A profile's own source when there is one, and otherwise whoever supplied the
 * name. Free after `resolveName` or `fetchProfile`, both of which fill the same
 * cache.
 */
export async function sourceFor(address: string): Promise<Source | null> {
    const profile = await fetchProfile(address);
    if (profile) return profile.source;
    return (await resolve(address)).nameSource;
}


// ── Profiles ────────────────────────────────────────────────────────────────

/**
 * Who someone is, as far as an art site cares.
 *
 * Two sources, and the order is the point. hack.tez is primary: it is a profile
 * its owner edits directly, on chain, in records they hold, and it is where we
 * ask people to keep this. objkt is the fallback, because it aggregates
 * tzprofiles and its own profiles and therefore already knows almost every
 * Tezos artist who has ever filled a form in. An artist who has never heard of
 * us still arrives with a face.
 *
 * The directory carries more than this: projects, tip jars, registration
 * history. Those are hack.tez's own subject and belong on hack.tez.
 */
export interface Profile {
    /** Which source answered. Shown, because one of them is editable and the other is not. */
    source: "hacktez" | "objkt";
    /** The hack.tez subdomain, when that is where this came from. */
    handle?: string;
    /** Their own display name. Distinct from the resolved domain name. */
    name?: string;
    bio?: string;
    location?: string;
    /** hack.tez builder status: building, open-to-collab, available, hiring. */
    status?: string;
    skills?: string[];
    /** `ipfs://` or `https://`. Absent means fall back to the hackatar. */
    picture?: string;
    links: ProfileLink[];
}

export interface ProfileLink {
    kind: string;
    /** What to show. A handle where there is one, the host otherwise. */
    label: string;
    /** Absent for the ones that are not addressable, like a Discord tag. */
    href?: string;
}

/**
 * One social value to a link.
 *
 * The two sources disagree on shape: hack.tez stores bare handles, objkt stores
 * whole URLs, and both are right for their own purposes. Anything already
 * absolute is left alone, so this stays correct without knowing which source it
 * came from.
 */
function link(kind: string, value: unknown): ProfileLink | null {
    if (typeof value !== "string" || value.trim() === "") return null;
    const v = value.trim();

    if (/^https?:\/\//i.test(v)) {
        const label = v.replace(/^https?:\/\//i, "").replace(/\/$/, "");
        return { kind, label, href: v };
    }

    const handle = v.replace(/^@/, "");
    switch (kind) {
        case "website":
            return { kind, label: v, href: `https://${v}` };
        case "github":
            return { kind, label: handle, href: `https://github.com/${handle}` };
        case "twitter":
            return { kind, label: `@${handle}`, href: `https://x.com/${handle}` };
        case "bluesky":
            // A DID, not a handle. bsky resolves either at the same path.
            return { kind, label: v.startsWith("did:") ? "bluesky" : `@${handle}`, href: `https://bsky.app/profile/${v}` };
        case "mastodon": {
            // `@user@host`, which is a handle on a host we are not told twice.
            const parts = v.replace(/^@/, "").split("@");
            return parts.length === 2
                ? { kind, label: v, href: `https://${parts[1]}/@${parts[0]}` }
                : { kind, label: v };
        }
        case "farcaster":
            return { kind, label: `@${handle}`, href: `https://farcaster.xyz/${handle}` };
        case "telegram":
            return { kind, label: `@${handle}`, href: `https://t.me/${handle}` };
        case "instagram":
            return { kind, label: `@${handle}`, href: `https://instagram.com/${handle}` };
        case "youtube":
            return { kind, label: handle, href: `https://youtube.com/@${handle}` };
        case "twitch":
            return { kind, label: handle, href: `https://twitch.tv/${handle}` };
        default:
            // Discord tags and anything unrecognised: worth showing, not linking.
            return { kind, label: v };
    }
}

const SOCIALS = [
    "website",
    "twitter",
    "bluesky",
    "github",
    "mastodon",
    "farcaster",
    "instagram",
    "youtube",
    "twitch",
    "telegram",
    "discord",
];

function linksFrom(raw: Record<string, unknown>): ProfileLink[] {
    return SOCIALS.map((k) => link(k, raw[k])).filter((l): l is ProfileLink => l !== null);
}

const profiles = new Map<string, { profile: Profile | null; at: number }>();

async function fromHackTez(address: string): Promise<Profile | null> {
    // No subdomain, no profile. A reverse record is a name and nothing else.
    const { handle } = await resolve(address);
    if (!handle) return null;

    const res = await timed(`${RESOLVER}/api/v1/profile/${handle}`);
    const body = res
        ? ((await res.json().catch(() => null)) as {
              data?: { profile?: Record<string, unknown> };
          } | null)
        : null;

    const raw = body?.data?.profile;
    // An empty object means the domain is registered and never filled in,
    // which is a different thing from having no domain, and should fall
    // through to objkt rather than showing a blank profile.
    if (!raw || Object.keys(raw).length === 0) return null;

    return {
        source: "hacktez",
        handle,
        name: typeof raw.name === "string" ? raw.name : undefined,
        bio: typeof raw.bio === "string" ? raw.bio : undefined,
        location: typeof raw.location === "string" ? raw.location : undefined,
        status: typeof raw.status === "string" ? raw.status : undefined,
        skills: Array.isArray(raw.skills) ? (raw.skills as string[]) : undefined,
        picture: typeof raw.picture === "string" ? raw.picture : undefined,
        links: linksFrom(raw),
    };
}

const OBJKT_GRAPHQL = "https://data.objkt.com/v3/graphql";

/**
 * objkt's holder record.
 *
 * It aggregates tzprofiles and objkt's own profiles into one row, which is why
 * it is the fallback: an artist who never touched hack.tez has usually still
 * filled this in somewhere, years ago, and forgotten.
 */
async function fromObjkt(address: string): Promise<Profile | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(OBJKT_GRAPHQL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: abort.signal,
            body: JSON.stringify({
                query: `query Holder($a: String!) {
                    holder(where: { address: { _eq: $a } }) {
                        alias description logo website twitter github
                        telegram instagram discord facebook farcaster
                    }
                }`,
                variables: { a: address },
            }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            data?: { holder?: Record<string, unknown>[] };
        };
        const raw = body.data?.holder?.[0];
        if (!raw) return null;

        const profile: Profile = {
            source: "objkt",
            name: typeof raw.alias === "string" ? raw.alias : undefined,
            bio: typeof raw.description === "string" ? raw.description : undefined,
            picture: typeof raw.logo === "string" ? raw.logo : undefined,
            links: linksFrom(raw),
        };
        // A row with nothing in it is not a profile.
        return profile.name || profile.bio || profile.picture || profile.links.length > 0
            ? profile
            : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The profile behind an address, from whichever source has one.
 *
 * Only pages about one person should call this. A feed wants `resolveName` and
 * nothing more.
 */
export async function fetchProfile(address: string): Promise<Profile | null> {
    if (!address) return null;

    const hit = profiles.get(address);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.profile;

    const profile =
        (await fromHackTez(address).catch(() => null)) ??
        (await fromObjkt(address).catch(() => null));

    profiles.set(address, { profile, at: Date.now() });
    return profile;
}

/**
 * A picture for an address.
 *
 * Theirs if they set one. Otherwise the hackatar, when they have a hack.tez
 * name: a generative avatar derived from the domain, stable and free, and a
 * better answer than an empty circle on a site about generative art.
 */
export function avatarUrl(profile: Profile | null): string | null {
    if (!profile) return null;
    if (profile.picture) return profile.picture;
    if (!profile.handle) return null;
    return `${RESOLVER}/api/v1/hackatar/${profile.handle.split(".")[0]}?static=1`;
}

/** Where someone goes to fill in the profile this page would rather be showing. */
export const PROFILE_HOME = "https://hacktez.com";

/** TzKT client. Everything the site shows comes through here. */
import { tzktApi } from "./config";
import { bytesToString } from "@/utils/ipfs";
import { cleanTags } from "@provider/metadata";

export interface TzktContract {
    address: string;
    alias?: string;
    creator?: { address: string };
    firstActivityTime?: string;
    lastActivityTime?: string;
    tokensCount?: number;
}

export interface TzktToken {
    id: number;
    contract: { address: string; alias?: string };
    tokenId: string;
    firstMinter?: { address: string };
    firstTime?: string;
    lastTime?: string;
    totalSupply?: string;
    metadata?: TokenMetadata;
}

/** TZIP-21 shaped, as TzKT resolves it from the token's metadata document. */
export interface TokenMetadata {
    name?: string;
    description?: string;
    artifactUri?: string;
    displayUri?: string;
    thumbnailUri?: string;
    creators?: string[];
    attributes?: { name: string; value: string }[];
    royalties?: { decimals: number; shares: Record<string, number> };
    /** Aleatory's own keys, per docs/params.md §4. */
    aleaParams?: string;
    aleaCodeHash?: string;
    /** The provider contract whose agent published this piece. */
    aleaProvider?: string;
}

/** Tezos address shape. Route params reach path building, so they are checked. */
const ADDRESS = /^(tz[123]|KT1)[A-Za-z0-9]{33}$/;

export function isAddress(a: string): boolean {
    return ADDRESS.test(a);
}

function requireAddress(a: string): string {
    if (!ADDRESS.test(a)) throw new Error("not an address");
    return a;
}

/**
 * Sized for a serverless invocation: two attempts at three seconds, plus the
 * pause between them, is about six. A healthy answer arrives well under a
 * second. Without a deadline a slow indexer holds the socket until the platform
 * gives up on the whole render, which is a 500 instead of a missing number.
 *
 * This bounds one read. Several in sequence can still outlast an invocation, so
 * the reads that matter sit behind `Promise.all` or a `catch` that degrades to
 * empty.
 */
const INDEXER_TIMEOUT_MS = 6_000;
const INDEXER_ATTEMPTS = 5;

/** Answers worth asking again about. Anything else is the indexer's real answer. */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * One read from the indexer, with a deadline and retries. A 404 is an
 * answer and comes straight back.
 *
 * The pause is jittered, because the failures worth retrying are the ones every
 * page hits at once, and a fixed pause turns one outage into a second one made
 * of our own reconnecting pages.
 */
export async function indexerFetch(url: string, init: RequestInit = {}): Promise<Response> {
    let last: unknown;

    for (let attempt = 1; attempt <= INDEXER_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            const base = 200 * 2 ** (attempt - 2);
            await new Promise((r) => setTimeout(r, base + Math.random() * base));
        }
        try {
            const res = await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(INDEXER_TIMEOUT_MS),
            });
            if (!TRANSIENT.has(res.status)) return res;
            last = new Error(`TzKT ${res.status}`);
        } catch (e) {
            last = e;
        }
    }

    throw last instanceof Error ? last : new Error("TzKT did not answer");
}

/**
 * In-memory fallback cache for indexer responses.
 *
 * When an indexer query fails or times out after all retries, the last successful
 * response is served rather than failing the whole page render.
 */
const queryCache = new Map<string, { data: unknown; timestamp: number }>();
const MAX_CACHE_ENTRIES = 500;

/**
 * Every read here asks about chain state. Queries fetch live from the indexer,
 * updating the in-memory cache on success, and fall back to the last clean answer
 * if the indexer is temporarily unreachable.
 */
async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${tzktApi()}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const cacheKey = url.toString();

    try {
        const res = await indexerFetch(cacheKey, { cache: "no-store" });
        if (!res.ok) {
            throw new Error(`TzKT ${res.status} on ${path}`);
        }
        // TzKT's answer for a single entity that does not exist is 204 and no body.
        if (res.status === 204) return null as T;
        const data = (await res.json()) as T;
        if (queryCache.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = queryCache.keys().next().value;
            if (oldestKey) queryCache.delete(oldestKey);
        }
        queryCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    } catch (err) {
        const cached = queryCache.get(cacheKey);
        if (cached) {
            return cached.data as T;
        }
        throw err;
    }
}

/**
 * Every generator a factory has originated. TzKT attributes an internal
 * origination to the contract that made it, so one query returns the set.
 */
export async function fetchGenerators(factory: string): Promise<TzktContract[]> {
    if (!factory) return [];
    return get<TzktContract[]>("/v1/contracts", {
        creator: factory,
        "sort.desc": "firstActivityTime",
        limit: 200,
        select: "address,alias,firstActivityTime,lastActivityTime,tokensCount",
    });
}

/** A known set of generators, by address, batched to stay under TzKT's row limit. */
const CONTRACTS_IN_BATCH = 100;
export async function fetchContractsByAddress(addresses: string[]): Promise<TzktContract[]> {
    if (addresses.length === 0) return [];
    const batches: string[][] = [];
    for (let i = 0; i < addresses.length; i += CONTRACTS_IN_BATCH) {
        batches.push(addresses.slice(i, i + CONTRACTS_IN_BATCH));
    }
    const pages = await Promise.all(
        batches.map((batch) =>
            get<TzktContract[]>("/v1/contracts", {
                "address.in": batch.join(","),
                limit: CONTRACTS_IN_BATCH,
                select: "address,alias,firstActivityTime,lastActivityTime,tokensCount",
            }).catch(() => []),
        ),
    );
    return pages.flat();
}

/**
 * How large each generator's edition is. Zero is an open edition.
 *
 * Off the events, because storage carries the source: `includeStorage=true`
 * over thirteen generators is 266kB against 2kB, and it grows with the size of
 * the artists' code. A bare `select=payload` pulls the source back the same
 * way, so the payload fields are named.
 *
 * `deploy` states the size published with, `set_edition_size` states every
 * reduction after it, and the size only goes down, so the last word wins.
 */
export async function fetchEditionSizes(
    factories: string[],
    generators: string[],
): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    if (factories.length === 0) return sizes;

    const [deployed, reduced] = await Promise.all([
        get<{ "payload.address"?: string; "payload.edition_size"?: string }[]>(
            "/v1/contracts/events",
            {
                "contract.in": factories.join(","),
                tag: "deploy",
                "sort.asc": "id",
                limit: 1000,
                select: "payload.address,payload.edition_size",
            },
        ).catch(() => []),
        generators.length === 0
            ? Promise.resolve([])
            : get<{ contract?: { address?: string }; "payload.edition_size"?: string }[]>(
                  "/v1/contracts/events",
                  {
                      "contract.in": generators.join(","),
                      tag: "set_edition_size",
                      "sort.asc": "id",
                      limit: 1000,
                      select: "contract,payload.edition_size",
                  },
              ).catch(() => []),
    ]);

    for (const row of deployed) {
        const address = row["payload.address"];
        if (address) sizes.set(address, Number(row["payload.edition_size"] ?? 0));
    }
    // Ascending, so a later reduction overwrites an earlier one.
    for (const row of reduced) {
        const address = row.contract?.address;
        if (address) sizes.set(address, Number(row["payload.edition_size"] ?? 0));
    }
    return sizes;
}

/**
 * Whether each generator is paused, right now.
 *
 * Not an events read like `fetchEditionSizes` above: `deploy`'s payload never
 * carried `start_paused`, so there is no event bulk-listing the initial state,
 * and a generator that has never been toggled has no `set_paused` event to
 * read either. Confirmed live: `/v1/contracts?select=storage.sale.paused`
 * answers every row with `null` instead of erroring. TzKT cannot project a
 * nested storage path in bulk, the same limitation already noted above for
 * `creator`-side filtering. One narrow request per generator instead, same
 * shape as `fetchProviderGas`, bounded concurrency and short-lived caching so
 * a large collection does not fan out unbounded on every page render.
 */
const PAUSED_CONCURRENCY = 8;
export async function fetchPausedStates(generators: string[]): Promise<Map<string, boolean>> {
    const paused = new Map<string, boolean>();
    const queue = [...generators];
    async function worker() {
        for (;;) {
            const address = queue.shift();
            if (address === undefined) return;
            const p = await fetch(`${tzktApi()}/v1/contracts/${address}/storage?path=sale.paused`, {
                next: { revalidate: 30 },
            })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
            if (typeof p === "boolean") paused.set(address, p);
        }
    }
    await Promise.all(Array.from({ length: Math.min(PAUSED_CONCURRENCY, queue.length) }, worker));
    return paused;
}

/**
 * Whether each generator has finished walking its code on chain. Same shape
 * as `fetchPausedStates`, same reason: `art.code_sealed` is a nested storage
 * path TzKT cannot project in bulk.
 */
export async function fetchSealedStates(generators: string[]): Promise<Map<string, boolean>> {
    const sealed = new Map<string, boolean>();
    const queue = [...generators];
    async function worker() {
        for (;;) {
            const address = queue.shift();
            if (address === undefined) return;
            const s = await fetch(
                `${tzktApi()}/v1/contracts/${address}/storage?path=art.code_sealed`,
                { next: { revalidate: 30 } },
            )
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
            if (typeof s === "boolean") sealed.set(address, s);
        }
    }
    await Promise.all(Array.from({ length: Math.min(PAUSED_CONCURRENCY, queue.length) }, worker));
    return sealed;
}

/**
 * Who administers each generator. Same shape as `fetchPausedStates` and the
 * same reason: `administrator` is a top-level storage field, but TzKT cannot
 * project it in bulk, so this is one narrow request per generator. Cached
 * longer than paused — transferring admin is rare, toggling sales isn't.
 */
const ARTIST_CONCURRENCY = 8;
export async function fetchArtists(generators: string[]): Promise<Map<string, string>> {
    const artists = new Map<string, string>();
    const queue = [...generators];
    async function worker() {
        for (;;) {
            const address = queue.shift();
            if (address === undefined) return;
            const a = await fetch(
                `${tzktApi()}/v1/contracts/${address}/storage?path=administrator`,
                {
                    next: { revalidate: 300 },
                },
            )
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
            if (typeof a === "string") artists.set(address, a);
        }
    }
    await Promise.all(Array.from({ length: Math.min(ARTIST_CONCURRENCY, queue.length) }, worker));
    return artists;
}

/**
 * Every generator one artist deployed. TzKT ignores an unrecognized filter
 * rather than erroring, so a wrong param here reads as success on an
 * unfiltered page. `select` on one field flattens to that field's bare value.
 */
const DEPLOYED_PAGE = 200;
const DEPLOYED_CEILING = 2_000;
export async function fetchGeneratorsDeployedBy(
    artist: string,
    factory: string,
): Promise<string[]> {
    if (!factory || !isAddress(artist)) return [];
    const out: string[] = [];
    for (let offset = 0; offset < DEPLOYED_CEILING; offset += DEPLOYED_PAGE) {
        const rows = await get<{ address?: string }[]>("/v1/operations/originations", {
            initiator: requireAddress(artist),
            sender: requireAddress(factory),
            status: "applied",
            "sort.desc": "id",
            limit: DEPLOYED_PAGE,
            offset,
            select: "originatedContract",
        });
        out.push(...rows.map((r) => r?.address).filter((a): a is string => Boolean(a)));
        if (rows.length < DEPLOYED_PAGE) break;
    }
    return out;
}

/** Tokens across a set of generators, newest first. */
export async function fetchRecentTokens(
    generators: string[],
    limit = 48,
    offset = 0,
): Promise<TzktToken[]> {
    if (generators.length === 0) return [];
    return get<TzktToken[]>("/v1/tokens", {
        "contract.in": generators.join(","),
        "sort.desc": "firstTime",
        limit,
        offset,
    });
}

/**
 * Specific tokens, across generators, in one query.
 *
 * `contract.in` and `tokenId.in` filter independently rather than as a set of
 * pairs, so this returns the cross product and the caller keeps only what it
 * asked for. For a page of listings that is one request instead of forty.
 */
export async function fetchTokensIn(
    generators: string[],
    tokenIds: string[],
): Promise<TzktToken[]> {
    if (generators.length === 0 || tokenIds.length === 0) return [];
    return get<TzktToken[]>("/v1/tokens", {
        "contract.in": generators.join(","),
        "tokenId.in": tokenIds.join(","),
        limit: Math.min(generators.length * tokenIds.length, 1000),
    });
}

/**
 * What one account holds, across a set of generators.
 *
 * Balance zero rows are excluded, so a piece someone sold stops appearing the
 * moment the transfer settles rather than lingering as something they own.
 */
export async function fetchTokensHeldBy(
    account: string,
    generators: string[],
    limit = 48,
    offset = 0,
): Promise<TzktToken[]> {
    if (generators.length === 0 || !isAddress(account)) return [];
    const rows = await get<{ token: TzktToken }[]>("/v1/tokens/balances", {
        account: requireAddress(account),
        "token.contract.in": generators.join(","),
        "balance.gt": 0,
        "sort.desc": "lastLevel",
        limit,
        offset,
    });
    return rows.map((r) => r.token).filter(Boolean);
}

/** How many tokens an account holds, same filter as `fetchTokensHeldBy`, without the page cap. */
export async function fetchHeldCount(account: string, generators: string[]): Promise<number> {
    if (generators.length === 0 || !isAddress(account)) return 0;
    return get<number>("/v1/tokens/balances/count", {
        account: requireAddress(account),
        "token.contract.in": generators.join(","),
        "balance.gt": 0,
    });
}

/**
 * Which of a specific set of tokens an account holds, as `generator:tokenId`
 * keys.
 *
 * `fetchTokensHeldBy` filters by generator alone and caps at a page, so a
 * piece somebody offered on can sit outside the window and read as not held.
 * Both sides are filtered here, independently and not as pairs, so the caller's
 * set decides.
 */
export async function fetchHeldAmong(
    account: string,
    pairs: { generator: string; tokenId: string }[],
): Promise<Set<string>> {
    if (pairs.length === 0 || !isAddress(account)) return new Set();

    const wanted = new Set(pairs.map((p) => `${p.generator}:${p.tokenId}`));
    const generators = [...new Set(pairs.map((p) => p.generator))];
    const tokenIds = [...new Set(pairs.map((p) => p.tokenId))];

    const rows = await get<{ token: TzktToken }[]>("/v1/tokens/balances", {
        account: requireAddress(account),
        "token.contract.in": generators.join(","),
        "token.tokenId.in": tokenIds.join(","),
        "balance.gt": 0,
        limit: Math.min(generators.length * tokenIds.length, 1000),
    });

    const held = new Set<string>();
    for (const r of rows) {
        const key = `${r.token?.contract?.address}:${r.token?.tokenId}`;
        if (wanted.has(key)) held.add(key);
    }
    return held;
}

export async function fetchToken(contract: string, tokenId: string): Promise<TzktToken | null> {
    const rows = await get<TzktToken[]>("/v1/tokens", {
        contract: requireAddress(contract),
        tokenId,
        limit: 1,
    });
    return rows[0] ?? null;
}

/**
 * Raw contract storage, for the fields TzKT does not model. Null when there is
 * no such contract; throws when the indexer could not be read.
 */
export async function fetchStorage<T = unknown>(address: string): Promise<T | null> {
    return get<T | null>(`/v1/contracts/${requireAddress(address)}/storage`);
}

/** Who holds a token now. */
export async function fetchOwner(contract: string, tokenId: string): Promise<string | null> {
    const rows = await get<{ account: { address: string } }[]>("/v1/tokens/balances", {
        "token.contract": contract,
        "token.tokenId": tokenId,
        "balance.gt": 0,
        limit: 1,
    });
    return rows[0]?.account?.address ?? null;
}

/** The operation that created a token. Its hash is the piece's seed. */
export async function fetchMintOperation(
    contract: string,
    tokenId: string,
): Promise<{ hash: string; level: number; timestamp: string; params: string } | null> {
    const rows = await get<{ hash: string; level: number; timestamp: string }[]>(
        "/v1/tokens/transfers",
        {
            "token.contract": contract,
            "token.tokenId": tokenId,
            "from.null": "true",
            limit: 1,
            select: "transactionId,level,timestamp",
        },
    );
    const row = rows[0];
    if (!row) return null;
    // The parameter comes back with the hash, and it holds the collector's
    // chosen values. The piece's metadata holds them too, minutes later, once a
    // provider has rendered and published.
    const ops = await get<{ hash: string; parameter?: { value?: string } }[]>(
        "/v1/operations/transactions",
        {
            id: (row as unknown as { transactionId: number }).transactionId,
            limit: 1,
            select: "hash,parameter",
        },
    );
    const op = ops[0];
    if (!op) return null;

    return {
        hash: op.hash,
        level: row.level,
        timestamp: row.timestamp,
        // Hex bytes on chain. Empty when the generator declares no parameters.
        params: bytesToString(op.parameter?.value ?? ""),
    };
}

/**
 * A generator's own name and description, from the `content` key of its
 * metadata big_map.
 *
 * TzKT resolves TZIP-16 documents into a `metadata` field on its own schedule,
 * it is null on this network today, and it cannot be asked for in a `select`,
 * so waiting for it leaves every generator showing as a KT1 address. The
 * big_map is the same request count and never lags.
 */
export interface GeneratorMeta {
    name?: string;
    description?: string;
    /** The cover the artist picked at deploy. What to show before any piece renders. */
    displayUri?: string;
    thumbnailUri?: string;
    /** Standard TZIP-21 tags, as declared in `content`. */
    tags?: string[];
}

export async function fetchGeneratorMeta(address: string): Promise<GeneratorMeta> {
    const doc = await fetchRawContent(address);
    if (!doc) return {};
    return {
        name: doc.name as string | undefined,
        description: doc.description as string | undefined,
        displayUri: doc.displayUri as string | undefined,
        thumbnailUri: doc.thumbnailUri as string | undefined,
        tags: cleanTags(doc.tags as string[] | undefined),
    };
}

/**
 * The `content` document exactly as stored, for anything that needs to read
 * a field this app has no typed model for and write the whole thing back
 * with only that field changed.
 */
export async function fetchRawContent(address: string): Promise<Record<string, unknown> | null> {
    const row = await fetch(`${tzktApi()}/v1/contracts/${address}/bigmaps/metadata/keys/content`, {
        next: { revalidate: 300 },
    })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    const raw = (row as { value?: string } | null)?.value;
    if (!raw) return null;
    try {
        return JSON.parse(bytesToString(raw)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Whether a contract has a given entrypoint, from TzKT's own indexed schema
 * rather than an RPC round-trip. A factory redeploy leaves older generators
 * on a template that may not have one a newer template added.
 */
export async function hasEntrypoint(address: string, name: string): Promise<boolean> {
    const rows = await fetch(`${tzktApi()}/v1/contracts/${address}/entrypoints`, {
        next: { revalidate: 3600 },
    })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    return Array.isArray(rows) && rows.some((e: { name?: string }) => e?.name === name);
}

/**
 * Which token an operation minted. A collector signs and gets a hash back; the
 * contract decides the token id.
 *
 * This TzKT instance ignores `?hash=` on transactions and answers with an
 * unfiltered page of whatever is recent, which reads as success and hands back
 * somebody else's operation. So the query is by recipient and the hash is
 * checked afterwards. No match means the operation is not indexed yet, which is
 * normal for the first second or two.
 */
export async function fetchMintedTokenId(
    contract: string,
    buyer: string,
    hash: string,
): Promise<string | null> {
    if (!isAddress(contract) || !isAddress(buyer)) return null;
    const rows = await get<{ "token.tokenId": string; transactionId: number }[]>(
        "/v1/tokens/transfers",
        {
            "token.contract": requireAddress(contract),
            to: requireAddress(buyer),
            "from.null": "true",
            "sort.desc": "id",
            // A few, not one: two mints in the same block by the same buyer
            // would otherwise resolve to whichever the indexer ordered last.
            limit: 8,
            select: "token.tokenId,transactionId",
        },
    );
    if (rows.length === 0) return null;

    const ops = await get<{ id: number; hash: string }[]>("/v1/operations/transactions", {
        "id.in": rows.map((r) => r.transactionId).join(","),
        limit: rows.length,
        select: "id,hash",
    });
    const hashById = new Map(ops.map((o) => [o.id, o.hash]));
    const match = rows.find((r) => hashById.get(r.transactionId) === hash);
    return match ? match["token.tokenId"] : null;
}

/**
 * A token's metadata document, from `token_info[""]` in the generator's own
 * big_map. One call covers a whole generator.
 *
 * TzKT resolves `ipfs://` metadata into its `metadata` field on its own
 * schedule, and on some networks not at all, so waiting for it shows a piece
 * that is finished on chain as unrendered.
 */
export async function fetchTokenUris(generator: string): Promise<Map<string, string>> {
    const rows = await get<{ key: string; value: { token_info: Record<string, string> } }[]>(
        `/v1/contracts/${requireAddress(generator)}/bigmaps/token_metadata/keys`,
        { active: "true", limit: 400 },
    ).catch(() => []);

    const out = new Map<string, string>();
    for (const r of rows) {
        const hex = r.value?.token_info?.[""];
        if (!hex) continue;
        const uri = hexToUtf8(hex);
        if (uri) out.set(String(r.key), uri);
    }
    return out;
}

function hexToUtf8(hex: string): string {
    const clean = hex.replace(/^0x/, "");
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return "";
    const bytes = clean.match(/.{2}/g) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

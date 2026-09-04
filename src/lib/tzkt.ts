/**
 * TzKT client.
 *
 * Everything the site shows comes through here, from public chain data, so
 * anyone can rebuild the same views against the same API. See
 * docs/decisions.md §8.
 */
import { tzktApi } from "./config";
import { bytesToString } from "@/utils/ipfs";

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
 * How long one attempt at the indexer gets, and how many attempts it gets.
 *
 * Every gateway read on this site already carries a deadline, because a public
 * IPFS gateway is obviously somebody else's machine. The indexer is somebody
 * else's machine too, and a read of it had no deadline at all: a slow response
 * held the socket until the platform gave up on the whole render, which is a
 * page that 500s rather than a page that is briefly missing a number.
 *
 * The budget is sized for the runtime and not for the build. A serverless
 * invocation is measured in seconds, so two attempts at three seconds plus the
 * pause between them comes to about six, and a build that needs longer gets its
 * own retries from the framework. A healthy answer here arrives in well under a
 * second, so three is already generous.
 *
 * This bounds one read. A page that makes several in sequence can still spend
 * more than an invocation has while the indexer is down, and the thing standing
 * between that and a broken page is the caller: the reads that matter are
 * behind `Promise.all` or a `catch` that degrades to empty.
 */
const INDEXER_TIMEOUT_MS = 3_000;
const INDEXER_ATTEMPTS = 2;

/** Answers worth asking again about. Anything else is the indexer's real answer. */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * One read from the indexer, with a deadline and a second try.
 *
 * Retried on a timeout, a dropped connection, and the handful of statuses that
 * mean "not now" rather than "no". A 404 is an answer and comes straight back.
 *
 * The pause before the retry is jittered, because the failures worth retrying
 * are the ones everything hits at once, and a fixed pause turns one outage into
 * a second one made of our own reconnecting pages.
 */
export async function indexerFetch(url: string, init: RequestInit = {}): Promise<Response> {
    let last: unknown;

    for (let attempt = 1; attempt <= INDEXER_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            const base = 150 * 2 ** (attempt - 2);
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

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${tzktApi()}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await indexerFetch(url.toString(), { next: { revalidate: 30 } } as RequestInit);
    if (!res.ok) {
        throw new Error(`TzKT ${res.status} on ${path}`);
    }
    return (await res.json()) as T;
}

/**
 * Every collection a factory has originated.
 *
 * TzKT attributes an internal origination to the contract that made it, so
 * this one query returns the whole set. docs/decisions.md §8.
 */
export async function fetchCollections(factory: string): Promise<TzktContract[]> {
    if (!factory) return [];
    return get<TzktContract[]>("/v1/contracts", {
        creator: factory,
        "sort.desc": "firstActivityTime",
        limit: 200,
        select: "address,alias,firstActivityTime,lastActivityTime,tokensCount",
    });
}

/**
 * How large each collection's edition is. Zero is an open edition.
 *
 * Off the events, in two small reads, because the alternative is storage and
 * storage carries the generator: `includeStorage=true` over thirteen
 * collections is 266kB against 2kB, and it grows with how big the artists'
 * code is rather than with how many of them there are.
 *
 * `deploy` states the size the collection was published with, and
 * `set_edition_size` states every reduction after it. The size can only ever
 * go down, so the last word wins.
 *
 * Only the payload fields that are wanted. A bare `select=payload` pulls the
 * whole generator back with it, which is the same 250kB by another route.
 */
export async function fetchEditionSizes(
    factories: string[],
    collections: string[],
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
        collections.length === 0
            ? Promise.resolve([])
            : get<{ contract?: { address?: string }; "payload.edition_size"?: string }[]>(
                  "/v1/contracts/events",
                  {
                      "contract.in": collections.join(","),
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
 * Every collection one artist deployed.
 *
 * A collection is originated by the factory, so its `creator` is the factory
 * and not the artist. What identifies the artist is `initiator`: the account
 * whose operation caused the internal origination. Filtering on storage would
 * be the obvious approach and TzKT does not support it, it ignores unknown
 * query parameters and answers with an unfiltered page, which reads as success.
 *
 * A single-field `select` is flattened: TzKT answers with the field's own value
 * per row, not with a row containing that field. Reading `row.originatedContract`
 * therefore found `undefined` on every row and the filter below dropped the lot,
 * so every artist's page said they had published nothing.
 */
export async function fetchCollectionsDeployedBy(
    artist: string,
    factory: string,
): Promise<string[]> {
    if (!factory || !isAddress(artist)) return [];
    const rows = await get<{ address?: string }[]>("/v1/operations/originations", {
        initiator: requireAddress(artist),
        sender: requireAddress(factory),
        status: "applied",
        "sort.desc": "id",
        limit: 200,
        select: "originatedContract",
    });
    return rows.map((r) => r?.address).filter((a): a is string => Boolean(a));
}

/** Tokens across a set of collections, newest first. */
export async function fetchRecentTokens(
    collections: string[],
    limit = 48,
    offset = 0,
): Promise<TzktToken[]> {
    if (collections.length === 0) return [];
    return get<TzktToken[]>("/v1/tokens", {
        "contract.in": collections.join(","),
        "sort.desc": "firstTime",
        limit,
        offset,
    });
}

/**
 * Specific tokens, across collections, in one query.
 *
 * `contract.in` and `tokenId.in` filter independently rather than as a set of
 * pairs, so this returns the cross product and the caller keeps only what it
 * asked for. For a page of listings that is one request instead of forty.
 */
export async function fetchTokensIn(
    collections: string[],
    tokenIds: string[],
): Promise<TzktToken[]> {
    if (collections.length === 0 || tokenIds.length === 0) return [];
    return get<TzktToken[]>("/v1/tokens", {
        "contract.in": collections.join(","),
        "tokenId.in": tokenIds.join(","),
        limit: Math.min(collections.length * tokenIds.length, 1000),
    });
}

/**
 * What one account holds, across a set of collections.
 *
 * Balance zero rows are excluded, so a piece someone sold stops appearing the
 * moment the transfer settles rather than lingering as something they own.
 */
export async function fetchTokensHeldBy(
    account: string,
    collections: string[],
    limit = 48,
): Promise<TzktToken[]> {
    if (collections.length === 0 || !isAddress(account)) return [];
    const rows = await get<{ token: TzktToken }[]>("/v1/tokens/balances", {
        account: requireAddress(account),
        "token.contract.in": collections.join(","),
        "balance.gt": 0,
        "sort.desc": "lastLevel",
        limit,
    });
    return rows.map((r) => r.token).filter(Boolean);
}

/**
 * Which of a specific set of tokens an account holds.
 *
 * `fetchTokensHeldBy` cannot answer this: it filters by collection alone and
 * caps at a page, so a piece somebody offered on can sit outside the window and
 * read as not held. Here the pairs are known, so both sides are filtered and
 * the answer is exact.
 *
 * `token.contract.in` and `token.tokenId.in` filter independently rather than
 * as a set of pairs, the same way `fetchTokensIn` does, so the caller's set is
 * what decides. Returned as `collection:tokenId` keys, which is what every
 * caller compares against.
 */
export async function fetchHeldAmong(
    account: string,
    pairs: { collection: string; tokenId: string }[],
): Promise<Set<string>> {
    if (pairs.length === 0 || !isAddress(account)) return new Set();

    const wanted = new Set(pairs.map((p) => `${p.collection}:${p.tokenId}`));
    const collections = [...new Set(pairs.map((p) => p.collection))];
    const tokenIds = [...new Set(pairs.map((p) => p.tokenId))];

    const rows = await get<{ token: TzktToken }[]>("/v1/tokens/balances", {
        account: requireAddress(account),
        "token.contract.in": collections.join(","),
        "token.tokenId.in": tokenIds.join(","),
        "balance.gt": 0,
        limit: Math.min(collections.length * tokenIds.length, 1000),
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

/** Raw contract storage, for the fields TzKT does not model. */
export async function fetchStorage<T = unknown>(address: string): Promise<T> {
    return get<T>(`/v1/contracts/${requireAddress(address)}/storage`);
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

/**
 * The operation that created a token, which is also its seed.
 *
 * A piece's seed is the hash of the `buy` operation that minted it
 * (docs/decisions.md §3). A renderer and anyone checking its work both read
 * it from here.
 */
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
    // `transactionId` identifies the operation; resolve it to a hash.
    //
    // The parameter comes back on the same row, which is where the collector's
    // chosen values are: `mint` takes them as bytes and this is the operation
    // they signed. Reading them here rather than from the piece's metadata is
    // the difference between knowing them now and knowing them once a provider
    // has rendered and published, which is minutes later.
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
 * A collection's own name and description.
 *
 * From the `content` key of its metadata big_map, decoded here. TzKT does
 * resolve TZIP-16 documents into a `metadata` field, but on its own schedule,
 * it is null on this network today, and it cannot be asked for in a `select`,
 * so waiting for it means every collection is a KT1 address until it catches
 * up. Reading the big_map is the same request count and never lags.
 */
export interface CollectionMeta {
    name?: string;
    description?: string;
    /**
     * The cover the artist picked at deploy, pinned then and on chain since.
     *
     * The deploy form calls it "what your collection looks like everywhere it
     * is listed", so anywhere a collection is shown before a piece of it has
     * been rendered, this is the picture to show.
     */
    displayUri?: string;
    thumbnailUri?: string;
}

export async function fetchCollectionMeta(address: string): Promise<CollectionMeta> {
    const row = await fetch(`${tzktApi()}/v1/contracts/${address}/bigmaps/metadata/keys/content`, {
        next: { revalidate: 300 },
    })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    const raw = (row as { value?: string } | null)?.value;
    if (!raw) return {};
    try {
        const doc = JSON.parse(bytesToString(raw)) as CollectionMeta;
        return {
            name: doc.name,
            description: doc.description,
            displayUri: doc.displayUri,
            thumbnailUri: doc.thumbnailUri,
        };
    } catch {
        return {};
    }
}

/**
 * Which token an operation minted.
 *
 * A collector signs and gets a hash back; the token id is decided by the
 * contract and only knowable afterwards. This closes that gap so the mint flow
 * can land them on their piece rather than on a receipt.
 *
 * Not `?hash=`: this TzKT instance ignores that filter on transactions and
 * answers with an unfiltered page of whatever is recent, which reads as
 * success and hands back somebody else's operation. So the query is by
 * recipient, and the hash is checked afterwards against the operations the
 * transfers actually belong to. Anything unmatched means the operation has not
 * been indexed yet, which is the normal case for the first second or two.
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
 * A token's metadata document, read from the chain rather than from an index.
 *
 * TzKT resolves `ipfs://` metadata into its `metadata` field, eventually and
 * on its own schedule, and on some networks not at all. Waiting for it means a
 * piece that is finished on chain still shows as unrendered, which is both
 * wrong and a strange thing for a project whose claim is that everything comes
 * from chain state.
 *
 * So this reads `token_info[""]` out of the collection's own big_map and
 * fetches the document itself. One call covers a whole collection.
 */
export async function fetchTokenUris(collection: string): Promise<Map<string, string>> {
    const rows = await get<{ key: string; value: { token_info: Record<string, string> } }[]>(
        `/v1/contracts/${requireAddress(collection)}/bigmaps/token_metadata/keys`,
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

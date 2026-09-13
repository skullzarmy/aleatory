/** TzKT client. Everything the site shows comes through here. */
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
 * Sized for a serverless invocation: two attempts at three seconds, plus the
 * pause between them, is about six. A healthy answer arrives well under a
 * second. Without a deadline a slow indexer holds the socket until the platform
 * gives up on the whole render, which is a 500 instead of a missing number.
 *
 * This bounds one read. Several in sequence can still outlast an invocation, so
 * the reads that matter sit behind `Promise.all` or a `catch` that degrades to
 * empty.
 */
const INDEXER_TIMEOUT_MS = 3_000;
const INDEXER_ATTEMPTS = 2;

/** Answers worth asking again about. Anything else is the indexer's real answer. */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * One read from the indexer, with a deadline and a second try. A 404 is an
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
 * Every generator one artist deployed.
 *
 * The factory originates a generator, so `creator` is the factory. The artist
 * is `initiator`, the account whose operation caused the internal origination.
 * TzKT cannot filter on storage and ignores unknown query parameters, answering
 * with an unfiltered page that reads as success.
 *
 * A single-field `select` is flattened: the answer is the field's own value per
 * row, not a row containing that field.
 */
export async function fetchGeneratorsDeployedBy(
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
): Promise<TzktToken[]> {
    if (generators.length === 0 || !isAddress(account)) return [];
    const rows = await get<{ token: TzktToken }[]>("/v1/tokens/balances", {
        account: requireAddress(account),
        "token.contract.in": generators.join(","),
        "balance.gt": 0,
        "sort.desc": "lastLevel",
        limit,
    });
    return rows.map((r) => r.token).filter(Boolean);
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
}

export async function fetchGeneratorMeta(address: string): Promise<GeneratorMeta> {
    const row = await fetch(`${tzktApi()}/v1/contracts/${address}/bigmaps/metadata/keys/content`, {
        next: { revalidate: 300 },
    })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    const raw = (row as { value?: string } | null)?.value;
    if (!raw) return {};
    try {
        const doc = JSON.parse(bytesToString(raw)) as GeneratorMeta;
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

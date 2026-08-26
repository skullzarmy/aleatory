/**
 * TzKT client.
 *
 * Everything the site shows comes through here, from public chain data, so
 * anyone can rebuild the same views against the same API. See
 * docs/decisions.md §8.
 */
import { tzktApi } from "./config";

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

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${tzktApi()}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
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
 * Every collection one artist deployed.
 *
 * A collection is originated by the factory, so its `creator` is the factory
 * and not the artist. What identifies the artist is `initiator`: the account
 * whose operation caused the internal origination. Filtering on storage would
 * be the obvious approach and TzKT does not support it, it ignores unknown
 * query parameters and answers with an unfiltered page, which reads as success.
 */
export async function fetchCollectionsDeployedBy(
    artist: string,
    factory: string,
): Promise<string[]> {
    if (!factory || !isAddress(artist)) return [];
    const rows = await get<{ originatedContract?: { address: string } }[]>(
        "/v1/operations/originations",
        {
            initiator: requireAddress(artist),
            sender: requireAddress(factory),
            status: "applied",
            "sort.desc": "id",
            limit: 200,
            select: "originatedContract",
        },
    );
    return rows.map((r) => r.originatedContract?.address).filter((a): a is string => Boolean(a));
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
): Promise<{ hash: string; level: number; timestamp: string } | null> {
    const rows = await get<
        { hash: string; level: number; timestamp: string }[]
    >("/v1/tokens/transfers", {
        "token.contract": contract,
        "token.tokenId": tokenId,
        "from.null": "true",
        limit: 1,
        select: "transactionId,level,timestamp",
    });
    const row = rows[0];
    if (!row) return null;
    // `transactionId` identifies the operation; resolve it to a hash.
    const ops = await get<{ hash: string }[]>("/v1/operations/transactions", {
        id: (row as unknown as { transactionId: number }).transactionId,
        limit: 1,
        select: "hash",
    });
    const hash = (ops[0] as unknown as string | { hash: string }) ?? null;
    return hash
        ? {
              hash: typeof hash === "string" ? hash : hash.hash,
              level: row.level,
              timestamp: row.timestamp,
          }
        : null;
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
export async function fetchTokenUris(
    collection: string,
): Promise<Map<string, string>> {
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

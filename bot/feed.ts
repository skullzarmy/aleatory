/**
 * What the contracts said happened: `deploy` from the factory, `mint` from
 * every generator. An event is part of a contract's interface and carries the
 * figures it published; an origination or token row is the indexer's record of
 * a side effect.
 *
 * An event is emitted once, which is where exactly-once comes from. The mark is
 * an event id, ids only go up, and `id.gt` is the whole of it.
 */
import { addresses, tzkt } from "./chain";
import { generatorsOf } from "./stats";

/** Nothing sensible produces this many in a minute; it is a runaway guard. */
const LIMIT = 50;

interface EventRow<P> {
    id: number;
    level: number;
    timestamp: string;
    contract: { address: string };
    tag: string;
    payload: P;
    transactionId: number;
}

/** `deploy`, from the factory. */
interface DeployPayload {
    collection_id?: string;
    address?: string;
    artist?: string;
    code_hash?: string;
    code_uri?: string;
    edition_size?: string;
}

/** `mint` and `set_token_metadata`, both from a generator. */
interface PiecePayload {
    token_id?: string;
    /** `mint` only. */
    buyer?: string;
    params?: string;
    paid?: string;
    render_gas?: string;
    /** `set_token_metadata` only. */
    metadata_uri?: string;
    renderer?: string;
}

export interface NewGenerator {
    cursor: number;
    address: string;
    artist: string;
    editionSize: number;
    codeHash: string;
    /** From the generator's own metadata, which the event does not carry. */
    name: string;
    description: string;
    coverUri: string;
    at: string;
}

export interface NewMint {
    cursor: number;
    contract: string;
    tokenId: string;
    collector: string;
    /**
     * Mutez, from the `mint` event. Null when only the render was seen, because
     * the current price is not what was paid.
     */
    paidMutez: number | null;
    /** What the collector chose, decoded from the event's own payload. */
    params: Record<string, unknown>;
    /** From the token's own metadata, which the event does not carry. */
    name: string;
    imageUri: string;
    /** The generator this belongs to, so a mint can name it rather than a KT1. */
    generatorName: string;
    artist: string;
    editionSize: number;
    at: string;
}

/** Hex bytes, as TzKT carries `sp.bytes` and big map values. */
function bytesToString(hex: string): string {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length === 0) return "";
    // parseInt("ip", 16) is NaN and Uint8Array turns NaN into 0, so unchecked
    // input decodes to zero-filled garbage, and garbage is truthy.
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return "";
    const bytes = clean.match(/.{2}/g) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

interface Meta {
    name?: string;
    description?: string;
    displayUri?: string;
    thumbnailUri?: string;
    /** The same settings the mint event carries, as plain JSON. */
    aleaParams?: string;
}

/**
 * A generator's own metadata document. The `deploy` event carries who, what
 * code and how many; the name the artist typed is TZIP-16 in a big map.
 */
async function generatorMeta(address: string): Promise<Meta> {
    try {
        const row = await tzkt<{ value?: string }>(
            `/v1/contracts/${address}/bigmaps/metadata/keys/content`,
        );
        if (!row?.value) return {};
        return JSON.parse(bytesToString(row.value)) as Meta;
    } catch {
        return {};
    }
}

const IPFS_GATEWAY = (process.env.ALEA_IPFS_GATEWAY || "https://ipfs.fileship.xyz").replace(
    /\/+$/,
    "",
);

/**
 * The document `set_token_metadata` points at, which is what the contract just
 * published. The indexer resolves the same document on its own schedule and is
 * behind when this fires.
 */
async function documentAt(uri: string): Promise<Meta> {
    const cid = uri.replace(/^ipfs:\/\//, "").split(/[/?#]/)[0];
    if (!cid) return {};
    try {
        const res = await fetch(`${IPFS_GATEWAY}/${cid}`, {
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return {};
        return (await res.json()) as Meta;
    } catch {
        return {};
    }
}

/** A piece's own metadata. The events carry the sale and the render, not the picture. */
async function tokenMeta(
    contract: string,
    tokenId: string,
): Promise<Meta & { firstMinter?: string }> {
    try {
        const rows = await tzkt<{ metadata?: Meta; firstMinter?: { address?: string } }[]>(
            `/v1/tokens?contract=${contract}&tokenId=${tokenId}&limit=1`,
        );
        return { ...(rows[0]?.metadata ?? {}), firstMinter: rows[0]?.firstMinter?.address };
    } catch {
        return {};
    }
}

interface Facts {
    name: string;
    artist: string;
    editionSize: number;
}

/**
 * What a generator is, looked up once and held for the life of the process. An
 * announcement wants the name and the edition size, neither of which is in the
 * `mint` event and neither of which changes per mint.
 */
const known = new Map<string, Facts>();

async function generatorFacts(address: string): Promise<Facts> {
    const hit = known.get(address);
    if (hit) return hit;

    const [meta, storage] = await Promise.all([
        generatorMeta(address),
        tzkt<{ administrator?: string; sale?: { edition_size?: string } }>(
            `/v1/contracts/${address}/storage`,
        ).catch(() => ({}) as { administrator?: string; sale?: { edition_size?: string } }),
    ]);

    const facts: Facts = {
        name: meta.name || "",
        artist: storage.administrator || "",
        editionSize: Number(storage.sale?.edition_size ?? 0),
    };
    known.set(address, facts);
    return facts;
}

function asRecord(json: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** The parameters the collector picked, as the event carries them. */
const decodeParams = (hex?: string) => (hex ? asRecord(bytesToString(hex)) : {});

async function watched(): Promise<{ factories: string[]; generators: string[] }> {
    const where = await addresses();
    const factories = [...new Set(where.factories.filter(Boolean))];
    if (factories.length === 0) return { factories: [], generators: [] };
    return { factories, generators: await generatorsOf(factories) };
}

/** The newest event id on each feed. What a start records and goes on from. */
export async function highWaterMark(): Promise<{ generators: number; mints: number }> {
    const { factories, generators: served } = await watched();
    if (factories.length === 0) return { generators: 0, mints: 0 };

    const newest = async (contracts: string[], tags: string): Promise<number> => {
        if (contracts.length === 0) return 0;
        const rows = await tzkt<EventRow<unknown>[]>(
            `/v1/contracts/events?contract.in=${contracts.join(",")}&tag.in=${tags}` +
                `&sort.desc=id&limit=1`,
        );
        return rows[0]?.id ?? 0;
    };

    const [generators, mints] = await Promise.all([
        newest(factories, "deploy"),
        // One mark over both tags, because one cursor reads both.
        newest(served, "mint,set_token_metadata"),
    ]);
    return { generators, mints };
}

/** `deploy` events from any factory the router has ever named. */
export async function newGenerators(since: number): Promise<NewGenerator[]> {
    const { factories } = await watched();
    if (factories.length === 0) return [];

    const rows = await tzkt<EventRow<DeployPayload>[]>(
        `/v1/contracts/events?contract.in=${factories.join(",")}&tag=deploy` +
            `&id.gt=${since}&sort.asc=id&limit=${LIMIT}`,
    );

    const out: NewGenerator[] = [];
    for (const row of rows) {
        const address = row.payload?.address ?? "";
        if (!address) continue;
        const meta = await generatorMeta(address);
        out.push({
            cursor: row.id,
            address,
            artist: row.payload?.artist ?? "",
            editionSize: Number(row.payload?.edition_size ?? 0),
            codeHash: row.payload?.code_hash ?? "",
            name: meta.name || "",
            description: meta.description || "",
            coverUri: meta.displayUri || meta.thumbnailUri || "",
            at: row.timestamp,
        });
    }
    return out;
}

interface Sale {
    collector: string;
    paidMutez: number;
    params: Record<string, unknown>;
}

/**
 * Mints whose piece has not been rendered yet. The sale is in the `mint` event
 * and the picture arrives with a later one. Keyed on contract and token
 * together, because every generator numbers from zero.
 */
const waiting = new Map<string, Sale>();

/**
 * Pieces already announced. `set_token_metadata` is rewritable on purpose, so a
 * provider retrying a publish emits it again for a piece already posted.
 */
const announced = new Set<string>();

/**
 * Pieces ready to announce, and how far the feed was read.
 *
 * The trigger is the render, not the mint. At mint time `token_info[""]` still
 * holds the generator's pending document, so a message sent then has no
 * picture in it. `set_token_metadata` refuses the pending document, so it fires
 * only when there is something to show.
 *
 * `consumed` is the last row examined, not the last row returned. A pass that
 * sees only mints produces nothing to post, and the mark still has to move or
 * those rows are re-read until they fill the page.
 */
export async function newMints(since: number): Promise<{ items: NewMint[]; consumed: number }> {
    const { generators } = await watched();
    if (generators.length === 0) return { items: [], consumed: since };

    const rows = await tzkt<EventRow<PiecePayload>[]>(
        `/v1/contracts/events?contract.in=${generators.join(",")}` +
            `&tag.in=mint,set_token_metadata&id.gt=${since}&sort.asc=id&limit=${LIMIT}`,
    );

    const items: NewMint[] = [];
    let consumed = since;

    for (const row of rows) {
        consumed = row.id;
        const contract = row.contract?.address ?? "";
        const tokenId = row.payload?.token_id ?? "";
        if (!contract || tokenId === "") continue;
        const key = `${contract}:${tokenId}`;

        if (row.tag === "mint") {
            waiting.set(key, {
                collector: row.payload?.buyer ?? "",
                paidMutez: Number(row.payload?.paid ?? 0),
                params: decodeParams(row.payload?.params),
            });
            continue;
        }

        // A render. Everything below happens once per piece.
        if (announced.has(key)) continue;
        announced.add(key);

        const sale = waiting.get(key);
        waiting.delete(key);

        // The document first, since the event just named it.
        const published = await documentAt(bytesToString(row.payload?.metadata_uri ?? ""));
        // The indexer answers when the document did not, and when there is no
        // buffered sale: the collector is on the token and in no document.
        const needIndexer = !published.name || !sale;
        const [indexed, facts] = await Promise.all([
            needIndexer
                ? tokenMeta(contract, tokenId)
                : Promise.resolve({} as Meta & { firstMinter?: string }),
            generatorFacts(contract),
        ]);
        const meta = { ...indexed, ...published };

        items.push({
            cursor: row.id,
            contract,
            tokenId,
            // Without the mint event, the token's first holder is the same
            // answer from a different direction.
            collector: sale?.collector ?? meta.firstMinter ?? "",
            paidMutez: sale ? sale.paidMutez : null,
            params: sale?.params ?? asRecord(meta.aleaParams ?? ""),
            name: meta.name || "",
            imageUri: meta.displayUri || meta.thumbnailUri || "",
            generatorName: facts.name,
            artist: facts.artist,
            editionSize: facts.editionSize,
            at: row.timestamp,
        });
    }

    return { items, consumed };
}

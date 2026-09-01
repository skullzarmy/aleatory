/**
 * What the contracts said happened.
 *
 * The factory emits `deploy` and every collection emits `mint`. Those are the
 * events, they are part of the contract's interface, and they are what this
 * reads. An origination row or a token row is the indexer's record of a side
 * effect; the event is the contract stating the thing itself, with the figures
 * it chose to publish already in the payload.
 *
 * **An event is emitted once.** That is where exactly-once comes from here.
 * The mark is an event id, ids only go up, and `id.gt` is the whole of it.
 */
import { addresses, tzkt } from "./chain";
import { collectionsOf } from "./stats";

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

/** `mint`, from a collection. */
interface MintPayload {
    token_id?: string;
    buyer?: string;
    params?: string;
    paid?: string;
    render_gas?: string;
}

export interface NewGenerator {
    cursor: number;
    address: string;
    artist: string;
    editionSize: number;
    codeHash: string;
    /** From the collection's own metadata, which the event does not carry. */
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
    /** Mutez. Price and render gas together, as the collector paid it. */
    paidMutez: number;
    /** What the collector chose, decoded from the event's own payload. */
    params: Record<string, unknown>;
    /** From the token's own metadata, which the event does not carry. */
    name: string;
    imageUri: string;
    /** The collection this belongs to, so a mint can name it rather than a KT1. */
    collectionName: string;
    artist: string;
    editionSize: number;
    at: string;
}

/** Hex bytes, as TzKT carries `sp.bytes` and big map values. */
function bytesToString(hex: string): string {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    let out = "";
    for (let i = 0; i < clean.length; i += 2) {
        out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    }
    return decodeURIComponent(escape(out));
}

interface Meta {
    name?: string;
    description?: string;
    displayUri?: string;
    thumbnailUri?: string;
}

/**
 * A collection's own metadata document.
 *
 * The `deploy` event carries what the contract knows: who, what code, how
 * many. The name the artist typed is TZIP-16 and lives in a big map, so it
 * takes this one read on top.
 */
async function collectionMeta(address: string): Promise<Meta> {
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

/** A piece's own metadata. The `mint` event carries the sale, not the picture. */
async function tokenMeta(contract: string, tokenId: string): Promise<Meta> {
    try {
        const rows = await tzkt<{ metadata?: Meta }[]>(
            `/v1/tokens?contract=${contract}&tokenId=${tokenId}&limit=1`,
        );
        return rows[0]?.metadata ?? {};
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
 * What a collection is, looked up once.
 *
 * A mint announcement wants the collection's name and how big the edition is,
 * and neither is in the `mint` event because neither changes per mint. Held
 * for the life of the process: a collection is named at deploy and an edition
 * only ever shrinks, so a busy collection costs two reads in total rather than
 * two per piece.
 */
const known = new Map<string, Facts>();

async function collectionFacts(address: string): Promise<Facts> {
    const hit = known.get(address);
    if (hit) return hit;

    const [meta, storage] = await Promise.all([
        collectionMeta(address),
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

/** The parameters the collector picked, as the event carries them. */
function decodeParams(hex: string | undefined): Record<string, unknown> {
    if (!hex) return {};
    try {
        const parsed: unknown = JSON.parse(bytesToString(hex));
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

async function watched(): Promise<{ factories: string[]; collections: string[] }> {
    const where = await addresses();
    const factories = [...new Set(where.factories.filter(Boolean))];
    if (factories.length === 0) return { factories: [], collections: [] };
    return { factories, collections: await collectionsOf(factories) };
}

/** The newest event id on each feed. What a start records and goes on from. */
export async function highWaterMark(): Promise<{ generators: number; mints: number }> {
    const { factories, collections } = await watched();
    if (factories.length === 0) return { generators: 0, mints: 0 };

    const newest = async (contracts: string[], tag: string): Promise<number> => {
        if (contracts.length === 0) return 0;
        const rows = await tzkt<EventRow<unknown>[]>(
            `/v1/contracts/events?contract.in=${contracts.join(",")}&tag=${tag}` +
                `&sort.desc=id&limit=1`,
        );
        return rows[0]?.id ?? 0;
    };

    const [generators, mints] = await Promise.all([
        newest(factories, "deploy"),
        newest(collections, "mint"),
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
        const meta = await collectionMeta(address);
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

/** `mint` events from every collection those factories deployed. */
export async function newMints(since: number): Promise<NewMint[]> {
    const { collections } = await watched();
    if (collections.length === 0) return [];

    const rows = await tzkt<EventRow<MintPayload>[]>(
        `/v1/contracts/events?contract.in=${collections.join(",")}&tag=mint` +
            `&id.gt=${since}&sort.asc=id&limit=${LIMIT}`,
    );

    const out: NewMint[] = [];
    for (const row of rows) {
        const contract = row.contract?.address ?? "";
        const tokenId = row.payload?.token_id ?? "";
        if (!contract || tokenId === "") continue;
        const [meta, facts] = await Promise.all([
            tokenMeta(contract, tokenId),
            collectionFacts(contract),
        ]);
        out.push({
            cursor: row.id,
            contract,
            tokenId,
            collector: row.payload?.buyer ?? "",
            paidMutez: Number(row.payload?.paid ?? 0),
            params: decodeParams(row.payload?.params),
            name: meta.name || "",
            imageUri: meta.displayUri || meta.thumbnailUri || "",
            collectionName: facts.name,
            artist: facts.artist,
            editionSize: facts.editionSize,
            at: row.timestamp,
        });
    }
    return out;
}

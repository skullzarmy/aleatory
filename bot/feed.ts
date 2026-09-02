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

/** `mint` and `set_token_metadata`, both from a collection. */
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
    /**
     * Mutez, from the `mint` event. Null when that event was emitted before
     * this process started and only the render was seen, since the figure is
     * the contract's to state and reconstructing it from the current price
     * would be a guess dressed as a fact.
     */
    paidMutez: number | null;
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
    /** The same settings the mint event carries, as plain JSON. */
    aleaParams?: string;
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
        newest(collections, "mint,set_token_metadata"),
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

interface Sale {
    collector: string;
    paidMutez: number;
    params: Record<string, unknown>;
}

/**
 * Mints whose piece has not been rendered yet.
 *
 * The sale is in the `mint` event and the picture arrives with a later one, so
 * the first is held until the second turns up. Keyed on contract and token
 * together: every collection numbers from zero, so token 0 is three different
 * pieces across three collections.
 *
 * A piece that is never rendered leaves its entry here. That is a stuck
 * provider rather than a leak worth writing code about, and an entry is three
 * short strings.
 */
const waiting = new Map<string, Sale>();

/**
 * Pieces already announced.
 *
 * `set_token_metadata` is rewritable on purpose, so a provider retrying a
 * publish emits it a second time for a piece that has already been posted.
 * Thirteen of thirty-nine pieces on shadownet have been written more than
 * once, so this is the common case and not an edge one.
 */
const announced = new Set<string>();

/**
 * Pieces ready to announce, and how far the feed was read.
 *
 * **The trigger is the render, not the mint.** At mint time `token_info[""]`
 * still holds the collection's pending document, so a message sent then has no
 * picture in it, and a picture is the whole point of announcing a piece of
 * art. `set_token_metadata` refuses to accept the pending document, so it
 * fires only when there is something real to show.
 *
 * `consumed` is the last row examined, which is not the last row returned: a
 * pass that sees only mints produces nothing to post, and without it the mark
 * would never move and those rows would be re-read until they filled the page.
 */
export async function newMints(
    since: number,
): Promise<{ items: NewMint[]; consumed: number }> {
    const { collections } = await watched();
    if (collections.length === 0) return { items: [], consumed: since };

    const rows = await tzkt<EventRow<PiecePayload>[]>(
        `/v1/contracts/events?contract.in=${collections.join(",")}` +
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

        const [meta, facts] = await Promise.all([
            tokenMeta(contract, tokenId),
            collectionFacts(contract),
        ]);

        items.push({
            cursor: row.id,
            contract,
            tokenId,
            // The mint said who bought it. Without that event, the token's own
            // first holder is the same answer from a different direction.
            collector: sale?.collector ?? meta.firstMinter ?? "",
            paidMutez: sale ? sale.paidMutez : null,
            // The event when we saw it, the piece's own document when we did
            // not. Both were published by the chain, so neither is a guess.
            params: sale?.params ?? asRecord(meta.aleaParams ?? ""),
            name: meta.name || "",
            imageUri: meta.displayUri || meta.thumbnailUri || "",
            collectionName: facts.name,
            artist: facts.artist,
            editionSize: facts.editionSize,
            at: row.timestamp,
        });
    }

    return { items, consumed };
}

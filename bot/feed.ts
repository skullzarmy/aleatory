/**
 * What has happened since last time.
 *
 * Both reads are the same shape: ask TzKT for rows newer than a cursor, in
 * ascending id order, so the caller can post them in the order they happened
 * and move the cursor as it goes.
 *
 * Row id rather than a timestamp. Ids are assigned by the indexer and only go
 * up, so "newer than this" is exact. Two mints in one block share a timestamp,
 * and a cursor built on time either posts one twice or never posts it.
 */
import { addresses, tzkt } from "./chain";
import { collectionsOf } from "./stats";

/** Nothing sensible produces this many in a minute; it is a runaway guard. */
const LIMIT = 50;

export interface NewGenerator {
    cursor: number;
    address: string;
    name: string;
    description: string;
    /** `ipfs://…`, or empty when the deploy pinned no cover. */
    coverUri: string;
    artist: string;
    at: string;
}

export interface NewMint {
    cursor: number;
    contract: string;
    tokenId: string;
    name: string;
    description: string;
    /** `ipfs://…`, or empty while the piece is still being rendered. */
    imageUri: string;
    collector: string;
    at: string;
}

/** Hex bytes out of a big map, as TzKT stores them. */
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
 * TZIP-16 puts it in a `metadata` big map under the key `content`, as bytes.
 * The artist typed the name that comes out of here, which is the reason to go
 * and get it rather than announce a KT1 address at people.
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

/** The highest id on each feed right now. What a first run records. */
export async function highWaterMark(): Promise<{ generators: number; mints: number }> {
    const where = await addresses();
    const factories = [...new Set(where.factories.filter(Boolean))];
    if (factories.length === 0) return { generators: 0, mints: 0 };

    const collections = await collectionsOf(factories);
    const [gen, mint] = await Promise.all([
        tzkt<number[]>(
            `/v1/contracts?creator.in=${factories.join(",")}&sort.desc=id&limit=1&select=id`,
        ),
        collections.length === 0
            ? Promise.resolve([] as number[])
            : tzkt<number[]>(
                  `/v1/tokens?contract.in=${collections.join(",")}&sort.desc=id&limit=1&select=id`,
              ),
    ]);

    return { generators: gen[0] ?? 0, mints: mint[0] ?? 0 };
}

/** Collections originated by any factory the router has ever named. */
export async function newGenerators(since: number): Promise<NewGenerator[]> {
    const where = await addresses();
    const factories = [...new Set(where.factories.filter(Boolean))];
    if (factories.length === 0) return [];

    const rows = await tzkt<{ id: number; address: string; firstActivityTime: string }[]>(
        `/v1/contracts?creator.in=${factories.join(",")}&id.gt=${since}` +
            `&sort.asc=id&limit=${LIMIT}&select=id,address,firstActivityTime`,
    );

    const out: NewGenerator[] = [];
    for (const row of rows) {
        // Two reads per generator, and a generator is a rare event. The
        // metadata carries what the artist called it, the storage carries who
        // they are.
        const [meta, storage] = await Promise.all([
            collectionMeta(row.address),
            tzkt<{ administrator?: string }>(`/v1/contracts/${row.address}/storage`).catch(
                () => ({}) as { administrator?: string },
            ),
        ]);
        out.push({
            cursor: row.id,
            address: row.address,
            name: meta.name || "",
            description: meta.description || "",
            coverUri: meta.displayUri || meta.thumbnailUri || "",
            artist: storage.administrator || "",
            at: row.firstActivityTime,
        });
    }
    return out;
}

/** Tokens minted in any of those collections. */
export async function newMints(since: number): Promise<NewMint[]> {
    const where = await addresses();
    const factories = [...new Set(where.factories.filter(Boolean))];
    if (factories.length === 0) return [];

    const collections = await collectionsOf(factories);
    if (collections.length === 0) return [];

    const rows = await tzkt<
        {
            id: number;
            contract: { address: string };
            tokenId: string;
            firstMinter: { address: string };
            firstTime: string;
            metadata?: Meta;
        }[]
    >(
        `/v1/tokens?contract.in=${collections.join(",")}&id.gt=${since}` +
            `&sort.asc=id&limit=${LIMIT}&select=id,contract,tokenId,firstMinter,firstTime,metadata`,
    );

    return rows.map((row) => ({
        cursor: row.id,
        contract: row.contract?.address ?? "",
        tokenId: row.tokenId,
        name: row.metadata?.name || "",
        description: row.metadata?.description || "",
        imageUri: row.metadata?.displayUri || row.metadata?.thumbnailUri || "",
        collector: row.firstMinter?.address ?? "",
        at: row.firstTime,
    }));
}

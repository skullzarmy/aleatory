/**
 * How a generator of a given size gets on chain, decided in one place.
 *
 * The 32,768 byte ceiling is on an operation, not on storage: a generator past
 * it is deployed empty and then walks on chain a chunk at a time through
 * `append_code`, closing with `seal_code`. So size decides how many signatures
 * a publish costs, and only at the far end whether the art is on chain at all.
 *
 * Here rather than in `publish.ts` because the studio quotes this before a
 * wallet is involved, and `publish.ts` carries the wallet client with it. Two
 * copies of these thresholds is how the studio came to tell artists a 49KB
 * generator was too big to publish while the publisher was perfectly willing
 * to walk it on chain in two signatures.
 */

/**
 * The protocol's operation ceiling, less measured room for everything else the
 * deploy carries: metadata, royalties, the pending pointer.
 */
export const MAX_INLINE_CODE_BYTES = 32_768 - 700;

/**
 * One chunk of a walked generator. The same ceiling applies, less room for the
 * call around the bytes, which is far smaller than a deploy's: an entrypoint
 * name, a contract address and the signature.
 */
export const MAX_CHUNK_BYTES = 32_768 - 1_200;

/**
 * How many signatures a publish may ask for before the generator goes behind a
 * pointer instead. Every chunk is a separate wallet prompt, and there is a
 * count past which walking it on chain stops being a reasonable thing to ask
 * of an artist.
 */
export const MAX_WALK_CHUNKS = 8;

/** Storage burn per byte, fixed here so a publish can quote a cost with no
 *  round trip. The studio prefers the chain's own figure. */
export const COST_PER_BYTE = 250;

/** Native everywhere this runs, so compression adds no dependency. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as unknown as BlobPart])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Inline rides inside the deploy. Walked is a deploy carrying nothing followed
 * by a chunk per signature. A pointer is the last resort, and the only one
 * where the art is not on chain.
 */
export type PublishRoute = "inline" | "walked" | "pointer";

export interface PublishPlan {
    route: PublishRoute;
    /** The source as written. */
    rawBytes: number;
    /** The bytes that go into storage, which is what the burn is paid on. */
    codeBytes: number;
    /** Those bytes, so the publisher encodes once and the studio's quote is of the same thing. */
    code: Uint8Array;
    codeEncoding: "identity" | "gzip";
    /** Chunk signatures. Zero unless walked. */
    chunks: number;
    /** Every wallet prompt the publish will ask for, the deploy and the seal included. */
    signatures: number;
    /** Storage burn for the code alone, mutez, at the protocol's usual rate. */
    burnMutez: number;
}

/** What publishing this source will do, and what it will ask for. */
export async function publishPlan(html: string): Promise<PublishPlan> {
    const raw = new TextEncoder().encode(html);

    // Identity by default, so the bytes can be read straight off the chain.
    // Compressed only when the source would not otherwise fit one operation.
    const zipped = raw.length > MAX_INLINE_CODE_BYTES ? await gzip(raw) : raw;
    const codeEncoding = zipped === raw ? "identity" : "gzip";

    if (zipped.length <= MAX_INLINE_CODE_BYTES) {
        return {
            route: "inline",
            rawBytes: raw.length,
            codeBytes: zipped.length,
            code: zipped,
            codeEncoding,
            chunks: 0,
            signatures: 1,
            burnMutez: zipped.length * COST_PER_BYTE,
        };
    }

    const chunks = Math.ceil(zipped.length / MAX_CHUNK_BYTES);
    if (chunks <= MAX_WALK_CHUNKS) {
        return {
            route: "walked",
            rawBytes: raw.length,
            codeBytes: zipped.length,
            code: zipped,
            codeEncoding,
            chunks,
            // The deploy, a signature per chunk, and the seal.
            signatures: 1 + chunks + 1,
            burnMutez: zipped.length * COST_PER_BYTE,
        };
    }

    // Behind a pointer, which is one deploy again and no code in storage.
    return {
        route: "pointer",
        rawBytes: raw.length,
        codeBytes: 0,
        code: zipped,
        codeEncoding,
        chunks: 0,
        signatures: 1,
        burnMutez: 0,
    };
}

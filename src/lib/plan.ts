/**
 * How a generator of a given size gets on chain, decided in one place.
 *
 * The 32,768 byte ceiling is on an operation, not on storage: a generator past
 * it is deployed empty and then walks on chain a chunk at a time through
 * `append_code`, closing with `seal_code`. So size decides how many signatures
 * a publish costs, never whether the art ends up on chain.
 *
 * Here rather than in `publish.ts` because the studio quotes this before a
 * wallet is involved, and `publish.ts` carries the wallet client with it. Two
 * copies of these thresholds is how the studio came to tell artists a 49KB
 * generator was too big to publish while the publisher was perfectly willing
 * to walk it on chain in two signatures.
 */

/**
 * The protocol's operation ceiling, less a margin for everything else the
 * deploy carries: the metadata map (name, description, tags, cover,
 * interfaces, authors, and aleatory:params/libraries/nameTrait when
 * declared), royalties, the pending pointer, edition size, price, provider
 * and the Michelson envelope around all of it. A margin, never a per-publish
 * measurement of the real metadata bytes, so a generator whose own metadata
 * is large enough can still be misrouted here and rejected on chain. The
 * correct fix measures the actual metadata bytes per publish; this guesses,
 * generously.
 */
export const MAX_INLINE_CODE_BYTES = 32_768 - 3_000;

/**
 * One chunk of a walked generator. The same ceiling applies, less room for the
 * call around the bytes, which is far smaller than a deploy's: an entrypoint
 * name, a contract address and the signature.
 */
export const MAX_CHUNK_BYTES = 32_768 - 1_200;

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
 * by a chunk per signature, as many as the source needs: there is no ceiling
 * on chunk count, only on the bytes each one carries.
 */
export type PublishRoute = "inline" | "walked";

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

/**
 * Publishing a draft: encode, hash, deploy.
 *
 * The generator goes into contract storage. That is what fully on-chain has to
 * mean, and it is affordable: a typical generator is well under 10KB, and at
 * 250 mutez per byte that is around half a dollar of storage burn, paid once by
 * the artist. A pointer to somebody's gateway costs less and is worth less,
 * because a gateway's content policy can change and the art stops resolving.
 * We learned that the direct way.
 *
 * A generator too large for one operation still needs a pointer, so `codeUri`
 * remains as the escape hatch and the contract accepts exactly one of the two.
 *
 * Ordered so nothing irreversible happens until everything reversible has
 * already succeeded: the pending document is pinned first, because pinning is
 * free to retry, and only then is a wallet asked to sign.
 */
import type { DAppClient } from "@tezos-x/octez.connect-sdk";
import { deployCollection } from "./ops";
import { buildPendingDocument, royaltiesToBps, type RoyaltySplit } from "@provider/metadata";
import { detectParams } from "./detect";
import { schemaForRecord } from "./params";
import { getKind } from "./runtimes";
import type { Draft } from "./draft";

export type PublishStage = "encoding" | "pinning-metadata" | "signing";

/**
 * The protocol's operation ceiling, less room for everything else the deploy
 * carries (metadata, royalties, the pending pointer). Measured against a real
 * deploy rather than guessed.
 */
const MAX_INLINE_CODE_BYTES = 32_768 - 700;

/** Storage burn per byte. Read from the chain for display; fixed here so a
 *  publish can quote a cost without a round trip. */
const COST_PER_BYTE = 250;

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** Native everywhere this runs, so compression adds no dependency. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as unknown as BlobPart])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface PublishInput {
    draft: Draft;
    /** The collection name, which is also each piece's name stem. */
    name: string;
    description: string;
    artist: string;
    editionSize: number;
    priceMutez: bigint;
    split: RoyaltySplit;
    provider: string;
    /** The artist's ceiling on the provider's per-piece charge. */
    maxRenderGasMutez: bigint;
    startPaused: boolean;
    trustResolver: boolean;
    /** Shown on a piece until its own render is published. */
    placeholderImageUri?: string;
    /**
     * The collection cover: a flat PNG captured in the studio and pinned.
     * Goes into TZIP-016 metadata, which is what an external marketplace
     * reads, and the artist can replace it later with `set_metadata`.
     */
    coverUri?: string;
    /** A downscaled copy of the same capture, for grids and marketplace cards. */
    coverThumbUri?: string;
    /** The seed that cover was drawn from, recorded so it can be reproduced. */
    coverSeed?: string;
}

export interface PublishResult {
    hash: string;
    /** Bytes of generator written into storage. Zero when a pointer was used. */
    codeBytes: number;
    codeEncoding: "identity" | "gzip";
    codeHashHex: string;
    /** Set only when the generator was too large to carry on chain. */
    codeUri: string;
    pendingMetadataUri: string;
    /** Storage burn for the code alone, mutez. */
    codeBurnMutez: number;
}

/** SHA-256, hex, through WebCrypto. No dependency, and it is what the spec says. */
export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

async function pin(body: unknown): Promise<string> {
    const res = await fetch("/api/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { uri?: string; error?: string };
    if (!res.ok || !json.uri) throw new Error(json.error || `Pinning failed (${res.status}).`);
    return json.uri;
}

export async function publishCollection(
    client: DAppClient,
    input: PublishInput,
    onStage?: (stage: PublishStage) => void,
): Promise<PublishResult> {
    const { draft } = input;

    onStage?.("encoding");
    // The hash always covers the decoded source, so it verifies what actually
    // runs whatever encoding the bytes travelled in.
    const codeHashHex = await sha256Hex(draft.html);

    const raw = new TextEncoder().encode(draft.html);
    let codeBytes: Uint8Array<ArrayBufferLike> = raw;
    let codeEncoding: "identity" | "gzip" = "identity";

    // Identity by default. The extra storage is worth it: bytes a person can
    // read straight off the chain are half of what on-chain means. Compress
    // only when the generator would not otherwise fit one operation.
    if (raw.length > MAX_INLINE_CODE_BYTES) {
        codeBytes = await gzip(raw);
        codeEncoding = "gzip";
    }

    const tooLarge = codeBytes.length > MAX_INLINE_CODE_BYTES;
    let codeUri = "";
    if (tooLarge) {
        // Past the operation cap even compressed. Fall back to a pointer, and
        // say so rather than failing: a large generator is still publishable,
        // it just carries the dependency a small one does not.
        onStage?.("pinning-metadata");
        codeUri = await pin({
            kind: "generator",
            content: draft.html,
            name: `${input.name || "generator"}.html`,
        });
    }

    onStage?.("pinning-metadata");
    // Every piece mints carrying this document, and a provider replaces it
    // with the piece's own. The comparison against it is the whole work queue,
    // so it has to be one stable pointer for the collection.
    const pendingMetadataUri = await pin({
        kind: "document",
        name: "pending.json",
        content: buildPendingDocument({
            collectionName: input.name,
            description: input.description,
            artist: input.artist,
            placeholderImageUri: input.placeholderImageUri ?? input.coverUri ?? "",
            split: input.split,
        }),
    });

    onStage?.("signing");
    const schema = schemaForRecord(detectParams(draft.html)?.params ?? []);

    // What this generator expects a renderer to load for it. Recorded on chain
    // because a renderer that cannot see this cannot draw the piece, and a
    // renderer is not required to know anything about our catalog. Id,
    // version and package path make it resolvable from any registry mirror;
    // the hash makes every one of those answers checkable.
    const libraries = getKind(draft.kindId).deps.map((d) => ({
        id: d.id,
        version: d.version,
        path: d.registry.path,
        hash: d.hash,
    }));

    const result = await deployCollection(client, {
        codeHex: tooLarge ? "" : toHex(codeBytes),
        codeEncoding,
        codeHashHex,
        codeUri,
        editionSize: input.editionSize,
        priceMutez: input.priceMutez,
        royalties: royaltiesToBps(input.split),
        pendingMetadataUri,
        startPaused: input.startPaused,
        trustResolver: input.trustResolver,
        provider: input.provider,
        maxRenderGasMutez: input.maxRenderGasMutez,
        metadata: {
            "": "tezos-storage:content",
            content: JSON.stringify({
                name: input.name,
                description: input.description,
                interfaces: ["TZIP-012", "TZIP-016", "ALEATORY-001"],
                authors: [input.artist],
                // The keys an external marketplace looks for. Both point at
                // the same capture: some read one, some the other.
                ...(input.coverUri
                    ? {
                          displayUri: input.coverUri,
                          thumbnailUri: input.coverThumbUri ?? input.coverUri,
                      }
                    : {}),
                // Recorded so the cover can be redrawn from chain state rather
                // than only existing as a pinned file.
                ...(input.coverSeed ? { aleaCoverSeed: input.coverSeed } : {}),
            }),
            // Held under its own key so a mint UI built by someone else needs
            // one value rather than the whole record. docs/params.md §4.
            ...(schema ? { "aleatory:params": JSON.stringify(schema) } : {}),
            ...(libraries.length > 0 ? { "aleatory:libraries": JSON.stringify(libraries) } : {}),
        },
    });

    return {
        hash: result.hash,
        codeBytes: tooLarge ? 0 : codeBytes.length,
        codeEncoding,
        codeHashHex,
        codeUri,
        pendingMetadataUri,
        codeBurnMutez: tooLarge ? 0 : codeBytes.length * COST_PER_BYTE,
    };
}

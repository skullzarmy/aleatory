/**
 * Publishing a draft: encode, hash, deploy.
 *
 * The generator goes into contract storage. A typical one is well under 10KB,
 * which at 250 mutez per byte is around half a dollar of storage burn paid once
 * by the artist. A generator too large for one operation falls back to
 * `codeUri`, and the contract accepts exactly one of the two.
 *
 * Ordered so nothing irreversible happens until everything reversible has
 * succeeded: pinning is free to retry, so it all happens before a wallet is
 * asked to sign.
 */
import type { DAppClient } from "@tezos-x/octez.connect-sdk";
import { deployGenerator } from "./ops";
import { buildPendingDocument, royaltiesToBps, type RoyaltySplit } from "@provider/metadata";
import { detectParams } from "./detect";
import { schemaForRecord } from "./params";
import { recordFor } from "./libraries";
import type { DepSpec } from "./kinds";
import type { Draft } from "./draft";

export type PublishStage = "encoding" | "pinning-metadata" | "signing";

/**
 * The protocol's operation ceiling, less measured room for everything else the
 * deploy carries: metadata, royalties, the pending pointer.
 */
const MAX_INLINE_CODE_BYTES = 32_768 - 700;

/** Storage burn per byte, fixed here so a publish can quote a cost with no
 *  round trip. */
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
    /** The generator name, which is also each piece's name stem. */
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
     * The generator cover: a flat PNG captured in the studio and pinned.
     * Goes into TZIP-016 metadata, which is what an external marketplace
     * reads. `set_metadata` replaces it later; what a renderer reads to decide
     * what runs is fixed here and has no setter.
     */
    coverUri?: string;
    /** A downscaled copy of the same capture, for grids and marketplace cards. */
    coverThumbUri?: string;
    /** The seed that cover was drawn from, recorded so it can be reproduced. */
    coverSeed?: string;
    /**
     * The document's declarations as they actually resolved in this session,
     * which is also what the cover was drawn with, so the digest recorded on
     * chain names the bytes that ran. Required: an optional field here is how
     * a record that disagrees with its document gets written.
     */
    resolvedLibraries: DepSpec[];
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

export async function publishGenerator(
    client: DAppClient,
    input: PublishInput,
    onStage?: (stage: PublishStage) => void,
): Promise<PublishResult> {
    const { draft } = input;

    // First, before anything is pinned and before a wallet is asked for
    // anything. The record has no setter and a renderer must refuse to draw
    // without it, so a declaration that cannot be recorded stops here rather
    // than becoming a generator nobody can ever render.
    const record = recordFor(draft.html, input.resolvedLibraries);
    if (!record.ok) throw new Error(record.problems.join(" "));

    onStage?.("encoding");
    // The hash always covers the decoded source, so it verifies what actually
    // runs whatever encoding the bytes travelled in.
    const codeHashHex = await sha256Hex(draft.html);

    const raw = new TextEncoder().encode(draft.html);
    let codeBytes: Uint8Array<ArrayBufferLike> = raw;
    let codeEncoding: "identity" | "gzip" = "identity";

    // Identity by default, so the bytes can be read straight off the chain.
    // Compressed only when the source would not otherwise fit one operation.
    if (raw.length > MAX_INLINE_CODE_BYTES) {
        codeBytes = await gzip(raw);
        codeEncoding = "gzip";
    }

    const tooLarge = codeBytes.length > MAX_INLINE_CODE_BYTES;
    let codeUri = "";
    if (tooLarge) {
        // Past the operation cap even compressed, so it publishes as a pointer
        // and carries the dependency a smaller one does not.
        onStage?.("pinning-metadata");
        codeUri = await pin({
            kind: "source",
            content: draft.html,
            name: `${input.name || "generator"}.html`,
        });
    }

    onStage?.("pinning-metadata");
    // Every piece mints carrying this document and a provider replaces it with
    // the piece's own. The comparison against it is the provider's work queue,
    // so it has to be one stable pointer for the generator.
    const pendingMetadataUri = await pin({
        kind: "document",
        name: "pending.json",
        content: buildPendingDocument({
            generatorName: input.name,
            description: input.description,
            artist: input.artist,
            placeholderImageUri: input.placeholderImageUri ?? input.coverUri ?? "",
            split: input.split,
        }),
    });

    onStage?.("signing");
    const schema = schemaForRecord(detectParams(draft.html)?.params ?? []);

    const result = await deployGenerator(client, {
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
                // Recorded so the cover can be redrawn from chain state.
                ...(input.coverSeed ? { aleaCoverSeed: input.coverSeed } : {}),
            }),
            // Under its own key, so a mint UI reads one value and not the whole
            // record. docs/params.md §4.
            ...(schema ? { "aleatory:params": JSON.stringify(schema) } : {}),
            ...(record.libraries.length > 0
                ? { "aleatory:libraries": JSON.stringify(record.libraries) }
                : {}),
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

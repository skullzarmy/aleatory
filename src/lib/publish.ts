/**
 * Publishing a draft: encode, hash, deploy.
 *
 * The generator goes into contract storage. A typical one is well under 10KB,
 * which at 250 mutez per byte is around half a dollar of storage burn paid once
 * by the artist.
 *
 * The 32,768 byte ceiling is on an operation, not on storage. A generator past
 * it is deployed empty and then walks on chain a chunk at a time through
 * `append_code`, closing with `seal_code`. So size decides how many signatures
 * a publish costs, not whether the art lives on chain.
 *
 * `codeUri` remains for a generator that cannot be carried at all, and the
 * contract still accepts exactly one of the two.
 *
 * Ordered so nothing irreversible happens until everything reversible has
 * succeeded: pinning is free to retry, so it all happens before a wallet is
 * asked to sign.
 */
import type { DAppClient } from "@tezos-x/octez.connect-sdk";
import {
    appendCode,
    deployGenerator,
    generatorFromDeploy,
    isOurGenerator,
    readCode,
    sealCode,
} from "./ops";
import { buildPendingDocument, royaltiesToBps, type RoyaltySplit } from "@provider/metadata";
import { detectParams } from "./detect";
import { schemaForRecord } from "./params";
import { recordFor } from "./libraries";
import type { DepSpec } from "./kinds";
import { saveDraft, type Draft } from "./draft";

export type PublishStage = "encoding" | "pinning-metadata" | "signing" | "uploading" | "sealing";

/** Progress through a chunked upload, so the form can say which signature this is. */
export interface UploadProgress {
    chunk: number;
    of: number;
    bytesOnChain: number;
    totalBytes: number;
}

/**
 * The protocol's operation ceiling, less measured room for everything else the
 * deploy carries: metadata, royalties, the pending pointer.
 */
const MAX_INLINE_CODE_BYTES = 32_768 - 700;

/**
 * One chunk of a walked generator. The same ceiling applies, less room for the
 * call around the bytes, which is far smaller than a deploy's: an entrypoint
 * name, a contract address and the signature.
 */
const MAX_CHUNK_BYTES = 32_768 - 1_200;

/**
 * How many signatures a publish may ask for before the generator goes behind a
 * pointer instead. Every chunk is a separate wallet prompt, and there is a
 * count past which walking it on chain stops being a reasonable thing to ask
 * of an artist.
 */
const MAX_WALK_CHUNKS = 8;

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
    /**
     * Set when the generator was walked on chain: the chunks needed its
     * address, so by then it is known. Empty otherwise, where the deploy
     * operation is all a caller has.
     */
    generator: string;
    /** Signatures the code itself cost, beyond the deploy. Zero when inline. */
    chunks: number;
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

/**
 * Walk a generator's bytes on chain and close it.
 *
 * Safe to call again. It reads what is already there first, so an interrupted
 * publish continues from the byte it stopped at instead of starting over or
 * appending a second copy, and a generator already sealed is left alone.
 *
 * It refuses to append to bytes that are not the beginning of what it is
 * sending. Nothing can rewrite `code` once written, so appending to the wrong
 * prefix would be a generator permanently holding two halves of different
 * drafts.
 */
/**
 * How many signatures publishing this draft will ask for, decided the same way
 * the publish itself decides it. Exported so the form can say so beforehand
 * rather than keeping its own copy of these thresholds, which would drift.
 */
export async function estimateSignatures(html: string): Promise<number> {
    const raw = new TextEncoder().encode(html);
    const codeBytes = raw.length > MAX_INLINE_CODE_BYTES ? await gzip(raw) : raw;
    if (codeBytes.length <= MAX_INLINE_CODE_BYTES) return 1;
    const chunks = Math.ceil(codeBytes.length / MAX_CHUNK_BYTES);
    // Past the walk budget it goes behind a pointer, which is one deploy again.
    if (chunks > MAX_WALK_CHUNKS) return 1;
    // The deploy, a signature per chunk, and the seal.
    return 1 + chunks + 1;
}

/** Wait for the chain to hold at least `expected` bytes of code. */
async function confirmBytes(generator: string, expected: number, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3_000));
        const { hex } = await readCode(generator).catch(() => ({ hex: "" }));
        const have = hex.length / 2;
        if (have === expected) return have;
        // More than was sent means a chunk landed twice: an operation that was
        // still in flight when this resumed, applied after the offset was read.
        // `code` is append-only, so there is nothing to undo. Stopping here at
        // least leaves it unsealed, which is a generator that cannot mint
        // rather than one that mints a piece nobody can render.
        if (have > expected) {
            throw new Error(
                `${generator} holds ${have} bytes where ${expected} were sent. A chunk was applied twice and the code cannot be unwritten, so it has not been sealed. Publish again as a new generator.`,
            );
        }
    }
    throw new Error("A chunk was signed but has not been included yet. Resume to continue.");
}

export async function uploadCode(
    client: DAppClient,
    generator: string,
    codeBytes: Uint8Array,
    onProgress?: (p: UploadProgress) => void,
): Promise<{ chunks: number; sealHash: string | null }> {
    // Before the wallet is asked for anything. An address that is not a
    // generator our factory made is not one to offer an artist's code to,
    // whatever produced it.
    if (!(await isOurGenerator(generator))) {
        throw new Error(
            `${generator} was not deployed by an Aleatory factory, so nothing will be sent to it.`,
        );
    }

    const wanted = toHex(codeBytes);
    const current = await readCode(generator);

    if (current.sealed) return { chunks: 0, sealHash: null };
    if (!wanted.startsWith(current.hex)) {
        throw new Error(
            "This generator already holds bytes that are not the start of this draft. It cannot be continued from here.",
        );
    }

    const done = current.hex.length / 2;
    const remaining = codeBytes.slice(done);
    const total = Math.ceil(remaining.length / MAX_CHUNK_BYTES);

    let onChain = done;
    for (let i = 0; i < total; i++) {
        const slice = remaining.slice(i * MAX_CHUNK_BYTES, (i + 1) * MAX_CHUNK_BYTES);
        onProgress?.({
            chunk: i + 1,
            of: total,
            bytesOnChain: onChain,
            totalBytes: codeBytes.length,
        });
        await appendCode(client, generator, toHex(slice));

        // Each chunk waits to be included before the next is signed. Two
        // operations from one wallet in flight at once collide on the account
        // counter, and `code` is append-only, so a chunk that lands twice or
        // out of order cannot be taken back.
        onChain = await confirmBytes(generator, onChain + slice.length);
    }

    // Sealing is the irreversible step and, for anything walked, the contract
    // cannot check it: `seal_code` verifies the hash only for `identity`, and
    // everything large enough to be walked was gzipped on the way. So the last
    // word on whether these are the right bytes is here.
    const final = await readCode(generator);
    if (final.hex !== wanted) {
        throw new Error(
            `${generator} does not hold the bytes that were sent, so it has not been sealed. Publish again as a new generator.`,
        );
    }

    const { hash } = await sealCode(client, generator);
    return { chunks: total, sealHash: hash };
}

/**
 * Finish a generator a previous attempt left open.
 *
 * Returns null when the recorded address turns out to need nothing, which
 * covers the case where it sealed and the note outlived it, so the caller
 * carries on and deploys normally.
 */
async function resumePublish(
    client: DAppClient,
    draft: Draft,
    codeHashHex: string,
    onStage?: (stage: PublishStage) => void,
    onUpload?: (p: UploadProgress) => void,
): Promise<PublishResult | null> {
    const generator = draft.pendingUpload as string;
    const state = await readCode(generator).catch(() => null);
    if (!state || state.sealed) {
        await saveDraft({ ...draft, pendingUpload: undefined, updatedAt: Date.now() });
        return null;
    }

    // Whatever it already holds decides the encoding: the bytes on chain are
    // the start of one of these two and appending the other would splice a
    // gzip stream onto plain text.
    const raw = new TextEncoder().encode(draft.html);
    const zipped = await gzip(raw);
    const rawHex = toHex(raw);
    const zippedHex = toHex(zipped);

    let codeBytes: Uint8Array;
    let codeEncoding: "identity" | "gzip";
    if (rawHex.startsWith(state.hex)) {
        codeBytes = raw;
        codeEncoding = "identity";
    } else if (zippedHex.startsWith(state.hex)) {
        codeBytes = zipped;
        codeEncoding = "gzip";
    } else {
        throw new Error(
            "The unfinished generator on chain does not hold the start of this draft, so it cannot be finished from here.",
        );
    }

    onStage?.("uploading");
    await uploadCode(client, generator, codeBytes, onUpload);
    onStage?.("sealing");
    await saveDraft({ ...draft, pendingUpload: undefined, updatedAt: Date.now() });

    return {
        hash: "",
        generator,
        chunks: Math.ceil(codeBytes.length / MAX_CHUNK_BYTES),
        codeBytes: codeBytes.length,
        codeEncoding,
        codeHashHex,
        codeUri: "",
        pendingMetadataUri: "",
        codeBurnMutez: codeBytes.length * COST_PER_BYTE,
    };
}

export async function publishGenerator(
    client: DAppClient,
    input: PublishInput,
    onStage?: (stage: PublishStage) => void,
    onUpload?: (p: UploadProgress) => void,
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

    // A previous attempt originated a contract and stopped part way through
    // sending it. Deploying again would leave that one stranded holding half a
    // generator, so this finishes it rather than making a second.
    if (draft.pendingUpload) {
        const resumed = await resumePublish(client, draft, codeHashHex, onStage, onUpload);
        if (resumed) return resumed;
    }

    const raw = new TextEncoder().encode(draft.html);
    let codeBytes: Uint8Array<ArrayBufferLike> = raw;
    let codeEncoding: "identity" | "gzip" = "identity";

    // Identity by default, so the bytes can be read straight off the chain.
    // Compressed only when the source would not otherwise fit one operation.
    if (raw.length > MAX_INLINE_CODE_BYTES) {
        codeBytes = await gzip(raw);
        codeEncoding = "gzip";
    }

    // Three ways in, decided by size alone. Inline is one signature and the
    // bytes ride inside the deploy. Walked is a deploy carrying nothing
    // followed by a chunk per signature. A pointer is the last resort, and the
    // only one where the art is not on chain.
    const inline = codeBytes.length <= MAX_INLINE_CODE_BYTES;
    const chunks = Math.ceil(codeBytes.length / MAX_CHUNK_BYTES);
    const walked = !inline && chunks <= MAX_WALK_CHUNKS;
    const byPointer = !inline && !walked;

    let codeUri = "";
    if (byPointer) {
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
        // A walked generator is deployed holding neither its code nor a
        // pointer. The factory allows exactly that and leaves it unsealed,
        // which is what `append_code` requires and what stops it minting
        // before the last chunk lands.
        codeHex: inline ? toHex(codeBytes) : "",
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

    let generator = "";
    if (walked) {
        // The address is the protocol's to decide, so the chunks have nowhere
        // to go until the origination is visible.
        onStage?.("uploading");
        generator = await generatorFromDeploy(result.hash);

        // Written down before a single chunk is sent. Everything after this is
        // interruptible, and an address only the wallet saw is a contract
        // nobody can ever finish.
        await saveDraft({ ...draft, pendingUpload: generator, updatedAt: Date.now() });

        await uploadCode(client, generator, codeBytes, onUpload);
        onStage?.("sealing");
        await saveDraft({ ...draft, pendingUpload: undefined, updatedAt: Date.now() });
    }

    return {
        hash: result.hash,
        generator,
        codeBytes: byPointer ? 0 : codeBytes.length,
        codeEncoding,
        codeHashHex,
        codeUri,
        chunks: walked ? chunks : 0,
        pendingMetadataUri,
        codeBurnMutez: byPointer ? 0 : codeBytes.length * COST_PER_BYTE,
    };
}

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
import { COST_PER_BYTE, MAX_CHUNK_BYTES, gzip, publishPlan } from "./plan";

export type PublishStage = "encoding" | "pinning-metadata" | "signing" | "uploading" | "sealing";

/** Progress through a chunked upload, so the form can say which signature this is. */
export interface UploadProgress {
    chunk: number;
    of: number;
    bytesOnChain: number;
    totalBytes: number;
}

// The size thresholds, the encoding and the three routes live in `plan.ts`,
// which the studio also reads. They were duplicated, and the copies disagreed.

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
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
    return (await publishPlan(html)).signatures;
}

/**
 * A generator that cannot be finished and cannot be repaired.
 *
 * Separate from an ordinary failure because the draft has to stop pointing at
 * it. `code` is append-only, so there is no state this contract can be put
 * back into; leaving the draft aimed at it means every future publish resumes
 * into the same wall and the artist cannot even start again.
 */
export class UnusableGenerator extends Error {}

/**
 * Run an upload, and stop the draft pointing at the generator if it turns out
 * to be one that can never be finished.
 *
 * Only for that. A refused signature or a dropped connection leaves a
 * generator that is still exactly the beginning of this draft, and the pointer
 * is what lets the next attempt continue it instead of paying to originate a
 * second one.
 */
async function release<T>(draft: Draft, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        if (e instanceof UnusableGenerator) {
            await saveDraft({ ...draft, pendingUpload: undefined, updatedAt: Date.now() });
        }
        throw e;
    }
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
            throw new UnusableGenerator(
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
        // The offset this chunk must land at. The contract refuses it if that
        // is not what it holds, which is what a retry needs it to do.
        await appendCode(client, generator, toHex(slice), onChain);

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
        throw new UnusableGenerator(
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
        await saveDraft({ ...draft, pendingUpload: undefined, updatedAt: Date.now() });
        throw new UnusableGenerator(
            "The unfinished generator on chain does not hold the start of this draft, so it cannot be finished from here. It has been let go, and publishing again will deploy a new one.",
        );
    }

    onStage?.("uploading");
    await release(draft, () => uploadCode(client, generator, codeBytes, onUpload));
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

    // Three ways in, decided by size alone, and decided in one place: the
    // studio quotes the same plan before any of this is asked for.
    const plan = await publishPlan(draft.html);
    const codeBytes = plan.code;
    const codeEncoding = plan.codeEncoding;
    const inline = plan.route === "inline";
    const walked = plan.route === "walked";
    const byPointer = plan.route === "pointer";
    const chunks = plan.chunks;

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

        await release(draft, () => uploadCode(client, generator, codeBytes, onUpload));
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

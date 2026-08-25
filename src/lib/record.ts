/**
 * Aleatory, the generator record.
 *
 * The versioned, typed structure described in docs/aleatory/architecture.md §3,
 * as it is written into contract storage. Three independent version axes:
 *
 *   schema_version    how to parse this record          (we add fields)
 *   runtime.kind_id   what kind of code this is         (artist picks)
 *   standard_version  which lifecycle the code targets  (we revise the harness)
 *
 * Conflating them is the mistake that forces migrations later. A p5 1.5.0
 * project on standard v1 stays exactly that forever, whatever the registry is
 * doing by then.
 */
import { blake2bHex } from "blakejs";
import { type ParamSpec, type ParamsSchema, PARAMS_RESOLUTION, schemaForRecord } from "./params";
import { STANDARD_VERSION } from "./runtime";
import type { ResolvedDep, StorageClassId } from "./runtimes";

/** Bumped only additively, readers ignore unknown trailing optional fields. */
export const SCHEMA_VERSION = 1;

export interface CodeRef {
    /** blake2b-256 of the exact bytes, hex. */
    hash: string;
    bytes: number;
    /** Where the bytes live. v0 publishes code on chain; deps come from the manifest. */
    location: "on-chain" | "manifest" | "pinned";
    /** Storage key (on-chain) or URL (manifest/pinned). */
    ref: string;
}

export interface CaptureSpec {
    /** v0 has one mode: the piece signals its own capture point. */
    mode: "signal";
    timeout_ms: number;
    viewport: { width: number; height: number };
    pixel_ratio: number;
}

export interface SeedPolicy {
    kind: "op-hash" | "commit-reveal";
    version: number;
    /** The exact preimage, so anyone can recompute a seed without our code. */
    formula: string;
}

export interface GeneratorRecord {
    schema_version: number;
    artist: string;
    published_at: string;

    title: string;
    description: string;

    runtime: { kind_id: number; kind_name: string; kind_version: string };
    standard_version: number;

    code: CodeRef;
    deps: CodeRef[];
    storage_class: StorageClassId;

    seed_policy: SeedPolicy;
    /**
     * The mint-time parameters this generator declares, or null when it declares
     * none, which is the common case and stays one unambiguous shape.
     *
     * Immutable with the rest of the record, and deliberately readable on its
     * own: another platform builds a mint UI for this generator from this field
     * plus `params_resolution`, without our front end and without executing the
     * artwork. See docs/aleatory/params.md.
     */
    params_schema: ParamsSchema | null;
    /** The exact rule for turning raw input into the values a piece sees. Stated
     *  in the record rather than only in a doc, so a reader is never guessing. */
    params_resolution?: string;
    capture: CaptureSpec;

    edition: number;
    royalties_bps: number;
    /**
     * The seed the artist pinned as the collection's cover. Stored so the cover
     * can be regenerated from chain state by anyone, the thumbnail image in the
     * contract metadata is a cache of this, not the source of it.
     */
    cover_seed: string;
}

export const OP_HASH_SEED_FORMULA = "blake2b_256(utf8(op_hash + ':' + token_id + ':' + contract_address))";

/**
 * Policy A. The operation hash is chain state, an indexer reads it, anyone
 * recomputes it, nobody is trusted, it simply isn't readable inside Michelson,
 * so the binding happens here rather than in contract storage.
 *
 * Known limitation, stated in the docs and not hidden: the op hash is
 * computable before submission, so a determined minter can grind for a seed.
 * Commit-reveal (Policy B) is the answer for projects that care; it is v1 work.
 */
export function deriveSeed(opHash: string, tokenId: number, contract: string): string {
    const preimage = new TextEncoder().encode(`${opHash}:${tokenId}:${contract}`);
    return blake2bHex(preimage, undefined, 32);
}

export function hashBytes(text: string): { hash: string; bytes: number } {
    const bytes = new TextEncoder().encode(text);
    return { hash: blake2bHex(bytes, undefined, 32), bytes: bytes.length };
}

/**
 * Class is derived, never chosen, and it is displayed on the piece rather than
 * enforced. An artist may publish anything; a collector always sees what the
 * work depends on.
 */
export function storageClassOf(deps: ResolvedDep[], codeOnChain: boolean): StorageClassId {
    if (!codeOnChain) return "ipfs";
    return deps.length === 0 ? "foc" : "shared";
}

export const STORAGE_CLASS_LABEL: Record<StorageClassId, { name: string; blurb: string }> = {
    foc: {
        name: "fully on-chain",
        blurb: "Your code and everything it needs are stored in the contract. The piece renders from Tezos alone, no IPFS, no server, nothing to keep paying for.",
    },
    shared: {
        name: "on-chain + shared library",
        blurb:
            "Your code is stored in the contract; the library it uses is referenced by hash. In v0 that library is fetched from a CDN, " +
            "so a piece like this is not fully on-chain yet, the shared library contract is v1 work.",
    },
    ipfs: {
        name: "IPFS",
        blurb: "Your code or assets live on IPFS with the hash recorded on chain. The piece stays available for as long as someone keeps it pinned.",
    },
};

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export interface ChainConstants {
    /** mutez burned per byte of storage. */
    costPerByte: number;
    /** Bytes a single operation may carry. */
    maxOperationBytes: number;
    /** Storage charged for the origination itself. */
    originationSize: number;
    /** False when the RPC could not be read and defaults are in use. */
    live: boolean;
}

/** Protocol defaults, only used when the RPC is unreachable, and labelled as such. */
const FALLBACK: ChainConstants = {
    costPerByte: 250,
    maxOperationBytes: 32_768,
    originationSize: 257,
    live: false,
};

/**
 * Read the constants from the chain rather than hardcoding them. Storage cost
 * and operation limits are protocol values that have changed before and will
 * change again, an estimator that lies is worse than no estimator.
 */
export async function fetchConstants(rpcUrl: string): Promise<ChainConstants> {
    try {
        const res = await fetch(`${rpcUrl}/chains/main/blocks/head/context/constants`);
        if (!res.ok) return FALLBACK;
        const raw = (await res.json()) as Record<string, unknown>;
        const num = (v: unknown, fallback: number): number => {
            const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
            return Number.isFinite(n) && n > 0 ? n : fallback;
        };
        return {
            costPerByte: num(raw.cost_per_byte, FALLBACK.costPerByte),
            maxOperationBytes: num(raw.max_operation_data_length, FALLBACK.maxOperationBytes),
            originationSize: num(raw.origination_size, FALLBACK.originationSize),
            live: true,
        };
    } catch {
        return FALLBACK;
    }
}

export interface CostBreakdown {
    codeBytes: number;
    recordBytes: number;
    depBytesOnChain: number;
    totalBytes: number;
    /** Storage burn in mutez, including the origination itself. */
    burnMutez: number;
    burnTez: number;
    /** How many operations the payload has to be split across. */
    operations: number;
    /** True when a single payload exceeds what one operation can carry. */
    needsChunking: boolean;
}

export function estimateCost(codeBytes: number, recordBytes: number, depBytesOnChain: number, constants: ChainConstants): CostBreakdown {
    const totalBytes = codeBytes + recordBytes + depBytesOnChain;
    // Storage burn is charged on the raw bytes...
    const burnMutez = (totalBytes + constants.originationSize) * constants.costPerByte;
    // ...but the operation carries them hex-encoded in a Michelson literal, so
    // the wire payload is twice the size. ~85% of the limit is usable once the
    // script, signature and headers are accounted for. Deliberately conservative.
    const wireBytes = totalBytes * 2;
    const perOp = Math.floor(constants.maxOperationBytes * 0.85);
    return {
        codeBytes,
        recordBytes,
        depBytesOnChain,
        totalBytes,
        burnMutez,
        burnTez: burnMutez / 1_000_000,
        operations: Math.max(1, Math.ceil(wireBytes / perOp)),
        needsChunking: wireBytes > perOp,
    };
}

export function formatTez(tez: number): string {
    if (tez >= 100) return `${tez.toFixed(0)} ꜩ`;
    if (tez >= 1) return `${tez.toFixed(2)} ꜩ`;
    return `${tez.toFixed(4)} ꜩ`;
}

export function formatBytes(bytes: number): string {
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
    if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
    return `${bytes} B`;
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

/**
 * Downscale a capture into a thumbnail for token metadata.
 *
 * Previews are a convenience, never a source of truth, the piece is the code
 * and the seed, and anyone can regenerate the image from the capture recipe.
 * They still cost real storage, so they are small on purpose and the cost is
 * shown before anyone signs.
 */
export function makeThumbnail(dataUrl: string, size = 320, quality = 0.82): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const scale = Math.min(size / img.width, size / img.height, 1);
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                reject(new Error("Could not create a thumbnail canvas."));
                return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => reject(new Error("Capture could not be decoded for a thumbnail."));
        img.src = dataUrl;
    });
}

// ---------------------------------------------------------------------------
// Record assembly
// ---------------------------------------------------------------------------

export interface BuildRecordInput {
    artist: string;
    title: string;
    description: string;
    kindId: number;
    kindName: string;
    kindVersion: string;
    code: { hash: string; bytes: number };
    deps: ResolvedDep[];
    edition: number;
    royaltiesBps: number;
    captureTimeoutMs: number;
    viewport: { width: number; height: number };
    coverSeed: string;
    /** Declared mint-time parameters. Empty is normal, params are optional. */
    paramSpecs?: ParamSpec[];
}

export function buildRecord(input: BuildRecordInput): GeneratorRecord {
    return {
        schema_version: SCHEMA_VERSION,
        artist: input.artist,
        published_at: new Date().toISOString(),
        title: input.title,
        description: input.description,
        runtime: {
            kind_id: input.kindId,
            kind_name: input.kindName,
            kind_version: input.kindVersion,
        },
        standard_version: STANDARD_VERSION,
        code: {
            hash: input.code.hash,
            bytes: input.code.bytes,
            location: "on-chain",
            ref: "aleatory:code",
        },
        deps: input.deps.map((d) => ({
            hash: d.hash,
            bytes: d.bytes,
            // v0 resolves shared libraries from the manifest and records the hash of
            // exactly what it resolved. v1 serves the same bytes from the Deps
            // contract by that hash; the record shape does not change.
            location: "manifest" as const,
            ref: `${d.spec.id}@${d.spec.version}`,
        })),
        storage_class: storageClassOf(input.deps, true),
        seed_policy: { kind: "op-hash", version: 1, formula: OP_HASH_SEED_FORMULA },
        params_schema: schemaForRecord(input.paramSpecs ?? []),
        params_resolution: PARAMS_RESOLUTION,
        capture: {
            mode: "signal",
            timeout_ms: input.captureTimeoutMs,
            viewport: input.viewport,
            pixel_ratio: 2,
        },
        edition: input.edition,
        royalties_bps: input.royaltiesBps,
        cover_seed: input.coverSeed,
    };
}

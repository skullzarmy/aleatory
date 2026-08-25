/**
 * Aleatory, the runtime kinds catalogue.
 *
 * This is the v0 mirror of what becomes the on-chain **Runtimes** contract
 * (docs/aleatory/architecture.md §3). Kinds live in an append-only catalogue
 * rather than an enum precisely so that adding a runtime in 2029 is one append
 * operation instead of a registry migration, and the v0 shape is deliberately
 * identical to the on-chain record so the swap is a data-source change.
 *
 * A kind is never edited. A better harness for a kind is a NEW kind_id, and
 * existing generators keep pointing at the old one, forever.
 */

/**
 * How a piece is stored, in the words the Tezos art community already uses.
 *
 *   foc    fully on-chain, code and everything it needs live in contract storage
 *   shared on-chain code, plus a shared library referenced by hash
 *   ipfs   code or assets off-chain, content hash recorded on chain
 *
 * Displayed on every piece. Not a ranking and not a gate, a collector should
 * be able to see what a work depends on before they buy it.
 */
export type StorageClassId = "foc" | "shared" | "ipfs";

export interface DepSpec {
    /** Stable id, recorded in the generator record. */
    id: string;
    label: string;
    /** Pinned version, a generator records this, never "latest". */
    version: string;
    /**
     * v0 resolves dependency source from this URL and records the blake2b of
     * what it fetched. v1 resolves the same bytes from the on-chain Deps
     * contract by hash; the artist-facing behaviour does not change.
     */
    url: string;
    /** Approximate size, for the cost estimate before anything is fetched. */
    approxBytes: number;
}

export interface RuntimeKind {
    /** Matches the on-chain kind_id. Append-only: never reuse, never renumber. */
    kindId: number;
    name: string;
    label: string;
    /** The pinned dialect/library version recorded with a generator. */
    kindVersion: string;
    /** Human statement of the lifecycle contract this kind expects. */
    entrySpec: string;
    /** Libraries this kind needs resolved before boot. */
    deps: DepSpec[];
    /** Shown in the picker. */
    blurb: string;
}

export const P5_DEP: DepSpec = {
    id: "p5",
    label: "p5.js",
    version: "1.5.0",
    url: "https://cdn.jsdelivr.net/npm/p5@1.5.0/lib/p5.min.js",
    approxBytes: 1_050_000,
};

export const RUNTIME_KINDS: RuntimeKind[] = [
    {
        kindId: 1,
        name: "vanilla",
        label: "Canvas 2D",
        kindVersion: "1",
        entrySpec: "Script runs on load; draws to a <canvas>; calls $alea.ready() at the capture point.",
        deps: [],
        blurb: "No dependencies. Fully on-chain.",
    },
    {
        kindId: 2,
        name: "svg",
        label: "SVG",
        kindVersion: "1",
        entrySpec: "Script builds an <svg> in the document; calls $alea.ready() when complete.",
        deps: [],
        blurb: "No dependencies, and the output is text. Fully on-chain.",
    },
    {
        kindId: 3,
        name: "p5",
        label: "p5.js",
        kindVersion: "1.5.0",
        entrySpec: "Standard p5 sketch (setup/draw). Call $alea.ready() (or fxpreview()) at the capture point.",
        deps: [P5_DEP],
        blurb: "p5 is shared: referenced by hash, not bundled into your piece.",
    },
    {
        kindId: 4,
        name: "custom",
        label: "Custom",
        kindVersion: "1",
        entrySpec:
            "Export window.ALEA_MAIN = { boot(ctx), render(ctx), features()?, resize(w,h)? } and call ctx.ready() at the capture point.",
        deps: [],
        blurb: "Any engine. Implement the lifecycle entry points.",
    },
];

export function getKind(kindId: number): RuntimeKind {
    return RUNTIME_KINDS.find((k) => k.kindId === kindId) ?? RUNTIME_KINDS[0];
}

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

export interface ResolvedDep {
    spec: DepSpec;
    source: string;
    bytes: number;
    /** blake2b-256 of the fetched source, hex. What v1 stores on chain. */
    hash: string;
}

const cache = new Map<string, ResolvedDep>();

/**
 * Fetch and hash a dependency. This happens in the LAB page, never in the
 * sandbox frame, by the time a piece runs, its libraries are already inlined
 * text and the frame has no network at all.
 */
export async function resolveDep(spec: DepSpec): Promise<ResolvedDep> {
    const cached = cache.get(spec.id + "@" + spec.version);
    if (cached) return cached;

    const res = await fetch(spec.url);
    if (!res.ok) throw new Error(`${spec.label} ${spec.version} could not be resolved (${res.status}).`);
    const source = await res.text();

    const { blake2bHex } = await import("blakejs");
    const bytes = new TextEncoder().encode(source);
    const resolved: ResolvedDep = {
        spec,
        source,
        bytes: bytes.length,
        hash: blake2bHex(bytes, undefined, 32),
    };
    cache.set(spec.id + "@" + spec.version, resolved);
    return resolved;
}

export async function resolveDeps(specs: DepSpec[]): Promise<ResolvedDep[]> {
    const out: ResolvedDep[] = [];
    for (const spec of specs) out.push(await resolveDep(spec));
    return out;
}

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
 * Where a piece's bytes live.
 *
 *   foc   in contract storage
 *   ipfs  on IPFS, content hash recorded on chain
 *
 * Only two, because a generator is always the whole piece. There was a third,
 * "shared", for code on chain that referenced a library resolved at render
 * time. That was never a storage class, it was a piece with a hole in it, and
 * the hole was filled by this website being in the room.
 *
 * Displayed on every piece. Not a ranking and not a gate: a collector should be
 * able to see where a work is kept before they buy it.
 */
export type StorageClassId = "foc" | "ipfs";

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
    /**
     * blake2b-256 the fetched bytes have to match, hex.
     *
     * Empty means unpinned, which is a state to leave before mainnet: an
     * unpinned dependency puts a third party in the position of deciding what
     * gets written on chain.
     */
    expectedHash?: string;
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

/**
 * Known-good digest of p5 1.5.0.
 *
 * `resolveDep` hashes whatever the CDN returns and that hash goes on chain
 * immutably, so without a value to compare against, a compromised or
 * republished CDN would be recorded as canonical with the chain vouching for
 * it. Verify before trusting: the value below has to be confirmed against a
 * known-good copy before any mainnet publish.
 */
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
        entrySpec: "Standard p5 sketch (setup/draw). Call $alea.ready() at the capture point.",
        deps: [P5_DEP],
        blurb: "p5 is bundled into your piece. Larger, and it renders anywhere.",
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
 * Fetch and hash a dependency, refusing anything that does not match what we
 * expect.
 *
 * The hash computed here is written into the generator record and goes on
 * chain immutably. Without a value to compare against, a CDN that was
 * compromised, intercepted, or that republished the version would have its
 * bytes inlined into an artist's document, executed in every viewer's
 * browser, and recorded on chain as canonical with the chain vouching for it.
 *
 * Resolution happens in the studio, never in a sandboxed frame: by the time a
 * piece runs, its libraries are inlined text and the frame has no network.
 */
export async function resolveDep(spec: DepSpec): Promise<ResolvedDep> {
    const key = spec.id + "@" + spec.version;
    const cached = cache.get(key);
    if (cached) return cached;

    // In a browser this goes through our own origin (`/api/dep`), so the app's
    // `connect-src` stays `'self'` and the digest is verified somewhere the
    // page cannot skip. A hash check that runs in the page is a hash check a
    // compromised page removes. Off the browser, in a script or a test, the
    // CDN is fetched directly and verified here.
    if (typeof window !== "undefined") {
        const res = await fetch(
            `/api/dep?id=${encodeURIComponent(spec.id)}&version=${encodeURIComponent(spec.version)}`,
        );
        const json = (await res.json().catch(() => ({}))) as {
            source?: string;
            hash?: string;
            bytes?: number;
            error?: string;
        };
        if (!res.ok || typeof json.source !== "string") {
            throw new Error(json.error || `${spec.label} ${spec.version} could not be resolved.`);
        }
        const resolved: ResolvedDep = {
            spec,
            source: json.source,
            bytes: json.bytes ?? new TextEncoder().encode(json.source).length,
            hash: json.hash ?? "",
        };
        cache.set(key, resolved);
        return resolved;
    }

    const res = await fetch(spec.url);
    if (!res.ok) throw new Error(`${spec.label} ${spec.version} could not be resolved (${res.status}).`);
    const source = await res.text();

    // blakejs is CommonJS. A bundler gives the named export; plain Node hands
    // back a namespace with everything under `default`, and destructuring it
    // there yields undefined rather than an import error, so it fails at the
    // call. Take whichever is actually there.
    const blake = (await import("blakejs")) as unknown as {
        blake2bHex?: typeof import("blakejs").blake2bHex;
        default?: { blake2bHex: typeof import("blakejs").blake2bHex };
    };
    const blake2bHex = blake.blake2bHex ?? blake.default?.blake2bHex;
    if (!blake2bHex) throw new Error("blakejs did not load.");

    const bytes = new TextEncoder().encode(source);
    const hash = blake2bHex(bytes, undefined, 32);

    if (spec.expectedHash && hash !== spec.expectedHash) {
        throw new Error(
            `${spec.label} ${spec.version} does not match its pinned hash. ` +
                `Expected ${spec.expectedHash}, got ${hash}. Refusing to use it.`,
        );
    }

    const resolved: ResolvedDep = { spec, source, bytes: bytes.length, hash };
    cache.set(key, resolved);
    return resolved;
}

/**
 * Record the digest of a dependency that has been checked against a
 * known-good copy.
 *
 * Run once per version, by a person, comparing against the published release
 * rather than against whatever the CDN happens to be serving.
 */
export async function pinDep(spec: DepSpec): Promise<string> {
    const res = await fetch(spec.url);
    const source = await res.text();
    const { blake2bHex } = await import("blakejs");
    return blake2bHex(new TextEncoder().encode(source), undefined, 32);
}

export async function resolveDeps(specs: DepSpec[]): Promise<ResolvedDep[]> {
    const out: ResolvedDep[] = [];
    for (const spec of specs) out.push(await resolveDep(spec));
    return out;
}

/**
 * Put a kind's libraries inside the document, once, when the draft is made.
 *
 * This is the fxhash model and it is the only honest one: what gets stored is
 * everything needed to draw the piece. The studio used to fetch p5 and hand it
 * to the frame at render time, so a p5 collection minted tokens whose stored
 * code was a sketch with no p5 in it. It drew here because we were injecting
 * the missing half on the way past, and it would have drawn nowhere else, ever,
 * the moment this site stopped doing that.
 *
 * Inlined ahead of the artist's own scripts, because a sketch that runs before
 * its library is a sketch that throws.
 */
export async function inlineDeps(html: string, kindId: number): Promise<string> {
    const specs = getKind(kindId).deps;
    if (specs.length === 0) return html;

    const resolved = await resolveDeps(specs);
    const blocks = resolved
        .map(
            (r) =>
                `<!-- ${r.spec.label} ${r.spec.version}, bundled with this piece. ` +
                `sha ${r.hash.slice(0, 16)} -->\n<script>${r.source}</script>`,
        )
        .join("\n");

    // Straight after <head>, or at the top if the document has no head. Never
    // appended: order is the whole point.
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => `${m}\n${blocks}`);
    }
    if (/<body[^>]*>/i.test(html)) {
        return html.replace(/<body[^>]*>/i, (m) => `${m}\n${blocks}`);
    }
    return `${blocks}\n${html}`;
}

/**
 * The render provider.
 *
 * Finds pieces waiting for their metadata, renders them, pins them, and
 * publishes. Everything privileged lives here: the pinning key, the agent key
 * that signs, and the work queue. The render worker holds none of it.
 *
 * Two ways work arrives, and the chain is the one that counts:
 *
 *   1. The cron, every five minutes. This works with no cooperation from
 *      anyone and survives our own UI being down.
 *   2. A ping from the mint UI, which turns a polling interval into a couple
 *      of seconds. The ping carries a shared secret.
 *
 * Everything a candidate collection asserts about itself is checked against
 * its own storage before any of it is used. An event payload is written by
 * the contract that emits it, so it can say anything, and it is treated as a
 * hint about where to look rather than as evidence.
 */
import type { Config, Context } from "@netlify/functions";
import { TezosToolkit } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";
import { getStore } from "@netlify/blobs";

const TZKT = process.env.TZKT_API || "https://api.shadownet.tzkt.io";
const RPC = process.env.TEZOS_RPC || "https://rpc.tzkt.io/shadownet";
const PROVIDER_ADDRESS = process.env.ALEA_PROVIDER_ADDRESS || "";
const AGENT_SK = process.env.ALEA_AGENT_SK || "";
import { render as renderPiece, renderConfigFromEnv } from "./lib/render.mts";
import { buildPieceDocument } from "../../src/lib/metadata";
import {
    parseLibraries,
    resolveLibraries,
    type DeclaredLibrary,
} from "./lib/libraries.mts";
const PINATA_JWT = process.env.PINATA_JWT || "";

const KT1 = /^KT1[1-9A-HJ-NP-Za-km-z]{33}$/;

function addressList(value: string | undefined): string[] {
    return (value || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => KT1.test(s));
}

/** Overrides the router, for testing against a factory it does not list. */
const FACTORY_OVERRIDE = addressList(
    process.env.ALEA_FACTORIES || process.env.ALEA_FACTORY_ADDRESS,
);

const ROUTER = (process.env.ALEA_ROUTER_ADDRESS ||
    process.env.NEXT_PUBLIC_ROUTER_ADDRESS ||
    "").trim();

let factoryCache: { at: number; addresses: string[] } | null = null;

/**
 * Factories whose collections this provider will look at.
 *
 * From the router, which is what the router is for: it holds the current
 * factory and every retired one, so a collection deployed by an old factory
 * keeps being served rather than quietly going unrendered forever.
 *
 * This used to be an environment variable with no fallback. An operator who
 * set one factory served that factory's collections and silently ignored the
 * rest, which is exactly what happened here: three collections sat unrendered
 * because the list was written before the other factories existed and nobody
 * updates a list they cannot see is wrong.
 *
 * Storage is still the authority afterwards. This only decides where to look,
 * and a collection is served because its own storage names this provider.
 */
export async function collectionsFactories(): Promise<string[]> {
    if (FACTORY_OVERRIDE.length > 0) return FACTORY_OVERRIDE;
    if (!ROUTER) return [];

    // Rarely changes, and a scan every fifteen seconds should not re-read it.
    if (factoryCache && Date.now() - factoryCache.at < 300_000) {
        return factoryCache.addresses;
    }

    const storage = await tzkt<{ factories?: string[] }>(
        `/v1/contracts/${ROUTER}/storage`,
    ).catch(() => null);

    // Deduplicated: the router prepends, so re-registering a factory leaves it
    // in the list twice and it would be scanned twice.
    const addresses = [...new Set(addressList((storage?.factories ?? []).join(",")))];
    if (addresses.length > 0) factoryCache = { at: Date.now(), addresses };
    return addresses;
}
const PING_TOKEN = process.env.ALEA_PROVIDER_PING_TOKEN || "";
const IPFS_GATEWAY = process.env.ALEA_IPFS_GATEWAY || "https://ipfs.fileship.xyz";

/**
 * Collections this provider declines to render for.
 *
 * A provider serves anything that names it and pays render gas, which is the
 * arrangement the interface describes. This list is one operator saying no,
 * and it changes nothing for anyone else: the collection keeps working, and
 * another provider can pick it up.
 */
const BLOCKED_COLLECTIONS = new Set(
    (process.env.ALEA_BLOCKED_COLLECTIONS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
);

/** How many pieces one invocation will take on. */
const BATCH = 5;

/** Generators larger than this are refused rather than rendered. */
const MAX_GENERATOR_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/** How long a claim is held before another invocation may retry a piece. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

const ADDRESS = /^(tz[123]|KT1)[A-Za-z0-9]{33}$/;
const CID = /^[A-Za-z0-9]{46,64}$/;

interface PendingPiece {
    collection: string;
    tokenId: string;
    /** The buy operation hash. This is the seed. */
    seed: string;
    params: string;
    /** The generator source, out of contract storage. */
    code: string;
    codeUri: string;
    /** Libraries the collection says its generator expects to be loaded. */
    libraries: DeclaredLibrary[];
    artist: string;
    /** For the document. A piece is "<collection> #<n>", never a bare number. */
    collectionName: string;
    description: string;
    /** Address to basis points, straight from the collection's storage. */
    royalties: Record<string, number>;
    codeHash: string;
}

/* ------------------------------------------------------------------ */
/* Reading the chain                                                   */
/* ------------------------------------------------------------------ */

async function tzkt<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${TZKT}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`TzKT ${res.status} ${path}`);
    return (await res.json()) as T;
}

function requireAddress(a: string, what: string): string {
    if (!ADDRESS.test(a)) throw new Error(`${what} is not an address`);
    return a;
}

function hexToUtf8(hex: string): string {
    const clean = hex.replace(/^0x/, "");
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
        throw new Error("not hex");
    }
    const bytes = clean.match(/.{2}/g) || [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

interface CollectionStorage {
    administrator: string;
    art: {
        code: string;
        code_encoding: string;
        code_uri: string;
        code_hash: string;
        pending_metadata: string;
        /** Address to basis points. Published in the document, per TZIP-21. */
        royalties: Record<string, string | number>;
    };
    render: { provider: string };
}

/**
 * Collections this provider actually serves.
 *
 * Candidates come from two places: contracts a trusted factory originated,
 * and `set_provider` events naming us. Both are only hints. Every candidate
 * is then confirmed against its own storage, because a contract's event
 * payload is written by that contract and can claim anything.
 */
export async function collectionsServed(): Promise<string[]> {
    const candidates = new Set<string>();

    // Two ways in, because neither alone finds every collection.
    //
    // A collection deployed by a factory names its provider in its *initial
    // storage* and never emits `set_provider`, so an event scan alone never
    // sees a new collection at all: it would sit unrendered until its artist
    // happened to switch provider. Everything a factory originated is the
    // other half.
    for (const factory of await collectionsFactories()) {
        const originated = await tzkt<{ address: string }[]>("/v1/contracts", {
            creator: factory,
            limit: 500,
            select: "address",
        }).catch(() => []);
        for (const row of originated) {
            const addr = typeof row === "string" ? row : row.address;
            if (addr && ADDRESS.test(addr)) candidates.add(addr);
        }
    }

    // And a collection that switched *to* us after deploy, which a factory
    // scan would miss if it came from a factory we do not watch.
    const events = await tzkt<{ contract: { address: string } }[]>("/v1/contracts/events", {
        tag: "set_provider",
        "sort.desc": "id",
        limit: 1000,
    }).catch(() => []);
    for (const e of events) {
        const addr = e.contract?.address;
        if (addr && ADDRESS.test(addr)) candidates.add(addr);
    }

    // Storage is the authority, and it is the only check that matters here.
    // An event payload is written by the contract that emits it, so a
    // contract can claim anything; its storage is what actually points work
    // at us. A collection that no longer names us has switched away, and its
    // old event is still in the stream.
    const served: string[] = [];
    for (const address of candidates) {
        if (BLOCKED_COLLECTIONS.has(address)) continue;
        const storage = await tzkt<CollectionStorage>(`/v1/contracts/${address}/storage`).catch(
            () => null,
        );
        if (storage?.render?.provider === PROVIDER_ADDRESS) served.push(address);
    }
    return served;
}

/**
 * Pieces still carrying their collection's pending document.
 *
 * That one comparison is the whole work queue: new buys, pieces missed while
 * this was down, and pieces inherited from a provider an artist switched away
 * from.
 */
/** Name and description from the collection's own TZIP-16 document. */
async function collectionFacts(
    collection: string,
): Promise<{ name: string; description: string }> {
    const raw = await metadataKey(collection, "content").catch(() => undefined);
    if (!raw) return { name: "", description: "" };
    try {
        const doc = JSON.parse(raw) as { name?: string; description?: string };
        return { name: doc.name ?? "", description: doc.description ?? "" };
    } catch {
        return { name: "", description: "" };
    }
}

function royaltiesOf(storage: CollectionStorage): Record<string, number> {
    return Object.fromEntries(
        Object.entries(storage.art.royalties ?? {}).map(([a, bps]) => [a, Number(bps)]),
    );
}

/** One key out of a collection's metadata big_map, decoded. */
async function metadataKey(collection: string, key: string): Promise<string | undefined> {
    const row = await tzkt<{ value?: string } | null>(
        `/v1/contracts/${collection}/bigmaps/metadata/keys/${encodeURIComponent(key)}`,
    ).catch(() => null);
    const value = row?.value;
    return value ? hexToUtf8(value) : undefined;
}

export async function pendingIn(collection: string): Promise<PendingPiece[]> {
    const storage = await tzkt<CollectionStorage>(`/v1/contracts/${collection}/storage`);
    const pendingUri = hexToUtf8(storage.art.pending_metadata);
    // `code_uri` is sp.string on chain, not sp.bytes. Decoding it as hex threw
    // "not hex" on every collection published by pointer, so the scan died
    // before it reached a single piece and an IPFS-stored generator could
    // never be rendered at all.
    const codeUri = storage.art.code_uri ?? "";
    requireAddress(storage.administrator, "administrator");

    // The generator is in storage. Nothing is fetched, so there is no gateway
    // to be lied to by and no URL to be pointed at something else.
    let code = "";
    if (storage.art.code) {
        code = await decodeCode(storage.art.code, storage.art.code_encoding ?? "identity");
    } else if (codeUri.startsWith("ipfs://") && CID.test(codeUri.slice(7).split(/[/?#]/)[0])) {
        // Only for a generator too large to carry on chain. A pointer is
        // written by whoever deployed the collection and anyone can deploy
        // one, so it is IPFS only and a CID shape only.
        code = await fetchGenerator(codeUri);
    }
    if (!code) return [];

    // What the collection says its generator needs loaded. Read from the
    // collection's own metadata rather than inferred from anything here: a
    // provider is not required to know what a "p5 collection" is, only how to
    // resolve what it was told.
    const libraries = parseLibraries(
        await metadataKey(collection, "aleatory:libraries").catch(() => undefined),
    );
    const facts = await collectionFacts(collection);
    const royalties = royaltiesOf(storage);

    const waiting: PendingPiece[] = [];
    let offset = 0;

    // Paginated, because a collection past one page of tokens would otherwise
    // have pieces that never reveal and never report why.
    for (;;) {
        const tokens = await tzkt<{ tokenId: string }[]>("/v1/tokens", {
            contract: collection,
            limit: 200,
            offset,
            "sort.asc": "tokenId",
            select: "tokenId",
        });
        if (tokens.length === 0) break;

        for (const t of tokens) {
            const tokenId = typeof t === "string" ? t : t.tokenId;
            if (await tokenMetadataUri(collection, tokenId) !== pendingUri) continue;

            const buy = await buyEvent(collection, tokenId);
            if (!buy) continue;

            waiting.push({
                collection,
                tokenId,
                seed: buy.hash,
                params: buy.params,
                code,
                codeUri,
                libraries,
                artist: storage.administrator,
                collectionName: facts.name,
                description: facts.description,
                royalties,
                codeHash: storage.art.code_hash ?? "",
            });
            if (waiting.length >= BATCH) return waiting;
        }

        offset += tokens.length;
        if (tokens.length < 200) break;
    }
    return waiting;
}

async function tokenMetadataUri(contract: string, tokenId: string): Promise<string> {
    const rows = await tzkt<{ value: { token_info: Record<string, string> } }[]>(
        `/v1/contracts/${contract}/bigmaps/token_metadata/keys`,
        { key: tokenId, limit: 1 },
    ).catch(() => []);
    const raw = rows[0]?.value?.token_info?.[""] ?? "";
    if (!raw) return "";
    try {
        return hexToUtf8(raw);
    } catch {
        return "";
    }
}

/** The buy that minted a piece: its hash is the seed, its payload the params. */
async function buyEvent(
    contract: string,
    tokenId: string,
): Promise<{ hash: string; params: string } | null> {
    const events = await tzkt<
        { payload: { token_id: string; params: string }; transactionId: number }[]
    >("/v1/contracts/events", {
        contract,
        tag: "mint",
        "payload.token_id": tokenId,
        limit: 1,
    }).catch(() => []);

    const match = events[0];
    if (!match) return null;

    const ops = await tzkt<string[]>("/v1/operations/transactions", {
        id: match.transactionId,
        limit: 1,
        select: "hash",
    }).catch(() => []);
    if (!ops[0]) return null;

    let params = "";
    try {
        params = match.payload?.params ? hexToUtf8(match.payload.params) : "";
    } catch {
        params = "";
    }
    return { hash: ops[0], params };
}

/* ------------------------------------------------------------------ */
/* Doing the work                                                      */
/* ------------------------------------------------------------------ */

/** Fetch a generator, with a ceiling and a clock on it. */
async function fetchGenerator(codeUri: string): Promise<string> {
    const cid = codeUri.slice(7).split(/[/?#]/)[0];
    const res = await fetch(`${IPFS_GATEWAY}/${cid}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`generator ${res.status}`);

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_GENERATOR_BYTES) throw new Error("generator too large");

    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_GENERATOR_BYTES) throw new Error("generator too large");
    return new TextDecoder().decode(body);
}

/**
 * Draw one piece.
 *
 * Goes to Browser Run's REST endpoint, which takes the document directly. The
 * Worker this used to call is gone: Browser Rendering became Browser Run and
 * moved off the `env.BROWSER` binding, and a REST call from here needs no
 * deploy, no `workers.dev` URL, and no secret guarding one.
 */
async function render(piece: PendingPiece): Promise<Uint8Array> {
    const config = renderConfigFromEnv();
    if (!config) throw new Error("rendering is not configured");
    // Refused rather than rendered without them. A p5 sketch drawn with no p5
    // produces a blank frame, and publishing that as the piece is worse than
    // publishing nothing: the token would carry a permanent image of an error
    // nobody was told about.
    const deps = await resolveLibraries(piece.libraries);

    return renderPiece(
        {
            code: piece.code,
            seed: piece.seed,
            params: piece.params ? (JSON.parse(piece.params) as Record<string, unknown>) : {},
            deps,
        },
        config,
    );
}

/** The generator, out of storage. `gzip` only when it would not otherwise fit. */
async function decodeCode(hex: string, encoding: string): Promise<string> {
    const clean = (hex || "").replace(/^0x/, "");
    if (!clean) return "";
    const bytes = Buffer.from(clean, "hex");
    if (encoding !== "gzip") return bytes.toString("utf8");
    const { gunzipSync } = await import("node:zlib");
    return gunzipSync(bytes).toString("utf8");
}

/**
 * Pin bytes this renderer produced.
 *
 * Only ever our own output. Accepting bytes from a caller would make this an
 * open upload endpoint, and checking someone else's image costs the same as
 * rendering it.
 */
async function pin(bytes: Uint8Array, name: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/png" }), name);
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: { authorization: `Bearer ${PINATA_JWT}` },
        body: form,
    });
    if (!res.ok) throw new Error(`pin ${res.status}`);
    return `ipfs://${((await res.json()) as { IpfsHash: string }).IpfsHash}`;
}

/**
 * Ask the public gateway for something we just pinned.
 *
 * A gateway other than the pinning service has to fetch content across the
 * IPFS network before it can serve it, and until it does it answers with
 * nothing: a piece that is finished on chain shows as unrendered, and no
 * amount of reloading fixes it because nothing is asking the gateway to go
 * look. One request is what makes it go look.
 *
 * Failures are ignored. This is a warm-up, and the page it helps is not
 * waiting on it.
 */
async function warmGateway(uri: string): Promise<void> {
    const cid = uri.replace(/^ipfs:\/\//, "").split(/[/?#]/)[0];
    if (!cid) return;
    const base = (process.env.ALEA_IPFS_GATEWAY || "https://ipfs.fileship.xyz").replace(/\/+$/, "");
    await fetch(`${base}/${cid}`, { signal: AbortSignal.timeout(20_000) }).catch(() => {});
}

async function pinJson(doc: unknown, name: string): Promise<string> {
    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
            authorization: `Bearer ${PINATA_JWT}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({ pinataContent: doc, pinataMetadata: { name } }),
    });
    if (!res.ok) throw new Error(`pin json ${res.status}`);
    return `ipfs://${((await res.json()) as { IpfsHash: string }).IpfsHash}`;
}

/**
 * One toolkit for the whole invocation.
 *
 * Each publish reads the agent's counter, so separate instances issuing
 * concurrently collide and one operation is rejected. Sharing the instance
 * and awaiting each confirmation keeps a single operation in flight.
 */
let toolkit: TezosToolkit | null = null;
async function signer(): Promise<TezosToolkit> {
    if (!toolkit) {
        toolkit = new TezosToolkit(RPC);
        const s = await InMemorySigner.fromSecretKey(AGENT_SK);
        toolkit.setSignerProvider(s);
        await ensureRevealed(toolkit, s);
    }
    return toolkit;
}

/**
 * Reveal the agent's key, once, before it ever sends anything.
 *
 * A Tezos account cannot transact until its public key is on chain. Taquito
 * normally bundles the reveal with the first operation, and on this chain
 * `hard_gas_limit_per_operation` equals the per-*block* limit, so a bundled
 * reveal overflows and the whole batch is refused. The symptom is an agent
 * that is funded, looks fine, and has never landed an operation.
 *
 * Sent by hand for the same reason estimation is skipped below: the estimator
 * simulates at the operation cap, which this chain's block cap rejects.
 */
async function ensureRevealed(tezos: TezosToolkit, s: InMemorySigner): Promise<void> {
    const pkh = await s.publicKeyHash();
    if (await tezos.rpc.getManagerKey(pkh).catch(() => null)) return;

    const branch = (await tezos.rpc.getBlockHeader()).hash;
    const protocol = (await tezos.rpc.getProtocols()).protocol;
    const counter = parseInt((await tezos.rpc.getContract(pkh)).counter ?? "0", 10);
    const contents = [
        {
            kind: "reveal",
            source: pkh,
            fee: "1000",
            counter: String(counter + 1),
            gas_limit: "5000",
            storage_limit: "0",
            public_key: await s.publicKey(),
        },
    ];
    const forged = await tezos.rpc.forgeOperations({ branch, contents } as never);
    const sig = await s.sign(forged, new Uint8Array([3]));
    await tezos.rpc.preapplyOperations([
        { branch, contents, protocol, signature: sig.prefixSig },
    ] as never);
    const hash = await tezos.rpc.injectOperation(sig.sbytes);
    console.log(`revealing agent key, op ${hash}`);

    for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        if (await tezos.rpc.getManagerKey(pkh).catch(() => null)) return;
    }
    throw new Error(`agent key reveal not confirmed (op ${hash})`);
}

async function publish(piece: PendingPiece, metadataUri: string): Promise<string> {
    const tezos = await signer();
    const collection = await tezos.contract.at(piece.collection);
    const call = collection.methodsObject.set_token_metadata({
        token_id: piece.tokenId,
        metadata_uri: Buffer.from(metadataUri, "utf-8").toString("hex"),
    });

    // Explicit limits and an explicit fee, because neither can be estimated
    // here. Taquito simulates at `hard_gas_limit_per_operation`, and on this
    // chain that equals the per-*block* limit, so the simulation is refused
    // with gas_exhausted.block and no estimate comes back.
    //
    // The fee has to be derived from the gas limit, not guessed. A baker's
    // minimum is roughly 100 + 0.1 per gas unit + 1 per byte, in mutez, and
    // it is charged against the limit *declared*, not the gas consumed. So a
    // generous limit raises the fee floor, and paying below it does not fail:
    // the operation injects, returns a hash, and then sits in the mempool
    // until it expires. Which looks exactly like a chain that is ignoring you.
    const GAS_LIMIT = 10_000;
    const BYTES = 400;
    const fee = 100 + Math.ceil(GAS_LIMIT * 0.1) + BYTES + 200;

    const op = await call.send({ gasLimit: GAS_LIMIT, storageLimit: 300, fee });

    // The hash exists before the confirmation does, so a process that dies
    // here can tell "already sent" from "never sent".
    const hash = op.hash;
    await op.confirmation();
    return hash;
}

/**
 * Build one piece by hand, ignoring the queue.
 *
 * The queue finds pieces still holding the pending document, which by
 * definition excludes a piece that got a write and needs a better one. This is
 * how you reach those: name the collection and the token.
 */
export async function pieceAt(collection: string, tokenId: string): Promise<PendingPiece> {
    const storage = await tzkt<CollectionStorage>(`/v1/contracts/${collection}/storage`);
    requireAddress(storage.administrator, "administrator");

    let code = "";
    if (storage.art.code) {
        code = await decodeCode(storage.art.code, storage.art.code_encoding ?? "identity");
    } else {
        // `code_uri` is sp.string on chain, not sp.bytes. Decoding it as hex threw
    // "not hex" on every collection published by pointer, so the scan died
    // before it reached a single piece and an IPFS-stored generator could
    // never be rendered at all.
    const codeUri = storage.art.code_uri ?? "";
        if (codeUri.startsWith("ipfs://") && CID.test(codeUri.slice(7).split(/[/?#]/)[0])) {
            code = await fetchGenerator(codeUri);
        }
    }
    if (!code) throw new Error(`${collection} has no generator`);

    const mint = await buyEvent(collection, tokenId);
    if (!mint) throw new Error(`${collection} #${tokenId} has no mint event`);

    const facts = await collectionFacts(collection);

    return {
        collection,
        tokenId,
        seed: mint.hash,
        params: mint.params,
        code,
        codeUri: storage.art.code_uri ?? "",
        libraries: parseLibraries(
            await metadataKey(collection, "aleatory:libraries").catch(() => undefined),
        ),
        artist: storage.administrator,
        collectionName: facts.name,
        description: facts.description,
        royalties: royaltiesOf(storage),
        codeHash: storage.art.code_hash ?? "",
    };
}

export async function handle(piece: PendingPiece): Promise<string> {
    const image = await render(piece);
    const imageUri = await pin(image, `${piece.collection}-${piece.tokenId}.png`);

    const params = safeParse(piece.params);
    // The one builder, shared with the studio and covered by the golden tests.
    // This used to be assembled inline here and had drifted: a bare "#4" for a
    // name, no description, no code hash, and no royalties at all, which meant
    // no royalty was paid on any secondary sale of any piece.
    const doc = buildPieceDocument({
        collectionName: piece.collectionName,
        description: piece.description,
        artist: piece.artist,
        tokenId: Number(piece.tokenId),
        artifactUri: piece.codeUri,
        imageUri: imageUri,
        seed: piece.seed,
        codeHash: piece.codeHash,
        params,
        // Basis points from the collection's own storage. TZIP-21 with
        // `decimals: 4` is the same unit, so these travel unchanged.
        royalties: { decimals: 4, shares: piece.royalties },
    });

    // Who rendered it. The publish event records the agent that signed and
    // agents rotate, so the provider contract is the durable answer.
    const withProvider = { ...doc, aleaProvider: PROVIDER_ADDRESS };

    const metadataUri = await pinJson(withProvider, `${piece.collection}-${piece.tokenId}.json`);

    // Before the write lands, so the gateway has both by the time anything
    // reads the token. Not awaited for correctness, only so the two requests
    // overlap with the operation.
    const warmed = Promise.all([warmGateway(imageUri), warmGateway(metadataUri)]);

    const hash = await publish(piece, metadataUri);
    await warmed;
    return hash;
}

function safeParse(s: string): Record<string, unknown> {
    try {
        const v = JSON.parse(s) as unknown;
        return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

/**
 * One invocation at a time per piece.
 *
 * A second publish of the same piece is harmless rather than fatal now,
 * so this is about money rather than correctness: without it, two concurrent
 * runs both render and both pin, and one of the two operations is rejected
 * after the spending has happened.
 */
async function claim(key: string): Promise<boolean> {
    try {
        const store = getStore("aleatory-provider");
        const held = await store.get(key, { type: "json" }) as { at: number } | null;
        if (held && Date.now() - held.at < CLAIM_TTL_MS) return false;
        await store.setJSON(key, { at: Date.now() });
        return true;
    } catch {
        // Blobs unavailable. Proceed rather than stall the queue: the
        // on-chain guard still prevents a double write.
        return true;
    }
}

async function release(key: string): Promise<void> {
    try {
        await getStore("aleatory-provider").delete(key);
    } catch {
        /* the TTL covers it */
    }
}

/* ------------------------------------------------------------------ */

function configured(): string | null {
    if (!PROVIDER_ADDRESS || !AGENT_SK) return "provider is not configured";
    if (!renderConfigFromEnv()) return "rendering is not configured";
    if (!PINATA_JWT) return "pinning is not configured";
    return null;
}

/** Constant-time compare, so a token cannot be guessed a byte at a time. */
function tokenMatches(given: string, expected: string): boolean {
    if (!expected || given.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

export default async function handler(req: Request, context: Context): Promise<Response> {
    const problem = configured();
    if (problem) return new Response(problem, { status: 503 });

    // The cron carries no headers of ours, so a scheduled run is identified
    // by Netlify rather than by a secret. Every other caller needs the token:
    // each invocation spends render budget, pinning quota, and gas.
    const scheduled = req.headers.get("x-nf-event") === "schedule";
    if (!scheduled) {
        const given = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
        if (!tokenMatches(given, PING_TOKEN)) {
            return new Response("Unauthorized", { status: 401 });
        }
    }

    const runId = crypto.randomUUID();
    let published = 0;
    let failed = 0;

    try {
        const collections = await collectionsServed();
        let budget = BATCH;

        for (const collection of collections) {
            if (budget <= 0) break;
            const waiting = await pendingIn(collection).catch((e) => {
                console.error(`[${runId}] scan ${collection}`, e);
                return [] as PendingPiece[];
            });

            for (const piece of waiting) {
                if (budget <= 0) break;
                const key = `${piece.collection}:${piece.tokenId}`;
                if (!(await claim(key))) continue;
                budget--;
                try {
                    await handle(piece);
                    published++;
                } catch (e) {
                    // The piece stays pending, which is the state it was
                    // already in, and the next run picks it up.
                    failed++;
                    console.error(`[${runId}] publish ${key}`, e);
                    await release(key);
                }
            }
        }

        // Counts and a correlation id. Internal error text stays in the logs,
        // where it is not also a probe channel for an unauthenticated caller.
        return Response.json({ runId, collections: collections.length, published, failed });
    } catch (e) {
        console.error(`[${runId}] run failed`, e);
        return Response.json({ runId, error: "run failed" }, { status: 500 });
    }
}

export const config: Config = {
    schedule: "*/5 * * * *",
};

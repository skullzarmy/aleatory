/**
 * The render provider. Finds pieces waiting for their metadata, renders them,
 * pins them and publishes. Everything privileged lives here: the pinning key,
 * the agent key that signs, and the work queue. The render worker holds none of
 * it.
 *
 * Work arrives two ways, and the chain is the one that counts:
 *
 *   1. The cron, every five minutes, which survives our own UI being down.
 *   2. A ping from the mint UI carrying a shared secret, which turns a polling
 *      interval into a couple of seconds.
 *
 * A candidate generator is checked against its own storage before anything it
 * asserts is used. An event payload is written by the contract that emits it,
 * so it is a hint about where to look and not evidence.
 */
import { createHash } from "node:crypto";
import { TezosToolkit } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";

const TZKT = process.env.TZKT_API || "https://api.shadownet.tzkt.io";
const RPC = process.env.TEZOS_RPC || "https://rpc.tzkt.io/shadownet";
const PROVIDER_ADDRESS = process.env.ALEA_PROVIDER_ADDRESS || "";
const AGENT_SK = process.env.ALEA_AGENT_SK || "";
import { render as renderPiece, renderConfigFromEnv } from "./render.mts";
import { buildPieceDocument } from "./metadata";
import { parseLibraries, resolveLibraries, type DeclaredLibrary } from "./libraries.mts";
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

const ROUTER = (
    process.env.ALEA_ROUTER_ADDRESS ||
    process.env.NEXT_PUBLIC_ROUTER_ADDRESS ||
    ""
).trim();

let factoryCache: { at: number; addresses: string[] } | null = null;

/**
 * Factories whose generators this provider will look at.
 *
 * From the router, which holds the current factory and every retired one, so a
 * generator deployed by an old factory keeps being served. An environment list
 * written before a later factory existed serves that one alone and ignores the
 * rest in silence.
 *
 * This only decides where to look. Storage is the authority, and a generator
 * is served because its own storage names this provider.
 */
export async function generatorsFactories(): Promise<string[]> {
    if (FACTORY_OVERRIDE.length > 0) return FACTORY_OVERRIDE;
    return await routerFactories();
}

/** What the router lists, whatever the environment overrides it with. */
export async function routerFactories(): Promise<string[]> {
    if (!ROUTER) return [];

    // Rarely changes, and a scan every fifteen seconds should not re-read it.
    if (factoryCache && Date.now() - factoryCache.at < 300_000) {
        return factoryCache.addresses;
    }

    const storage = await tzkt<{ factories?: string[] }>(`/v1/contracts/${ROUTER}/storage`).catch(
        () => null,
    );

    // Deduplicated: the router prepends, so re-registering a factory leaves it
    // in the list twice and it would be scanned twice.
    const addresses = [...new Set(addressList((storage?.factories ?? []).join(",")))];
    if (addresses.length > 0) factoryCache = { at: Date.now(), addresses };
    return addresses;
}

/**
 * What an override hides. A factory-deployed generator names its provider in
 * initial storage and never emits `set_provider`, so the event scan below
 * cannot find it either: an override is the only thing deciding.
 */
export async function factoriesIgnored(): Promise<string[]> {
    if (FACTORY_OVERRIDE.length === 0) return [];
    const listed = await routerFactories();
    return listed.filter((f) => !FACTORY_OVERRIDE.includes(f));
}
const IPFS_GATEWAY = (process.env.ALEA_IPFS_GATEWAY || "https://ipfs.fileship.xyz").replace(
    /\/+$/,
    "",
);

/**
 * Generators this provider declines to render for. One operator saying no; the
 * generator keeps working and another provider can pick it up.
 */
const BLOCKED_GENERATORS = new Set(
    // The old name is still read: an operator who set it chose to decline those
    // contracts, and dropping it would quietly start rendering for them again.
    (process.env.ALEA_BLOCKED_GENERATORS || process.env.ALEA_BLOCKED_COLLECTIONS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
);

/** How many pieces one pass will take on before looking again. */
const BATCH = 5;

/** Generators larger than this are refused rather than rendered. */
const MAX_GENERATOR_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

const ADDRESS = /^(tz[123]|KT1)[A-Za-z0-9]{33}$/;
const CID = /^[A-Za-z0-9]{46,64}$/;

interface PendingPiece {
    generator: string;
    tokenId: string;
    /** The buy operation hash. This is the seed. */
    seed: string;
    params: string;
    /** The generator source, out of contract storage. */
    code: string;
    codeUri: string;
    /** Libraries the generator says its source expects to be loaded. */
    libraries: DeclaredLibrary[];
    artist: string;
    /** For the document. A piece is "<generator> #<n>", never a bare number. */
    generatorName: string;
    description: string;
    /** Address to basis points, straight from the generator's storage. */
    royalties: Record<string, number>;
    codeHash: string;
}

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

interface GeneratorStorage {
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
 * Generators this provider actually serves. Candidates come from contracts a
 * trusted factory originated and from `set_provider` events naming us, and each
 * one is confirmed against its own storage.
 */
export async function generatorsServed(): Promise<string[]> {
    const candidates = new Set<string>();

    // A generator deployed by a factory names its provider in its initial
    // storage and never emits `set_provider`, so an event scan alone never sees
    // a new generator until its artist happens to switch provider.
    for (const factory of await generatorsFactories()) {
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

    // And a generator that switched to us after deploy, from a factory we do
    // not watch.
    const events = await tzkt<{ contract: { address: string } }[]>("/v1/contracts/events", {
        tag: "set_provider",
        "sort.desc": "id",
        limit: 1000,
    }).catch(() => []);
    for (const e of events) {
        const addr = e.contract?.address;
        if (addr && ADDRESS.test(addr)) candidates.add(addr);
    }

    // Storage is the authority. A generator that no longer names us has
    // switched away, and its old event is still in the stream.
    const served: string[] = [];
    for (const address of candidates) {
        if (BLOCKED_GENERATORS.has(address)) continue;
        const storage = await tzkt<GeneratorStorage>(`/v1/contracts/${address}/storage`).catch(
            () => null,
        );
        if (storage?.render?.provider === PROVIDER_ADDRESS) served.push(address);
    }
    return served;
}

/** Name and description from the generator's own TZIP-16 document. */
async function generatorFacts(generator: string): Promise<{ name: string; description: string }> {
    const raw = await metadataKey(generator, "content").catch(() => undefined);
    if (!raw) return { name: "", description: "" };
    try {
        const doc = JSON.parse(raw) as { name?: string; description?: string };
        return { name: doc.name ?? "", description: doc.description ?? "" };
    } catch {
        return { name: "", description: "" };
    }
}

function royaltiesOf(storage: GeneratorStorage): Record<string, number> {
    return Object.fromEntries(
        Object.entries(storage.art.royalties ?? {}).map(([a, bps]) => [a, Number(bps)]),
    );
}

/** One key out of a generator's metadata big_map, decoded. */
async function metadataKey(generator: string, key: string): Promise<string | undefined> {
    const row = await tzkt<{ value?: string } | null>(
        `/v1/contracts/${generator}/bigmaps/metadata/keys/${encodeURIComponent(key)}`,
    ).catch(() => null);
    const value = row?.value;
    return value ? hexToUtf8(value) : undefined;
}

/**
 * Every token id in a generator, oldest first, for a retry that covers the
 * whole generator. The queue treats a piece that already got a write as
 * finished, which is exactly when a rebuild is wanted.
 */
export async function tokenIdsIn(generator: string): Promise<string[]> {
    const out: string[] = [];
    let offset = 0;
    for (;;) {
        const rows = await tzkt<{ tokenId: string }[]>("/v1/tokens", {
            contract: generator,
            "sort.asc": "tokenId",
            limit: 200,
            offset,
            select: "tokenId",
        }).catch(() => []);
        if (rows.length === 0) break;
        for (const r of rows) out.push(typeof r === "string" ? r : r.tokenId);
        offset += rows.length;
        if (rows.length < 200) break;
    }
    return out;
}

export async function pendingIn(generator: string): Promise<PendingPiece[]> {
    const storage = await tzkt<GeneratorStorage>(`/v1/contracts/${generator}/storage`);
    const pendingUri = hexToUtf8(storage.art.pending_metadata);
    // `code_uri` is sp.string on chain, not sp.bytes, so decoding it as hex
    // throws "not hex" on every generator published by pointer.
    const codeUri = storage.art.code_uri ?? "";
    requireAddress(storage.administrator, "administrator");

    let code = "";
    if (storage.art.code) {
        code = await decodeCode(storage.art.code, storage.art.code_encoding ?? "identity");
    } else if (codeUri.startsWith("ipfs://") && CID.test(codeUri.slice(7).split(/[/?#]/)[0])) {
        // Only for a generator too large to carry on chain. A pointer is
        // written by whoever deployed the generator, so it is IPFS only and a
        // CID shape only.
        code = await fetchGenerator(codeUri);
    }
    if (!code) return [];
    verifySource(code, storage.art.code_hash ?? "", generator);

    // Read from the generator's own metadata: a provider does not need to know
    // what a "p5 sketch" is, only how to resolve what it was told.
    const libraries = parseLibraries(
        await metadataKey(generator, "aleatory:libraries").catch(() => undefined),
    );
    const facts = await generatorFacts(generator);
    const royalties = royaltiesOf(storage);

    const waiting: PendingPiece[] = [];
    let offset = 0;

    // Paginated, or a generator past one page has pieces that never reveal.
    for (;;) {
        const tokens = await tzkt<{ tokenId: string }[]>("/v1/tokens", {
            contract: generator,
            limit: 200,
            offset,
            "sort.asc": "tokenId",
            select: "tokenId",
        });
        if (tokens.length === 0) break;

        for (const t of tokens) {
            const tokenId = typeof t === "string" ? t : t.tokenId;
            if ((await tokenMetadataUri(generator, tokenId)) !== pendingUri) continue;

            const buy = await buyEvent(generator, tokenId);
            if (!buy) continue;

            waiting.push({
                generator,
                tokenId,
                seed: buy.hash,
                params: buy.params,
                code,
                codeUri,
                libraries,
                artist: storage.administrator,
                generatorName: facts.name,
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

/** Fetch a generator, with a ceiling and a clock on it. */
/**
 * ALEATORY-001 §9.2. For a generator published by pointer this is the only
 * thing standing between a gateway and what gets drawn.
 */
function verifySource(code: string, codeHashHex: string, generator: string): void {
    const want = codeHashHex.replace(/^0x/, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) {
        throw new Error(`${generator} records no usable code_hash`);
    }
    const got = createHash("sha256").update(code, "utf8").digest("hex");
    if (got !== want) {
        throw new Error(`${generator} source is ${got}, storage records ${want}`);
    }
}

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

/** Draw one piece, through Browser Run's REST endpoint. */
async function render(piece: PendingPiece): Promise<Uint8Array> {
    const config = renderConfigFromEnv();
    if (!config) throw new Error("rendering is not configured");
    // Throws rather than rendering without them. A p5 sketch drawn with no p5
    // produces a blank frame, and the token would carry it permanently.
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
 * Pin bytes this renderer produced. Only ever our own output: accepting bytes
 * from a caller would make this an open upload endpoint.
 */
async function pin(bytes: Uint8Array, name: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: "image/png" }), name);
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: { authorization: `Bearer ${PINATA_JWT}` },
        body: form,
    });
    if (!res.ok) throw new Error(`pin ${res.status}`);
    return `ipfs://${((await res.json()) as { IpfsHash: string }).IpfsHash}`;
}

/**
 * Ask the public gateway for something we just pinned. A gateway other than the
 * pinning service answers with nothing until something asks it to fetch the
 * content across the network. Failures are ignored.
 */
async function warmGateway(uri: string): Promise<void> {
    const cid = uri.replace(/^ipfs:\/\//, "").split(/[/?#]/)[0];
    if (!cid) return;
    await Promise.all([
        fetch(`${IPFS_GATEWAY}/${cid}`, { signal: AbortSignal.timeout(20_000) }).catch(() => {}),
        warmSite(cid),
    ]);
}

/**
 * Ask the site too. Everything that shows a picture points at `/api/img/{cid}`,
 * which reads a gateway once and is cached for a year afterwards, so warming
 * the gateway alone leaves that route cold.
 *
 * The first request is usually Discord building an embed for the stats bot's
 * announcement, seconds after the publish, and a miss there is permanent: it
 * caches the absence against the URL and does not ask again.
 */
async function warmSite(cid: string): Promise<void> {
    const site = (process.env.ALEA_SITE_URL || "").replace(/\/+$/, "");
    if (!site) return;
    await fetch(`${site}/api/img/${cid}`, { signal: AbortSignal.timeout(20_000) }).catch(() => {});
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
 * One toolkit for the whole invocation. Each publish reads the agent's counter,
 * so separate instances issuing concurrently collide and one operation is
 * rejected.
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
 * Reveal the agent's key, once, before it sends anything.
 *
 * A Tezos account cannot transact until its public key is on chain. Taquito
 * bundles the reveal with the first operation, and on this chain
 * `hard_gas_limit_per_operation` equals the per-block limit, so the bundle
 * overflows and the batch is refused. The symptom is a funded agent that has
 * never landed an operation. Sent by hand for the same reason estimation is
 * skipped below.
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
    const generator = await tezos.contract.at(piece.generator);
    const call = generator.methodsObject.set_token_metadata({
        token_id: piece.tokenId,
        metadata_uri: Buffer.from(metadataUri, "utf-8").toString("hex"),
    });

    // Neither can be estimated here: Taquito simulates at
    // `hard_gas_limit_per_operation`, which on this chain equals the per-block
    // limit, so the simulation is refused with gas_exhausted.block.
    //
    // The fee follows from the gas limit. A baker's minimum is roughly 100 +
    // 0.1 per gas unit + 1 per byte, in mutez, charged against the limit
    // declared and not the gas consumed, so a generous limit raises the floor.
    // Paying under it injects, returns a hash, and sits in the mempool until it
    // expires.
    const GAS_LIMIT = 10_000;
    const BYTES = 400;
    const fee = 100 + Math.ceil(GAS_LIMIT * 0.1) + BYTES + 200;

    const op = await call.send({ gasLimit: GAS_LIMIT, storageLimit: 300, fee });

    // Read before the confirmation, so a process that dies here can tell
    // "already sent" from "never sent".
    const hash = op.hash;
    await op.confirmation();
    return hash;
}

/**
 * Build one piece by hand, ignoring the queue. The queue finds pieces still
 * holding the pending document, which excludes one that got a write and needs a
 * better one.
 */
export async function pieceAt(generator: string, tokenId: string): Promise<PendingPiece> {
    const storage = await tzkt<GeneratorStorage>(`/v1/contracts/${generator}/storage`);
    requireAddress(storage.administrator, "administrator");

    let code = "";
    if (storage.art.code) {
        code = await decodeCode(storage.art.code, storage.art.code_encoding ?? "identity");
    } else {
        // sp.string on chain, not sp.bytes. See `pendingIn`.
        const codeUri = storage.art.code_uri ?? "";
        if (codeUri.startsWith("ipfs://") && CID.test(codeUri.slice(7).split(/[/?#]/)[0])) {
            code = await fetchGenerator(codeUri);
        }
    }
    if (!code) throw new Error(`${generator} has no source`);
    verifySource(code, storage.art.code_hash ?? "", generator);

    const mint = await buyEvent(generator, tokenId);
    if (!mint) throw new Error(`${generator} #${tokenId} has no mint event`);

    const facts = await generatorFacts(generator);

    return {
        generator,
        tokenId,
        seed: mint.hash,
        params: mint.params,
        code,
        codeUri: storage.art.code_uri ?? "",
        libraries: parseLibraries(
            await metadataKey(generator, "aleatory:libraries").catch(() => undefined),
        ),
        artist: storage.administrator,
        generatorName: facts.name,
        description: facts.description,
        royalties: royaltiesOf(storage),
        codeHash: storage.art.code_hash ?? "",
    };
}

export async function handle(piece: PendingPiece): Promise<string> {
    const image = await render(piece);
    const imageUri = await pin(image, `${piece.generator}-${piece.tokenId}.png`);

    const params = safeParse(piece.params);
    // Shared with the studio and covered by the golden tests. A document
    // assembled here instead is how a provider ships pieces with no royalties.
    const doc = buildPieceDocument({
        generatorName: piece.generatorName,
        description: piece.description,
        artist: piece.artist,
        tokenId: Number(piece.tokenId),
        artifactUri: piece.codeUri,
        imageUri: imageUri,
        seed: piece.seed,
        codeHash: piece.codeHash,
        params,
        // Basis points, and TZIP-21 with `decimals: 4` is the same unit.
        royalties: { decimals: 4, shares: piece.royalties },
    });

    // Who rendered it. The publish event records the agent that signed, and
    // agents rotate, so the provider contract is the durable answer.
    const withProvider = { ...doc, aleaProvider: PROVIDER_ADDRESS };

    const metadataUri = await pinJson(withProvider, `${piece.generator}-${piece.tokenId}.json`);

    // Started before the write lands so the two requests overlap the operation.
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

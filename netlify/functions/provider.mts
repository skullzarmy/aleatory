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
const RENDER_URL = process.env.ALEA_RENDER_WORKER_URL || "";
const RENDER_TOKEN = process.env.ALEA_RENDER_TOKEN || "";
const PINATA_JWT = process.env.PINATA_JWT || "";
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
    codeUri: string;
    artist: string;
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
    art: { code_uri: string; pending_metadata: string };
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
async function collectionsServed(): Promise<string[]> {
    const candidates = new Set<string>();

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
async function pendingIn(collection: string): Promise<PendingPiece[]> {
    const storage = await tzkt<CollectionStorage>(`/v1/contracts/${collection}/storage`);
    const pendingUri = hexToUtf8(storage.art.pending_metadata);
    const codeUri = hexToUtf8(storage.art.code_uri);
    requireAddress(storage.administrator, "administrator");

    // A generator address is written by whoever deployed the collection, and
    // anyone can deploy one. Only IPFS, and only a CID shape.
    if (!codeUri.startsWith("ipfs://") || !CID.test(codeUri.slice(7).split(/[/?#]/)[0])) {
        return [];
    }

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
                codeUri,
                artist: storage.administrator,
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

async function render(piece: PendingPiece): Promise<Uint8Array> {
    const html = await fetchGenerator(piece.codeUri);
    const res = await fetch(RENDER_URL, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${RENDER_TOKEN}`,
        },
        body: JSON.stringify({
            html,
            seed: piece.seed,
            params: piece.params,
            width: 1000,
            height: 1000,
        }),
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`render ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
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
        toolkit.setSignerProvider(await InMemorySigner.fromSecretKey(AGENT_SK));
    }
    return toolkit;
}

async function publish(piece: PendingPiece, metadataUri: string): Promise<string> {
    const tezos = await signer();
    const collection = await tezos.contract.at(piece.collection);
    const op = await collection.methodsObject
        .set_token_metadata({
            token_id: piece.tokenId,
            metadata_uri: Buffer.from(metadataUri, "utf-8").toString("hex"),
        })
        .send();

    // The hash exists before the confirmation does, so a process that dies
    // here can tell "already sent" from "never sent".
    const hash = op.hash;
    await op.confirmation();
    return hash;
}

async function handle(piece: PendingPiece): Promise<string> {
    const image = await render(piece);
    const imageUri = await pin(image, `${piece.collection}-${piece.tokenId}.png`);

    const params = safeParse(piece.params);
    const doc = {
        name: `#${Number(piece.tokenId) + 1}`,
        decimals: 0,
        isBooleanAmount: false,
        shouldPreferSymbol: false,
        creators: [piece.artist],
        artifactUri: piece.codeUri,
        displayUri: imageUri,
        thumbnailUri: imageUri,
        aleaSeed: piece.seed,
        aleaParams: piece.params,
        attributes: Object.entries(params).map(([name, value]) => ({
            name,
            value: String(value),
        })),
    };

    const metadataUri = await pinJson(doc, `${piece.collection}-${piece.tokenId}.json`);
    return publish(piece, metadataUri);
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
 * The on-chain write-once guard already stops a piece being published twice,
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
    if (!PROVIDER_ADDRESS || !AGENT_SK || !RENDER_URL) return "provider is not configured";
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

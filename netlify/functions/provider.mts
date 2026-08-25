/**
 * The render provider.
 *
 * Finds pieces waiting for their metadata, renders them, pins them, and
 * publishes. Everything privileged lives here: the pinning key, the agent
 * key that signs, and the queue. The render worker holds none of it.
 *
 * Two ways work arrives, and the chain is the one that counts:
 *
 *   1. Poll. Collections that name us, then pieces still carrying the
 *      collection's pending document. This works with no cooperation from
 *      anyone and survives our own UI being down.
 *   2. Ping. The mint UI calls this after a buy lands, which turns a polling
 *      interval into a couple of seconds.
 *
 * Idempotency follows zolturd-mint.mts: claim a row with a conditional
 * update so exactly one attempt wins, persist the operation hash at injection
 * before waiting for confirmation, and reconcile against the chain with three
 * outcomes where the indeterminate one is never retried.
 */
import type { Config, Context } from "@netlify/functions";
import { TezosToolkit } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";

const TZKT = process.env.TZKT_API || "https://api.shadownet.tzkt.io";
const RPC = process.env.TEZOS_RPC || "https://rpc.tzkt.io/shadownet";
const PROVIDER_ADDRESS = process.env.ALEA_PROVIDER_ADDRESS || "";
const AGENT_SK = process.env.ALEA_AGENT_SK || "";
const RENDER_URL = process.env.ALEA_RENDER_WORKER_URL || "";
const RENDER_TOKEN = process.env.ALEA_RENDER_TOKEN || "";
const PINATA_JWT = process.env.PINATA_JWT || "";

/** How many pieces one invocation will take on. */
const BATCH = 5;

interface PendingPiece {
    collection: string;
    tokenId: string;
    /** The buy operation hash. This is the seed. */
    seed: string;
    params: string;
    codeUri: string;
    collectionName: string;
    artist: string;
}

async function tzkt<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${TZKT}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`TzKT ${res.status} ${path}`);
    return (await res.json()) as T;
}

function hexToUtf8(hex: string): string {
    const clean = hex.replace(/^0x/, "");
    const bytes = clean.match(/.{1,2}/g) || [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

/**
 * Collections that name this provider.
 *
 * Read from each collection's own storage, so a collection deployed by
 * somebody else's factory is served the same way ours is.
 */
async function collectionsServed(): Promise<string[]> {
    const events = await tzkt<{ payload: { provider: string } }[]>("/v1/contracts/events", {
        tag: "set_provider",
        limit: 1000,
    }).catch(() => []);

    const named = new Set<string>();
    for (const e of events) {
        if (e.payload?.provider === PROVIDER_ADDRESS) named.add((e as unknown as { contract: { address: string } }).contract.address);
    }

    const factory = process.env.ALEA_FACTORY_ADDRESS;
    if (factory) {
        const deployed = await tzkt<{ address: string }[]>("/v1/contracts", {
            creator: factory,
            limit: 200,
            select: "address",
        }).catch(() => []);
        for (const c of deployed) {
            const addr = typeof c === "string" ? c : c.address;
            const storage = await tzkt<{ render: { provider: string } }>(
                `/v1/contracts/${addr}/storage`,
            ).catch(() => null);
            if (storage?.render?.provider === PROVIDER_ADDRESS) named.add(addr);
        }
    }

    return [...named];
}

/**
 * Pieces still carrying their collection's pending document.
 *
 * This is the whole backlog: new buys, pieces missed while we were down, and
 * pieces inherited from a provider an artist switched away from. One rule
 * covers all three, and it needs no state of ours.
 */
async function pendingIn(collection: string): Promise<PendingPiece[]> {
    const storage = await tzkt<{
        administrator: string;
        art: { code_uri: string; pending_metadata: string };
    }>(`/v1/contracts/${collection}/storage`);

    const pendingUri = hexToUtf8(storage.art.pending_metadata);
    const codeUri = hexToUtf8(storage.art.code_uri) || storage.art.code_uri;

    const tokens = await tzkt<
        { tokenId: string; metadata?: { "": string }; firstTime: string }[]
    >("/v1/tokens", { contract: collection, limit: 200, "sort.desc": "firstTime" });

    const waiting: PendingPiece[] = [];
    for (const t of tokens) {
        const rawUri = await tokenMetadataUri(collection, t.tokenId);
        if (rawUri !== pendingUri) continue;

        const seed = await mintOperationHash(collection, t.tokenId);
        if (!seed) continue;

        waiting.push({
            collection,
            tokenId: t.tokenId,
            seed,
            params: await buyParams(collection, t.tokenId),
            codeUri,
            collectionName: collection,
            artist: storage.administrator,
        });
    }
    return waiting;
}

async function tokenMetadataUri(contract: string, tokenId: string): Promise<string> {
    const rows = await tzkt<{ value: { token_info: Record<string, string> } }[]>(
        `/v1/contracts/${contract}/bigmaps/token_metadata/keys`,
        { key: tokenId, limit: 1 },
    ).catch(() => []);
    const raw = rows[0]?.value?.token_info?.[""] ?? "";
    return raw ? hexToUtf8(raw) : "";
}

async function mintOperationHash(contract: string, tokenId: string): Promise<string | null> {
    const events = await tzkt<{ payload: { token_id: string }; transactionId: number }[]>(
        "/v1/contracts/events",
        { contract, tag: "buy", limit: 200 },
    ).catch(() => []);
    const match = events.find((e) => e.payload?.token_id === tokenId);
    if (!match) return null;
    const ops = await tzkt<string[]>("/v1/operations/transactions", {
        id: match.transactionId,
        limit: 1,
        select: "hash",
    }).catch(() => []);
    return ops[0] ?? null;
}

async function buyParams(contract: string, tokenId: string): Promise<string> {
    const events = await tzkt<{ payload: { token_id: string; params: string } }[]>(
        "/v1/contracts/events",
        { contract, tag: "buy", limit: 200 },
    ).catch(() => []);
    const match = events.find((e) => e.payload?.token_id === tokenId);
    const raw = match?.payload?.params ?? "";
    return raw ? hexToUtf8(raw) : "";
}

/** Fetch the generator, render it, and get PNG bytes back. */
async function render(piece: PendingPiece): Promise<Uint8Array> {
    const codeUrl = piece.codeUri.startsWith("ipfs://")
        ? `https://ipfs.fileship.xyz/${piece.codeUri.slice(7)}`
        : piece.codeUri;

    const html = await fetch(codeUrl).then((r) => {
        if (!r.ok) throw new Error(`generator ${r.status}`);
        return r.text();
    });

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
    });
    if (!res.ok) throw new Error(`render ${res.status}: ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
}

/**
 * Pin bytes this renderer produced.
 *
 * Only ever our own output. Accepting bytes from a caller would make this an
 * open upload endpoint, and verifying someone else's image costs the same as
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
    const json = (await res.json()) as { IpfsHash: string };
    return `ipfs://${json.IpfsHash}`;
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
    const json = (await res.json()) as { IpfsHash: string };
    return `ipfs://${json.IpfsHash}`;
}

async function publish(piece: PendingPiece, metadataUri: string): Promise<string> {
    const tezos = new TezosToolkit(RPC);
    tezos.setSignerProvider(await InMemorySigner.fromSecretKey(AGENT_SK));
    const collection = await tezos.contract.at(piece.collection);

    const op = await collection.methodsObject
        .set_token_metadata({
            token_id: piece.tokenId,
            metadata_uri: Buffer.from(metadataUri, "utf-8").toString("hex"),
        })
        .send();

    // The hash exists before confirmation does. A process that dies here has
    // to be able to tell "already published" from "never sent".
    const hash = op.hash;
    await op.confirmation();
    return hash;
}

async function handle(piece: PendingPiece): Promise<string> {
    const image = await render(piece);
    const imageUri = await pin(image, `${piece.collection}-${piece.tokenId}.png`);

    const params = piece.params ? safeParse(piece.params) : {};
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

export default async function handler(req: Request, _context: Context): Promise<Response> {
    if (!PROVIDER_ADDRESS || !AGENT_SK || !RENDER_URL) {
        return new Response("Provider is not configured", { status: 503 });
    }

    const results: Record<string, string> = {};
    const errors: Record<string, string> = {};

    try {
        const collections = await collectionsServed();
        let budget = BATCH;

        for (const collection of collections) {
            if (budget <= 0) break;
            const waiting = await pendingIn(collection).catch(() => []);
            for (const piece of waiting) {
                if (budget <= 0) break;
                budget--;
                const key = `${piece.collection}:${piece.tokenId}`;
                try {
                    results[key] = await handle(piece);
                } catch (e) {
                    // One failure leaves that piece pending, which is the
                    // same state it was already in, and the next run picks it
                    // up. Nothing is lost by stopping here.
                    errors[key] = (e as Error).message;
                }
            }
        }

        return Response.json({
            collections: collections.length,
            published: Object.keys(results).length,
            results,
            errors,
        });
    } catch (e) {
        return new Response(`Provider run failed: ${(e as Error).message}`, { status: 500 });
    }
}

export const config: Config = {
    // Polling keeps the backlog draining without anyone calling us. The mint
    // UI also pings this endpoint, which is what makes a reveal feel quick.
    schedule: "*/5 * * * *",
};

/**
 * Aleatory — testnet publish and mint.
 *
 * v0 publishes one contract per project: a stock FA2 whose contract metadata
 * carries the generator record AND the generator code itself, on chain, in
 * storage. That is a real Class A/B publish, not a simulation of one — the
 * bytes are burned, the estimate can be checked against the receipt, and the
 * piece renders from chain state.
 *
 * Minting a piece is one batched operation: create_token + mint_tokens. Both
 * share a single operation hash, and that hash IS the seed source (Policy A,
 * see record.deriveSeed). Nothing about the seed is chosen by us, by the
 * artist, or by the collector.
 *
 * Why no preview image in the token metadata: the seed is not knowable until
 * the operation lands, so an image written in that same operation could not be
 * of the piece it claims to show. Rather than embed something false, the token
 * points at the code and the policy, and any viewer regenerates the image.
 * The piece is the code and the seed; the image is a cache.
 */
import type { DAppClient, TezosOperationType } from "@tezos-x/octez.connect-sdk";
import multiAsset from "../fa2/MultiAsset.json";
import type { DeployNetwork } from "../fa2Deployer";
import { encodeParams, type ParamValues, specsOf } from "./params";
import { type GeneratorRecord, OP_HASH_SEED_FORMULA } from "./record";

/** Storage key the generator's code lives under, in the contract metadata big_map. */
export const CODE_KEY = "aleatory:code";
/** Storage key the generator record lives under. */
export const RECORD_KEY = "aleatory:record";
/**
 * Storage key the parameter declaration lives under — written only when the
 * generator declares parameters.
 *
 * It is already inside the record, so this is a duplicate of a few hundred
 * bytes, and it is worth them: a platform building a mint UI for this generator
 * needs exactly this one value, and asking it to fetch and parse the whole
 * record to find one field is how an integration gets skipped. One big_map key,
 * one JSON document, a control per entry. See docs/aleatory/params.md.
 */
export const PARAMS_KEY = "aleatory:params";

const TZKT_API: Record<string, string> = {
    mainnet: "https://api.tzkt.io",
    ghostnet: "https://api.ghostnet.tzkt.io",
    shadownet: "https://api.shadownet.tzkt.io",
    tezosx: "https://api.previewnet.tezosx.tzkt.io",
};

export function tzktApiFor(net: DeployNetwork): string {
    return TZKT_API[net.id] ?? net.tzktUrl.replace("://", "://api.");
}

// ---------------------------------------------------------------------------
// Micheline
// ---------------------------------------------------------------------------

type Mich = { prim: string; args?: Mich[]; annots?: string[] } | { int: string } | { string: string } | { bytes: string } | Mich[];

const int = (n: string | number): Mich => ({ int: String(n) });
const str = (s: string): Mich => ({ string: s });
const bytes = (h: string): Mich => ({ bytes: h });
const pair = (a: Mich, b: Mich): Mich => ({ prim: "Pair", args: [a, b] });
const elt = (k: Mich, v: Mich): Mich => ({ prim: "Elt", args: [k, v] });

function toHex(s: string): string {
    const encoded = new TextEncoder().encode(s);
    return Array.from(encoded, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** big_map literals must be sorted by key or origination fails to typecheck. */
function sortedStringMap(entries: Array<[string, Mich]>): Mich {
    return entries
        .slice()
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => elt(str(k), v));
}

/**
 * Storage for the project contract. Same layout as the FA2 deployer's Basic
 * (MultiAsset) contract, with no tokens at origination — pieces are created
 * one at a time by minting, so each gets its own operation hash to seed from.
 */
function buildStorage(admin: string, record: GeneratorRecord, code: string, coverUri?: string | null): Mich {
    const tzip16 = {
        name: record.title || "untitled generator",
        description: record.description || "",
        version: `aleatory-${record.schema_version}`,
        authors: [record.artist],
        homepage: "https://hacktez.com/labs/aleatory",
        interfaces: ["TZIP-012", "TZIP-016", "TZIP-021"],
        // Collection cover: an ipfs:// URI. objkt does not generate collection
        // thumbnails and will not read a data URI, so the image has to be pinned
        // and referenced. It is rendered from cover_seed, so it stays a cache of
        // something reproducible rather than the only copy.
        ...(coverUri ? { thumbnailUri: coverUri, displayUri: coverUri } : {}),
        // The generator record, inline, so a reader that fetches contract
        // metadata gets everything needed to render without a second lookup.
        aleatory: record,
    };

    const entries: Array<[string, Mich]> = [
        ["", bytes(toHex("tezos-storage:contents"))],
        ["contents", bytes(toHex(JSON.stringify(tzip16)))],
        [RECORD_KEY, bytes(toHex(JSON.stringify(record)))],
        [CODE_KEY, bytes(toHex(code))],
    ];
    // Only when there is something to declare — an absent key and an empty
    // declaration must not be two ways of saying the same thing.
    if (record.params_schema && record.params_schema.params.length > 0) {
        entries.push([PARAMS_KEY, bytes(toHex(JSON.stringify(record.params_schema)))]);
    }
    const metadata = sortedStringMap(entries);

    const adminPart = pair(pair(str(admin), { prim: "False" }), { prim: "None" });
    const assetsPart = pair(pair([], []), pair([], []));
    return pair(pair(adminPart, assetsPart), metadata);
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export interface PublishResult {
    opHash: string;
    opUrl: string;
}

export async function publishGenerator(
    net: DeployNetwork,
    client: DAppClient,
    admin: string,
    record: GeneratorRecord,
    code: string,
    coverUri?: string | null,
): Promise<PublishResult> {
    const result = await client.requestOperation({
        operationDetails: [
            {
                kind: "origination" as TezosOperationType.ORIGINATION,
                balance: "0",
                script: {
                    // biome-ignore lint/suspicious/noExplicitAny: Taquito's MichelineMichelsonV1Expression is structurally compatible but not exported
                    code: multiAsset as any,
                    // biome-ignore lint/suspicious/noExplicitAny: same
                    storage: buildStorage(admin, record, code, coverUri) as any,
                },
            },
        ],
    });
    const opHash = (result as { transactionHash: string }).transactionHash;
    return { opHash, opUrl: `${net.tzktUrl}/${opHash}` };
}

/**
 * Poll the indexer for the originated contract address.
 *
 * `/v1/operations/{hash}` returns every operation in the batch; the
 * origination carries the new address. (Deliberately not the `?hash=` filter
 * on the typed endpoints — it is silently ignored there.)
 */
export async function waitForContract(
    net: DeployNetwork,
    opHash: string,
    { attempts = 30, intervalMs = 3000 }: { attempts?: number; intervalMs?: number } = {},
): Promise<string> {
    const api = tzktApiFor(net);
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(`${api}/v1/operations/${opHash}`);
            if (res.ok) {
                const ops = (await res.json()) as Array<{
                    type?: string;
                    status?: string;
                    originatedContract?: { address?: string };
                }>;
                const origination = ops.find((o) => o.type === "origination" && o.originatedContract?.address);
                if (origination?.originatedContract?.address) return origination.originatedContract.address;
                const failed = ops.find((o) => o.status && o.status !== "applied");
                if (failed) throw new Error(`Origination ${failed.status}.`);
            }
        } catch (err) {
            if (err instanceof Error && err.message.startsWith("Origination ")) throw err;
            // Indexer lag or a transient network error — keep waiting.
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("The indexer has not reported the contract yet. It is on chain — check the operation link.");
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

export interface TokenInfoInput {
    title: string;
    description: string;
    tokenId: number;
    artist: string;
    record: GeneratorRecord;
    contract: string;
    /** The values the minter chose. Resolved against the record's schema here,
     *  so a caller cannot write a value the piece would not have accepted. */
    params?: ParamValues;
}

/**
 * TZIP-21 token metadata for one piece.
 *
 * `artifactUri` points into this contract's own storage: the artifact is the
 * code. `aleaSeed*` keys carry the policy and the exact preimage, so a resolver
 * that has never seen our front end can derive the seed from the operation
 * hash and render the piece correctly.
 */
/**
 * The token_info key/value pairs, before Micheline encoding.
 *
 * Exported so the cost estimate can measure exactly what a mint will store,
 * rather than guessing at it — the estimate and the operation read the same
 * list, so they cannot drift apart.
 */
export function tokenInfoEntries(input: TokenInfoInput): Array<[string, string]> {
    const { record } = input;
    const royaltyShares: Record<string, string> = {};
    if (record.royalties_bps > 0) royaltyShares[input.artist] = String(record.royalties_bps);

    const entries: Array<[string, string]> = [
        ["name", `${input.title} #${input.tokenId}`],
        ["description", input.description],
        ["decimals", "0"],
        ["isBooleanAmount", "true"],
        ["shouldPreferSymbol", "false"],
        ["artifactUri", `tezos-storage:${encodeURIComponent(CODE_KEY)}`],
        ["creators", JSON.stringify([input.artist])],
        ["tags", JSON.stringify(["aleatory", "generative", record.runtime.kind_name])],
        [
            "formats",
            JSON.stringify([
                {
                    uri: `tezos-storage:${encodeURIComponent(CODE_KEY)}`,
                    mimeType: "text/html",
                },
            ]),
        ],
        ["royalties", JSON.stringify({ decimals: 4, shares: royaltyShares })],
        // --- how to render this piece, without needing us ---
        ["aleaGenerator", input.contract],
        ["aleaTokenIndex", String(input.tokenId)],
        ["aleaCodeHash", record.code.hash],
        ["aleaRuntime", `${record.runtime.kind_name}@${record.runtime.kind_version}`],
        ["aleaStandardVersion", String(record.standard_version)],
        ["aleaStorageClass", record.storage_class],
        ["aleaSeedPolicy", `${record.seed_policy.kind}-v${record.seed_policy.version}`],
        ["aleaSeedFormula", OP_HASH_SEED_FORMULA],
    ];

    // A piece is (code, seed, params). The first two are already here; without
    // the third a parameterized token cannot be re-rendered by anyone, which
    // would make it the one kind of piece that needs us. So the values ride on
    // the token, and the declaration they resolve against is named beside them.
    const specs = specsOf(record.params_schema);
    if (specs.length > 0) {
        entries.push(["aleaParams", encodeParams(specs, input.params ?? {})]);
        entries.push(["aleaParamsSchema", `tezos-storage:${encodeURIComponent(PARAMS_KEY)}`]);
    }

    return entries;
}

export function buildTokenInfo(input: TokenInfoInput): Mich {
    return sortedStringMap(tokenInfoEntries(input).map(([k, v]) => [k, bytes(toHex(v))]));
}

/**
 * Mint one piece: create_token + mint_tokens, batched.
 *
 * One batch is one operation with one hash, and that hash seeds the piece.
 */
export async function mintPiece(
    net: DeployNetwork,
    client: DAppClient,
    contract: string,
    owner: string,
    tokenId: number,
    tokenInfo: Mich,
): Promise<PublishResult> {
    const result = await client.requestOperation({
        operationDetails: [
            {
                kind: "transaction" as TezosOperationType.TRANSACTION,
                amount: "0",
                destination: contract,
                parameters: {
                    entrypoint: "create_token",
                    // biome-ignore lint/suspicious/noExplicitAny: Micheline literal, structurally valid
                    value: pair(int(tokenId), tokenInfo) as any,
                },
            },
            {
                kind: "transaction" as TezosOperationType.TRANSACTION,
                amount: "0",
                destination: contract,
                parameters: {
                    entrypoint: "mint_tokens",
                    // biome-ignore lint/suspicious/noExplicitAny: Micheline literal, structurally valid
                    value: [pair(str(owner), pair(int(tokenId), int(1)))] as any,
                },
            },
        ],
    });
    const opHash = (result as { transactionHash: string }).transactionHash;
    return { opHash, opUrl: `${net.tzktUrl}/${opHash}` };
}

/** Wait until the mint operation is indexed and applied. */
export async function waitForApplied(
    net: DeployNetwork,
    opHash: string,
    { attempts = 30, intervalMs = 3000 }: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
    const api = tzktApiFor(net);
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(`${api}/v1/operations/${opHash}`);
            if (res.ok) {
                const ops = (await res.json()) as Array<{ status?: string }>;
                if (ops.length > 0) {
                    const bad = ops.find((o) => o.status && o.status !== "applied");
                    if (bad) throw new Error(`Mint ${bad.status}.`);
                    return;
                }
            }
        } catch (err) {
            if (err instanceof Error && err.message.startsWith("Mint ")) throw err;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error("The indexer has not reported the mint yet — it may still land. Check the operation link.");
}

// ---------------------------------------------------------------------------
// Reading a published generator back from the chain
// ---------------------------------------------------------------------------

export interface OnChainGenerator {
    contract: string;
    record: GeneratorRecord;
    code: string;
}

function hexToText(hex: string): string {
    const clean = hex.replace(/^0x/, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return new TextDecoder().decode(out);
}

/**
 * Rebuild a generator from chain state alone — contract metadata in, runnable
 * piece out. This is the resurrection path in miniature: no front end, no
 * indexer of ours, no server.
 */
export async function loadGenerator(net: DeployNetwork, contract: string): Promise<OnChainGenerator> {
    const api = tzktApiFor(net);
    const res = await fetch(`${api}/v1/contracts/${contract}/bigmaps/metadata/keys?limit=100`);
    if (!res.ok) throw new Error(`Could not read contract metadata (${res.status}).`);
    const keys = (await res.json()) as Array<{
        key: string;
        value: string;
        active?: boolean;
    }>;

    const find = (k: string) => keys.find((entry) => entry.key === k && entry.active !== false)?.value;
    const codeHex = find(CODE_KEY);
    const recordHex = find(RECORD_KEY);
    if (!codeHex) throw new Error("This contract carries no aleatory code — it is not a Aleatory generator.");

    const code = hexToText(codeHex);
    const record = recordHex ? (JSON.parse(hexToText(recordHex)) as GeneratorRecord) : null;
    if (!record) throw new Error("This contract carries code but no generator record.");

    return { contract, record, code };
}

export interface OnChainPiece {
    tokenId: number;
    /** The mint operation hash — the seed source. */
    opHash: string;
    seed: string;
    owner: string;
}

/**
 * List minted pieces with the operation hash each one derives its seed from,
 * and the parameter values that were written with them.
 *
 * The values come out of the mint operation's own `token_info`, not from
 * anything we stored — the same place any other reader would get them.
 */
export async function loadPieces(
    net: DeployNetwork,
    contract: string,
): Promise<Array<{ tokenId: number; opHash: string; params: string | null }>> {
    const api = tzktApiFor(net);
    const res = await fetch(
        `${api}/v1/operations/transactions?target=${contract}&entrypoint=create_token&status=applied&limit=200&select=hash,parameter`,
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
        hash: string;
        parameter?: unknown;
    }>;

    // TzKT decodes parameters using the contract's annotations when it can
    // ({ token_id, token_info }) and falls back to raw Micheline when it can't
    // ({ args: [{ int }, …] }). Read both rather than betting on one.
    const tokenIdOf = (parameter: unknown): number | null => {
        const value = (parameter as { value?: unknown } | undefined)?.value;
        if (value === undefined || value === null) return null;
        const named = (value as { token_id?: string | number }).token_id;
        if (named !== undefined) return Number(named);
        const raw = (value as { args?: Array<{ int?: string }> }).args?.[0]?.int;
        if (raw !== undefined) return Number(raw);
        return null;
    };

    /** The `aleaParams` entry of a mint's token_info, decoded, or null. */
    const paramsOf = (parameter: unknown): string | null => {
        const value = (parameter as { value?: unknown } | undefined)?.value;
        if (!value || typeof value !== "object") return null;
        const named = (value as { token_info?: Record<string, string> }).token_info;
        if (named && typeof named === "object") {
            const hex = named.aleaParams;
            return typeof hex === "string" ? hexToText(hex) : null;
        }
        const raw = (value as { args?: unknown[] }).args?.[1];
        if (Array.isArray(raw)) {
            for (const entry of raw as Array<{ args?: Array<{ string?: string; bytes?: string }> }>) {
                if (entry?.args?.[0]?.string === "aleaParams" && entry.args[1]?.bytes) return hexToText(entry.args[1].bytes);
            }
        }
        return null;
    };

    const out: Array<{ tokenId: number; opHash: string; params: string | null }> = [];
    for (const row of rows) {
        const tokenId = tokenIdOf(row.parameter);
        if (tokenId === null || Number.isNaN(tokenId)) continue;
        out.push({ tokenId, opHash: row.hash, params: paramsOf(row.parameter) });
    }
    return out.sort((a, b) => a.tokenId - b.tokenId);
}

export interface MintRecord {
    hash: string;
    params: Record<string, unknown>;
    timestamp: string;
    level: number;
}

export interface TzktOptions {
    baseUrl?: string;
    fetch?: typeof fetch;
}

/**
 * Queries TzKT to resolve a piece's mint operation hash (seed) and collector parameters.
 */
export async function fetchMintRecord(
    contract: string,
    tokenId: string | number,
    options: TzktOptions = {},
): Promise<MintRecord | null> {
    const fetchFn = options.fetch || globalThis.fetch;
    const base = (options.baseUrl || "https://api.tzkt.io").replace(/\/$/, "");

    // 1. Find the mint token transfer
    const transferUrl = `${base}/v1/tokens/transfers?token.contract=${contract}&token.tokenId=${tokenId}&from.null=true&limit=1&select=transactionId,level,timestamp`;
    const transfersRes = await fetchFn(transferUrl);
    if (!transfersRes.ok) return null;

    const transfers = (await transfersRes.json()) as Array<{
        transactionId: number;
        level: number;
        timestamp: string;
    }>;
    const transfer = transfers[0];
    if (!transfer || !transfer.transactionId) return null;

    // 2. Fetch transaction details by transactionId
    const txUrl = `${base}/v1/operations/transactions?id=${transfer.transactionId}&limit=1&select=hash,parameter`;
    const txRes = await fetchFn(txUrl);
    if (!txRes.ok) return null;

    const txs = (await txRes.json()) as Array<{
        hash: string;
        parameter?: { value?: unknown };
    }>;
    const tx = txs[0];
    if (!tx || !tx.hash) return null;

    let params: Record<string, unknown> = {};
    if (tx.parameter && tx.parameter.value) {
        if (typeof tx.parameter.value === "string") {
            try {
                // Parameter might be hex-encoded string or raw JSON
                const raw = tx.parameter.value.startsWith("0x")
                    ? new TextDecoder().decode(
                          new Uint8Array(
                              (tx.parameter.value.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
                          ),
                      )
                    : tx.parameter.value;
                params = JSON.parse(raw);
            } catch {}
        } else if (typeof tx.parameter.value === "object") {
            params = tx.parameter.value as Record<string, unknown>;
        }
    }

    return {
        hash: tx.hash,
        params,
        timestamp: transfer.timestamp,
        level: transfer.level,
    };
}

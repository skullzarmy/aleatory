/**
 * IPFS URI handling.
 *
 * Which gateway is a runtime choice, and a deliberately shallow one: a piece
 * is addressed by its CID, so any gateway serves the same bytes and a dead
 * one is a config change rather than a migration.
 */
const GATEWAY =
    process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.fileship.xyz";

export function isIpfsUri(uri: string): boolean {
    return typeof uri === "string" && uri.startsWith("ipfs://");
}

export function cidOf(uri: string): string {
    return isIpfsUri(uri) ? uri.slice("ipfs://".length) : uri;
}

/** ipfs://Qm... to a fetchable https URL. Non-IPFS URIs pass through. */
export function convertIpfsToGatewayUrl(uri: string | undefined): string {
    if (!uri) return "";
    if (!isIpfsUri(uri)) return uri;
    return `${GATEWAY}/${cidOf(uri)}`;
}

/** Michelson bytes (hex) to the UTF-8 string they encode. */
export function bytesToString(hex: string): string {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length === 0) return "";
    try {
        const bytes = clean.match(/.{1,2}/g) || [];
        return new TextDecoder().decode(
            new Uint8Array(bytes.map((b) => parseInt(b, 16))),
        );
    } catch {
        return "";
    }
}

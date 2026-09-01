/**
 * IPFS URI handling.
 *
 * The gateway is a runtime choice. A piece is addressed by its CID, so any
 * gateway serves the same bytes and swapping one is a config change.
 */
/**
 * Where pinned content is read from.
 *
 * fileship, because it is the fastest of the public gateways: measured at
 * 0.37s against 3.6 to 5.8s for the pinning service's own. Reading from the
 * pinning service would tie every page load to the slowest option available.
 *
 * A gateway other than the one we pinned to has to pull the content across the
 * network first, so a freshly pinned file can answer with nothing at all. That
 * is a propagation problem and it belongs at pin time: whoever pins warms this
 * gateway immediately afterwards, so by the time a page asks, it is cached.
 * See `warmGateway` in provider/provider.mts.
 */
const GATEWAY =
    process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.fileship.xyz";

export function isIpfsUri(uri: string): boolean {
    return typeof uri === "string" && uri.startsWith("ipfs://");
}

export function cidOf(uri: string): string {
    return isIpfsUri(uri) ? uri.slice("ipfs://".length) : uri;
}

const CID = /^[A-Za-z0-9]{46,64}$/;

/**
 * ipfs://Qm... to a fetchable https URL.
 *
 * Anything that is not an IPFS URI with a CID shape returns empty. Token
 * metadata is written by whoever rendered a piece, so a displayUri could
 * name any host, and passing it through would make every visitor's browser
 * beacon to an address of someone else's choosing.
 */
export function convertIpfsToGatewayUrl(uri: string | undefined): string {
    if (!uri || !isIpfsUri(uri)) return "";
    const cid = cidOf(uri).split(/[/?#]/)[0];
    if (!CID.test(cid)) return "";
    return `${GATEWAY}/${cid}`;
}

/** Michelson bytes (hex) to the UTF-8 string they encode. */
export function bytesToString(hex: string): string {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length === 0) return "";

    // Reject rather than mangle. `parseInt("ip", 16)` is NaN and `Uint8Array`
    // turns NaN into 0 without complaining, so decoding a plain string like
    // "ipfs://Qm..." used to return zero-filled garbage. Garbage is truthy, so
    // every `bytesToString(x) || x` fallback in the codebase silently kept the
    // garbage and the real value never surfaced.
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return "";

    const bytes = clean.match(/.{2}/g) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

/**
 * Gateways to try, in order, when this runs on a server.
 *
 * The configured one first, then public fallbacks. A CID names its own bytes,
 * so any of them either returns exactly the right content or nothing.
 */
export const IPFS_GATEWAYS = [
    ...new Set([GATEWAY, "https://ipfs.fileship.xyz", "https://ipfs.io", "https://gateway.pinata.cloud"]),
];

/**
 * The URL to put in an `<img>`.
 *
 * Our own origin, not a gateway. A CID is a hash of its bytes, so the content
 * can never change and the answer is cacheable forever: the first viewer pays
 * a gateway round trip and the CDN serves everyone after them. It also keeps
 * every visitor's address off a third party we do not run, which is the same
 * reason `/api/dep` exists.
 *
 * Server-side fetching wants `convertIpfsToGatewayUrl` instead: a relative
 * path has nothing to resolve against outside a browser.
 */
export function ipfsImageUrl(uri: string | undefined): string {
    if (!uri) return "";
    if (!isIpfsUri(uri)) return uri;
    const cid = cidOf(uri).split(/[/?#]/)[0];
    if (!CID.test(cid)) return "";
    return `/api/img/${cid}`;
}

/**
 * IPFS URI handling. A piece is addressed by its CID, so any gateway serves the
 * same bytes and the choice is configuration.
 *
 * The default is fileship, measured at 0.37s against 3.6 to 5.8s for the
 * pinning service's own, and its convention is a bare `/<cid>`. A gateway other
 * than the one we pinned to has to pull content across the network first, which
 * is why whoever pins warms this one straight afterwards. See `warmGateway` in
 * provider/provider.mts.
 */

/**
 * How long one gateway read gets, server side. Under the invocation a page is
 * rendered in, with room for the chain reads beside it: a page that gives
 * several documents longer than the whole render is killed with the response
 * half sent.
 */
export const GATEWAY_TIMEOUT_MS = 4_000;

const GATEWAY = (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.fileship.xyz").replace(
    /\/+$/,
    "",
);

export function isIpfsUri(uri: string): boolean {
    return typeof uri === "string" && uri.startsWith("ipfs://");
}

export function cidOf(uri: string): string {
    return isIpfsUri(uri) ? uri.slice("ipfs://".length) : uri;
}

const CID = /^[A-Za-z0-9]{46,64}$/;

/**
 * ipfs://Qm... to a fetchable https URL. Anything that is not an IPFS URI with a
 * CID shape returns empty: token metadata is written by whoever rendered a
 * piece, so a `displayUri` could name any host.
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

    // `parseInt("ip", 16)` is NaN and `Uint8Array` turns NaN into 0, so a plain
    // string would decode to zero-filled garbage, and garbage is truthy: every
    // `bytesToString(x) || x` fallback would keep it.
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return "";

    const bytes = clean.match(/.{2}/g) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

/**
 * Gateways to try, in order, when this runs on a server.
 *
 * Each entry carries its own path, because gateways disagree about it: fileship
 * serves `/<cid>`, and Pinata and ipfs.io want `/ipfs/<cid>` and answer a bare
 * one with a 401 or a redirect.
 *
 * The pinning service is second, as the only one certain to hold a piece
 * rendered a minute ago. A CID names its own bytes, so each of these returns
 * the right content or nothing.
 */
export const IPFS_GATEWAYS = [
    ...new Set([
        GATEWAY,
        "https://ipfs.fileship.xyz",
        "https://gateway.pinata.cloud/ipfs",
        "https://ipfs.io/ipfs",
        "https://dweb.link/ipfs",
    ]),
];

/**
 * The URL to put in an `<img>`: our own origin, not a gateway. A CID is a hash
 * of its bytes, so the answer is cacheable forever and only the first viewer
 * pays a gateway round trip. It also keeps every visitor's address off a third
 * party we do not run.
 *
 * Server-side fetching wants `convertIpfsToGatewayUrl`, since a relative path
 * has nothing to resolve against outside a browser.
 */
export function ipfsImageUrl(uri: string | undefined): string {
    if (!uri) return "";
    if (!isIpfsUri(uri)) return uri;
    const cid = cidOf(uri).split(/[/?#]/)[0];
    if (!CID.test(cid)) return "";
    return `/api/img/${cid}`;
}

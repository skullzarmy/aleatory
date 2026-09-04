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
 * Its convention is a bare `/<cid>`, which is why this carries no path.
 *
 * A gateway other than the one we pinned to has to pull the content across the
 * network first, so a freshly pinned file can answer with nothing at all. That
 * is a propagation problem and it belongs at pin time: whoever pins warms this
 * gateway immediately afterwards, so by the time a page asks, it is cached.
 * See `warmGateway` in provider/provider.mts.
 */
/**
 * How long one gateway read gets, server side.
 *
 * Under the invocation a page is rendered in, with room for the chain reads
 * beside it. A page that fetches several documents and gives each of them
 * longer than the whole render is allowed cannot finish: the function is
 * killed with the response half sent, and a reader gets a page that stops in
 * the middle rather than one missing a picture.
 *
 * A gateway that has not answered in four seconds is not going to save the
 * page. The piece it describes is on chain and the next render asks again.
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
    // turns NaN into 0 silently, so a plain string decodes to zero-filled
    // garbage, and garbage is truthy: every `bytesToString(x) || x` fallback
    // would keep it and never surface the real value.
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return "";

    const bytes = clean.match(/.{2}/g) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16))));
}

/**
 * Gateways to try, in order, when this runs on a server.
 *
 * **Each entry carries its own path, because gateways disagree about it.**
 * fileship serves `/<cid>`; Pinata and ipfs.io want `/ipfs/<cid>` and answer
 * a bare one with a 401 or a redirect. These were written as hosts and joined
 * as `<host>/<cid>`, which is right for the first and wrong for the rest, so
 * there were never any fallbacks: the day fileship blipped, every image on the
 * site went to a 502.
 *
 * The pinning service is second, because it is the only one that is certain to
 * hold a piece rendered a minute ago. A CID names its own bytes, so each of
 * these either returns exactly the right content or nothing.
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

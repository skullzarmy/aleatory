import type { NextConfig } from "next";

/**
 * Security headers, built from the same configuration the app reads.
 *
 * These used to live in `netlify.toml` as a static string naming
 * `isolate.aleatory.art`. That host is an environment variable everywhere
 * else, so locally the app framed `localhost:4321` while the header still
 * insisted on the production host, and every preview was blocked. A policy
 * that only holds in production is a policy nobody tests.
 *
 * One definition, here, derived from `NEXT_PUBLIC_ISOLATE_ORIGIN`.
 */
const ISOLATE_ORIGIN =
    process.env.NEXT_PUBLIC_ISOLATE_ORIGIN || "https://isolate.aleatory.art";

const NETWORK = process.env.NEXT_PUBLIC_TEZOS_NETWORK || "shadownet";
const isDev = process.env.NODE_ENV !== "production";

/** Chain reads. Both indexers are listed so switching network needs no redeploy. */
const CHAIN_HOSTS = [
    "https://api.tzkt.io",
    "https://api.shadownet.tzkt.io",
    "https://rpc.tzkt.io",
];

/**
 * Gateways an image may be loaded from.
 *
 * The configured one is included by origin, so changing the gateway does not
 * silently leave every image blocked by a policy that still names the old one.
 * The rest are fallbacks a piece minted earlier may still point at.
 */
const IPFS_GATEWAY =
    process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs";

const IPFS_HOSTS = [
    ...new Set([
        new URL(IPFS_GATEWAY).origin,
        "https://gateway.pinata.cloud",
        "https://ipfs.fileship.xyz",
        "https://ipfs.io",
        "https://cloudflare-ipfs.com",
    ]),
];

function csp(): string {
    return [
        "default-src 'self'",
        // Next injects inline bootstrap script; dev additionally evaluates.
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${IPFS_HOSTS.join(" ")}`,
        "font-src 'self' data: https://fonts.gstatic.com",
        // The dependency proxy keeps this 'self': the studio never reaches a
        // CDN directly, /api/dep does it server-side. See src/app/api/dep.
        [
            "connect-src 'self'",
            ...CHAIN_HOSTS,
            "wss://*.walletbeacon.io",
            "https://*.walletbeacon.io",
            // Dev servers move ports and HMR needs a socket back.
            ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
        ].join(" "),
        // Generator code runs on the provider's render host and nowhere else.
        `frame-src ${ISOLATE_ORIGIN}`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
    ].join("; ");
}

const config: NextConfig = {
    reactStrictMode: true,
    // Images come from IPFS gateways through plain <img>, and the hosts that
    // may be reached are set by img-src above. Adding a next/image allowlist
    // would describe a control the code does not use.
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "Content-Security-Policy", value: csp() },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    {
                        key: "Permissions-Policy",
                        value: "geolocation=(), microphone=(), camera=(), payment=()",
                    },
                    // Only meaningful over TLS, and setting it in dev would
                    // pin localhost to https in the browser for two years.
                    ...(isDev
                        ? []
                        : [
                              {
                                  key: "Strict-Transport-Security",
                                  value: "max-age=63072000; includeSubDomains",
                              },
                          ]),
                ],
            },
        ];
    },
};

export default config;

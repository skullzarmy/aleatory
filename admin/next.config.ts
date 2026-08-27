import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const TZKT = ["https://api.tzkt.io", "https://api.shadownet.tzkt.io", "https://rpc.tzkt.io"];

/**
 * No images, fonts or embeds here, so anything that is not a chain endpoint or
 * a wallet relay is denied outright.
 */
function csp(): string {
    return [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        [
            "connect-src 'self'",
            ...TZKT,
            "https://*.octez.io",
            "wss://*.octez.io",
            "https://*.walletbeacon.io",
            "wss://*.walletbeacon.io",
            "https://cdn.jsdelivr.net/gh/trilitech/octez.connect-wallet-list@latest/dist/",
            ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
        ].join(" "),
        // WalletConnect's origin-verification iframe, which wallets load to
        // attest which site is asking. Refusing it makes a connection request
        // read as unverified in the wallet.
        "frame-src https://verify.walletconnect.org https://verify.walletconnect.com",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ].join("; ");
}

const nextConfig: NextConfig = {
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "Content-Security-Policy", value: csp() },
                    { key: "Referrer-Policy", value: "no-referrer" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "X-Frame-Options", value: "DENY" },
                    // A console is not something to find in a search result.
                    { key: "X-Robots-Tag", value: "noindex, nofollow" },
                ],
            },
        ];
    },
};

export default nextConfig;

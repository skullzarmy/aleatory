import type { NextConfig } from "next";

const config: NextConfig = {
    reactStrictMode: true,
    images: {
        // Pieces are pinned to IPFS and served through public gateways. Which
        // gateway is a runtime choice (see src/utils/ipfs.ts), so the allowed
        // hosts are listed rather than wildcarded.
        remotePatterns: [
            { protocol: "https", hostname: "ipfs.fileship.xyz" },
            { protocol: "https", hostname: "ipfs.io" },
            { protocol: "https", hostname: "cloudflare-ipfs.com" },
        ],
    },
};

export default config;

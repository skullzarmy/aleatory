import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * A page with no chain reads, no wallet and no forms, so everything a policy
 * can deny is denied. The font is the one exception and it is self-hosted by
 * `next/font`, which is why there is no Google origin here.
 */
function csp(): string {
    return [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        `connect-src 'self'${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ].join("; ");
}

const config: NextConfig = {
    reactStrictMode: true,
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

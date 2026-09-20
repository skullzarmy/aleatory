import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Anybody } from "next/font/google";
import { BRAND } from "@/lib/config";

const anybody = Anybody({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
    metadataBase: new URL(BRAND.url),
    title: `${BRAND.name}, ${BRAND.tagline}`,
    description: BRAND.description,
    alternates: { canonical: "/" },
    applicationName: BRAND.name,
    keywords: [
        "generative art",
        "on-chain",
        "Tezos",
        "NFT",
        "p5.js",
        "creative coding",
        "generative",
    ],
    manifest: "/site.webmanifest",
    // Named rather than left to convention, because the files are in `public`
    // and Next only finds icons it is told about or ones in `app`.
    icons: {
        icon: [
            { url: "/favicon.svg", type: "image/svg+xml" },
            { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
        ],
        apple: "/apple-touch-icon.png",
    },
    openGraph: {
        type: "website",
        siteName: BRAND.name,
        title: `${BRAND.name}, ${BRAND.tagline}`,
        description: BRAND.description,
        url: BRAND.url,
    },
    // The image comes from opengraph-image.tsx, which Next wires into both this
    // and the Open Graph tags above. Asking for a large card without one is how
    // this page was rendering an empty box in every timeline it was posted to.
    twitter: { card: "summary_large_image", title: BRAND.name, description: BRAND.description },
};

export const viewport: Viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#e3e4e8" },
        { media: "(prefers-color-scheme: dark)", color: "#17181c" },
    ],
};

/**
 * No theme toggle. The app carries one and remembers a choice; a page somebody
 * sees once should follow the choice their system already made.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${anybody.className} bg-background text-foreground antialiased`}>
                {children}
            </body>
        </html>
    );
}

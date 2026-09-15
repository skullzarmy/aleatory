import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Anybody } from "next/font/google";
import { BRAND } from "@/lib/config";

const anybody = Anybody({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
    metadataBase: new URL(BRAND.url),
    title: `${BRAND.name}, ${BRAND.tagline}`,
    description: BRAND.description,
    openGraph: {
        type: "website",
        title: BRAND.name,
        description: BRAND.description,
        url: BRAND.url,
    },
    twitter: { card: "summary_large_image" },
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

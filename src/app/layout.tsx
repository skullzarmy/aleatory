import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Anybody } from "next/font/google";
import { ServiceWorker } from "@/components/ServiceWorker";
import { ThemeProvider } from "@/components/themeProvider";
import { WalletProvider } from "@/context/WalletContext";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { BRAND } from "@/lib/config";

const anybody = Anybody({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
    metadataBase: new URL(BRAND.url),
    title: {
        default: `${BRAND.name}, ${BRAND.tagline}`,
        template: `%s · ${BRAND.name}`,
    },
    description: BRAND.description,
    openGraph: {
        type: "website",
        title: `${BRAND.name}`,
        description: BRAND.description,
        url: BRAND.url,
    },
    twitter: { card: "summary_large_image" },
    // Written as metadata rather than as tags in the markup so there is one
    // source and nothing can be emitted twice.
    manifest: "/site.webmanifest",
    icons: {
        icon: [
            { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
            { url: "/favicon.svg", type: "image/svg+xml" },
        ],
        shortcut: "/favicon.ico",
        apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
    },
    appleWebApp: {
        title: BRAND.name,
        capable: true,
        statusBarStyle: "black-translucent",
    },
};

/**
 * The colour the browser paints around the page, and the one behind a splash
 * screen on a phone. Matching the app means an install does not flash white
 * before it starts.
 */
export const viewport: Viewport = {
    themeColor: "#17191c",
    colorScheme: "dark light",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className={anybody.className} suppressHydrationWarning>
            <body>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
                    <WalletProvider>
                        <div className="flex min-h-screen flex-col bg-background">
                            <Header />
                            {/* 2.4.1 Bypass Blocks. Every page opens with the
                                same header and nav; without this a keyboard or
                                screen reader user walks all of it on every
                                navigation. Visible only when focused. */}
                            <a
                                href="#main"
                                className="sr-only rounded-md bg-background px-4 py-2 text-sm font-medium underline focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
                            >
                                Skip to content
                            </a>
                            <main id="main" tabIndex={-1} className="flex-grow">
                                {children}
                            </main>
                            <Footer />
                        </div>
                    </WalletProvider>
                </ThemeProvider>
                            <ServiceWorker />
            </body>
        </html>
    );
}

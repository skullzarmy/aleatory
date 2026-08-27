import "./globals.css";
import type { Metadata } from "next";
import { Anybody } from "next/font/google";
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
            </body>
        </html>
    );
}

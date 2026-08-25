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
                            <main className="flex-grow">{children}</main>
                            <Footer />
                        </div>
                    </WalletProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}

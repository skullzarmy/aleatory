import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { WalletBar } from "@/components/WalletBar";
import { BRAND, NETWORK } from "@/lib/config";

export const metadata: Metadata = {
    title: BRAND.name,
    description: BRAND.description,
    // Nothing here belongs in an index. Every action is gated on chain, so
    // this is not a security boundary, but a console has no readers to find.
    robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <WalletProvider>
                    {/* 2.4.1 Bypass Blocks. */}
                    <a
                        href="#main"
                        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:border focus:border-line focus:bg-base focus:px-3 focus:py-2"
                    >
                        Skip to content
                    </a>

                    <header className="border-b border-line">
                        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
                            <div className="flex items-baseline gap-3">
                                <span className="font-semibold tracking-tight">
                                    {BRAND.name}
                                </span>
                                {/* Which chain this is pointed at, always on
                                    screen. The controls look identical on
                                    shadownet and mainnet and do not have
                                    remotely the same consequences. */}
                                <span
                                    className={`rounded-full border px-2 py-0.5 text-xs ${
                                        NETWORK === "mainnet"
                                            ? "border-warn/60 text-warn"
                                            : "border-line text-dim"
                                    }`}
                                >
                                    {NETWORK}
                                </span>
                            </div>
                            <WalletBar />
                        </div>
                    </header>

                    <main id="main" className="mx-auto max-w-5xl px-4 py-8">
                        {children}
                    </main>
                </WalletProvider>
            </body>
        </html>
    );
}

import type { Metadata } from "next";

/**
 * The page is a client component and cannot export metadata, so it lives here.
 *
 * Not indexed. Every offer on it is public chain state, but the page is a view
 * of whichever wallet is connected, so a crawler sees an empty shell and a
 * search result for it would send somebody to nothing.
 */
export const metadata: Metadata = {
    title: "Offers",
    description:
        "Offers standing on the pieces you hold, and the offers you have made, with the tez each one is escrowing.",
    alternates: { canonical: "/offers" },
    robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

import type { Metadata } from "next";

// The page itself is a client component and can't export metadata, so it lives here.
// Not indexed: the page shows whichever wallet is connected, so a crawler sees an
// empty shell.
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

import type { Metadata } from "next";

// The page itself is a client component, so its metadata lives here. noindex: a draft
// lives in one browser's IndexedDB, so this route renders nothing for anyone else.
export const metadata: Metadata = {
    title: "Studio",
    description: "Your generator, running, with the seed held still while you work.",
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

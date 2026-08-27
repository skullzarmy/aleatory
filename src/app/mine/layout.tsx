import type { Metadata } from "next";

/**
 * The page is a client component and cannot export metadata, so it lives here.
 */
export const metadata: Metadata = {
    title: "What you own",
    description: "A shortcut to your own wallet page: the pieces you hold and the collections you made.",
    alternates: { canonical: "/mine" },
    robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

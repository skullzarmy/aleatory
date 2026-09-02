import type { Metadata } from "next";

/**
 * The page is a client component and cannot export metadata, so it lives here.
 */
export const metadata: Metadata = {
    title: "Manage",
    description:
        "Price, pause, edition size, render provider and resolver trust, for collections you published.",
    alternates: { canonical: "/manage" },
    robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

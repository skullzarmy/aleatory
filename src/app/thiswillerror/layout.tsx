import type { Metadata } from "next";

/** Temporary route. Kept out of search and out of the sitemap. */
export const metadata: Metadata = {
    title: "Break it",
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

import type { Metadata } from "next";
import { fetchCollection } from "@/lib/collection";
import { shortAddress } from "@/lib/utils";

/**
 * The page is a client component, so its metadata lives here.
 *
 * `noindex`: this is an artist's control panel for one collection, it is
 * useless to anyone who does not hold the key, and `/collection/[address]` is
 * the public page for the same thing.
 */
export async function generateMetadata({
    params,
}: {
    params: Promise<{ address: string }>;
}): Promise<Metadata> {
    const { address } = await params;
    const c = await fetchCollection(address).catch(() => null);
    return {
        title: `Manage ${c?.name || shortAddress(address)}`,
        robots: { index: false, follow: false },
        alternates: { canonical: `/collection/${address}` },
    };
}

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

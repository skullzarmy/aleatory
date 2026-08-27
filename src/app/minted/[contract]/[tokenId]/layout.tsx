import type { Metadata } from "next";
import { fetchPiece } from "@/lib/piece";
import { BRAND } from "@/lib/config";

/**
 * Metadata for the page a collector lands on after paying.
 *
 * The page itself is a client component, because right after a mint the
 * indexer has usually not caught up and a server render would answer "no such
 * token" for a token that demonstrably exists. A client component cannot
 * export metadata, so it lives here, where the same lookup is allowed to fail
 * without taking the page with it.
 *
 * `noindex`, deliberately. This is one person's receipt, it duplicates
 * `/piece/*`, and a search result pointing at somebody else's celebration is
 * worth nothing. The share buttons on it point at the permanent page.
 */
export async function generateMetadata({
    params,
}: {
    params: Promise<{ contract: string; tokenId: string }>;
}): Promise<Metadata> {
    const { contract, tokenId } = await params;
    const piece = await fetchPiece(contract, tokenId).catch(() => null);
    const title = piece?.name ?? `#${Number(tokenId) + 1}`;

    return {
        title,
        description: piece?.description || BRAND.description,
        robots: { index: false, follow: true },
        alternates: { canonical: `/piece/${contract}/${tokenId}` },
    };
}

export default function MintedLayout({ children }: { children: React.ReactNode }) {
    return children;
}

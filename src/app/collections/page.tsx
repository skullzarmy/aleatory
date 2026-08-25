import Link from "next/link";
import type { Metadata } from "next";
import { fetchAllCollections } from "@/lib/collection";
import { EmptyFeed } from "@/components/feed/EmptyFeed";
import { CONTRACTS } from "@/lib/config";
import { shortAddress, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Collections" };
export const revalidate = 60;

export default async function CollectionsPage() {
    if (!CONTRACTS.factory) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-8">
                <EmptyFeed reason="unconfigured" />
            </div>
        );
    }

    const collections = await fetchAllCollections();

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="mb-6 text-xl font-semibold tracking-tight">Collections</h1>

            {collections.length === 0 ? (
                <EmptyFeed reason="no-collections" />
            ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                    {collections.map((c) => (
                        <li key={c.address}>
                            <Link
                                href={`/collection/${c.address}`}
                                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">
                                        {c.name || shortAddress(c.address)}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {c.minted} minted
                                    </span>
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {c.firstActivity ? timeAgo(c.firstActivity) : ""}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

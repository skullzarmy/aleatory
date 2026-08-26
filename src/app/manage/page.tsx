"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { CONTRACTS } from "@/lib/config";
import { fetchCollection, type Collection } from "@/lib/collection";
import { fetchCollectionsDeployedBy } from "@/lib/tzkt";
import { formatTez, shortAddress } from "@/lib/utils";

/**
 * The collections you own.
 *
 * Ownership here is the contract's `administrator`, not an account on this
 * site. Anything listed is something this wallet can actually change, and
 * connecting a different wallet shows a different list.
 */
export default function ManagePage() {
    const { address, connect, restoring } = useWallet();
    const [collections, setCollections] = useState<Collection[] | null>(null);

    useEffect(() => {
        if (!address) {
            setCollections(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            const addresses = await fetchCollectionsDeployedBy(
                address,
                CONTRACTS.factory ?? "",
            ).catch(() => []);
            const rows = await Promise.all(addresses.map((a) => fetchCollection(a).catch(() => null)));
            if (!cancelled) {
                setCollections(rows.filter((c): c is Collection => c !== null));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [address]);

    if (restoring) {
        return <Shell><p className="text-sm text-muted-foreground">Restoring your session…</p></Shell>;
    }

    if (!address) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">
                    Connect the wallet you published with.
                </p>
                <button
                    type="button"
                    onClick={() => void connect()}
                    className="mt-4 rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Connect
                </button>
            </Shell>
        );
    }

    if (collections === null) {
        return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>;
    }

    if (collections.length === 0) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">
                    Nothing published from {shortAddress(address)} yet.
                </p>
                <Link
                    href="/studio"
                    className="mt-4 inline-block rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700"
                >
                    Open the studio
                </Link>
            </Shell>
        );
    }

    return (
        <Shell>
            <ul className="divide-y divide-border rounded-lg border border-border">
                {collections.map((c) => (
                    <li key={c.address}>
                        <Link
                            href={`/manage/${c.address}`}
                            className="flex items-center gap-4 px-4 py-3 hover:bg-accent"
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                    {c.name || shortAddress(c.address)}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {c.minted} minted
                                    {c.editionSize > 0 ? ` of ${c.editionSize}` : ", open edition"}
                                    {" · "}
                                    {formatTez(Number(c.totalMutez))} ꜩ to mint
                                </span>
                            </span>
                            <Status collection={c} />
                        </Link>
                    </li>
                ))}
            </ul>
        </Shell>
    );
}

function Status({ collection }: { collection: Collection }) {
    const [label, tone] = collection.soldOut
        ? ["Sold out", "text-muted-foreground"]
        : collection.paused
          ? ["Paused", "text-warning"]
          : ["Selling", "text-success"];
    return <span className={`shrink-0 text-xs font-medium ${tone}`}>{label}</span>;
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Your collections</h1>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">
                Change the price, pause sales, shrink an edition, or switch who renders
                your images.
            </p>
            {children}
        </div>
    );
}

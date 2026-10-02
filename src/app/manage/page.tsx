"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { allFactories } from "@/lib/router";
import { fetchGenerator, type Generator } from "@/lib/generator";
import { fetchGeneratorsDeployedBy } from "@/lib/tzkt";
import { formatTez, shortAddress } from "@/lib/utils";
import { useLive } from "@/components/LiveRefresh";

// Ownership here is the contract's `administrator`; connecting a different wallet
// shows a different list.
export default function ManagePage() {
    const { address, connect, restoring } = useWallet();
    const [generators, setGenerators] = useState<Generator[] | null>(null);

    const load = useCallback(async () => {
        if (!address) return null;
        // Every factory, so a generator deployed before a redeploy still
        // appears under the wallet that made it.
        const factories = await allFactories().catch(() => []);
        const lists = await Promise.all(
            factories.map((f) => fetchGeneratorsDeployedBy(address, f).catch(() => [])),
        );
        const addresses = [...new Set(lists.flat())];
        const rows = await Promise.all(addresses.map((a) => fetchGenerator(a).catch(() => null)));
        return rows.filter((c): c is Generator => c !== null);
    }, [address]);

    useEffect(() => {
        if (!address) {
            setGenerators(null);
            return;
        }
        let cancelled = false;
        void load().then((rows) => {
            if (!cancelled && rows) setGenerators(rows);
        });
        return () => {
            cancelled = true;
        };
    }, [address, load]);

    // A generator published in the studio, in another tab, belongs in this list
    // without being asked for again.
    useLive(() => void load().then((rows) => rows && setGenerators(rows)), 30);

    if (restoring) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">Restoring your session…</p>
            </Shell>
        );
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

    if (generators === null) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">Loading…</p>
            </Shell>
        );
    }

    if (generators.length === 0) {
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
                {generators.map((c) => (
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
                            <Status generator={c} />
                        </Link>
                    </li>
                ))}
            </ul>
        </Shell>
    );
}

function Status({ generator }: { generator: Generator }) {
    const [label, tone] = generator.soldOut
        ? ["Sold out", "text-muted-foreground"]
        : generator.paused
          ? ["Paused", "text-warning"]
          : ["Selling", "text-success"];
    return <span className={`shrink-0 text-xs font-medium ${tone}`}>{label}</span>;
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto max-w-3xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Your generators</h1>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">
                Change the price, pause sales, shrink an edition, or switch who renders your images.
            </p>
            {children}
        </div>
    );
}

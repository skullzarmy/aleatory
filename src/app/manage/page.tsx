"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { allFactories } from "@/lib/router";
import { fetchGenerator, type Generator } from "@/lib/generator";
import { fetchGeneratorsDeployedBy, fetchRawContent } from "@/lib/tzkt";
import { missingTzipFields, patchTzipFields } from "@/lib/tzip";
import { pushContentBatch } from "@/lib/ops";
import { formatTez, shortAddress } from "@/lib/utils";
import { useLive } from "@/components/LiveRefresh";

interface Row {
    generator: Generator;
    content: Record<string, unknown> | null;
}

// Ownership here is the contract's `administrator`; connecting a different wallet
// shows a different list.
export default function ManagePage() {
    const { address, getClient, connect, restoring } = useWallet();
    const [rows, setRows] = useState<Row[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

    const load = useCallback(async () => {
        if (!address) return null;
        // Every factory, so a generator deployed before a redeploy still
        // appears under the wallet that made it.
        const factories = await allFactories().catch(() => []);
        const lists = await Promise.all(
            factories.map((f) => fetchGeneratorsDeployedBy(address, f).catch(() => [])),
        );
        const addresses = [...new Set(lists.flat())];
        const out = await Promise.all(
            addresses.map(async (a) => {
                const generator = await fetchGenerator(a).catch(() => null);
                if (!generator) return null;
                const content = await fetchRawContent(a).catch(() => null);
                return { generator, content };
            }),
        );
        return out.filter((r): r is Row => r !== null);
    }, [address]);

    useEffect(() => {
        if (!address) {
            setRows(null);
            return;
        }
        let cancelled = false;
        void load().then((r) => {
            if (!cancelled && r) setRows(r);
        });
        return () => {
            cancelled = true;
        };
    }, [address, load]);

    // A generator published in the studio, in another tab, belongs in this list
    // without being asked for again.
    useLive(() => void load().then((r) => r && setRows(r)), 30);

    const needsUpdate = (rows ?? []).filter(
        (r) => r.content && missingTzipFields(r.content).length > 0,
    );

    async function updateAll() {
        setBusy(true);
        setNote(null);
        try {
            const client = await getClient();
            const { hash } = await pushContentBatch(
                client,
                needsUpdate.map((r) => ({
                    generator: r.generator.address,
                    contentJson: JSON.stringify(
                        patchTzipFields(r.content as Record<string, unknown>),
                    ),
                })),
            );
            setNote({ kind: "ok", text: `Signed. ${hash.slice(0, 12)}…` });
            const r = await load();
            if (r) setRows(r);
        } catch (e) {
            setNote({
                kind: "bad",
                text: e instanceof Error ? e.message : "Your wallet cancelled that.",
            });
        } finally {
            setBusy(false);
        }
    }

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

    if (rows === null) {
        return (
            <Shell>
                <p className="text-sm text-muted-foreground">Loading…</p>
            </Shell>
        );
    }

    if (rows.length === 0) {
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
            {needsUpdate.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-accent/40 px-4 py-3">
                    <p className="text-sm">
                        {needsUpdate.length} generator{needsUpdate.length === 1 ? "" : "s"} missing
                        metadata marketplaces like objkt read (a site link). One signature updates
                        all of them.
                    </p>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void updateAll()}
                        className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
                    >
                        {busy ? "Signing…" : `Update all (${needsUpdate.length})`}
                    </button>
                </div>
            )}

            {note && (
                <p
                    className={`mb-4 rounded-md px-3 py-2 text-sm ${
                        note.kind === "ok"
                            ? "border border-success/40 bg-success/10"
                            : "border border-destructive/40 bg-destructive/10"
                    }`}
                >
                    {note.text}
                </p>
            )}

            <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.map(({ generator: c, content }) => (
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
                                    {content && missingTzipFields(content).length > 0 && (
                                        <>
                                            {" · "}
                                            <span className="text-warning">metadata update</span>
                                        </>
                                    )}
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

"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { CONTRACTS } from "@/lib/config";
import { royaltyPreview, type RoyaltySplit } from "@/lib/metadata";
import { shortAddress } from "@/lib/utils";
import type { Provider } from "@/lib/providers";

/**
 * Deploy a collection.
 *
 * Everything on this form except the price and the edition size is permanent
 * from the moment the collection exists, so the permanent fields say so, and
 * the royalty preview shows what each recipient will receive on a sale before
 * anything is signed.
 */
export function DeployForm({ providers }: { providers: Provider[] }) {
    const { address, connect } = useWallet();

    const [name, setName] = useState("");
    const [codeUri, setCodeUri] = useState("");
    const [editionSize, setEditionSize] = useState("10");
    const [price, setPrice] = useState("1");
    const [royaltyTotal, setRoyaltyTotal] = useState("10");
    const [platformShare, setPlatformShare] = useState(false);
    const [platformPercent, setPlatformPercent] = useState("10");
    const [providerAddress, setProviderAddress] = useState(providers[0]?.address ?? "");

    const provider = providers.find((p) => p.address === providerAddress);

    const split: RoyaltySplit = useMemo(() => {
        const total = parseFloat(royaltyTotal) || 0;
        const recipients = [];
        if (address) {
            const platform = platformShare ? parseFloat(platformPercent) || 0 : 0;
            recipients.push({ address, percent: 100 - platform });
            if (platform > 0) {
                recipients.push({ address: CONTRACTS.marketplace || address, percent: platform });
            }
        }
        return { totalPercent: total, recipients };
    }, [address, royaltyTotal, platformShare, platformPercent]);

    const preview = useMemo(() => royaltyPreview(split), [split]);

    return (
        <form
            className="space-y-6"
            onSubmit={(e) => {
                e.preventDefault();
            }}
        >
            <Field label="Collection name" permanent>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Drift"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            <Field label="Generator" permanent hint="ipfs:// pointer to your code">
                <input
                    value={codeUri}
                    onChange={(e) => setCodeUri(e.target.value)}
                    placeholder="ipfs://Qm..."
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Edition size" hint="0 for an open edition. It can shrink later, never grow.">
                    <input
                        inputMode="numeric"
                        value={editionSize}
                        onChange={(e) => setEditionSize(e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                </Field>

                <Field label="Price in ꜩ" hint="Changeable any time, for pieces not yet sold.">
                    <input
                        inputMode="decimal"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                </Field>
            </div>

            <Field
                label="Render provider"
                hint={
                    provider
                        ? `${provider.stats.delivered} pieces published. Switchable later.`
                        : "Who renders your pieces."
                }
            >
                <select
                    value={providerAddress}
                    onChange={(e) => setProviderAddress(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                    {providers.length === 0 && <option value="">No providers registered</option>}
                    {providers.map((p) => (
                        <option key={p.address} value={p.address}>
                            {p.name || shortAddress(p.address)}
                            {p.isOurs ? " (ours)" : ""}
                            {` — ${p.renderGasMutez / 1_000_000} ꜩ per piece`}
                        </option>
                    ))}
                </select>
            </Field>

            <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm font-medium">Support the platform</p>
                        <p className="text-xs text-muted-foreground">
                            Share part of your royalty with Aleatory.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setPlatformShare((v) => !v)}
                        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                        {platformShare ? "Remove" : "Add platform"}
                    </button>
                </div>

                {platformShare && (
                    <div className="flex items-center gap-2">
                        <input
                            inputMode="decimal"
                            value={platformPercent}
                            onChange={(e) => setPlatformPercent(e.target.value)}
                            className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        />
                        <span className="text-xs text-muted-foreground">
                            percent of your royalty
                        </span>
                    </div>
                )}
            </div>

            <Field label="Royalty on each sale" permanent hint="0, or 10 to 25 percent.">
                <input
                    inputMode="decimal"
                    value={royaltyTotal}
                    onChange={(e) => setRoyaltyTotal(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            {preview.length > 0 && (
                <div className="space-y-1 rounded-lg bg-muted/50 p-4 text-sm">
                    <p className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        On every secondary sale
                    </p>
                    {preview.map((r) => (
                        <div key={r.address} className="flex justify-between">
                            <span className="text-muted-foreground">{shortAddress(r.address)}</span>
                            <span className="font-medium">
                                {r.percentOfSale.toFixed(2)}% of the sale price
                            </span>
                        </div>
                    ))}
                    <p className="pt-2 text-xs text-muted-foreground">
                        This split is written into every piece this collection mints, and it holds
                        for as long as the pieces exist.
                    </p>
                </div>
            )}

            <button
                type="button"
                onClick={() => void connect()}
                disabled={Boolean(address)}
                className="w-full rounded-md bg-alea-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
            >
                {address ? "Deploy collection" : "Connect to deploy"}
            </button>

            <p className="text-xs text-muted-foreground">
                One signature. You own the contract from the moment it exists, and Aleatory keeps
                no authority over it. Your wallet pays the origination.
            </p>
        </form>
    );
}

function Field({
    label,
    hint,
    permanent,
    children,
}: {
    label: string;
    hint?: string;
    permanent?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
                <label className="text-sm font-medium">{label}</label>
                {permanent && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        permanent
                    </span>
                )}
            </div>
            {children}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}

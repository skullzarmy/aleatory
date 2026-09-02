"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { fetchMintedTokenId } from "@/lib/tzkt";
import { tzktLink } from "@/lib/config";
import { formatTez } from "@/lib/utils";
import type { Collection } from "@/lib/collection";
import {
    resolveParams,
    encodeParams,
    randomValues,
    type ParamsSchema,
    type ParamSpec,
} from "@/lib/params";
import * as ops from "@/lib/ops";
import { IsolateFrame } from "@/components/IsolateFrame";

/**
 * Buy one piece.
 *
 * One signature covers the price and the render gas together. The operation
 * hash becomes the seed, so the outcome is fixed by the collector's own
 * signature and known to nobody beforehand.
 */
export function MintPanel({
    collection,
    schema,
    onPreview,
}: {
    collection: Collection;
    /** The generator's declared parameters, when it has any. */
    schema?: ParamsSchema | null;
    /**
     * Show the collector what a set of values looks like before they sign.
     * The seed here is a stand-in: theirs does not exist until their operation
     * lands, and the panel says so rather than implying they are choosing it.
     */
    onPreview?: (values: Record<string, unknown>, previewSeed: string) => void;
}) {
    const router = useRouter();
    const { address, connect, getClient } = useWallet();
    const [busy, setBusy] = useState(false);
    const [hash, setHash] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chosen, setChosen] = useState<Record<string, unknown>>({});

    /**
     * Reroll the parameters, and the seed the preview is drawn from.
     *
     * Two different things, deliberately. The parameters are the collector's
     * to choose and are committed by their signature. The seed is not: it is
     * the hash of the operation they are about to send, so what this rerolls
     * is only the draw being *shown*, to give a sense of the space they are
     * buying into.
     */
    function randomize() {
        const values = schema?.params.length ? randomValues(schema.params) : {};
        setChosen(values);
        onPreview?.(values, randomPreviewSeed());
    }

    const remaining =
        collection.editionSize > 0 ? collection.editionSize - collection.minted : null;

    async function mint() {
        setBusy(true);
        setError(null);
        try {
            const client = await getClient();
            // Resolved through the one rule every reader shares, so the values
            // recorded in the operation are the values the piece will run
            // with. See docs/params.md §3.
            const params = schema
                ? encodeParams(schema.params, resolveParams(schema.params, chosen))
                : "";
            const res = await ops.mint(client, collection.address, params, collection.totalMutez);
            setHash(res.hash);
            // Tell the provider this collection pays to look now. It polls
            // regardless, so this only shortens the wait, and a provider that
            // advertises no push endpoint is left to its own clock.
            void fetch("/api/render-ping", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ provider: collection.provider }),
            }).catch(() => {});
            // The contract decides the token id, so it is only knowable once
            // the operation is indexed. Until then the collector waits here
            // rather than on a page for a token that does not resolve yet.
            const tokenId = await waitForToken(collection.address, address!, res.hash);
            if (tokenId !== null) {
                router.push(`/minted/${collection.address}/${tokenId}`);
                return;
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not go through");
        } finally {
            setBusy(false);
        }
    }

    // Reached when the operation landed and the indexer has not caught up
    // within the window.
    //
    // Nothing here waits on anybody. The seed is the hash of the operation
    // they just signed, the generator came out of contract storage before they
    // signed it, and a piece is a pure function of the two, so their piece can
    // be on screen the moment it exists. The indexer, the render provider and
    // the pin are all downstream of a picture we can already draw.
    if (hash) {
        return (
            <div className="space-y-3 rounded-lg border border-border p-4">
                {collection.code && (
                    <div className="overflow-hidden rounded-lg border border-border">
                        <div className="aspect-square">
                            <IsolateFrame
                                code={collection.code}
                                seed={hash}
                                params={resolveParams(schema?.params ?? [], chosen)}
                                paramsSchema={schema?.params ?? []}
                                title="Your piece"
                            />
                        </div>
                    </div>
                )}
                <p className="text-sm font-medium">Yours. Here it is.</p>
                <p className="text-xs text-muted-foreground">
                    Drawn from the seed your signature made. The permanent image is being published
                    now, and your piece appears on your wallet page in a moment.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                        href={`/wallet/${address}`}
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                    >
                        What you own
                    </Link>
                    <a
                        href={tzktLink(hash)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                    >
                        The operation
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Price</span>
                <span className="text-lg font-semibold">{formatTez(collection.priceMutez)} ꜩ</span>
            </div>

            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                <span>Render gas</span>
                <span>{formatTez(collection.renderGasMutez)} ꜩ</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm">
                <span>You pay</span>
                <span className="font-medium">{formatTez(collection.totalMutez)} ꜩ</span>
            </div>

            <p className="text-xs text-muted-foreground">
                {remaining === null
                    ? `${collection.minted} minted, open edition`
                    : `${remaining} of ${collection.editionSize} remaining`}
            </p>

            <div className="space-y-3 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                        {schema && schema.params.length > 0 ? "Parameters" : "Preview"}
                    </p>
                    <button
                        type="button"
                        onClick={randomize}
                        disabled={busy}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
                    >
                        Randomize
                    </button>
                </div>
                {schema && schema.params.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        This generator has no settings. Randomize shows you another draw.
                    </p>
                )}
            </div>

            {schema && schema.params.length > 0 && (
                <div className="space-y-3">
                    {schema.params.map((spec) => (
                        <ParamControl
                            key={spec.id}
                            spec={spec}
                            value={chosen[spec.id]}
                            onChange={(v) => {
                                const next = { ...chosen, [spec.id]: v };
                                setChosen(next);
                                onPreview?.(next, "");
                            }}
                        />
                    ))}
                </div>
            )}

            {collection.soldOut ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">Sold out</p>
            ) : collection.paused ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">Sales are paused</p>
            ) : (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => (address ? void mint() : void connect())}
                    className="w-full rounded-md bg-alea-600 px-3 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {address
                        ? busy
                            ? hash
                                ? "Finding your piece"
                                : "Confirming"
                            : "Mint"
                        : "Connect to mint"}
                </button>
            )}

            <p className="text-xs text-muted-foreground">
                Your signature decides the seed. The piece is yours as soon as it lands, and the
                image follows shortly after.
            </p>

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

/**
 * One control, per the type in the declaration.
 *
 * Values are held loosely here and resolved once, at mint, through the rule
 * every reader shares. A control that clamps as you type would be a second
 * implementation of that rule.
 */
function ParamControl({
    spec,
    value,
    onChange,
}: {
    spec: ParamSpec;
    value: unknown;
    onChange: (v: unknown) => void;
}) {
    const current = value ?? spec.default;

    return (
        <label className="block space-y-1">
            {/* Both sides are the artist's: they named the parameter and they
                set its range. Neither length is ours to assume. */}
            <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{spec.label}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {String(current)}
                </span>
            </span>

            {spec.type === "number" || spec.type === "int" ? (
                <input
                    type="range"
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={Number(current)}
                    onChange={(e) => onChange(Number(e.target.value))}
                    className="w-full"
                />
            ) : spec.type === "bool" ? (
                <input
                    type="checkbox"
                    checked={Boolean(current)}
                    onChange={(e) => onChange(e.target.checked)}
                />
            ) : spec.type === "color" ? (
                <input
                    type="color"
                    value={String(current)}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-8 w-full"
                />
            ) : (
                <select
                    value={String(current)}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                    {(spec.options ?? []).map((o) => (
                        <option key={o} value={o}>
                            {o}
                        </option>
                    ))}
                </select>
            )}

            {spec.hint && <span className="block text-xs text-muted-foreground">{spec.hint}</span>}
        </label>
    );
}

/**
 * Wait for the indexer to place the operation, then say which token it made.
 *
 * A block is a few seconds and indexing follows it, so this asks for about
 * half a minute and then gives up rather than holding a spinner over something
 * that has already succeeded. Giving up is not a failure: the operation landed,
 * the piece is theirs, and the panel says where to find it.
 */
async function waitForToken(
    collection: string,
    buyer: string,
    hash: string,
): Promise<string | null> {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
        const id = await fetchMintedTokenId(collection, buyer, hash).catch(() => null);
        if (id !== null) return id;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return null;
}

/**
 * A stand-in seed for the preview.
 *
 * Shaped like an operation hash so what a collector sees is the same kind of
 * value a real mint produces. It is not their seed and cannot be: that one is
 * the hash of an operation that does not exist yet.
 */
function randomPreviewSeed(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return (
        "oo" +
        Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 49)
    );
}

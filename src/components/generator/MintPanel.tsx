"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { fetchMintedTokenId } from "@/lib/tzkt";
import { tzktLink } from "@/lib/config";
import { formatTez } from "@/lib/utils";
import type { Generator } from "@/lib/generator";
import {
    resolveParams,
    encodeParams,
    randomValues,
    type ParamsSchema,
    type ParamSpec,
} from "@/lib/params";
import * as ops from "@/lib/ops";
import { IsolateFrame } from "@/components/IsolateFrame";
import { useDeps } from "@/components/useDeps";

/**
 * Buy one piece. One signature covers the price and the render gas, and the
 * operation hash becomes the seed, so the outcome is fixed by the collector's
 * own signature and known to nobody beforehand.
 */
export function MintPanel({
    generator,
    schema,
    onPreview,
}: {
    generator: Generator;
    /** The generator's declared parameters, when it has any. */
    schema?: ParamsSchema | null;
    /**
     * Show the collector what a set of values looks like before they sign. The
     * seed is a stand-in: theirs does not exist until their operation lands.
     */
    onPreview?: (values: Record<string, unknown>, previewSeed: string) => void;
}) {
    const router = useRouter();
    const { address, connect, getClient } = useWallet();
    const [busy, setBusy] = useState(false);
    const [hash, setHash] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chosen, setChosen] = useState<Record<string, unknown>>({});

    // Same as the piece page: the isolate cannot fetch a library or load one by
    // URL, so the declared ones are resolved here and handed over as source.
    const { deps } = useDeps(generator.code ?? "");

    /**
     * Reroll the parameters, and the seed the preview is drawn from. The
     * parameters are the collector's to choose and their signature commits
     * them; the seed is the hash of the operation they have yet to send, so
     * rerolling it changes only what is shown.
     */
    function randomize() {
        const values = schema?.params.length ? randomValues(schema.params) : {};
        setChosen(values);
        onPreview?.(values, randomPreviewSeed());
    }

    const remaining = generator.editionSize > 0 ? generator.editionSize - generator.minted : null;

    async function mint() {
        setBusy(true);
        setError(null);
        try {
            const client = await getClient();
            // Resolved through the rule every reader shares, so the operation
            // records the values the piece will run with. docs/params.md §3.
            const params = schema
                ? encodeParams(schema.params, resolveParams(schema.params, chosen))
                : "";
            const res = await ops.mint(client, generator.address, params, generator.totalMutez);
            setHash(res.hash);
            // The provider polls regardless, so this only shortens the wait.
            void fetch("/api/render-ping", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ provider: generator.provider }),
            }).catch(() => {});
            // The contract decides the token id, so it is knowable only once
            // the operation is indexed.
            const tokenId = await waitForToken(generator.address, address!, res.hash);
            if (tokenId !== null) {
                router.push(`/piece/${generator.address}/${tokenId}?minted`);
                return;
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "That did not go through");
        } finally {
            setBusy(false);
        }
    }

    // Reached when the operation landed and the indexer has not caught up. The
    // seed is the hash they just signed and the generator came out of storage
    // before they signed it, so the piece can be drawn here without waiting for
    // the indexer, the provider or the pin.
    if (hash) {
        return (
            <div className="space-y-3 rounded-lg border border-border p-4">
                {generator.code && (
                    <div className="overflow-hidden rounded-lg border border-border">
                        <div className="aspect-square">
                            <IsolateFrame
                                code={generator.code}
                                seed={hash}
                                params={resolveParams(schema?.params ?? [], chosen)}
                                paramsSchema={schema?.params ?? []}
                                deps={deps}
                                liveClock
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
                <span className="text-lg font-semibold">{formatTez(generator.priceMutez)} ꜩ</span>
            </div>

            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                <span>Render gas</span>
                <span>{formatTez(generator.renderGasMutez)} ꜩ</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border pt-2 text-sm">
                <span>You pay</span>
                <span className="font-medium">{formatTez(generator.totalMutez)} ꜩ</span>
            </div>

            <p className="text-xs text-muted-foreground">
                {remaining === null
                    ? `${generator.minted} minted, open edition`
                    : `${remaining} of ${generator.editionSize} remaining`}
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

            {!generator.sealed ? (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                    This generator is still being written to the chain. Minting opens once its
                    artist seals it.
                </p>
            ) : generator.soldOut ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">Sold out</p>
            ) : generator.paused ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">Sales are paused</p>
            ) : !generator.providerReachable ? (
                /* A mint asks the provider what they charge, so one that has
                   stopped answering fails the sale. Said here, because the
                   wallet reports it as a wrong price. */
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                    This generator&apos;s render provider is not answering, so minting is stopped
                    until its artist picks another.
                </p>
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
 * One control, per the type in the declaration. Values are held loosely and
 * resolved once, at mint: a control that clamps as you type would be a second
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
            {/* Both sides are the artist's, so neither length is ours to assume. */}
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
 * Bounded: giving up is not a failure, since the operation landed and the panel
 * says where to find the piece.
 */
async function waitForToken(
    generator: string,
    buyer: string,
    hash: string,
): Promise<string | null> {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
        const id = await fetchMintedTokenId(generator, buyer, hash).catch(() => null);
        if (id !== null) return id;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return null;
}

/**
 * A stand-in seed for the preview, shaped like an operation hash. Not the
 * collector's seed, which is the hash of an operation that does not exist yet.
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

"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { fetchCollection, type Collection } from "@/lib/collection";
import { fetchProviders, type Provider } from "@/lib/providers";
import { tzktLink } from "@/lib/config";
import { AccountLink } from "@/components/account/AccountLink";
import { formatTez, parseTez, shortAddress } from "@/lib/utils";
import { setEditionSize, setPaused, setPrice, setProvider, setTrustResolver } from "@/lib/ops";

/**
 * One collection, from the artist's side.
 *
 * Every control writes to the artist's own contract, so the page reads the
 * chain again after each one rather than assuming the write landed. What the
 * contract refuses, it refuses here too: edition size only shrinks, and a
 * provider whose price moved above the ceiling fails the call.
 */
export default function ManageCollectionPage({ params }: { params: Promise<{ address: string }> }) {
    const { address: contract } = use(params);
    const { address: wallet, getClient, connect } = useWallet();
    const [collection, setCollection] = useState<Collection | null | undefined>(undefined);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

    const reload = useCallback(async () => {
        setCollection(await fetchCollection(contract).catch(() => null));
    }, [contract]);

    useEffect(() => {
        void reload();
        void fetchProviders()
            .then(setProviders)
            .catch(() => setProviders([]));
    }, [reload]);

    /** Send one write, then re-read the chain. */
    async function run(
        id: string,
        fn: (client: Awaited<ReturnType<typeof getClient>>) => Promise<{ hash: string }>,
    ) {
        setBusy(id);
        setNote(null);
        try {
            const client = await getClient();
            const { hash } = await fn(client);
            setNote({ kind: "ok", text: `Signed. ${hash.slice(0, 12)}…` });
            await reload();
        } catch (e) {
            setNote({
                kind: "bad",
                text: e instanceof Error ? e.message : "Your wallet cancelled that.",
            });
        } finally {
            setBusy(null);
        }
    }

    if (collection === undefined) {
        return (
            <p className="mx-auto max-w-2xl px-4 py-8 text-sm text-muted-foreground">Loading…</p>
        );
    }

    if (collection === null) {
        return (
            <div className="mx-auto max-w-md px-4 py-16 text-center">
                <h1 className="text-lg font-semibold">No collection there</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {shortAddress(contract)} is not an Aleatory collection, or it was published
                    moments ago and has not appeared yet.
                </p>
            </div>
        );
    }

    const isArtist = wallet !== null && wallet === collection.artist;

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link
                href="/manage"
                className="text-xs text-muted-foreground underline hover:text-foreground"
            >
                All your collections
            </Link>

            <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="truncate text-xl font-semibold tracking-tight">
                        {collection.name || shortAddress(collection.address)}
                    </h1>
                    <p className="mt-1 text-xs text-muted-foreground">
                        <a
                            href={tzktLink(collection.address)}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-foreground"
                        >
                            {shortAddress(collection.address)}
                        </a>
                        {" · "}
                        {collection.minted} minted
                        {collection.editionSize > 0
                            ? ` of ${collection.editionSize}`
                            : ", open edition"}
                    </p>
                </div>
                <Link
                    href={`/collection/${collection.address}`}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                >
                    View public page
                </Link>
            </header>

            {!isArtist && (
                <p className="mt-6 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                    {wallet
                        ? `This collection belongs to ${shortAddress(collection.artist)}. Connect that wallet to make changes.`
                        : "Connect the wallet that owns this collection to make changes."}
                    {!wallet && (
                        <button
                            type="button"
                            onClick={() => void connect()}
                            className="ml-2 underline hover:text-foreground"
                        >
                            Connect
                        </button>
                    )}
                </p>
            )}

            {note && (
                <p
                    className={`mt-6 rounded-md px-3 py-2 text-sm ${
                        note.kind === "ok"
                            ? "border border-success/40 bg-success/10"
                            : "border border-destructive/40 bg-destructive/10"
                    }`}
                >
                    {note.text}
                </p>
            )}

            <fieldset disabled={!isArtist || busy !== null} className="mt-8 space-y-4">
                <Control
                    title="Sale"
                    detail={
                        collection.soldOut
                            ? "This edition has sold out."
                            : collection.paused
                              ? "Nobody can mint while this is paused."
                              : "Open for minting."
                    }
                >
                    <button
                        type="button"
                        onClick={() =>
                            void run("pause", (c) =>
                                setPaused(c, collection.address, !collection.paused),
                            )
                        }
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
                    >
                        {busy === "pause" ? "Signing…" : collection.paused ? "Resume" : "Pause"}
                    </button>
                </Control>

                <ValueControl
                    title="Price"
                    detail="What a collector pays, before render costs."
                    initial={formatTez(Number(collection.priceMutez))}
                    suffix="ꜩ"
                    busy={busy === "price"}
                    onSubmit={(raw) => {
                        const mutez = parseTez(raw);
                        if (mutez === null) {
                            setNote({ kind: "bad", text: "That price does not look right." });
                            return;
                        }
                        void run("price", (c) => setPrice(c, collection.address, mutez));
                    }}
                />

                <ValueControl
                    title="Edition size"
                    detail={`Currently ${
                        collection.editionSize === 0 ? "open" : collection.editionSize
                    }. It can shrink to as low as ${collection.minted} minted, and can never grow.`}
                    initial={String(collection.editionSize)}
                    busy={busy === "edition"}
                    onSubmit={(raw) => {
                        const size = Number.parseInt(raw, 10);
                        if (!Number.isFinite(size) || size < 0) {
                            setNote({
                                kind: "bad",
                                text: "That edition size does not look right.",
                            });
                            return;
                        }
                        void run("edition", (c) => setEditionSize(c, collection.address, size));
                    }}
                />

                <Control
                    title="Render provider"
                    detail={`${shortAddress(collection.provider)}, ${formatTez(
                        Number(collection.renderGasMutez),
                    )} ꜩ per piece. You can switch at any time.`}
                >
                    <select
                        defaultValue=""
                        onChange={(e) => {
                            const next = providers.find((p) => p.address === e.target.value);
                            if (!next) return;
                            void run("provider", (c) =>
                                setProvider(
                                    c,
                                    collection.address,
                                    next.address,
                                    BigInt(next.renderGasMutez),
                                ),
                            );
                        }}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                    >
                        <option value="">{busy === "provider" ? "Signing…" : "Switch to…"}</option>
                        {providers
                            .filter((p) => p.address !== collection.provider)
                            .map((p) => (
                                <option key={p.address} value={p.address}>
                                    {p.name || shortAddress(p.address)} —{" "}
                                    {formatTez(p.renderGasMutez)} ꜩ
                                </option>
                            ))}
                    </select>
                </Control>

                <Control
                    title="Let Aleatory publish your images"
                    detail={
                        collection.trustResolver
                            ? `On. Writers authorised by the resolver at ${shortAddress(collection.resolver)} may publish metadata for your unrevealed pieces, which is what lets a provider work without further setup.`
                            : "Off. Only your chosen provider's agent may publish metadata here."
                    }
                >
                    <button
                        type="button"
                        onClick={() =>
                            void run("trust", (c) =>
                                setTrustResolver(c, collection.address, !collection.trustResolver),
                            )
                        }
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
                    >
                        {busy === "trust"
                            ? "Signing…"
                            : collection.trustResolver
                              ? "Turn off"
                              : "Turn on"}
                    </button>
                </Control>
            </fieldset>

            <section className="mt-10 border-t border-border pt-6">
                <h2 className="text-sm font-medium">Permanent</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                    Set when you published. These can never be changed.
                </p>
                <dl className="mt-3 divide-y divide-border rounded-lg border border-border text-sm">
                    <Row label="Generator" value={collection.codeUri} mono />
                    <Row label="Code hash" value={collection.codeHash} mono />
                    <Row
                        label="Royalty"
                        value={`${(collection.royaltyTotalBps / 100).toFixed(2)}% across ${
                            collection.royalties.length
                        } recipient${collection.royalties.length === 1 ? "" : "s"}`}
                    />
                    <Row label="Owner" value={<AccountLink address={collection.artist} />} />
                </dl>
            </section>
        </div>
    );
}

function Control({
    title,
    detail,
    children,
}: {
    title: string;
    detail: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

function ValueControl({
    title,
    detail,
    initial,
    suffix,
    busy,
    onSubmit,
}: {
    title: string;
    detail: string;
    initial: string;
    suffix?: string;
    busy: boolean;
    onSubmit: (raw: string) => void;
}) {
    const [value, setValue] = useState(initial);
    useEffect(() => setValue(initial), [initial]);

    return (
        <Control title={title} detail={detail}>
            <div className="flex items-center gap-2">
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    inputMode="decimal"
                    aria-label={title}
                    className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
                {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
                <button
                    type="button"
                    onClick={() => onSubmit(value)}
                    disabled={value === initial}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                >
                    {busy ? "Signing…" : "Set"}
                </button>
            </div>
        </Control>
    );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className={`min-w-0 truncate text-right ${mono ? "font-mono text-xs" : ""}`}>
                {value}
            </dd>
        </div>
    );
}

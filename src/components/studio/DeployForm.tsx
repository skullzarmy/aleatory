"use client";

import { cloneElement, isValidElement, useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { useWallet } from "@/context/WalletContext";
import { addresses } from "@/lib/router";
import { royaltyPreview, type RoyaltySplit } from "@provider/metadata";
import { parseTez, shortAddress } from "@/lib/utils";
import { tzktApi, tzktLink } from "@/lib/config";
import type { Provider } from "@/lib/providers";
import type { Draft } from "@/lib/draft";
import { getKind } from "@/lib/runtimes";
import { AccountName } from "@/components/account/AccountName";
import { CoverPicker } from "./CoverPicker";
import {
    publishCollection,
    type PublishResult,
    type PublishStage,
} from "@/lib/publish";

/**
 * Deploy a collection.
 *
 * Everything on this form except the price and the edition size is permanent
 * from the moment the collection exists, so the permanent fields say so, and
 * the royalty preview shows what each recipient will receive on a sale before
 * anything is signed.
 *
 * Given a draft, the generator comes from the studio rather than from a pointer
 * the artist types: the bytes that were checked are the bytes that get pinned.
 * Without one the form still accepts an `ipfs://` pointer, so a generator built
 * entirely outside this site can be published through it.
 */
export function DeployForm({ providers, draft }: { providers: Provider[]; draft?: Draft }) {
    const { address, connect, getClient } = useWallet();

    const [name, setName] = useState(draft?.name ?? "");
    const [description, setDescription] = useState("");
    const [codeUri, setCodeUri] = useState("");
    const [editionSize, setEditionSize] = useState("10");
    const [price, setPrice] = useState("1");
    const [royaltyTotal, setRoyaltyTotal] = useState("10");
    const [platformShare, setPlatformShare] = useState(false);
    const [platformPercent, setPlatformPercent] = useState("10");
    const [providerAddress, setProviderAddress] = useState(providers[0]?.address ?? "");
    const [trustResolver, setTrustResolver] = useState(false);
    // Deploy, look at it, announce it, then open it. A collection that opens
    // the instant it exists cannot be checked before someone mints from it.
    const [startPaused, setStartPaused] = useState(true);
    const [cover, setCover] = useState<{
        uri: string;
        thumbUri: string;
        seed: string;
    } | null>(null);

    const [stage, setStage] = useState<PublishStage | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Recipients that will never be paid, shown once and deployed past on a
    // second click. Cleared whenever a recipient changes, so an acknowledgement
    // never carries over to an address it was not about.
    const [royaltyWarnings, setRoyaltyWarnings] = useState<string[]>([]);
    const [acknowledged, setAcknowledged] = useState(false);
    const [checking, setChecking] = useState(false);
    const [done, setDone] = useState<PublishResult | null>(null);

    const provider = providers.find((p) => p.address === providerAddress);
    // The cover renders through the same isolate as everything else, so it
    // needs the same libraries the generator does.
    /**
     * Where a shared royalty goes: the marketplace's treasury.
     *
     * The marketplace contract itself was used here, and it cannot receive a
     * plain transfer. Now that a sale pays each royalty share in the same
     * operation, naming it would have made every sale of the collection
     * revert, permanently, because the royalty map has no setter.
     */
    const [platformAddress, setPlatformAddress] = useState("");
    useEffect(() => {
        void addresses()
            .then(async (a) => {
                const market = a.marketplaces[0];
                if (!market) return;
                const res = await fetch(`${tzktApi()}/v1/contracts/${market}/storage`);
                if (!res.ok) return;
                const { treasury } = (await res.json()) as { treasury?: string };
                if (treasury) setPlatformAddress(treasury);
            })
            .catch(() => {});
    }, []);

    const split: RoyaltySplit = useMemo(() => {
        const total = parseFloat(royaltyTotal) || 0;
        const recipients = [];
        if (address) {
            const platform = platformShare ? parseFloat(platformPercent) || 0 : 0;
            recipients.push({ address, percent: 100 - platform });
            // Only when it is actually known. Falling back to the artist's
            // own address made a share they meant to give us go to
            // themselves, written into a map with no setter, with every
            // number on screen still looking right.
            if (platform > 0 && platformAddress) {
                recipients.push({ address: platformAddress, percent: platform });
            }
        }
        return { totalPercent: total, recipients };
    }, [address, royaltyTotal, platformShare, platformPercent, platformAddress]);

    const preview = useMemo(() => royaltyPreview(split), [split]);

    // A new set of recipients is a new question. Without this, acknowledging a
    // warning about one address would deploy past an unchecked different one.
    const recipientKey = split.recipients.map((r) => r.address).join(",");
    useEffect(() => {
        setRoyaltyWarnings([]);
        setAcknowledged(false);
    }, [recipientKey]);

    /**
     * Everything that has to be true before a wallet is opened.
     *
     * Checked here rather than left to the contract, because a rejected
     * operation still costs an artist a signature and a confusing failure,
     * and every one of these is knowable beforehand.
     */
    function problem(): string | null {
        if (!address) return "Connect a wallet first.";
        if (!name.trim()) return "The collection needs a name.";
        if (!draft && !/^ipfs:\/\/.+/.test(codeUri.trim())) {
            return "Point at a generator with an ipfs:// URI.";
        }
        if (!provider) return "Choose a render provider.";
        if (draft && !cover) {
            return "Pick a cover. It is what your collection looks like everywhere it is listed.";
        }
        const size = Number.parseInt(editionSize, 10);
        if (!Number.isFinite(size) || size < 0) return "Edition size must be 0 or more.";
        const tez = parseTez(price);
        if (tez === null) return "That price is not an amount.";
        const royalty = parseFloat(royaltyTotal);
        if (!Number.isFinite(royalty) || royalty < 0 || royalty > 25) {
            return "Royalty must be between 0 and 25 percent, which is what marketplaces honour.";
        }
        if (platformShare) {
            const share = parseFloat(platformPercent);
            if (!Number.isFinite(share) || share < 0 || share > 100) {
                return "The platform's share is a percentage of your royalty, so it cannot be more than 100.";
            }
            if (share > 0 && royalty === 0) {
                return "There is no royalty to share. Set a royalty, or remove the platform's share.";
            }
            if (share > 0 && !platformAddress) {
                return "The platform's payout address has not loaded, so a share cannot be written to it. Try again, or publish without one.";
            }
        }
        return null;
    }

    /**
     * What each royalty recipient will actually receive.
     *
     * The marketplace pays every share inside the sale and asks first, so a
     * recipient that cannot take a plain transfer is skipped and its share
     * goes to the seller. That keeps the collection sellable. It also means
     * the address is never paid, on any sale, and `royalties` has no setter,
     * so nothing after this can put it right. This form is the last moment
     * the address is editable, which is why it is asked here.
     *
     * ALEATORY-001 section 1 puts this on any front end that originates
     * collections. A recipient whose entrypoint accepts the transfer and then
     * throws is the one case the contract cannot survive, and it is the one
     * the simulation exists to catch.
     */
    async function royaltyProblems(): Promise<{ fatal: string[]; warnings: string[] }> {
        const fatal: string[] = [];
        const warnings: string[] = [];
        const recipients = new Set(
            split.recipients.map((r) => r.address).filter((a) => a.startsWith("KT1")),
        );

        for (const recipient of recipients) {
            const where = shortAddress(recipient);
            try {
                const res = await fetch(
                    `/api/payable?address=${recipient}&source=${address ?? ""}`,
                );
                const body = (await res.json()) as { verdict?: string; why?: string };
                if (body.verdict === "reverts") {
                    fatal.push(
                        `${where} accepts a transfer and then fails (${body.why}). Every sale of this collection would revert, permanently. Use a different address.`,
                    );
                } else if (body.verdict === "skipped") {
                    warnings.push(
                        `${where} cannot be paid, because ${body.why}. Its share will go to the seller on every sale, and this cannot be changed after the collection exists.`,
                    );
                } else if (body.verdict !== "payable") {
                    warnings.push(
                        `${where} could not be checked (${body.why ?? "no answer"}). If it cannot receive tez, its share goes to the seller on every sale.`,
                    );
                }
            } catch {
                warnings.push(
                    `${where} could not be checked. If it cannot receive tez, its share goes to the seller on every sale.`,
                );
            }
        }
        return { fatal, warnings };
    }

    async function submit() {
        const bad = problem();
        if (bad) {
            setError(bad);
            return;
        }
        // Checked once. A recipient that reverts a sale stops this outright; a
        // recipient that will silently never be paid is shown and the artist
        // decides, because they may know something about the address that we
        // cannot see from here.
        if (!acknowledged) {
            setChecking(true);
            const { fatal, warnings } = await royaltyProblems();
            setChecking(false);
            if (fatal.length > 0) {
                setError(fatal.join(" "));
                setRoyaltyWarnings([]);
                return;
            }
            if (warnings.length > 0) {
                setError(null);
                setRoyaltyWarnings(warnings);
                setAcknowledged(true);
                return;
            }
            setAcknowledged(true);
        }
        if (!draft) {
            // Publishing a pointer someone else pinned is a different flow:
            // there are no bytes here to hash, so the guarantee that chain
            // state matches the document cannot be made from this page.
            setError("Open your generator in the studio to publish it.");
            return;
        }

        setError(null);
        setStage("encoding");
        try {
            const result = await publishCollection(
                await getClient(),
                {
                    draft,
                    name: name.trim(),
                    description: description.trim(),
                    artist: address as string,
                    editionSize: Number.parseInt(editionSize, 10),
                    priceMutez: parseTez(price) as bigint,
                    split,
                    provider: provider!.address,
                    maxRenderGasMutez: BigInt(provider!.renderGasMutez),
                    startPaused,
                    trustResolver,
                    coverUri: cover?.uri,
                    coverThumbUri: cover?.thumbUri,
                    coverSeed: cover?.seed,
                },
                setStage,
            );
            setDone(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : "The wallet refused it.");
        } finally {
            setStage(null);
        }
    }

    if (done) {
        return (
            <div className="space-y-4 rounded-lg border border-success/40 bg-success/10 p-6">
                <h2 className="text-lg font-semibold">{name} is on chain</h2>
                <p className="text-sm">
                    {startPaused
                        ? "It is paused, so nothing can mint until you open it."
                        : "It is open for minting."}
                </p>
                <dl className="space-y-1 text-xs">
                    <Fact label="Operation" value={done.hash} href={tzktLink(done.hash)} />
                    <Fact
                        label="Generator"
                        value={
                            done.codeBytes > 0
                                ? `${done.codeBytes.toLocaleString()} bytes in contract storage` +
                                  (done.codeEncoding === "gzip" ? ", gzipped" : "") +
                                  `, ${(done.codeBurnMutez / 1e6).toFixed(3)} \u2721 of storage`
                                : `too large for one operation, stored at ${done.codeUri}`
                        }
                    />
                    <Fact label="SHA-256" value={done.codeHashHex} />
                </dl>
                {done.codeBytes > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Your generator is stored in the contract itself, so the piece will
                        always render.
                    </p>
                )}
                <a
                    href={tzktLink(done.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                >
                    Watch it settle
                </a>
                <p className="text-xs text-muted-foreground">
                    Once it settles, the collection appears under{" "}
                    <a href="/manage" className="underline hover:text-foreground">
                        your collections
                    </a>
                    .
                </p>
            </div>
        );
    }

    return (
        <form
            className="space-y-6"
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
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

            <Field
                label="Description"
                permanent
                hint="Shown on your collection and on every piece."
            >
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="What the generator does, in a sentence or two."
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            {draft && (
                <Field
                    label="Cover"
                    hint="Shown wherever your collection is listed."
                >
                    <CoverPicker
                        html={draft.html}
                        params={draft.params}
                        baseSeed={draft.seed}
                        onCaptured={setCover}
                    />
                </Field>
            )}

            {draft ? (
                <Field
                    label="Generator"
                    permanent
                    hint="Stored in the contract when you publish."
                >
                    <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5 text-sm">
                        <p className="font-medium">{getKind(draft.kindId).label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {new TextEncoder().encode(draft.html).length.toLocaleString()} bytes
                            from your draft
                            {draft.params.length > 0 &&
                                `, ${draft.params.length} parameter${draft.params.length === 1 ? "" : "s"}: ${draft.params
                                    .map((p) => p.label || p.id)
                                    .join(", ")}`}
                        </p>
                    </div>
                </Field>
            ) : (
                <Field label="Generator" permanent hint="ipfs:// pointer to your code">
                    <input
                        value={codeUri}
                        onChange={(e) => setCodeUri(e.target.value)}
                        placeholder="ipfs://Qm..."
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                    />
                </Field>
            )}

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
                        ? [
                              `${provider.stats.delivered} published`,
                              provider.stats.medianBlocksToPublish !== null
                                  ? `${provider.stats.medianBlocksToPublish} blocks to publish`
                                  : null,
                              provider.stats.outstanding > 0
                                  ? `${provider.stats.outstanding} waiting`
                                  : null,
                              "switchable later",
                          ]
                              .filter(Boolean)
                              .join(", ")
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
                        <p className="text-sm font-medium">Let Aleatory publish images</p>
                        <p className="text-xs text-muted-foreground">
                            We can publish images if your provider does not, so nothing gets
                            stuck. You can turn this off at any time.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setTrustResolver((v) => !v)}
                        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                        {trustResolver ? "On" : "Off"}
                    </button>
                </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm font-medium">Support the platform</p>
                        <p className="text-xs text-muted-foreground">
                            Give Aleatory a cut of your royalty on resales. Your mint
                            price is yours in full: the contract takes nothing from it.
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
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step={1}
                            value={platformPercent}
                            onChange={(e) => setPlatformPercent(e.target.value)}
                            aria-label="Platform share, percent of your royalty"
                            className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
                        />
                        <span className="text-xs text-muted-foreground">
                            percent of your royalty, not of the mint price
                        </span>
                    </div>
                )}
            </div>

            <Field
                label="Royalty on each sale"
                permanent
                hint="0, or between 10 and 25 percent. The contract refuses more than 25."
            >
                <div className="flex items-center gap-3">
                    <input
                        type="range"
                        min={0}
                        max={25}
                        step={0.5}
                        value={Math.min(25, Math.max(0, parseFloat(royaltyTotal) || 0))}
                        onChange={(e) => setRoyaltyTotal(e.target.value)}
                        aria-label="Royalty percent"
                        className="min-w-0 flex-1"
                    />
                    <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={25}
                        step={0.5}
                        value={royaltyTotal}
                        onChange={(e) => setRoyaltyTotal(e.target.value)}
                        aria-label="Royalty percent"
                        className="w-20 rounded-md border border-border bg-background px-2 py-2 text-sm tabular-nums"
                    />
                    <span className="shrink-0 text-sm text-muted-foreground">%</span>
                </div>
            </Field>

            {preview.length > 0 && (
                <div className="space-y-1 rounded-lg bg-muted/50 p-4 text-sm">
                    <p className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        On every secondary sale
                    </p>
                    {preview.map((r) => (
                        <div key={r.address} className="flex justify-between">
                            <span className="text-muted-foreground">
                                <AccountName address={r.address} />
                            </span>
                            <span className="font-medium">
                                {r.percentOfSale.toFixed(2)}% of the sale price
                            </span>
                        </div>
                    ))}
                    <p className="pt-2 text-xs text-muted-foreground">
                        This split is fixed once you publish.
                    </p>
                </div>
            )}

            <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm font-medium">Open for minting immediately</p>
                        <p className="text-xs text-muted-foreground">
                            Off means it publishes paused, so you can check it over and
                            announce it first.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setStartPaused((v) => !v)}
                        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                    >
                        {startPaused ? "Off" : "On"}
                    </button>
                </div>
            </div>

            {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    {error}
                </p>
            )}

            {royaltyWarnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    <p className="font-medium">Read this before you sign.</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                        {royaltyWarnings.map((w) => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs">
                        Change the address above, or deploy anyway.
                    </p>
                </div>
            )}

            <button
                type={address ? "submit" : "button"}
                onClick={address ? undefined : () => void connect()}
                disabled={stage !== null || checking}
                className="w-full rounded-md bg-alea-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
            >
                {!address
                    ? "Connect to deploy"
                    : stage
                      ? STAGE_LABEL[stage]
                      : checking
                        ? "Checking royalty recipients…"
                        : royaltyWarnings.length > 0
                          ? "Deploy anyway"
                          : "Deploy collection"}
            </button>

            <p className="text-xs text-muted-foreground">
                One signature. The collection is yours, and we have no control over it.
            </p>
        </form>
    );
}

const STAGE_LABEL: Record<PublishStage, string> = {
    encoding: "Preparing the generator…",
    "pinning-metadata": "Pinning the metadata…",
    signing: "Waiting for your signature…",
};

function Fact({
    label,
    value,
    href,
}: {
    label: string;
    value: string;
    href?: string;
}) {
    return (
        <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate font-mono">
                {href ? (
                    <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                        title={value}
                    >
                        {value}
                    </a>
                ) : (
                    value
                )}
            </dd>
        </div>
    );
}

/**
 * A labelled field.
 *
 * The label used to sit beside the input with no `htmlFor`, which looks like a
 * label and is not one: nothing announces it, and clicking it does not focus
 * the field. The id is generated here and handed to the child, so every input
 * this wraps is labelled without each call site remembering to.
 */
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
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;

    // The child is the control. Give it the id the label points at, and the
    // hint as its description, unless the call site set them itself.
    const control = isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
              id: (children.props as { id?: string }).id ?? id,
              "aria-describedby":
                  (children.props as { "aria-describedby"?: string })["aria-describedby"] ??
                  hintId,
          })
        : children;

    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
                <label htmlFor={id} className="text-sm font-medium">
                    {label}
                </label>
                {permanent && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        permanent
                    </span>
                )}
            </div>
            {control}
            {hint && (
                <p id={hintId} className="text-xs text-muted-foreground">
                    {hint}
                </p>
            )}
        </div>
    );
}

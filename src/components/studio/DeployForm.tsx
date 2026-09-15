"use client";

import {
    cloneElement,
    isValidElement,
    useEffect,
    useId,
    useMemo,
    useState,
    type ReactElement,
} from "react";
import { useWallet } from "@/context/WalletContext";
import { addresses } from "@/lib/router";
import { royaltyPreview, type RoyaltySplit } from "@provider/metadata";
import { parseTez, shortAddress } from "@/lib/utils";
import { tzktApi, tzktLink } from "@/lib/config";
import type { Provider } from "@/lib/providers";
import type { Draft } from "@/lib/draft";
import { getKind } from "@/lib/runtimes";
import { detectParams } from "@/lib/detect";
import { AccountName } from "@/components/account/AccountName";
import { CoverPicker } from "./CoverPicker";
import { useDeps } from "./useDeps";
import { declaredIn, recordFor } from "@/lib/libraries";
import {
    estimateSignatures,
    publishGenerator,
    type PublishResult,
    type PublishStage,
    type UploadProgress,
} from "@/lib/publish";

/**
 * Deploy a generator. Everything here except the price and the edition size is
 * permanent from the moment the generator exists, and the fields say so.
 *
 * Given a draft, the source comes from the studio, so the bytes that were
 * checked are the bytes that get pinned. Without one the form takes an
 * `ipfs://` pointer, so work built outside this site can be published
 * through it.
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
    // Deploy, look at it, announce it, then open it. A generator that opens
    // the instant it exists cannot be checked before someone mints from it.
    const [startPaused, setStartPaused] = useState(true);
    const [cover, setCover] = useState<{
        uri: string;
        thumbUri: string;
        seed: string;
    } | null>(null);

    const [stage, setStage] = useState<PublishStage | null>(null);
    const [upload, setUpload] = useState<UploadProgress | null>(null);
    const [signatures, setSignatures] = useState(1);
    const [error, setError] = useState<string | null>(null);
    // Recipients that will never be paid, shown once and deployed past on a
    // second click.
    const [royaltyWarnings, setRoyaltyWarnings] = useState<string[]>([]);
    const [acknowledged, setAcknowledged] = useState(false);
    const [checking, setChecking] = useState(false);
    const [done, setDone] = useState<PublishResult | null>(null);

    // What the wallet will ask for, said before it starts asking.
    useEffect(() => {
        let cancelled = false;
        void estimateSignatures(draft?.html ?? "").then((n) => {
            if (!cancelled) setSignatures(n);
        });
        return () => {
            cancelled = true;
        };
    }, [draft?.html]);

    const provider = providers.find((p) => p.address === providerAddress);
    /**
     * Where a shared royalty goes: the marketplace's treasury, never the
     * marketplace contract, which cannot receive a plain transfer. A sale pays
     * each royalty share in the same operation, and the royalty map has no
     * setter, so an address that cannot be paid is permanent.
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
            // Only when it is known. There is no fallback, because the wrong
            // address here is written into a map with no setter.
            if (platform > 0 && platformAddress) {
                recipients.push({ address: platformAddress, percent: platform });
            }
        }
        return { totalPercent: total, recipients };
    }, [address, royaltyTotal, platformShare, platformPercent, platformAddress]);

    const preview = useMemo(() => royaltyPreview(split), [split]);

    // The same source the publish path reads, so the form shows what is about
    // to be written on chain.
    const declared = useMemo(
        () => (draft ? (detectParams(draft.html)?.params ?? []) : []),
        [draft],
    );

    // Resolved once, and used for both halves of the job: the cover is drawn
    // with these bytes and their digests are what goes on chain, so the record
    // names the file the artist actually looked at.
    const {
        deps,
        resolved: resolvedDeps,
        ready: depsReady,
        error: depsError,
    } = useDeps(draft?.html ?? "");

    // A new set of recipients is a new question, or acknowledging a warning
    // about one address deploys past an unchecked different one.
    const recipientKey = split.recipients.map((r) => r.address).join(",");
    useEffect(() => {
        setRoyaltyWarnings([]);
        setAcknowledged(false);
    }, [recipientKey]);

    /**
     * Everything that has to be true before a wallet is opened. All of it is
     * knowable here, and a rejected operation still costs a signature.
     */
    function problem(): string | null {
        if (!address) return "Connect a wallet first.";
        if (!name.trim()) return "The generator needs a name.";
        if (!draft && !/^ipfs:\/\/.+/.test(codeUri.trim())) {
            return "Point at your source with an ipfs:// URI.";
        }
        if (!provider) return "Choose a render provider.";
        // Before the cover, which cannot be captured correctly without them,
        // and long before a signature. The record has no setter.
        if (draft) {
            if (depsError) return depsError;
            if (!depsReady) return "The libraries this generator declares are still loading.";
            const record = recordFor(
                draft.html,
                resolvedDeps.map((r) => r.spec),
            );
            if (!record.ok) return record.problems.join(" ");
        }
        if (draft && !cover) {
            return "Pick a cover. It is what your generator looks like everywhere it is listed.";
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
     * The marketplace asks before it pays, so a recipient that cannot take a
     * plain transfer is skipped and its share goes to the seller. `royalties`
     * has no setter, so this form is the last moment the address is editable.
     *
     * ALEATORY-001 §1 puts this on any front end that originates generators. A
     * recipient whose entrypoint accepts the transfer and then throws is the
     * case the contract cannot survive, and what the simulation catches.
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
                        `${where} accepts a transfer and then fails (${body.why}). Every sale of this generator would revert, permanently. Use a different address.`,
                    );
                } else if (body.verdict === "skipped") {
                    warnings.push(
                        `${where} cannot be paid, because ${body.why}. Its share will go to the seller on every sale, and this cannot be changed after the generator exists.`,
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
        // Checked once. A recipient that reverts a sale stops this outright.
        // One that will never be paid is shown, and the artist decides.
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
            // No bytes here to hash, so chain state cannot be tied to the
            // document from this page.
            setError("Open your draft in the studio to publish it.");
            return;
        }

        setError(null);
        setStage("encoding");
        try {
            const result = await publishGenerator(
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
                    resolvedLibraries: resolvedDeps.map((r) => r.spec),
                    startPaused,
                    trustResolver,
                    coverUri: cover?.uri,
                    coverThumbUri: cover?.thumbUri,
                    coverSeed: cover?.seed,
                },
                setStage,
                setUpload,
            );
            setDone(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : "The wallet refused it.");
        } finally {
            setStage(null);
            setUpload(null);
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
                    {/* Empty when this run only finished an upload a previous
                        one started, where the deploy belongs to that attempt. */}
                    {done.hash && (
                        <Fact label="Operation" value={done.hash} href={tzktLink(done.hash)} />
                    )}
                    {done.generator && (
                        <Fact
                            label="Generator"
                            value={done.generator}
                            href={tzktLink(done.generator)}
                        />
                    )}
                    <Fact
                        label="Source"
                        value={
                            done.codeBytes > 0
                                ? `${done.codeBytes.toLocaleString("en-US")} bytes in contract storage` +
                                  (done.codeEncoding === "gzip" ? ", gzipped" : "") +
                                  (done.chunks > 0 ? `, sent in ${done.chunks} parts` : "") +
                                  `, ${(done.codeBurnMutez / 1e6).toFixed(3)} \u2721 of storage`
                                : `too large to carry on chain, stored at ${done.codeUri}`
                        }
                    />
                    <Fact label="SHA-256" value={done.codeHashHex} />
                </dl>
                {done.codeBytes > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Your source is stored in the contract itself, so the piece will always
                        render.
                    </p>
                )}
                <a
                    href={tzktLink(done.hash || done.generator)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                >
                    Watch it settle
                </a>
                <p className="text-xs text-muted-foreground">
                    Once it settles, the generator appears under{" "}
                    <a href="/manage" className="underline hover:text-foreground">
                        your generators
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
            <Field label="Generator name" permanent>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Drift"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            <Field label="Description" permanent hint="Shown on your generator and on every piece.">
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="What the generator does, in a sentence or two."
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
            </Field>

            {draft && (
                <Field label="Cover" hint="Shown wherever your generator is listed.">
                    {/* A gate, not a prop that arrives late. A p5 sketch with no
                        p5 still fills a canvas, so a cover captured early is a
                        valid PNG of nothing and nothing downstream can tell. */}
                    {depsError ? (
                        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {depsError}
                        </p>
                    ) : !depsReady ? (
                        <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                            Loading {declaredIn(draft.html).join(", ") || "libraries"}…
                        </p>
                    ) : (
                        <CoverPicker
                            html={draft.html}
                            params={declared}
                            deps={deps}
                            baseSeed={draft.seed}
                            onCaptured={setCover}
                        />
                    )}
                </Field>
            )}

            {draft ? (
                <Field label="Source" permanent hint="Stored in the contract when you publish.">
                    <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5 text-sm">
                        <p className="font-medium">{getKind(draft.kindId).label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {new TextEncoder().encode(draft.html).length.toLocaleString("en-US")}{" "}
                            bytes from your draft
                            {declared.length > 0 &&
                                `, ${declared.length} parameter${declared.length === 1 ? "" : "s"}: ${declared
                                    .map((p) => p.label || p.id)
                                    .join(", ")}`}
                        </p>
                    </div>
                </Field>
            ) : (
                <Field label="Source" permanent hint="ipfs:// pointer to your code">
                    <input
                        value={codeUri}
                        onChange={(e) => setCodeUri(e.target.value)}
                        placeholder="ipfs://Qm..."
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                    />
                </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <Field
                    label="Edition size"
                    hint="0 for an open edition. It can shrink later, never grow."
                >
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
                            We can publish images if your provider does not, so nothing gets stuck.
                            You can turn this off at any time.
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
                            Give Aleatory a cut of your royalty on resales. Your mint price is yours
                            in full: the contract takes nothing from it.
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
                        <div key={r.address} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate text-muted-foreground">
                                <AccountName address={r.address} />
                            </span>
                            <span className="shrink-0 font-medium">
                                {r.percentOfSale.toFixed(2)}%
                                <span className="hidden sm:inline"> of the sale price</span>
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
                            Off means it publishes paused, so you can check it over and announce it
                            first.
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
                    <p className="mt-2 text-xs">Change the address above, or deploy anyway.</p>
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
                      ? upload
                          ? `Signing chunk ${upload.chunk} of ${upload.of}…`
                          : STAGE_LABEL[stage]
                      : checking
                        ? "Checking royalty recipients…"
                        : royaltyWarnings.length > 0
                          ? "Deploy anyway"
                          : "Deploy generator"}
            </button>

            <p className="text-xs text-muted-foreground">
                {signatures > 1
                    ? `Around ${signatures} signatures: this generator is past what one operation carries, so it is written to the chain a piece at a time. Stopping part way is safe, and publishing again continues where it left off.`
                    : "One signature."}{" "}
                The generator is yours, and we have no control over it.
            </p>
        </form>
    );
}

const STAGE_LABEL: Record<PublishStage, string> = {
    encoding: "Preparing the source…",
    "pinning-metadata": "Pinning the metadata…",
    signing: "Waiting for your signature…",
    uploading: "Writing the generator to the chain…",
    sealing: "Closing the generator…",
};

function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
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
 * A labelled field. The id is generated here and handed to the child, so every
 * input this wraps is labelled without each call site remembering to.
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

    // The child is the control, unless the call site set these itself.
    const control = isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
              id: (children.props as { id?: string }).id ?? id,
              "aria-describedby":
                  (children.props as { "aria-describedby"?: string })["aria-describedby"] ?? hintId,
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

"use client";

import {
    cloneElement,
    isValidElement,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactElement,
} from "react";
import { useWallet } from "@/context/WalletContext";
import { addresses } from "@/lib/router";
import { royaltyPreview, type RoyaltySplit } from "@provider/metadata";
import { parseTez, shortAddress } from "@/lib/utils";
import { tzktApi, tzktLink, objktManageLink, objktTokenLinkTemplate } from "@/lib/config";
import { CopyField } from "@/components/CopyField";
import type { Provider } from "@/lib/providers";
import { saveDraft, type Draft } from "@/lib/draft";
import { getKind } from "@/lib/runtimes";
import { detectParams } from "@/lib/detect";
import { AccountName } from "@/components/account/AccountName";
import { CoverPicker } from "./CoverPicker";
import { TagInput } from "./TagInput";
import { SplitTable, isSplitAddress, type SplitRow } from "./SplitTable";
import { ArtistList } from "./ArtistList";
import { MissingArtists } from "./MissingArtists";
import { useDeps } from "@/components/useDeps";
import { declaredIn, recordFor } from "@/lib/libraries";
import { ipfsImageUrl } from "@/utils/ipfs";
import { Pencil, Check } from "lucide-react";
import { CoverThumbnail } from "./PreflightModal";
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
    const [description, setDescription] = useState(draft?.description ?? "");
    const [tags, setTags] = useState<string[]>(draft?.tags ?? []);
    const [codeUri, setCodeUri] = useState("");
    const [editionSize, setEditionSize] = useState("10");
    const [price, setPrice] = useState("1");
    const [royaltyTotal, setRoyaltyTotal] = useState("10");
    const [platformShare, setPlatformShare] = useState(false);
    /**
     * Two independent asks, both out of the artist's own share and both zero
     * until somebody types a number. The mint one puts the treasury in the
     * mint split and never in the artists list: it is a cut, which is the
     * distinction the two lists exist for.
     */
    const [platformPercent, setPlatformPercent] = useState("10");
    const [platformMintPercent, setPlatformMintPercent] = useState("0");
    /**
     * Three separate questions, asked separately: who made it, who the mint
     * price goes to, and who the resale royalty goes to. None of them implies
     * another, and none of these lists holds the connected wallet, who is
     * always an artist and always takes each remainder.
     */
    const [artists, setArtists] = useState<string[]>(draft?.artists ?? []);
    const [payeeRows, setPayeeRows] = useState<SplitRow[]>(draft?.collab ?? []);
    const [royaltyRows, setRoyaltyRows] = useState<SplitRow[]>(draft?.royaltyRecipients ?? []);
    const [providerAddress, setProviderAddress] = useState(providers[0]?.address ?? "");
    const [trustResolver, setTrustResolver] = useState(true);
    // Opt-in, off by default. The feature key whose value becomes part of
    // each piece's name — empty means every piece keeps the plain
    // "<Generator> #<n>" form every indexer expects.
    const [nameTrait, setNameTrait] = useState(draft?.nameTrait ?? "");
    // Deploy, look at it, announce it, then open it. A generator that opens
    // the instant it exists cannot be checked before someone mints from it.
    const [startPaused, setStartPaused] = useState(true);
    const [cover, setCover] = useState<{
        uri: string;
        thumbUri: string;
        seed: string;
    } | null>(draft?.cover ?? null);
    const [editingMetadata, setEditingMetadata] = useState(false);

    const [stage, setStage] = useState<PublishStage | null>(null);
    const [upload, setUpload] = useState<UploadProgress | null>(null);
    const [signatures, setSignatures] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [pendingUpload, setPendingUpload] = useState(draft?.pendingUpload);
    const [abandoning, setAbandoning] = useState(false);
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

    // This form remounts fresh every time the publish route loads, so name,
    // description and tags are otherwise ordinary local state. Navigate away
    // to check something and back, and whatever was typed is gone. Same
    // debounced-save shape Workspace.tsx already uses for the rest of a draft.
    // No draft (the ipfs:// pointer path) has nothing to save into.
    // One comparison, reached from the debounce and from the unmount flush
    // below. Two copies of it drifted the moment a field was added to only
    // one of them.
    const editable = { name, description, tags, nameTrait, cover, artists, payeeRows, royaltyRows };
    type Editable = typeof editable;
    function flush(d: Draft, v: Editable) {
        const sameList = (a: SplitRow[] | undefined, b: SplitRow[]) =>
            (a ?? []).length === b.length &&
            (a ?? []).every((r, i) => r.address === b[i].address && r.percent === b[i].percent);
        const sameTags =
            (d.tags ?? []).length === v.tags.length &&
            (d.tags ?? []).every((t, i) => t === v.tags[i]);
        const sameArtists =
            (d.artists ?? []).length === v.artists.length &&
            (d.artists ?? []).every((a: string, i: number) => a === v.artists[i]);
        if (
            d.name === v.name &&
            (d.description ?? "") === v.description &&
            (d.nameTrait ?? "") === v.nameTrait &&
            d.cover?.uri === v.cover?.uri &&
            sameTags &&
            sameArtists &&
            sameList(d.collab, v.payeeRows) &&
            sameList(d.royaltyRecipients, v.royaltyRows)
        )
            return;
        void saveDraft({
            ...d,
            name: v.name,
            description: v.description,
            tags: v.tags,
            nameTrait: v.nameTrait,
            cover: v.cover ?? undefined,
            artists: v.artists,
            collab: v.payeeRows,
            royaltyRecipients: v.royaltyRows,
        });
    }

    useEffect(() => {
        if (!draft) return;
        const t = setTimeout(() => flush(draft, latest.current.editable), 600);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft, name, description, tags, nameTrait, cover, artists, payeeRows, royaltyRows]);

    // The effect above cancels its own timer on every keystroke, by design —
    // that's the debounce. But its cleanup also runs on a real unmount, which
    // looks identical to "settled, waiting out the 600ms" from in here: typing
    // and navigating away inside that window cancelled the only save that was
    // ever going to happen for it. A ref keeps the latest values reachable
    // from a cleanup that only fires on the real thing (empty deps), so an
    // unmount flushes immediately instead of just cancelling.
    const latest = useRef({ draft, editable });
    latest.current = { draft, editable };
    useEffect(() => {
        return () => {
            const { draft, editable } = latest.current;
            if (draft) flush(draft, editable);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    /** Named rows that parse, with their percentages. */
    const named = (rows: SplitRow[]) =>
        rows
            .filter((r) => isSplitAddress(r.address))
            .map((r) => ({ address: r.address.trim(), percent: parseFloat(r.percent) || 0 }));

    const payeeNamed = useMemo(() => named(payeeRows), [payeeRows]);
    const royaltyNamed = useMemo(() => named(royaltyRows), [royaltyRows]);

    /**
     * Who made it. The connected wallet always, plus whoever they named. The
     * contract requires the signer here, since they are credited from the
     * moment the generator exists.
     */
    const credited = useMemo(
        () => [
            ...(address ? [address] : []),
            ...artists.map((a) => a.trim()).filter(isSplitAddress),
        ],
        [address, artists],
    );

    /**
     * Artists missing from a money split, per split.
     *
     * The three lists are independent on purpose, which is also how somebody
     * ends up credited and unpaid. Worth saying before the signature and not
     * worth blocking on: an artist who waived the mint and kept royalties is
     * a real arrangement, and neither map has a setter. Silent for a solo
     * generator, which has nobody to leave out.
     */
    const gapsAgainst = (present: Set<string>) =>
        credited.length < 2 ? [] : credited.filter((a) => a !== address && !present.has(a));

    const mintGaps = useMemo(
        () => gapsAgainst(new Set(payeeNamed.map((r) => r.address))),
        [credited, payeeNamed, address],
    );
    const royaltyGaps = useMemo(
        () => gapsAgainst(new Set(royaltyNamed.map((r) => r.address))),
        [credited, royaltyNamed, address],
    );

    /**
     * Added at an even share of what the owner currently holds, taken from
     * their own remainder so the click can never overdraw a table. Any number
     * picked for them is a guess at the deal, so an even cut is the one that
     * assumes least.
     *
     * Floors to two places and refuses to emit zero: a remainder too small to
     * divide would otherwise add rows at 0%, which the contract drops and
     * validation then blocks on, so the button would produce a state the form
     * rejects.
     */
    const SMALLEST_SHARE = 0.01;
    const shareOut = (rows: SplitRow[], ownerPercent: number, missing: string[]) => {
        const each = Math.floor((ownerPercent / (missing.length + 1)) * 100) / 100;
        if (each < SMALLEST_SHARE) return rows;
        return [...rows, ...missing.map((a) => ({ address: a, percent: String(each) }))];
    };
    const canShareOut = (ownerPercent: number, missing: string[]) =>
        Math.floor((ownerPercent / (missing.length + 1)) * 100) / 100 >= SMALLEST_SHARE;

    const platform = platformShare ? parseFloat(platformPercent) || 0 : 0;
    const platformMint = platformShare ? parseFloat(platformMintPercent) || 0 : 0;

    /** What the connected wallet is left with on each table. */
    const mintOwnerPercent = 100 - platformMint - payeeNamed.reduce((n, r) => n + r.percent, 0);
    const royaltyOwnerPercent = 100 - platform - royaltyNamed.reduce((n, r) => n + r.percent, 0);

    /** Who the mint price is divided between. Always totals 100%. */
    const collab: RoyaltySplit = useMemo(
        () => ({
            totalPercent: 100,
            recipients: address
                ? [
                      { address, percent: mintOwnerPercent },
                      ...payeeNamed,
                      // Only when it is known. No fallback: the wrong address
                      // here is written into a map with no setter.
                      ...(platformMint > 0 && platformAddress
                          ? [{ address: platformAddress, percent: platformMint }]
                          : []),
                  ]
                : [],
        }),
        [address, mintOwnerPercent, payeeNamed, platformMint, platformAddress],
    );

    const split: RoyaltySplit = useMemo(() => {
        const total = parseFloat(royaltyTotal) || 0;
        const recipients = [];
        if (address) {
            recipients.push({ address, percent: royaltyOwnerPercent });
            recipients.push(...royaltyNamed);
            // Only when it is known. There is no fallback, because the wrong
            // address here is written into a map with no setter.
            if (platform > 0 && platformAddress) {
                recipients.push({ address: platformAddress, percent: platform });
            }
        }
        return { totalPercent: total, recipients };
    }, [address, royaltyTotal, royaltyOwnerPercent, royaltyNamed, platform, platformAddress]);

    const preview = useMemo(() => royaltyPreview(split), [split]);
    const collabPreview = useMemo(() => royaltyPreview(collab), [collab]);

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
    const recipientKey = [...split.recipients, ...collab.recipients]
        .map((r) => r.address)
        .join(",");
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
            if (draft.preflightPassedHtml !== draft.html) {
                return "Pass pre-flight checks before publishing.";
            }
        }
        if (draft && !cover) {
            return "Pick a cover. It is what your generator looks like everywhere it is listed.";
        }
        const size = Number.parseInt(editionSize, 10);
        if (!Number.isFinite(size) || size < 0) return "Edition size must be 0 or more.";
        const tez = parseTez(price);
        if (tez === null) return "That price is not an amount.";

        // Every address here is written into a map with no setter, so a row
        // half typed is permanent, and a zero share is dropped on the way to
        // the contract, which leaves that person in neither list.
        for (const a of artists) {
            if (!isSplitAddress(a)) {
                return "That artist address is not a Tezos address. Fix it or remove the row.";
            }
        }
        if (new Set(credited).size !== credited.length) {
            return "One address is listed twice as an artist.";
        }
        for (const [rows, what] of [
            [payeeRows, "person sharing the mint"],
            [royaltyRows, "royalty recipient"],
        ] as const) {
            for (const r of rows) {
                if (!isSplitAddress(r.address)) {
                    return `That ${what}'s address is not a Tezos address. Fix it or remove the row.`;
                }
                if (!((parseFloat(r.percent) || 0) > 0)) {
                    return `Give every ${what} a share above 0, or remove them.`;
                }
            }
        }
        if (mintOwnerPercent < 0) {
            return "The mint split adds up to more than the whole mint price.";
        }
        // The signer takes the rounding remainder and any share that cannot
        // be delivered, so the contract refuses a split they are not in, and
        // a zero share would drop them from it.
        if (mintOwnerPercent <= 0) {
            return "Keep some share of the mint price for yourself. The contract refuses a split the person deploying is not part of.";
        }
        if (
            new Set([address, ...payeeNamed.map((r) => r.address)]).size !==
            payeeNamed.length + 1
        ) {
            return "One address appears twice in the mint split.";
        }
        // Not a product limit. The payout walks this map inside every mint,
        // and an operation has a gas ceiling it would eventually hit, with no
        // setter to undo it.
        if (payeeNamed.length + 1 > 50) {
            return "A mint can be split between at most 50 addresses, including you.";
        }
        const royalty = parseFloat(royaltyTotal);
        if (!Number.isFinite(royalty) || royalty < 0 || royalty > 25) {
            return "Royalty must be between 0 and 25 percent, which is what marketplaces honour.";
        }
        if (royaltyOwnerPercent < 0) {
            return "The royalty recipients and the platform share add up to more than the whole royalty.";
        }
        if (platformShare) {
            const mintShare = parseFloat(platformMintPercent);
            if (!Number.isFinite(mintShare) || mintShare < 0 || mintShare > 100) {
                return "The platform's share of a mint is a percentage of the mint price, so it cannot be more than 100.";
            }
            if (mintShare > 0 && !platformAddress) {
                return "The platform's payout address has not loaded, so a share cannot be written to it. Try again, or publish without one.";
            }
            if (mintShare > 0 && payeeNamed.some((r) => r.address === platformAddress)) {
                return "The platform is already in your mint split. Remove that row, or set its support share to 0.";
            }
            const share = parseFloat(platformPercent);
            if (!Number.isFinite(share) || share < 0 || share > 100) {
                return "The platform's share is a percentage of your royalty, so it cannot be more than 100.";
            }
            if (share > 0 && royalty === 0) {
                return "There is no royalty to share. Set a royalty, or set the platform's royalty share to 0.";
            }
            if (mintShare === 0 && share === 0) {
                return "Set a share for the platform, or remove it.";
            }
            if (share > 0 && !platformAddress) {
                return "The platform's payout address has not loaded, so a share cannot be written to it. Try again, or publish without one.";
            }
        }
        return null;
    }

    /**
     * Whether every address on both splits can actually be paid.
     *
     * Both maps are written at origination and have no setter, so this form
     * is the last moment either address is editable. What a skipped share
     * does differs by table, which is why the copy does: a royalty share
     * that cannot be delivered goes to the seller on each resale, and a mint
     * share that cannot be delivered goes to whoever deployed.
     *
     * ALEATORY-001 §1 puts this on any front end that originates generators.
     * A recipient whose entrypoint accepts the transfer and then throws is
     * the case neither contract can survive, and what the simulation catches:
     * it would revert every resale, or every mint, for good.
     */
    async function recipientProblems(
        addresses: string[],
        skippedGoesTo: string,
        revertsBreaks: string,
    ): Promise<{ fatal: string[]; warnings: string[] }> {
        const fatal: string[] = [];
        const warnings: string[] = [];
        const originated = [...new Set(addresses)].filter((a) => a.startsWith("KT1"));

        await Promise.all(
            originated.map(async (recipient) => {
                const where = shortAddress(recipient);
                try {
                    const res = await fetch(
                        `/api/payable?address=${recipient}&source=${address ?? ""}`,
                    );
                    const body = (await res.json()) as { verdict?: string; why?: string };
                    if (body.verdict === "reverts") {
                        fatal.push(
                            `${where} accepts a transfer and then fails (${body.why}). Every ${revertsBreaks} would revert, permanently. Use a different address.`,
                        );
                    } else if (body.verdict === "skipped") {
                        warnings.push(
                            `${where} cannot be paid, because ${body.why}. Its share will go to ${skippedGoesTo}, and this cannot be changed after the generator exists.`,
                        );
                    } else if (body.verdict !== "payable") {
                        warnings.push(
                            `${where} could not be checked (${body.why ?? "no answer"}). If it cannot receive tez, its share goes to ${skippedGoesTo}.`,
                        );
                    }
                } catch {
                    warnings.push(
                        `${where} could not be checked. If it cannot receive tez, its share goes to ${skippedGoesTo}.`,
                    );
                }
            }),
        );
        return { fatal, warnings };
    }

    async function royaltyProblems(): Promise<{ fatal: string[]; warnings: string[] }> {
        const [royalty, mint] = await Promise.all([
            recipientProblems(
                split.recipients.map((r) => r.address),
                "the seller on every sale",
                "sale of this generator",
            ),
            recipientProblems(
                collab.recipients.map((r) => r.address),
                "you on every mint",
                "mint of this generator",
            ),
        ]);
        return {
            fatal: [...royalty.fatal, ...mint.fatal],
            warnings: [...royalty.warnings, ...mint.warnings],
        };
    }

    // No contract entrypoint clears `code`, so this cannot touch the stuck
    // generator. It only stops this draft from resuming into it. The
    // generator itself stays on chain, unsealed, abandoned.
    async function abandonPendingUpload() {
        if (!draft || !pendingUpload) return;
        setAbandoning(true);
        try {
            await saveDraft({ ...draft, pendingUpload: undefined });
            setPendingUpload(undefined);
        } finally {
            setAbandoning(false);
        }
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
                    draft: { ...draft, pendingUpload },
                    name: name.trim(),
                    description: description.trim(),
                    tags,
                    artist: address as string,
                    editionSize: Number.parseInt(editionSize, 10),
                    priceMutez: parseTez(price) as bigint,
                    split,
                    collab,
                    collabCreditable: credited,
                    provider: provider!.address,
                    maxRenderGasMutez: BigInt(provider!.renderGasMutez),
                    resolvedLibraries: resolvedDeps.map((r) => r.spec),
                    startPaused,
                    trustResolver,
                    nameTrait: nameTrait.trim() || undefined,
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
                            `${done.codeBytes.toLocaleString("en-US")} bytes in contract storage` +
                            (done.codeEncoding === "gzip" ? ", gzipped" : "") +
                            (done.chunks > 0 ? `, sent in ${done.chunks} parts` : "") +
                            `, ${(done.codeBurnMutez / 1e6).toFixed(3)} \u2721 of storage`
                        }
                    />
                    <Fact label="SHA-256" value={done.codeHashHex} />
                </dl>
                <p className="text-xs text-muted-foreground">
                    Your source is stored in the contract itself, so the piece will always render.
                </p>
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

                {done.generator && (
                    <div className="space-y-2 border-t border-success/40 pt-4">
                        <h3 className="text-sm font-medium">List nicely on objkt</h3>
                        <p className="text-xs text-muted-foreground">
                            A logo, a banner and a token link live on objkt's own collection page,
                            not in anything your contract carries. Open your collection there and
                            paste this into its Token link field, so a piece viewed on objkt links
                            back to its page here, and set up an icon and a banner while you're
                            there.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Clear the Website field first: it's filled from this contract's own
                            metadata, and objkt refuses to save the page until it's empty, since a
                            website there needs a domain verified through tzprofiles.
                        </p>
                        <a
                            href={objktManageLink(done.generator)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                        >
                            Open on objkt
                        </a>
                        <CopyField
                            value={objktTokenLinkTemplate(done.generator)}
                            label="Token link"
                        />
                    </div>
                )}
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
            {pendingUpload && (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-xs">
                    <p>
                        An earlier publish of this draft stopped partway through sending code on
                        chain, to{" "}
                        <a
                            href={tzktLink(pendingUpload)}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                        >
                            {shortAddress(pendingUpload)}
                        </a>
                        . Publishing again resumes it from exactly where it stopped.
                    </p>
                    <p>
                        To deploy fresh instead, abandon it first. The unfinished contract stays on
                        chain, unsealed, and can never mint. There is nothing to undo, it just sits
                        unused.
                    </p>
                    <button
                        type="button"
                        onClick={() => void abandonPendingUpload()}
                        disabled={abandoning}
                        className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-accent disabled:opacity-50"
                    >
                        {abandoning ? "Abandoning…" : "Abandon it, deploy fresh instead"}
                    </button>
                </div>
            )}

            {draft && !editingMetadata ? (
                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                            {cover && (
                                <CoverThumbnail
                                    src={ipfsImageUrl(cover.thumbUri || cover.uri)}
                                    alt="Cover thumbnail"
                                    className="h-16 w-16"
                                />
                            )}
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-foreground truncate text-sm">
                                        {name.trim() || "Untitled"}
                                    </h3>
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Cannot edit after deploy
                                    </span>
                                </div>
                                {description.trim() ? (
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                        {description.trim()}
                                    </p>
                                ) : (
                                    <p className="text-xs italic text-muted-foreground">
                                        No description
                                    </p>
                                )}
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    {tags.length > 0 ? (
                                        tags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                                            >
                                                #{tag}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-[11px] text-muted-foreground">
                                            No tags
                                        </span>
                                    )}
                                    {nameTrait.trim() && (
                                        <span className="rounded bg-alea-600/10 px-2 py-0.5 text-[11px] font-medium text-alea-600">
                                            Trait: {nameTrait.trim()}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEditingMetadata(true)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
                            title="Edit generator details"
                        >
                            <Pencil size={13} aria-hidden />
                            <span>Edit</span>
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {draft && editingMetadata && (
                        <div className="flex items-center justify-between pb-1 border-b border-border">
                            <span className="text-xs font-semibold text-foreground">
                                Edit generator details
                            </span>
                            <button
                                type="button"
                                onClick={() => setEditingMetadata(false)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
                            >
                                <Check size={12} aria-hidden />
                                <span>Done</span>
                            </button>
                        </div>
                    )}

                    <Field label="Generator name" permanent>
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
                        hint="Shown on your generator and on every piece."
                    >
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            placeholder="What the generator does, in a sentence or two."
                            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                    </Field>

                    <Field
                        label="Tags"
                        hint="Press comma or Enter to add, e.g. generative, glitch, longform. Read by objkt and other marketplaces for discovery. Changeable later via set_metadata. A change only reaches pieces minted after it; a piece already published keeps what it had."
                    >
                        <TagInput tags={tags} onChange={setTags} />
                    </Field>

                    <Field
                        label="Name a piece from a trait (optional)"
                        permanent
                        hint={
                            nameTrait.trim()
                                ? `Pieces will be named "${name.trim() || "Generator"} #1 · <value of ${nameTrait.trim()}>" when that trait is present, and the plain form otherwise.`
                                : 'Leave empty and every piece is named "Generator #1", "Generator #2", and so on — the form every marketplace expects. Fill in a key your code passes to $alea.features() and that trait\'s value is appended to the name.'
                        }
                    >
                        <input
                            value={nameTrait}
                            onChange={(e) => setNameTrait(e.target.value)}
                            placeholder="e.g. Name"
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                    </Field>

                    {draft && cover ? (
                        <Field label="Cover" hint="Selected in the studio and pinned to IPFS.">
                            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                                <CoverThumbnail
                                    src={ipfsImageUrl(cover.thumbUri || cover.uri)}
                                    alt="Cover thumbnail"
                                    className="h-16 w-16"
                                />
                                <div className="min-w-0 flex-1 text-xs">
                                    <p className="font-medium text-foreground">Cover image set</p>
                                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                                        Seed: {cover.seed}
                                    </p>
                                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                                        {cover.uri}
                                    </p>
                                </div>
                            </div>
                        </Field>
                    ) : draft ? (
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
                                    initialCover={cover}
                                    onCaptured={setCover}
                                />
                            )}
                        </Field>
                    ) : null}
                </>
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
                        className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                            trustResolver
                                ? "border-foreground/30 bg-accent text-foreground"
                                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                    >
                        {trustResolver ? "On" : "Off"}
                    </button>
                </div>
            </div>

            <Field
                label="Artists"
                permanent
                hint="Who made this. Nothing to do with the money, which is set below. Everyone you name has to accept before they are credited anywhere, so nobody's name lands on work they had nothing to do with."
            >
                <ArtistList
                    artists={artists}
                    onChange={setArtists}
                    owner={address ?? undefined}
                    disabled={stage !== null}
                />
            </Field>

            <Field
                label="Who shares each mint"
                permanent
                hint="The mint price, divided. Anyone can be here, artist or not: a studio or a fund takes a share without being credited as an author."
            >
                <SplitTable
                    rows={payeeRows}
                    onChange={setPayeeRows}
                    owner={address ?? undefined}
                    ownerPercent={mintOwnerPercent}
                    rowsLeft={50 - payeeRows.length - 1}
                    addLabel="Add someone"
                    disabled={stage !== null}
                    ownerLabel="the rest"
                />
                <MissingArtists
                    missing={mintGaps}
                    what="they get nothing from a mint"
                    onAdd={() => setPayeeRows(shareOut(payeeRows, mintOwnerPercent, mintGaps))}
                    canAdd={canShareOut(mintOwnerPercent, mintGaps)}
                    disabled={stage !== null}
                />
            </Field>

            {payeeNamed.length > 0 && (
                <div className="space-y-1 rounded-lg bg-muted/50 p-4 text-sm">
                    <p className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        On every mint
                    </p>
                    {collabPreview.map((r) => (
                        <div key={r.address} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate text-muted-foreground">
                                <AccountName address={r.address} />
                            </span>
                            <span className="shrink-0 font-medium">
                                {r.percentOfSale.toFixed(2)}%
                                <span className="hidden sm:inline"> of the mint price</span>
                            </span>
                        </div>
                    ))}
                    <p className="pt-2 text-xs text-muted-foreground">
                        This split is fixed once you publish.
                    </p>
                </div>
            )}

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

            <Field
                label="Who shares the royalty"
                permanent
                hint="A share of the royalty pool, not of the sale price. Separate from the mint split above, so an upfront share and a long-tail share can differ."
            >
                <SplitTable
                    rows={royaltyRows}
                    onChange={setRoyaltyRows}
                    owner={address ?? undefined}
                    ownerPercent={royaltyOwnerPercent}
                    rowsLeft={Number.POSITIVE_INFINITY}
                    addLabel="Add a recipient"
                    disabled={stage !== null}
                    ownerLabel="the rest"
                />
                <MissingArtists
                    missing={royaltyGaps}
                    what="they get nothing when a piece resells"
                    onAdd={() =>
                        setRoyaltyRows(shareOut(royaltyRows, royaltyOwnerPercent, royaltyGaps))
                    }
                    canAdd={canShareOut(royaltyOwnerPercent, royaltyGaps)}
                    disabled={stage !== null}
                />
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
                        <p className="text-sm font-medium">Support the platform</p>
                        <p className="text-xs text-muted-foreground">
                            Give Aleatory a share of each mint, of the royalty, or of both. It comes
                            out of what you hold, never your collaborators&apos;, and the contract
                            takes nothing you do not give it here.
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
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={100}
                                step={1}
                                value={platformMintPercent}
                                onChange={(e) => setPlatformMintPercent(e.target.value)}
                                aria-label="Platform share, percent of each mint"
                                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
                            />
                            <span className="text-xs text-muted-foreground">
                                percent of each mint, paid in the collector&apos;s own operation
                            </span>
                        </div>
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
                                percent of your royalty, taken on resales
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Supporting from a mint lists the treasury as paid, never as an artist.
                        </p>
                    </div>
                )}
            </div>

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

            <aside className="rounded-md border border-alea-600/30 bg-alea-600/5 p-3.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Start development on Shadownet</p>
                <p className="mt-1 leading-relaxed">
                    Start development on{" "}
                    <a
                        href="https://shadownet.aleatory.art"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline hover:text-foreground"
                    >
                        shadownet.aleatory.art
                    </a>{" "}
                    and test fully there through the minting process before deploying to mainnet.
                    Shadownet tez is free and can be requested at{" "}
                    <a
                        href="https://faucet.shadownet.teztnets.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline hover:text-foreground"
                    >
                        https://faucet.shadownet.teztnets.com/
                    </a>
                    .
                </p>
            </aside>

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
                        cannot edit after deploy
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

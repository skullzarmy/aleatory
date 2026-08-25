/** biome-ignore-all lint/suspicious/noCommentText: `// …` is the house voice in lab copy */
/**
 * Aleatory — v0.
 *
 * The whole first iteration in one lab: template, sandbox, mechanical checks,
 * cost estimate, testnet publish + mint, and a gallery that rebuilds pieces
 * from chain state alone.
 *
 * See docs/aleatory/ for what this is and why it is shaped this way. The short
 * version: generative means rules plus a seed, deterministic forever; the front
 * end is disposable; nothing here may become load-bearing on us.
 */

import {
    ArrowLeft,
    Check,
    Coins,
    Dices,
    Download,
    ExternalLink,
    Grid3x3,
    Images,
    Play,
    RefreshCw,
    Rocket,
    Shield,
    TriangleAlert,
    Upload,
    X,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ConnectWallet from "../../components/ConnectWallet";
import { ParamsDeclaration, ParamsTuner } from "../../components/aleatory/ParamsPanel";
import SandboxFrame, { type RunResult } from "../../components/aleatory/SandboxFrame";
import { useTezos } from "../../context/TezosContext";
import { usePageMeta } from "../../hooks/usePageMeta";
import {
    connectDeployer,
    DEPLOY_NETWORKS,
    type DeployNetwork,
    disconnectDeployer,
    getDeployerClient,
    getNetwork,
    isSiteNetwork,
    peekDeployerAddress,
} from "../../lib/fa2Deployer";
import {
    decodeParams,
    defaultValues,
    fromFxParams,
    type ParamSpec,
    type ParamValues,
    randomValues,
    resolveParams,
    specsOf,
    summarizeParams,
    validateSchema,
} from "../../lib/aleatory/params";
import { downloadText, type PackagedProject, packageFromFile, packageFromHtml } from "../../lib/aleatory/project";
import {
    buildTokenInfo,
    loadGenerator,
    loadPieces,
    mintPiece,
    publishGenerator,
    tokenInfoEntries,
    waitForApplied,
    waitForContract,
} from "../../lib/aleatory/publish";
import {
    buildRecord,
    type ChainConstants,
    type CostBreakdown,
    deriveSeed,
    estimateCost,
    fetchConstants,
    formatBytes,
    formatTez,
    type GeneratorRecord,
    hashBytes,
    STORAGE_CLASS_LABEL,
    storageClassOf,
} from "../../lib/aleatory/record";
import { getKind, type ResolvedDep, RUNTIME_KINDS, resolveDeps } from "../../lib/aleatory/runtimes";
import { randomSeed, seedAt } from "../../lib/aleatory/sandbox";
import { templateFor, templateParamsFor } from "../../lib/aleatory/templates";
import { getLab } from "../../lib/labs";

const mono = "var(--font-mono)";
const CAPTURE_TIMEOUT = 8000;

type TabId = "studio" | "grid" | "checks" | "cost" | "publish" | "gallery";

const TABS: Array<{ id: TabId; label: string; Icon: typeof Play }> = [
    { id: "studio", label: "studio", Icon: Play },
    { id: "grid", label: "grid", Icon: Grid3x3 },
    { id: "checks", label: "checks", Icon: Shield },
    { id: "cost", label: "cost", Icon: Coins },
    { id: "publish", label: "publish", Icon: Rocket },
    { id: "gallery", label: "gallery", Icon: Images },
];

const fieldStyle: CSSProperties = {
    width: "100%",
    fontFamily: mono,
    fontSize: "0.82rem",
    padding: "0.45rem 0.6rem",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    color: "var(--fg)",
    boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
    fontFamily: mono,
    fontSize: "0.68rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--fg-muted)",
    marginBottom: "0.3rem",
    display: "block",
};

const cardStyle: CSSProperties = {
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    padding: "1rem",
};

function button(variant: "solid" | "ghost" = "ghost", disabled = false): CSSProperties {
    return {
        fontFamily: mono,
        fontSize: "0.78rem",
        padding: "0.45rem 0.8rem",
        border: `1px solid ${variant === "solid" ? "var(--fg)" : "var(--border)"}`,
        background: variant === "solid" ? "var(--fg)" : "var(--bg-card)",
        color: variant === "solid" ? "var(--bg)" : "var(--fg)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        whiteSpace: "nowrap",
    };
}

function Note({ children }: { children: React.ReactNode }) {
    return (
        <p
            style={{
                fontFamily: mono,
                fontSize: "0.72rem",
                color: "var(--fg-muted)",
                margin: 0,
                lineHeight: 1.6,
            }}
        >
            {children}
        </p>
    );
}

type CheckStatus = "pass" | "fail" | "warn" | "pending";

interface CheckRow {
    id: string;
    label: string;
    status: CheckStatus;
    detail: string;
}

function StatusMark({ status }: { status: CheckStatus }) {
    if (status === "pass") return <Check size={14} color="var(--ok)" aria-hidden="true" />;
    if (status === "fail") return <X size={14} color="var(--err, #ff6b6b)" aria-hidden="true" />;
    if (status === "warn") return <TriangleAlert size={14} color="var(--warn)" aria-hidden="true" />;
    return <span style={{ color: "var(--fg-muted)" }}>·</span>;
}

export default function Aleatory() {
    const lab = getLab("aleatory");
    const { client: globalClient, address: globalAddress, connect: globalConnect, disconnect: globalDisconnect } = useTezos();

    usePageMeta({
        title: "Aleatory — seeded generative art on Tezos — Labs — hack.tez",
        description:
            "v0 of a community-run home for generative art on Tezos: template, sandbox, determinism checks, on-chain cost estimate, and testnet publish + mint. Rules and a seed, deterministic forever.",
        path: "/labs/aleatory",
    });

    // --- project -----------------------------------------------------------
    const [kindId, setKindId] = useState(1);
    const kind = getKind(kindId);
    const [project, setProject] = useState<PackagedProject>(() => packageFromHtml(templateFor(1)));
    const [source, setSource] = useState<string>("template");
    const [deps, setDeps] = useState<ResolvedDep[]>([]);
    const [depError, setDepError] = useState<string | null>(null);
    const [depLoading, setDepLoading] = useState(false);

    // --- declared parameters -----------------------------------------------
    // The artist's declaration, and the values whoever is looking has set. They
    // are separate state on purpose: the declaration is published once and is
    // immutable, the values are chosen per piece, per mint.
    const [paramSpecs, setParamSpecs] = useState<ParamSpec[]>(() => templateParamsFor(1));
    const [paramValues, setParamValues] = useState<ParamValues>(() => defaultValues(templateParamsFor(1)));
    /** A declaration an imported piece made in code, waiting to be adopted. */
    const [fxImport, setFxImport] = useState<{ params: ParamSpec[]; notes: string[] } | null>(null);
    const paramErrors = useMemo(() => validateSchema(paramSpecs), [paramSpecs]);
    /** What the frames actually receive — never the raw control state. */
    const runParams = useMemo(() => resolveParams(paramSpecs, paramValues), [paramSpecs, paramValues]);

    // A declaration edit can invalidate a value (a range moved, a type changed).
    // Re-resolving here means the studio never previews a value the piece could
    // not have been given.
    useEffect(() => {
        setParamValues((current) => resolveParams(paramSpecs, current));
    }, [paramSpecs]);

    // --- run state ---------------------------------------------------------
    const [baseSeed, setBaseSeed] = useState(() => randomSeed());
    const [seed, setSeed] = useState(() => randomSeed());
    const [lastRun, setLastRun] = useState<RunResult | null>(null);
    const [runNonce, setRunNonce] = useState(0);
    const [tab, setTab] = useState<TabId>("studio");

    // --- network / wallet --------------------------------------------------
    // v0 is testnet only. Nothing here holds anyone's money, and the contracts
    // are not the ones that have to be right forever (roadmap §1).
    const networks = useMemo(() => DEPLOY_NETWORKS.filter((n) => !n.isMainnet), []);
    const [networkId, setNetworkId] = useState(() => networks.find((n) => n.id === "shadownet")?.id ?? networks[0].id);
    const net: DeployNetwork = getNetwork(networkId);
    const onSite = isSiteNetwork(networkId);
    const [labAddress, setLabAddress] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const activeAddress = onSite ? globalAddress : labAddress;

    useEffect(() => {
        if (onSite) return;
        let cancelled = false;
        void peekDeployerAddress(net).then((a) => {
            if (!cancelled) setLabAddress(a);
        });
        return () => {
            cancelled = true;
        };
    }, [onSite, net]);

    const depSources = useMemo(() => deps.map((d) => d.source), [deps]);

    // Resolve the kind's shared libraries once, in the page — by the time a
    // piece boots they are inlined text and the frame has no network at all.
    useEffect(() => {
        let cancelled = false;
        if (kind.deps.length === 0) {
            setDeps([]);
            setDepError(null);
            return;
        }
        setDepLoading(true);
        setDepError(null);
        resolveDeps(kind.deps)
            .then((resolved) => {
                if (!cancelled) setDeps(resolved);
            })
            .catch((err: unknown) => {
                if (!cancelled) setDepError(err instanceof Error ? err.message : "Dependency could not be resolved.");
            })
            .finally(() => {
                if (!cancelled) setDepLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [kind]);

    const loadTemplate = useCallback((id: number) => {
        setKindId(id);
        setProject(packageFromHtml(templateFor(id)));
        setSource("template");
        setLastRun(null);
        setChecks(null);
        // The template's code and its declaration ship together, or the example
        // arrives with controls that are wired to nothing.
        const specs = templateParamsFor(id);
        setParamSpecs(specs);
        setParamValues(defaultValues(specs));
        setFxImport(null);
    }, []);

    const onFile = useCallback(async (file: File) => {
        try {
            const packaged = await packageFromFile(file);
            setProject(packaged);
            setSource(file.name);
            setLastRun(null);
            setChecks(null);
            // Someone else's project knows nothing about the template's params.
            // If it declares its own in fxhash style, the harness will offer them
            // back and the panel will ask before adopting anything.
            setParamSpecs([]);
            setParamValues({});
            setFxImport(null);
        } catch (err) {
            setDepError(err instanceof Error ? err.message : "That file could not be read.");
        }
    }, []);

    /** An imported piece called `$fx.params([...])`. Offered, never applied
     *  silently — adopting a declaration changes what gets published. */
    const onParamsDeclared = useCallback(
        (declaration: unknown[]) => {
            if (paramSpecs.length > 0) return;
            const mapped = fromFxParams(declaration);
            if (mapped.params.length === 0) return;
            setFxImport(mapped);
        },
        [paramSpecs.length],
    );

    // --- checks ------------------------------------------------------------
    const [checks, setChecks] = useState<CheckRow[] | null>(null);
    const [checkPhase, setCheckPhase] = useState<0 | 1 | 2>(0);
    const firstRunRef = useRef<RunResult | null>(null);
    const [checkSeed, setCheckSeed] = useState("");

    const runChecks = useCallback(() => {
        firstRunRef.current = null;
        setChecks(null);
        setCheckSeed(randomSeed());
        setCheckPhase(1);
    }, []);

    const onCheckResult = useCallback(
        (result: RunResult) => {
            if (checkPhase === 1) {
                firstRunRef.current = result;
                setCheckPhase(2);
                return;
            }
            if (checkPhase !== 2) return;
            const first = firstRunRef.current;
            setCheckPhase(0);
            if (!first) return;

            const rows: CheckRow[] = [];
            const networkViolations = [...first.violations, ...result.violations].filter((v) => v.kind === "network");
            const captureIssues = [...first.violations, ...result.violations].filter((v) => v.kind === "capture");
            const mathRandomCalls = Math.max(first.mathRandomCalls, result.mathRandomCalls);

            // Math.random is a *cause*, never a symptom: the harness substitutes the
            // seeded stream, so calling it does not break anything on its own, and
            // libraries call it too (p5 does, during init). It is mentioned only
            // here, where the runs actually disagree and it is worth checking.
            const causes =
                mathRandomCalls > 0
                    ? ` Math.random() was called ${mathRandomCalls}×; a library may be the caller.`
                    : "";

            rows.push({
                id: "determinism",
                label: "Deterministic",
                status: first.digest && first.digest === result.digest ? "pass" : "fail",
                detail:
                    first.digest === result.digest
                        ? `Two runs of seed ${first.seed.slice(0, 12)}… produced identical output (${first.digest.slice(0, 16)}…).`
                        : `Same seed, different output: ${first.digest.slice(0, 16)}… ≠ ${result.digest.slice(0, 16)}….${causes}`,
            });

            rows.push({
                id: "network",
                label: "Self-contained",
                status: networkViolations.length === 0 ? "pass" : "fail",
                detail:
                    networkViolations.length === 0
                        ? "No network requests attempted."
                        : networkViolations.map((v) => v.detail).join(" "),
            });

            rows.push({
                id: "capture",
                label: "Capture point",
                status: result.source === "none" ? "fail" : result.autoCaptured ? "warn" : "pass",
                detail:
                    result.source === "none"
                        ? "No canvas or svg in the document."
                        : result.autoCaptured
                          ? captureIssues.map((v) => v.detail).join(" ") || "ready() never fired; captured on the deadline."
                          : `Signalled at ${result.elapsed}ms, captured from the ${result.source}.`,
            });

            rows.push({
                id: "errors",
                label: "Runs clean",
                status: first.errors.length + result.errors.length === 0 ? "pass" : "fail",
                detail:
                    first.errors.length + result.errors.length === 0
                        ? "No uncaught errors."
                        : [...first.errors, ...result.errors].slice(0, 3).join(" · "),
            });

            rows.push({
                id: "features",
                label: "Features declared",
                status: Object.keys(result.features).length > 0 ? "pass" : "warn",
                detail:
                    Object.keys(result.features).length > 0
                        ? `${Object.keys(result.features).length} trait${Object.keys(result.features).length === 1 ? "" : "s"}: ${Object.keys(result.features).join(", ")}.`
                        : "No features declared. Optional.",
            });

            // Params are optional, so "none declared" is a pass, not a warning.
            // What is worth failing on is a declaration that cannot be honoured:
            // an invalid schema, or code reading a name no control exists for —
            // that value would be unreachable for every collector, forever.
            const unreadable = [...first.violations, ...result.violations].filter(
                (v) => v.kind === "runtime" && v.detail.includes("undeclared parameter"),
            );
            rows.push({
                id: "params",
                label: "Parameters",
                status: paramErrors.length > 0 || unreadable.length > 0 ? "fail" : "pass",
                detail:
                    paramErrors.length > 0
                        ? paramErrors.join(" ")
                        : unreadable.length > 0
                          ? unreadable.map((v) => v.detail).join(" ")
                          : paramSpecs.length === 0
                            ? "None declared. Optional — this piece is the seed alone."
                            : `${paramSpecs.length} declared: ${paramSpecs.map((p) => p.id).join(", ")}. Both runs used the same values.`,
            });

            rows.push({
                id: "deps",
                label: "Dependencies resolved",
                status: kind.deps.length === 0 ? "pass" : deps.length === kind.deps.length ? "pass" : "fail",
                detail:
                    kind.deps.length === 0
                        ? "No shared libraries — this piece is fully on-chain."
                        : deps.length === kind.deps.length
                          ? deps.map((d) => `${d.spec.label} ${d.spec.version} → ${d.hash.slice(0, 12)}…`).join(" · ")
                          : "A declared dependency could not be resolved.",
            });

            setChecks(rows);
        },
        [checkPhase, deps, kind.deps, paramErrors, paramSpecs],
    );

    const gateOpen = checks !== null && checks.every((c) => c.status !== "fail");

    // --- what gets written into the record ----------------------------------
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [edition, setEdition] = useState(8);
    // Held as a percentage, because that is how royalties are talked about.
    // TZIP-21 wants basis points; the conversion is ours to do, not the artist's.
    const [royaltiesPct, setRoyaltiesPct] = useState(10);
    const royaltiesBps = Math.round(royaltiesPct * 100);

    // --- cost --------------------------------------------------------------
    const [constants, setConstants] = useState<ChainConstants | null>(null);
    useEffect(() => {
        let cancelled = false;
        void fetchConstants(net.rpcUrl).then((c) => {
            if (!cancelled) setConstants(c);
        });
        return () => {
            cancelled = true;
        };
    }, [net]);

    const codeHash = useMemo(() => hashBytes(project.html), [project.html]);

    const draftRecord: GeneratorRecord | null = useMemo(() => {
        if (!activeAddress) return null;
        return buildRecord({
            artist: activeAddress,
            title: title || "untitled",
            description,
            kindId: kind.kindId,
            kindName: kind.name,
            kindVersion: kind.kindVersion,
            code: codeHash,
            deps,
            edition,
            royaltiesBps,
            captureTimeoutMs: CAPTURE_TIMEOUT,
            viewport: { width: 1000, height: 1000 },
            coverSeed: seed,
            paramSpecs,
        });
    }, [activeAddress, codeHash, deps, kind, title, description, edition, royaltiesBps, seed, paramSpecs]);

    /**
     * What one mint stores: the token_info the mint operation actually writes,
     * measured rather than guessed. Edition size multiplies it, which is the
     * number an artist is usually surprised by.
     */
    const mintCost = useMemo(() => {
        if (!constants || !draftRecord || !activeAddress) return null;
        const entries = tokenInfoEntries({
            title: draftRecord.title,
            description: draftRecord.description,
            tokenId: 0,
            artist: activeAddress,
            record: draftRecord,
            contract: "KT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
            params: runParams,
        });
        const bytes = entries.reduce((sum, [k, v]) => sum + new TextEncoder().encode(k + v).length, 0);
        const mutez = bytes * constants.costPerByte;
        return { bytes, tez: mutez / 1_000_000 };
    }, [constants, draftRecord, activeAddress, runParams]);

    const cost: CostBreakdown | null = useMemo(() => {
        if (!constants) return null;
        // The record is stored twice — once inline in the TZIP-16 document and
        // once under its own key — plus the TZIP-16 wrapper itself.
        const recordBytes = draftRecord ? new TextEncoder().encode(JSON.stringify(draftRecord)).length * 2 + 300 : 1200;
        // Class B keeps shared libraries out of this project's storage entirely —
        // that is the whole reason the Deps contract exists.
        return estimateCost(codeHash.bytes, recordBytes, 0, constants);
    }, [constants, codeHash.bytes, draftRecord]);

    const klass = storageClassOf(deps, true);

    // Every grid cell is a live frame with the libraries inlined; a megabyte of
    // p5 sixteen times over is not a grid, it is a stall.
    // Counts are multiples of the column count below (4 at full width), so the
    // grid is always complete rectangles rather than a last row with one orphan.
    // Fewer cells when a library is in play: every cell is a live frame with the
    // whole of p5 inlined, and sixteen of those is a stall, not a grid.
    const gridCount = deps.length > 0 ? 8 : 16;

    // --- publish -----------------------------------------------------------
    const [publishing, setPublishing] = useState(false);
    const [publishStep, setPublishStep] = useState<string | null>(null);
    const [publishError, setPublishError] = useState<string | null>(null);
    const [contract, setContract] = useState<string | null>(null);
    const [publishedRecord, setPublishedRecord] = useState<GeneratorRecord | null>(null);
    const [minted, setMinted] = useState<Array<{ tokenId: number; opHash: string; seed: string; params: ParamValues }>>([]);
    const [minting, setMinting] = useState(false);

    /**
     * The values the next mint will carry.
     *
     * Held apart from the studio's own values because they answer a different
     * question: the studio's are the artist looking at their system, these are
     * a collector deciding what to buy. After publish the declaration is fixed,
     * so these tune against the record rather than against the editable panel.
     */
    const publishedSpecs = useMemo(() => specsOf(publishedRecord?.params_schema), [publishedRecord]);
    const [mintValues, setMintValues] = useState<ParamValues>({});

    /** The wallet that signs on the selected network: the site's own client when
     *  the lab is pointed at the site network, otherwise the shared off-site
     *  deployer session (so switching testnets never disturbs the main wallet). */
    const walletFor = useCallback(async () => {
        if (onSite) {
            if (!globalClient) throw new Error("Connect the site wallet first.");
            return globalClient;
        }
        return getDeployerClient(net);
    }, [onSite, globalClient, net]);

    const connect = useCallback(async () => {
        setPublishError(null);
        if (onSite) {
            await globalConnect();
            return;
        }
        setConnecting(true);
        try {
            setLabAddress(await connectDeployer(net));
        } catch (err) {
            setPublishError(err instanceof Error ? err.message : "Wallet connection failed.");
        } finally {
            setConnecting(false);
        }
    }, [onSite, net, globalConnect]);

    const disconnect = useCallback(async () => {
        if (onSite) {
            await globalDisconnect();
            return;
        }
        await disconnectDeployer();
        setLabAddress(null);
    }, [onSite, globalDisconnect]);

    const doPublish = useCallback(async () => {
        if (!activeAddress || !draftRecord) return;
        setPublishing(true);
        setPublishError(null);
        setMinted([]);
        try {
            const walletClient = await walletFor();

            setPublishStep("waiting for signature…");
            const record = {
                ...draftRecord,
                title: title || "untitled",
                description,
                edition,
                royalties_bps: royaltiesBps,
            };
            const res = await publishGenerator(net, walletClient, activeAddress, record, project.html);

            setPublishStep(`origination ${res.opHash.slice(0, 10)}… submitted — waiting for the indexer`);
            const address = await waitForContract(net, res.opHash);
            setContract(address);
            setPublishedRecord(record);
            // The mint form starts where the artist left the studio, not at the
            // declared defaults — it is the same piece they were just looking at.
            setMintValues(resolveParams(specsOf(record.params_schema), paramValues));
            setPublishStep(null);
        } catch (err) {
            setPublishError(err instanceof Error ? err.message.slice(0, 300) : "Publish failed.");
            setPublishStep(null);
        } finally {
            setPublishing(false);
        }
    }, [activeAddress, draftRecord, walletFor, net, title, description, edition, royaltiesBps, project.html, paramValues]);

    const doMint = useCallback(async () => {
        if (!activeAddress || !contract || !publishedRecord) return;
        setMinting(true);
        setPublishError(null);
        try {
            const walletClient = await walletFor();

            const tokenId = minted.length;
            const pieceParams = resolveParams(publishedSpecs, mintValues);
            setPublishStep(`minting piece #${tokenId} — waiting for signature…`);
            const info = buildTokenInfo({
                title: publishedRecord.title,
                description: publishedRecord.description,
                tokenId,
                artist: activeAddress,
                record: publishedRecord,
                contract,
                params: pieceParams,
            });
            const res = await mintPiece(net, walletClient, contract, activeAddress, tokenId, info);

            setPublishStep(`mint ${res.opHash.slice(0, 10)}… submitted — waiting for the indexer`);
            await waitForApplied(net, res.opHash);

            // The seed exists only now: it is derived from the operation hash,
            // which nobody — including us — knew before the operation landed.
            const pieceSeed = deriveSeed(res.opHash, tokenId, contract);
            setMinted((m) => [...m, { tokenId, opHash: res.opHash, seed: pieceSeed, params: pieceParams }]);
            setPublishStep(null);
        } catch (err) {
            setPublishError(err instanceof Error ? err.message.slice(0, 300) : "Mint failed.");
            setPublishStep(null);
        } finally {
            setMinting(false);
        }
    }, [activeAddress, contract, publishedRecord, walletFor, net, minted.length, publishedSpecs, mintValues]);

    // --- gallery -----------------------------------------------------------
    const [galleryAddress, setGalleryAddress] = useState("");
    const [galleryLoading, setGalleryLoading] = useState(false);
    const [galleryError, setGalleryError] = useState<string | null>(null);
    const [gallery, setGallery] = useState<{
        record: GeneratorRecord;
        code: string;
        deps: string[];
        specs: ParamSpec[];
        pieces: Array<{ tokenId: number; opHash: string; seed: string; params: ParamValues }>;
    } | null>(null);

    const loadGallery = useCallback(
        async (address: string) => {
            const target = address.trim();
            if (!target) return;
            setGalleryLoading(true);
            setGalleryError(null);
            setGallery(null);
            try {
                const gen = await loadGenerator(net, target);
                const pieces = await loadPieces(net, target);

                // Resolve the libraries the RECORD names, not whatever the studio
                // happens to be set to. A piece boots into the version it was made
                // with, forever — that is the entire point of pinning kind_version.
                const recordKind = RUNTIME_KINDS.find((k) => k.name === gen.record.runtime.kind_name);
                const wanted = (recordKind?.deps ?? []).filter((d) => gen.record.deps.some((ref) => ref.ref === `${d.id}@${d.version}`));
                const resolved = wanted.length > 0 ? await resolveDeps(wanted) : [];

                // The declaration comes from the record, the values from each
                // mint's own token_info. Both are chain state; neither is ours.
                const specs = specsOf(gen.record.params_schema);

                setGallery({
                    record: gen.record,
                    code: gen.code,
                    deps: resolved.map((d) => d.source),
                    specs,
                    pieces: pieces.map((p) => ({
                        tokenId: p.tokenId,
                        opHash: p.opHash,
                        seed: deriveSeed(p.opHash, p.tokenId, target),
                        params: decodeParams(specs, p.params),
                    })),
                });
            } catch (err) {
                setGalleryError(err instanceof Error ? err.message : "Could not load that contract.");
            } finally {
                setGalleryLoading(false);
            }
        },
        [net],
    );

    // -----------------------------------------------------------------------

    const previewBox: CSSProperties = {
        aspectRatio: "1 / 1",
        width: "100%",
        border: "1px solid var(--border)",
        background: "#000",
        overflow: "hidden",
    };

    return (
        <div className="container" style={{ paddingBlock: "3rem", maxWidth: "980px" }}>
            <Link
                to="/labs"
                style={{
                    fontFamily: mono,
                    fontSize: "0.8rem",
                    color: "var(--fg-muted)",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35em",
                    marginBottom: "1rem",
                }}
            >
                <ArrowLeft size={14} aria-hidden="true" /> labs
            </Link>

            <div
                style={{
                    paddingBottom: "1.25rem",
                    borderBottom: "1px solid var(--border)",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        flexWrap: "wrap",
                        marginBottom: "0.4rem",
                    }}
                >
                    <h1
                        style={{
                            fontFamily: mono,
                            fontSize: "clamp(1.2rem, 3.5vw, 1.75rem)",
                            margin: 0,
                        }}
                    >
                        {lab?.title ?? "Aleatory"}
                    </h1>
                    <span
                        style={{
                            fontFamily: mono,
                            fontSize: "0.62rem",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            padding: "0.18em 0.55em",
                            color: "var(--warn)",
                            background: "var(--warn-bg)",
                            border: "1px solid var(--warn)",
                        }}
                    >
                        {lab?.status ?? "alpha"}
                    </span>
                    <span
                        style={{
                            fontFamily: mono,
                            fontSize: "0.75rem",
                            color: "var(--fg-muted)",
                        }}
                    >
                        v{lab?.version ?? "0.1.0"}
                    </span>
                </div>
                <p
                    style={{
                        color: "var(--fg-muted)",
                        fontSize: "0.875rem",
                        maxWidth: "62ch",
                        margin: 0,
                    }}
                >
                    {lab?.summary ??
                        "Write a system, run it across seeds, see what it costs on chain, publish it to a testnet."}
                </p>
            </div>

            {/* Tabs */}
            <nav
                style={{
                    display: "flex",
                    gap: "0.4rem",
                    flexWrap: "wrap",
                    marginTop: "1.25rem",
                }}
            >
                {TABS.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        style={{
                            ...button(tab === id ? "solid" : "ghost"),
                            fontSize: "0.74rem",
                        }}
                    >
                        <Icon size={12} aria-hidden="true" /> {label}
                    </button>
                ))}
            </nav>

            {/* ---------------------------------------------------------- studio */}
            {tab === "studio" && (
                <section
                    style={{
                        marginTop: "1.5rem",
                        display: "grid",
                        gap: "1.25rem",
                        gridTemplateColumns: "minmax(0,1fr)",
                    }}
                >
                    <div
                        style={{
                            display: "grid",
                            gap: "1.25rem",
                            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                        }}
                    >
                        <div>
                            <div style={previewBox}>
                                <SandboxFrame
                                    html={project.html}
                                    seed={seed}
                                    deps={depSources}
                                    params={runParams}
                                    paramsSchema={paramSpecs}
                                    wantImage
                                    timeout={CAPTURE_TIMEOUT}
                                    runKey={runNonce}
                                    onResult={setLastRun}
                                    onParamsDeclared={onParamsDeclared}
                                />
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    gap: "0.4rem",
                                    marginTop: "0.6rem",
                                    flexWrap: "wrap",
                                }}
                            >
                                <button
                                    type="button"
                                    style={button("solid")}
                                    onClick={() => {
                                        setLastRun(null);
                                        setSeed(randomSeed());
                                    }}
                                >
                                    <Dices size={12} aria-hidden="true" /> new seed
                                </button>
                                <button
                                    type="button"
                                    style={button()}
                                    onClick={() => {
                                        setLastRun(null);
                                        setRunNonce((n) => n + 1);
                                    }}
                                >
                                    <RefreshCw size={12} aria-hidden="true" /> re-run
                                </button>
                                <button
                                    type="button"
                                    style={button()}
                                    onClick={() => downloadText(`${kind.name}-template.html`, project.html)}
                                >
                                    <Download size={12} aria-hidden="true" /> download
                                </button>
                            </div>
                            <p
                                style={{
                                    fontFamily: mono,
                                    fontSize: "0.68rem",
                                    color: "var(--fg-muted)",
                                    marginTop: "0.5rem",
                                    wordBreak: "break-all",
                                }}
                            >
                                seed {seed}
                            </p>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "1rem",
                                minWidth: 0,
                            }}
                        >
                            <div>
                                <span style={labelStyle}>Runtime kind</span>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                                    {RUNTIME_KINDS.map((k) => (
                                        <button
                                            key={k.kindId}
                                            type="button"
                                            onClick={() => loadTemplate(k.kindId)}
                                            style={{
                                                ...button(k.kindId === kindId ? "solid" : "ghost"),
                                                fontSize: "0.72rem",
                                            }}
                                        >
                                            {k.label}
                                        </button>
                                    ))}
                                </div>
                                <p
                                    style={{
                                        fontFamily: mono,
                                        fontSize: "0.7rem",
                                        color: "var(--fg-muted)",
                                        marginTop: "0.5rem",
                                        lineHeight: 1.6,
                                    }}
                                >
                                    {kind.blurb}
                                    <br />
                                    <span style={{ color: "var(--fg-3, var(--fg-muted))" }}>
                                        kind_id {kind.kindId} · {kind.name}@{kind.kindVersion} · entry: {kind.entrySpec}
                                    </span>
                                </p>
                            </div>

                            <div>
                                <span style={labelStyle}>Load a project</span>
                                <label
                                    style={{
                                        ...button(),
                                        justifyContent: "center",
                                        width: "100%",
                                    }}
                                >
                                    <Upload size={12} aria-hidden="true" /> drop or choose .html / .zip
                                    <input
                                        type="file"
                                        accept=".html,.htm,.zip"
                                        style={{ display: "none" }}
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) void onFile(f);
                                        }}
                                    />
                                </label>
                                <p
                                    style={{
                                        fontFamily: mono,
                                        fontSize: "0.68rem",
                                        color: "var(--fg-muted)",
                                        marginTop: "0.4rem",
                                    }}
                                >
                                    // loaded: {source} · {formatBytes(project.bytes)}
                                </p>
                                {project.notes.map((n) => (
                                    <Note key={n}>// {n}</Note>
                                ))}
                                {project.unresolved.length > 0 && <Note>// unresolved refs: {project.unresolved.join(", ")}</Note>}
                                {depLoading && <Note>// resolving {kind.deps.map((d) => d.label).join(", ")}…</Note>}
                                {deps.map((d) => (
                                    <Note key={d.spec.id}>
                                        // dep {d.spec.label} {d.spec.version} · {formatBytes(d.bytes)} · blake2b {d.hash.slice(0, 16)}…
                                    </Note>
                                ))}
                                {depError && (
                                    <p
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.72rem",
                                            color: "var(--err, #ff6b6b)",
                                        }}
                                    >
                                        // {depError}
                                    </p>
                                )}
                            </div>

                            <div style={cardStyle}>
                                <span style={labelStyle}>Last run</span>
                                {lastRun ? (
                                    <div
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.72rem",
                                            color: "var(--fg-muted)",
                                            lineHeight: 1.8,
                                        }}
                                    >
                                        <div>
                                            captured from {lastRun.source} at {lastRun.elapsed}ms
                                            {lastRun.autoCaptured ? " (on the deadline — ready() never fired)" : ""}
                                        </div>
                                        <div style={{ wordBreak: "break-all" }}>digest {lastRun.digest.slice(0, 24)}…</div>
                                        {Object.entries(lastRun.features).length > 0 && (
                                            <div style={{ marginTop: "0.4rem" }}>
                                                {Object.entries(lastRun.features).map(([k, v]) => (
                                                    <div key={k}>
                                                        <span style={{ color: "var(--fg)" }}>{k}</span> · {String(v)}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {lastRun.violations.map((v) => (
                                            <div
                                                key={v.kind + v.detail}
                                                style={{
                                                    color: v.kind === "network" ? "var(--err, #ff6b6b)" : "var(--warn)",
                                                    marginTop: "0.35rem",
                                                }}
                                            >
                                                {v.kind}: {v.detail}
                                            </div>
                                        ))}
                                        {lastRun.errors.map((e) => (
                                            <div key={e} style={{ color: "var(--err, #ff6b6b)" }}>
                                                error: {e}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <Note>// running…</Note>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ------------------------------------------------- params */}
                    <div style={cardStyle}>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: "0.6rem",
                                alignItems: "baseline",
                                flexWrap: "wrap",
                            }}
                        >
                            <span style={{ ...labelStyle, marginBottom: 0 }}>Parameters</span>
                            <span style={{ fontFamily: mono, fontSize: "0.68rem", color: "var(--fg-muted)" }}>
                                // optional · up to 5 · declared by you, tuned at mint
                            </span>
                        </div>

                        <p
                            style={{
                                fontFamily: mono,
                                fontSize: "0.72rem",
                                color: "var(--fg-muted)",
                                lineHeight: 1.7,
                                margin: "0.6rem 0 0",
                            }}
                        >
                            // you name them, you set the range. the declaration is published with the generator, so a mint page
                            anywhere — ours or somebody else's — can build these controls from chain state alone. the values a
                            collector picks are stored on their token, next to the seed.
                        </p>

                        {fxImport && (
                            <div
                                style={{
                                    ...cardStyle,
                                    borderColor: "var(--warn)",
                                    background: "var(--warn-bg)",
                                    marginTop: "0.8rem",
                                }}
                            >
                                <p style={{ fontFamily: mono, fontSize: "0.74rem", color: "var(--fg)", margin: 0, lineHeight: 1.7 }}>
                                    // this project declares {fxImport.params.length} parameter
                                    {fxImport.params.length === 1 ? "" : "s"} in code, fxhash style. the declaration has to live in the
                                    record for a mint UI to read it — import them?
                                </p>
                                {fxImport.notes.map((n) => (
                                    <p
                                        key={n}
                                        style={{ fontFamily: mono, fontSize: "0.7rem", color: "var(--fg-muted)", margin: "0.35rem 0 0" }}
                                    >
                                        // {n}
                                    </p>
                                ))}
                                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
                                    <button
                                        type="button"
                                        style={button("solid")}
                                        onClick={() => {
                                            setParamSpecs(fxImport.params);
                                            setParamValues(defaultValues(fxImport.params));
                                            setFxImport(null);
                                            setChecks(null);
                                        }}
                                    >
                                        import {fxImport.params.length}
                                    </button>
                                    <button type="button" style={button()} onClick={() => setFxImport(null)}>
                                        ignore
                                    </button>
                                </div>
                            </div>
                        )}

                        {paramSpecs.length > 0 && (
                            <div style={{ marginTop: "1rem" }}>
                                <span style={labelStyle}>Try them — this is the control a minter gets</span>
                                <ParamsTuner specs={paramSpecs} values={paramValues} onChange={setParamValues} />
                                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
                                    <button type="button" style={button()} onClick={() => setParamValues(randomValues(paramSpecs))}>
                                        <Dices size={12} aria-hidden="true" /> random values
                                    </button>
                                    <button type="button" style={button()} onClick={() => setParamValues(defaultValues(paramSpecs))}>
                                        <RefreshCw size={12} aria-hidden="true" /> defaults
                                    </button>
                                </div>
                            </div>
                        )}

                        <div
                            style={{
                                marginTop: "1rem",
                                paddingTop: "1rem",
                                borderTop: "1px solid var(--border)",
                            }}
                        >
                            <span style={labelStyle}>Declaration</span>
                            <ParamsDeclaration
                                specs={paramSpecs}
                                onChange={(next) => {
                                    setParamSpecs(next);
                                    // The declaration is part of what gets published, so a
                                    // passed check no longer describes what would be signed.
                                    setChecks(null);
                                }}
                            />
                        </div>
                    </div>
                </section>
            )}

            {/* ------------------------------------------------------------ grid */}
            {tab === "grid" && (
                <section style={{ marginTop: "1.5rem" }}>
                    <div
                        style={{
                            display: "flex",
                            gap: "0.5rem",
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginBottom: "0.9rem",
                        }}
                    >
                        <button type="button" style={button("solid")} onClick={() => setBaseSeed(randomSeed())}>
                            <Dices size={12} aria-hidden="true" /> new grid
                        </button>
                        <Note>
                            // {gridCount} seeds from base {baseSeed.slice(0, 12)}… — click one to pin it in the studio
                            {paramSpecs.length > 0 && (
                                <>
                                    <br />
                                    // params held at {summarizeParams(paramSpecs, runParams)} — the grid varies the seed and nothing
                                    else, which is the only way to read what the seed alone is doing
                                </>
                            )}
                        </Note>
                    </div>
                    <div
                        style={{
                            display: "grid",
                            // 200px min gives exactly 4 columns at the 980px container
                            // and steps down cleanly on narrow screens.
                            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                            gap: "0.5rem",
                        }}
                    >
                        {Array.from({ length: gridCount }, (_, i) => seedAt(baseSeed, i)).map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => {
                                    setSeed(s);
                                    setTab("studio");
                                }}
                                title={s}
                                style={{ ...previewBox, padding: 0, cursor: "pointer" }}
                            >
                                {/* The frame must not eat the click — the whole tile selects the seed. */}
                                <SandboxFrame
                                    html={project.html}
                                    seed={s}
                                    deps={depSources}
                                    params={runParams}
                                    paramsSchema={paramSpecs}
                                    timeout={CAPTURE_TIMEOUT}
                                    style={{ pointerEvents: "none" }}
                                />
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {/* ---------------------------------------------------------- checks */}
            {tab === "checks" && (
                <section style={{ marginTop: "1.5rem" }}>
                    <div
                        style={{
                            display: "flex",
                            gap: "0.5rem",
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginBottom: "1rem",
                        }}
                    >
                        <button type="button" style={button("solid", checkPhase !== 0)} disabled={checkPhase !== 0} onClick={runChecks}>
                            <Shield size={12} aria-hidden="true" /> {checkPhase !== 0 ? `running (${checkPhase}/2)…` : "run checks"}
                        </button>
                        <Note>// the same checks the mint pipeline runs.</Note>
                    </div>

                    {checks === null && checkPhase === 0 && (
                        <Note>
                            // a piece must be deterministic, self-contained and seed-bound. run the checks to see where yours stands.
                        </Note>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {(checks ?? []).map((row) => (
                            <div
                                key={row.id}
                                style={{
                                    ...cardStyle,
                                    display: "flex",
                                    gap: "0.7rem",
                                    alignItems: "flex-start",
                                }}
                            >
                                <div style={{ marginTop: "0.15rem" }}>
                                    <StatusMark status={row.status} />
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.8rem",
                                            color: "var(--fg)",
                                        }}
                                    >
                                        {row.label}
                                    </div>
                                    <div
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.72rem",
                                            color: "var(--fg-muted)",
                                            lineHeight: 1.7,
                                            wordBreak: "break-word",
                                        }}
                                    >
                                        {row.detail}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {checks !== null && (
                        <p
                            style={{
                                fontFamily: mono,
                                fontSize: "0.75rem",
                                marginTop: "1rem",
                                color: gateOpen ? "var(--ok)" : "var(--err, #ff6b6b)",
                            }}
                        >
                            // {gateOpen ? "gate open — this generator can be published." : "gate closed — fix the failures and run again."}
                        </p>
                    )}

                    {/* The two runs, on screen and on purpose. Browsers throttle
                        animation frames in offscreen iframes, so a hidden runner can
                        sit there forever without drawing — and showing the pair being
                        compared is the honest version of this check anyway. */}
                    {checkPhase !== 0 && (
                        <div style={{ marginTop: "1rem" }}>
                            <span style={labelStyle}>run {checkPhase} of 2 — seed {checkSeed.slice(0, 16)}…</span>
                            <div
                                style={{
                                    width: "220px",
                                    height: "220px",
                                    border: "1px solid var(--border)",
                                    background: "#000",
                                    pointerEvents: "none",
                                }}
                            >
                                <SandboxFrame
                                    key={checkPhase}
                                    html={project.html}
                                    seed={checkSeed}
                                    deps={depSources}
                                    params={runParams}
                                    paramsSchema={paramSpecs}
                                    runKey={checkPhase}
                                    timeout={CAPTURE_TIMEOUT}
                                    onResult={onCheckResult}
                                />
                            </div>
                        </div>
                    )}
                </section>
            )}

            {/* ------------------------------------------------------------ cost */}
            {tab === "cost" && (
                <section
                    style={{
                        marginTop: "1.5rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                    }}
                >
                    {/* The number first. Everything else on this tab explains it. */}
                    <div style={{ ...cardStyle, padding: "1.25rem" }}>
                        <span style={labelStyle}>To publish on {net.label}</span>
                        {cost && constants ? (
                            <>
                                <div
                                    style={{
                                        fontFamily: mono,
                                        fontSize: "clamp(1.8rem, 6vw, 2.6rem)",
                                        color: "var(--fg)",
                                        lineHeight: 1.1,
                                    }}
                                >
                                    {formatTez(cost.burnTez)}
                                </div>
                                <p
                                    style={{
                                        fontFamily: mono,
                                        fontSize: "0.75rem",
                                        color: "var(--fg-muted)",
                                        margin: "0.45rem 0 0",
                                        lineHeight: 1.6,
                                    }}
                                >
                                    one-time storage burn, paid once when you publish the generator ·{" "}
                                    {formatBytes(cost.totalBytes)} stored
                                </p>
                                {mintCost && (
                                    <p
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.78rem",
                                            color: "var(--fg)",
                                            margin: "0.75rem 0 0",
                                            paddingTop: "0.75rem",
                                            borderTop: "1px solid var(--border)",
                                            lineHeight: 1.7,
                                        }}
                                    >
                                        + {formatTez(mintCost.tez)} per piece minted
                                        {edition > 0 && (
                                            <span style={{ color: "var(--fg-muted)" }}>
                                                {" "}
                                                · {formatTez(cost.burnTez + mintCost.tez * edition)} for the whole edition of {edition}
                                            </span>
                                        )}
                                    </p>
                                )}
                                {!activeAddress && (
                                    <p
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.72rem",
                                            color: "var(--fg-muted)",
                                            margin: "0.6rem 0 0",
                                        }}
                                    >
                                        // connect a wallet on the publish tab for the per-mint figure
                                    </p>
                                )}
                            </>
                        ) : (
                            <Note>// reading protocol constants…</Note>
                        )}
                    </div>

                    <div style={cardStyle}>
                        <span style={labelStyle}>How it is stored</span>
                        <div
                            style={{
                                fontFamily: mono,
                                fontSize: "0.95rem",
                                color: "var(--fg)",
                            }}
                        >
                            {STORAGE_CLASS_LABEL[klass].name}
                        </div>
                        <p
                            style={{
                                fontFamily: mono,
                                fontSize: "0.73rem",
                                color: "var(--fg-muted)",
                                lineHeight: 1.7,
                                margin: "0.4rem 0 0",
                            }}
                        >
                            {STORAGE_CLASS_LABEL[klass].blurb}
                        </p>
                    </div>

                    <div style={cardStyle}>
                        <span style={labelStyle}>Breakdown</span>
                        {cost && constants ? (
                            <table
                                style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontFamily: mono,
                                    fontSize: "0.76rem",
                                }}
                            >
                                <tbody>
                                    {[
                                        ["generator code", formatBytes(cost.codeBytes)],
                                        ["record + metadata", formatBytes(cost.recordBytes)],
                                        ["shared libraries in this contract", deps.length > 0 ? "0 B — referenced by hash" : "none"],
                                        ["per mint (token metadata)", mintCost ? formatBytes(mintCost.bytes) : "—"],
                                        ["operations to publish", String(cost.operations)],
                                    ].map(([k, v]) => (
                                        <tr key={k} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "0.4rem 0", color: "var(--fg-muted)" }}>{k}</td>
                                            <td style={{ padding: "0.4rem 0", textAlign: "right", color: "var(--fg)" }}>{v}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <Note>// reading protocol constants…</Note>
                        )}
                        {constants && (
                            <p
                                style={{
                                    fontFamily: mono,
                                    fontSize: "0.68rem",
                                    color: "var(--fg-muted)",
                                    marginTop: "0.7rem",
                                    lineHeight: 1.7,
                                }}
                            >
                                // {constants.live ? "live from the chain" : "RPC unreachable — protocol defaults, may be wrong"}:{" "}
                                {constants.costPerByte} mutez/byte · {formatBytes(constants.maxOperationBytes)} per operation
                            </p>
                        )}
                    </div>

                    {deps.length > 0 && (
                        <div style={cardStyle}>
                            <span style={labelStyle}>The shared library, if someone puts it on chain</span>
                            {deps.map((d) => (
                                <p
                                    key={d.spec.id}
                                    style={{
                                        fontFamily: mono,
                                        fontSize: "0.74rem",
                                        color: "var(--fg-muted)",
                                        lineHeight: 1.8,
                                        margin: 0,
                                    }}
                                >
                                    {d.spec.label} {d.spec.version} · {formatBytes(d.bytes)} ·{" "}
                                    {constants ? formatTez((d.bytes * constants.costPerByte) / 1_000_000) : "…"} —{" "}
                                    <span style={{ color: "var(--fg)" }}>paid once by whoever does it, then free for every project after</span>
                                </p>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* --------------------------------------------------------- publish */}
            {tab === "publish" && (
                <section
                    style={{
                        marginTop: "1.5rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.8rem",
                            alignItems: "flex-end",
                        }}
                    >
                        <label style={{ display: "block", flex: "1 1 220px", minWidth: 0 }}>
                            <span style={labelStyle}>Testnet</span>
                            <select value={networkId} onChange={(e) => setNetworkId(e.target.value)} style={fieldStyle}>
                                {networks.map((n) => (
                                    <option key={n.id} value={n.id}>
                                        {n.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {activeAddress ? (
                            <button type="button" style={button()} onClick={() => void disconnect()}>
                                {activeAddress.slice(0, 6)}…{activeAddress.slice(-4)} · disconnect
                            </button>
                        ) : onSite ? (
                            <ConnectWallet />
                        ) : (
                            <button type="button" style={button("solid", connecting)} disabled={connecting} onClick={() => void connect()}>
                                {connecting ? "connecting…" : `connect on ${net.label}`}
                            </button>
                        )}
                        {net.faucet && (
                            <a href={net.faucet} target="_blank" rel="noopener noreferrer" style={{ ...button(), textDecoration: "none" }}>
                                faucet <ExternalLink size={11} aria-hidden="true" />
                            </a>
                        )}
                    </div>

                    <Note>
                        // v0 publishes to testnets only. mainnet contracts are v1, and most of what they store can never be changed — so
                        they wait until the shape has survived being wrong a few times here.
                    </Note>

                    {!gateOpen && (
                        <p
                            style={{
                                fontFamily: mono,
                                fontSize: "0.78rem",
                                color: "var(--warn)",
                            }}
                        >
                            // run the checks first.
                        </p>
                    )}

                    {cost?.needsChunking && (
                        <p
                            style={{
                                fontFamily: mono,
                                fontSize: "0.78rem",
                                color: "var(--err, #ff6b6b)",
                                lineHeight: 1.7,
                            }}
                        >
                            // this generator is {formatBytes(cost.totalBytes)} — hex-encoded that exceeds what one operation can carry, so
                            it needs {cost.operations} chunked uploads. v0 publishes in a single origination; chunking is v1. Trim the code,
                            or move heavy assets out of it.
                        </p>
                    )}

                    <div
                        style={{
                            display: "grid",
                            gap: "0.8rem",
                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        }}
                    >
                        <label>
                            <span style={labelStyle}>Title</span>
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="untitled system"
                                style={fieldStyle}
                            />
                        </label>
                        <label>
                            <span style={labelStyle}>Edition size (0 = open)</span>
                            <input
                                type="number"
                                value={edition}
                                onChange={(e) => setEdition(Math.max(0, Number(e.target.value)))}
                                style={fieldStyle}
                            />
                        </label>
                        <label>
                            <span style={labelStyle}>Royalties %</span>
                            <input
                                type="number"
                                min={0}
                                max={25}
                                step={0.5}
                                value={royaltiesPct}
                                onChange={(e) => setRoyaltiesPct(Math.max(0, Math.min(25, Number(e.target.value))))}
                                style={fieldStyle}
                            />
                        </label>
                    </div>
                    <label>
                        <span style={labelStyle}>Description</span>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            placeholder="What is the system doing?"
                            style={{ ...fieldStyle, resize: "vertical" }}
                        />
                    </label>

                    {publishError && (
                        <p
                            role="alert"
                            style={{
                                fontFamily: mono,
                                fontSize: "0.76rem",
                                color: "var(--err, #ff6b6b)",
                                wordBreak: "break-word",
                            }}
                        >
                            // {publishError}
                        </p>
                    )}
                    {publishStep && <Note>// {publishStep}</Note>}

                    {!contract ? (
                        <button
                            type="button"
                            style={button("solid", !activeAddress || !gateOpen || publishing || !!cost?.needsChunking || paramErrors.length > 0)}
                            disabled={!activeAddress || !gateOpen || publishing || !!cost?.needsChunking || paramErrors.length > 0}
                            onClick={() => void doPublish()}
                        >
                            <Rocket size={12} aria-hidden="true" />
                            {publishing ? "publishing…" : `publish generator on ${net.label}`}
                        </button>
                    ) : (
                        <div
                            style={{
                                ...cardStyle,
                                borderColor: "var(--ok)",
                                background: "var(--ok-bg)",
                            }}
                        >
                            <p
                                style={{
                                    fontFamily: mono,
                                    fontSize: "0.8rem",
                                    color: "var(--ok)",
                                    margin: "0 0 0.5rem",
                                }}
                            >
                                // published — code and record are in contract storage
                            </p>
                            <a
                                href={`${net.tzktUrl}/${contract}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    fontFamily: mono,
                                    fontSize: "0.76rem",
                                    color: "var(--fg)",
                                    wordBreak: "break-all",
                                }}
                            >
                                {contract} <ExternalLink size={11} aria-hidden="true" />
                            </a>
                            {publishedSpecs.length > 0 && (
                                <div
                                    style={{
                                        marginTop: "0.9rem",
                                        paddingTop: "0.9rem",
                                        borderTop: "1px solid var(--border)",
                                    }}
                                >
                                    <span style={labelStyle}>Set the parameters for this piece</span>
                                    <ParamsTuner specs={publishedSpecs} values={mintValues} onChange={setMintValues} />
                                    <button
                                        type="button"
                                        style={{ ...button(), marginTop: "0.6rem" }}
                                        onClick={() => setMintValues(randomValues(publishedSpecs))}
                                    >
                                        <Dices size={12} aria-hidden="true" /> random values
                                    </button>
                                    <p
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.68rem",
                                            color: "var(--fg-muted)",
                                            marginTop: "0.6rem",
                                            lineHeight: 1.7,
                                        }}
                                    >
                                        // these controls are built from the declaration in the record, nothing else. the values go into
                                        the token's own metadata as <code>aleaParams</code>, so the piece stays re-renderable by anyone.
                                    </p>
                                </div>
                            )}

                            <div
                                style={{
                                    display: "flex",
                                    gap: "0.5rem",
                                    marginTop: "0.8rem",
                                    flexWrap: "wrap",
                                }}
                            >
                                <button
                                    type="button"
                                    style={button("solid", minting || (edition > 0 && minted.length >= edition))}
                                    disabled={minting || (edition > 0 && minted.length >= edition)}
                                    onClick={() => void doMint()}
                                >
                                    <Dices size={12} aria-hidden="true" />
                                    {minting ? "minting…" : `mint piece #${minted.length}`}
                                </button>
                                <button
                                    type="button"
                                    style={button()}
                                    onClick={() => {
                                        setGalleryAddress(contract);
                                        setTab("gallery");
                                        void loadGallery(contract);
                                    }}
                                >
                                    <Images size={12} aria-hidden="true" /> open in gallery
                                </button>
                            </div>
                            <p
                                style={{
                                    fontFamily: mono,
                                    fontSize: "0.68rem",
                                    color: "var(--fg-muted)",
                                    marginTop: "0.7rem",
                                    lineHeight: 1.7,
                                }}
                            >
                                // each mint is one batched operation (create_token + mint_tokens). that operation's hash is the seed source
                                — nobody, including us, knows the seed before it lands.
                            </p>
                        </div>
                    )}

                    {minted.length > 0 && (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                                gap: "0.6rem",
                            }}
                        >
                            {minted.map((piece) => (
                                <div key={piece.tokenId}>
                                    <div style={previewBox}>
                                        <SandboxFrame
                                            html={project.html}
                                            seed={piece.seed}
                                            deps={depSources}
                                            params={piece.params}
                                            paramsSchema={publishedSpecs}
                                            timeout={CAPTURE_TIMEOUT}
                                        />
                                    </div>
                                    <p
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.66rem",
                                            color: "var(--fg-muted)",
                                            marginTop: "0.35rem",
                                            wordBreak: "break-all",
                                        }}
                                    >
                                        #{piece.tokenId} · seed {piece.seed.slice(0, 10)}…
                                        {publishedSpecs.length > 0 && (
                                            <>
                                                <br />
                                                {summarizeParams(publishedSpecs, piece.params)}
                                            </>
                                        )}
                                        <br />
                                        <a
                                            href={`${net.tzktUrl}/${piece.opHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ color: "var(--fg-muted)" }}
                                        >
                                            op {piece.opHash.slice(0, 10)}…
                                        </a>
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* --------------------------------------------------------- gallery */}
            {tab === "gallery" && (
                <section
                    style={{
                        marginTop: "1.5rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                    }}
                >
                    <Note>
                        // rebuilds every piece from chain state: code out of contract storage, seed derived from each mint's operation
                        hash. no indexer, no server, no stored images.
                    </Note>
                    <div
                        style={{
                            display: "flex",
                            gap: "0.5rem",
                            flexWrap: "wrap",
                            alignItems: "flex-end",
                        }}
                    >
                        <label style={{ flex: "1 1 320px", minWidth: 0 }}>
                            <span style={labelStyle}>Generator contract on {net.label}</span>
                            <input
                                value={galleryAddress}
                                onChange={(e) => setGalleryAddress(e.target.value)}
                                placeholder="KT1…"
                                style={fieldStyle}
                            />
                        </label>
                        <button
                            type="button"
                            style={button("solid", galleryLoading)}
                            disabled={galleryLoading}
                            onClick={() => void loadGallery(galleryAddress)}
                        >
                            {galleryLoading ? "loading…" : "rebuild from chain"}
                        </button>
                    </div>

                    {galleryError && (
                        <p
                            style={{
                                fontFamily: mono,
                                fontSize: "0.76rem",
                                color: "var(--err, #ff6b6b)",
                            }}
                        >
                            // {galleryError}
                        </p>
                    )}

                    {gallery && (
                        <>
                            <div style={cardStyle}>
                                <div
                                    style={{
                                        fontFamily: mono,
                                        fontSize: "0.9rem",
                                        color: "var(--fg)",
                                    }}
                                >
                                    {gallery.record.title}
                                </div>
                                <p
                                    style={{
                                        fontFamily: mono,
                                        fontSize: "0.72rem",
                                        color: "var(--fg-muted)",
                                        lineHeight: 1.8,
                                        margin: "0.4rem 0 0",
                                    }}
                                >
                                    {gallery.record.description}
                                    <br />
                                    schema v{gallery.record.schema_version} · runtime {gallery.record.runtime.kind_name}@
                                    {gallery.record.runtime.kind_version} (kind_id {gallery.record.runtime.kind_id}) · standard v
                                    {gallery.record.standard_version} · {STORAGE_CLASS_LABEL[gallery.record.storage_class]?.name ?? gallery.record.storage_class}
                                    <br />
                                    code {formatBytes(gallery.record.code.bytes)} · blake2b {gallery.record.code.hash.slice(0, 16)}…
                                    <br />
                                    seed policy {gallery.record.seed_policy.kind} v{gallery.record.seed_policy.version} ·{" "}
                                    {gallery.record.seed_policy.formula}
                                    <br />
                                    params{" "}
                                    {gallery.specs.length === 0
                                        ? "none declared"
                                        : gallery.specs
                                              .map((p) =>
                                                  p.type === "select"
                                                      ? `${p.id} (${(p.options ?? []).join("|")})`
                                                      : p.type === "number" || p.type === "int"
                                                        ? `${p.id} (${p.min}…${p.max})`
                                                        : `${p.id} (${p.type})`,
                                              )
                                              .join(" · ")}
                                </p>
                                {gallery.specs.length > 0 && (
                                    <p
                                        style={{
                                            fontFamily: mono,
                                            fontSize: "0.68rem",
                                            color: "var(--fg-muted)",
                                            lineHeight: 1.7,
                                            margin: "0.5rem 0 0",
                                        }}
                                    >
                                        // this declaration came out of contract storage, and every piece below is rendered with the
                                        values written on its own token. nothing here was remembered by the front end.
                                    </p>
                                )}
                            </div>

                            {gallery.pieces.length === 0 ? (
                                <Note>// no pieces minted from this generator yet.</Note>
                            ) : (
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                                        gap: "0.6rem",
                                    }}
                                >
                                    {gallery.pieces.map((piece) => (
                                        <div key={piece.tokenId}>
                                            <div style={previewBox}>
                                                <SandboxFrame
                                                    html={gallery.code}
                                                    seed={piece.seed}
                                                    deps={gallery.deps}
                                                    params={piece.params}
                                                    paramsSchema={gallery.specs}
                                                    timeout={CAPTURE_TIMEOUT}
                                                />
                                            </div>
                                            <p
                                                style={{
                                                    fontFamily: mono,
                                                    fontSize: "0.66rem",
                                                    color: "var(--fg-muted)",
                                                    marginTop: "0.35rem",
                                                    wordBreak: "break-all",
                                                }}
                                            >
                                                #{piece.tokenId} · seed {piece.seed.slice(0, 10)}…
                                                {gallery.specs.length > 0 && (
                                                    <>
                                                        <br />
                                                        {summarizeParams(gallery.specs, piece.params)}
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </section>
            )}
        </div>
    );
}

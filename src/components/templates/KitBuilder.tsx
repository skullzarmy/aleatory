"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { RUNTIME_KINDS, getKind } from "@/lib/kinds";
import { declaredIn, specFor, withLibraries } from "@/lib/libraries";
import { detectKind } from "@/lib/detect";
import type { Hit, Resolution } from "@/lib/npm";

/**
 * Build a starter kit out of any packages on npm.
 *
 * The four fixed kits answer "start me from p5". This answers "I want three and
 * d3 and a canvas", which the declaration model has always allowed and the page
 * never offered.
 *
 * The work that makes it worth having is version archaeology. npm's search
 * returns the newest release, and for any package of age the newest release is
 * an ES module, which a script tag cannot load. Searching `three` gives
 * `0.185.1`; the last one a piece can actually declare is `0.160.1`, thirty
 * four releases back. So a pick is resolved rather than accepted, and what
 * lands in the list is something that loads or an honest refusal.
 *
 * Nothing here is silent. Every state this can be in says so on screen, because
 * the failure that costs an artist a piece is the one nothing mentioned.
 */

interface KitLibrary {
    coordinate: string;
    id: string;
    version: string;
    global: string | null;
    bytes: number;
}

type Pick =
    | { key: string; id: string; version: string; s: "resolving" }
    | { key: string; id: string; version: string; s: "ok"; lib: KitLibrary; note: string | null }
    | { key: string; id: string; version: string; s: "refused"; why: string }
    | { key: string; id: string; version: string; s: "slow"; why: string }
    | { key: string; id: string; version: string; s: "pinned"; lib: KitLibrary };

type Search =
    | { s: "idle" }
    | { s: "searching" }
    | { s: "results"; hits: Hit[] }
    | { s: "empty"; q: string }
    | { s: "error" };

const keyOf = (id: string, version: string) => `${id}@${version}`;
const kb = (bytes: number) => (bytes > 0 ? `${Math.round(bytes / 1024)} kB` : "");

export function KitBuilder() {
    const [kindId, setKindId] = useState(RUNTIME_KINDS[0].kindId);
    const [picks, setPicks] = useState<Pick[]>([]);
    const [query, setQuery] = useState("");
    const [search, setSearch] = useState<Search>({ s: "idle" });
    const [building, setBuilding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Retrying has to change something, or React bails on the identical state
    // and the button does nothing.
    const [attempt, setAttempt] = useState(0);

    // Only the newest search may write. Without this a slow answer for "th"
    // lands after a fast one for "three" and replaces it.
    const latest = useRef(0);

    /**
     * What the chosen base already declares.
     *
     * The p5 template's body is a p5 sketch, so p5 there is not a choice, it is
     * what the file is. Shown as part of the kit and not removable, rather than
     * added silently at zip time where nobody could see it.
     */
    useEffect(() => {
        const base = declaredIn(kindPreamble(kindId)).flatMap((coordinate): Pick[] => {
            const spec = specFor(coordinate);
            if (!spec) return [];
            return [
                {
                    key: keyOf(spec.id, spec.version),
                    id: spec.id,
                    version: spec.version,
                    s: "pinned",
                    lib: {
                        coordinate,
                        id: spec.id,
                        version: spec.version,
                        global: spec.id === "p5" ? "p5" : null,
                        bytes: 0,
                    },
                },
            ];
        });
        // A base that pins p5 replaces a p5 somebody added by hand, rather
        // than sitting beside it and writing the declaration into the file
        // twice.
        const pinned = new Set(base.map((p) => p.id));
        setPicks((was) => [...base, ...was.filter((p) => p.s !== "pinned" && !pinned.has(p.id))]);
    }, [kindId]);

    // Debounced. The spinner is set inside the timer rather than on the way in,
    // so typing does not start and stop an animation on every keystroke.
    useEffect(() => {
        const text = query.trim();
        if (text.length < 2) {
            setSearch({ s: "idle" });
            return;
        }
        const mine = ++latest.current;
        const timer = window.setTimeout(() => {
            setSearch({ s: "searching" });
            void fetch(`/api/npm/search?q=${encodeURIComponent(text)}`)
                .then(async (r) => {
                    if (!r.ok) throw new Error(String(r.status));
                    return (await r.json()) as { hits?: Hit[] };
                })
                .then((body) => {
                    if (mine !== latest.current) return;
                    const hits = body.hits ?? [];
                    setSearch(hits.length > 0 ? { s: "results", hits } : { s: "empty", q: text });
                })
                .catch(() => {
                    if (mine === latest.current) setSearch({ s: "error" });
                });
        }, 300);
        return () => window.clearTimeout(timer);
    }, [query, attempt]);

    const add = useCallback(async (id: string, version: string) => {
        const key = keyOf(id, version);
        setError(null);
        setPicks((was) =>
            was.some((p) => p.key === key) ? was : [...was, { key, id, version, s: "resolving" }],
        );

        const settle = (next: Pick) =>
            setPicks((was) => was.map((p) => (p.key === key ? next : p)));

        try {
            const res = await fetch(
                `/api/npm/inspect?id=${encodeURIComponent(id)}&version=${encodeURIComponent(version)}`,
            );
            if (!res.ok) {
                // Running out of time is not a verdict on the package. The
                // second try is usually fast, because the miss warmed the CDN.
                const why = await res.text();
                settle({ key, id, version, s: res.status === 504 ? "slow" : "refused", why });
                return;
            }
            const found = (await res.json()) as Resolution;

            if (!found.coordinate) {
                settle({
                    key,
                    id,
                    version,
                    s: "refused",
                    why: found.note ?? `${id} cannot be loaded from a script tag.`,
                });
                return;
            }

            settle({
                key,
                id,
                version,
                s: "ok",
                note: found.note,
                lib: {
                    coordinate: found.coordinate,
                    id,
                    version: found.inspection.version,
                    global: found.global,
                    bytes: found.bytes,
                },
            });
        } catch {
            settle({
                key,
                id,
                version,
                s: "refused",
                why: "That package could not be read just now.",
            });
        }
    }, []);

    const remove = useCallback((key: string) => {
        setPicks((was) => was.filter((p) => p.key !== key));
    }, []);

    const usable = useMemo(
        () => picks.flatMap((p) => (p.s === "ok" || p.s === "pinned" ? [p.lib] : [])),
        [picks],
    );
    const resolving = picks.some((p) => p.s === "resolving");
    const declaredBytes = usable.reduce((n, l) => n + l.bytes, 0);

    /**
     * The kind this file will be read as, from the same function the studio
     * asks.
     *
     * The base is a body to start writing in. The kind is what the file turns
     * out to be, and declaring anything other than p5 makes it custom, because
     * a kind here means "no dependencies, fully on chain" or it means nothing.
     *
     * Asked of the declarations alone rather than the finished document, so the
     * templates do not have to be in this page's bundle to answer it. Declaring
     * something is the rule that fires first, so the two agree.
     */
    const willBe = useMemo(() => {
        if (usable.length === 0) return getKind(kindId);
        const declarations = withLibraries(
            "<!doctype html><html><head></head><body></body></html>",
            usable.map((l) => l.coordinate),
        );
        return getKind(detectKind(declarations).kindId);
    }, [usable, kindId]);

    async function download() {
        setBuilding(true);
        setError(null);
        try {
            // Loaded here, not at the top. The kit module carries every
            // template, every readme and the local server inline, which is a
            // lot of bytes to hand somebody who is only reading the page.
            const [{ zipKit, kitName }, skill] = await Promise.all([
                import("@/lib/kit"),
                fetch("/skill/aleatory-generator/SKILL.md")
                    .then((r) => (r.ok ? r.text() : ""))
                    .catch(() => ""),
            ]);

            const input = { kindId, libraries: usable, skill };
            const url = URL.createObjectURL(
                new Blob([zipKit(input) as unknown as BlobPart], { type: "application/zip" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = kitName(input);
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            setError("The kit could not be built.");
        } finally {
            setBuilding(false);
        }
    }

    return (
        <section className="rounded-lg border border-border p-4 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight">Build a kit</h2>
            <p className="mt-2 text-sm text-muted-foreground">
                Any package on npm. Each one is checked before you download it, and when the newest
                release cannot be loaded from a script tag, the newest one that can is used instead.
            </p>

            <fieldset className="mt-6">
                <legend className="text-sm font-medium">Start from</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                    {RUNTIME_KINDS.map((k) => (
                        <button
                            key={k.kindId}
                            type="button"
                            onClick={() => setKindId(k.kindId)}
                            aria-pressed={k.kindId === kindId}
                            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                                k.kindId === kindId
                                    ? "border-alea-600 bg-alea-600 text-white"
                                    : "border-border hover:bg-accent"
                            }`}
                        >
                            {k.label}
                        </button>
                    ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{getKind(kindId).entrySpec}</p>
            </fieldset>

            <div className="mt-6">
                <label htmlFor="npm-search" className="text-sm font-medium">
                    Libraries
                </label>
                <input
                    id="npm-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search npm, e.g. three"
                    className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <SearchPanel
                    search={search}
                    query={query}
                    picks={picks}
                    onAdd={(id, v) => void add(id, v)}
                    onRetry={() => setAttempt((n) => n + 1)}
                />
            </div>

            {picks.length > 0 && (
                <ul className="mt-4 space-y-2">
                    {picks.map((pick) => (
                        <PickRow
                            key={pick.key}
                            pick={pick}
                            onRemove={() => remove(pick.key)}
                            onRetry={() => void add(pick.id, pick.version)}
                        />
                    ))}
                </ul>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">
                    {usable.length === 0
                        ? "No libraries. Everything the piece draws will be its own code."
                        : `${usable.length} declared${declaredBytes > 0 ? `, ${kb(declaredBytes)} loaded before your code runs` : ""}.`}
                    <br />
                    Reads as <strong className="text-foreground">{willBe.label}</strong>, which is
                    what the studio will say when you bring it back.
                </p>
                <button
                    type="button"
                    onClick={() => void download()}
                    disabled={resolving || building}
                    className="rounded-md bg-alea-600 px-4 py-2 text-sm font-medium text-white hover:bg-alea-700 disabled:opacity-60"
                >
                    {building ? "Building" : resolving ? "Checking" : "Download kit"}
                </button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </section>
    );
}

/** Every state the search can be in, each said out loud. */
function SearchPanel({
    search,
    query,
    picks,
    onAdd,
    onRetry,
}: {
    search: Search;
    query: string;
    picks: Pick[];
    onAdd: (id: string, version: string) => void;
    onRetry: () => void;
}) {
    if (search.s === "idle") {
        return (
            <p className="mt-2 text-xs text-muted-foreground">
                {query.trim().length === 0
                    ? "Or take one of the fixed kits below."
                    : "Keep typing."}
            </p>
        );
    }

    if (search.s === "searching") {
        return (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching npm
            </p>
        );
    }

    if (search.s === "empty") {
        return (
            <p className="mt-2 text-xs text-muted-foreground">
                Nothing on npm matches {`"${search.q}"`}.
            </p>
        );
    }

    if (search.s === "error") {
        return (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                npm did not answer.
                <button
                    type="button"
                    onClick={onRetry}
                    className="rounded border border-border px-2 py-0.5 hover:bg-accent"
                >
                    Try again
                </button>
            </p>
        );
    }

    return (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {search.hits.map((h) => {
                const already = picks.some((p) => p.id === h.id);
                return (
                    <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-sm">
                                {h.id}
                                <span className="text-muted-foreground">@{h.version}</span>
                            </span>
                            {h.description && (
                                <span className="block truncate text-xs text-muted-foreground">
                                    {h.description}
                                </span>
                            )}
                        </span>
                        <button
                            type="button"
                            disabled={already}
                            onClick={() => onAdd(h.id, h.version)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                        >
                            <Plus className="h-3 w-3" />
                            {already ? "Added" : "Add"}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

function PickRow({
    pick,
    onRemove,
    onRetry,
}: {
    pick: Pick;
    onRemove: () => void;
    onRetry: () => void;
}) {
    const refused = pick.s === "refused" || pick.s === "slow";

    return (
        <li
            className={`rounded-md border px-3 py-2 ${
                refused ? "border-warning/50 bg-warning/5" : "border-border"
            }`}
        >
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                    {pick.s === "ok" || pick.s === "pinned" ? pick.lib.coordinate : pick.key}
                </span>

                {pick.s === "resolving" && (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        checking
                    </span>
                )}
                {(pick.s === "ok" || pick.s === "pinned") && (
                    <Check className="h-4 w-4 shrink-0 text-success" />
                )}

                {pick.s === "pinned" ? (
                    <span className="shrink-0 text-xs text-muted-foreground">from this base</span>
                ) : (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={`Remove ${pick.id}`}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {(pick.s === "ok" || pick.s === "pinned") && (
                <p className="mt-1 text-xs text-muted-foreground">
                    {pick.lib.global ? (
                        <>
                            available as <code className="font-mono">window.{pick.lib.global}</code>
                        </>
                    ) : (
                        "loads, but its global could not be read. Check the package's own docs."
                    )}
                    {pick.lib.bytes > 0 && ` · ${kb(pick.lib.bytes)}`}
                </p>
            )}

            {pick.s === "ok" && pick.note && (
                <p className="mt-1 text-xs text-muted-foreground">{pick.note}</p>
            )}

            {pick.s === "refused" && (
                <p className="mt-1 text-xs text-muted-foreground">{pick.why}</p>
            )}

            {pick.s === "slow" && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {pick.why}
                    <button
                        type="button"
                        onClick={onRetry}
                        className="rounded border border-border px-2 py-0.5 hover:bg-accent"
                    >
                        Check again
                    </button>
                </p>
            )}
        </li>
    );
}

/**
 * The declarations a base carries, without loading the templates to find out.
 *
 * Only p5 has any, and its kind record names it. Reading it from the generated
 * module would put every template's bytes in this page's bundle for one string.
 */
function kindPreamble(kindId: number): string {
    return getKind(kindId)
        .deps.map((d) => `<meta name="alea:library" content="${d.id}@${d.version}">`)
        .join("\n");
}

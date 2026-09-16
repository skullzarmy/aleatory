"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveDeps, type ResolvedDep } from "@/lib/runtimes";
import { librariesIn } from "@/lib/libraries";

/**
 * The libraries this document asks for, resolved once for the whole workspace.
 *
 * A library is fetched here and inlined into the document before it runs, so
 * the frame can hold `connect-src 'none'` and reach nothing. Resolving per
 * frame would fetch p5 seventeen times to draw a seed grid.
 */
export function useDeps(html: string): {
    deps: string[];
    resolved: ResolvedDep[];
    loading: boolean;
    /**
     * Every declaration is resolved and none failed. `loading` starts false
     * with nothing resolved, so the first render of a document that declares
     * something reports neither loading nor ready, and a frame mounted on
     * `!loading` draws without its libraries.
     */
    ready: boolean;
    error: string | null;
} {
    const [resolved, setResolved] = useState<ResolvedDep[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Keyed on what the document declares, never on the document: depending on
    // `html` re-resolves the libraries on every debounced keystroke.
    const key = useMemo(() => {
        const { specs } = librariesIn(html);
        return specs.map((s) => `${s.id}@${s.version}#${s.hash ?? ""}`).join(",");
    }, [html]);

    useEffect(() => {
        const { specs } = librariesIn(html);
        if (specs.length === 0) {
            setResolved([]);
            setLoading(false);
            setError(null);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        void resolveDeps(specs)
            .then((r) => {
                if (cancelled) return;
                setResolved(r);
                setLoading(false);
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : "A library could not be loaded.");
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // `html` is read inside and absent here: `key` is the part of it that
        // can change the answer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    // A fresh array each render would make every consumer's dependency arrays
    // unstable, and one that remounts a frame on change never stops.
    const deps = useMemo(() => resolved.map((r) => r.source), [resolved]);

    const ready = useMemo(
        () => !loading && error === null && resolved.length === librariesIn(html).specs.length,
        [loading, error, resolved, html],
    );

    return { deps, resolved, loading, ready, error };
}

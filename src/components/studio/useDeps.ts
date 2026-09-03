"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveDeps, type ResolvedDep } from "@/lib/runtimes";
import { librariesIn } from "@/lib/libraries";

/**
 * The libraries this document asks for, resolved once for the whole workspace.
 *
 * Resolution is a pre-render step on purpose: a library is fetched here, in the
 * studio, and inlined into the document before it runs. The frame itself has
 * `connect-src 'none'` and reaches nothing, which is what makes "a piece never
 * touches the network" structural rather than a promise.
 *
 * Resolving per frame would fetch p5 seventeen times to draw a seed grid, so it
 * happens here and every frame is handed the same already-resolved sources.
 */
export function useDeps(html: string): {
    deps: string[];
    resolved: ResolvedDep[];
    loading: boolean;
    error: string | null;
} {
    const [resolved, setResolved] = useState<ResolvedDep[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Keyed on what the document *declares*, never on the document. Editing
    // drawing code changes no declaration, and depending on `html` re-resolves
    // the libraries on every debounced keystroke, tearing down the frame of
    // any consumer that swaps it out while loading.
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
        // `html` is read inside and deliberately absent: `key` is the part of it
        // that can change the answer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    // Memoised. Returning a fresh array each render makes every consumer's
    // dependency arrays unstable, and a consumer that remounts a frame on
    // change then remounts it forever.
    const deps = useMemo(() => resolved.map((r) => r.source), [resolved]);

    return { deps, resolved, loading, error };
}

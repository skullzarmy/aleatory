"use client";

import { useRef, type ReactNode } from "react";

/**
 * Keeps the last successful render of a page across `router.refresh()`.
 *
 * `LiveRefresh` re-runs a page's server components on a timer, and one failed
 * indexer read during that pass would replace a page that was fine a moment ago.
 * A page whose read failed renders this with `failed` set: whatever rendered
 * last stays on screen, and `fallback` shows only when nothing has.
 *
 * Next keys a page segment by its params and search params, so navigating to a
 * different piece mounts a fresh one and nothing carries across.
 */
export function LastGood({
    children,
    failed = false,
    fallback = null,
}: {
    children?: ReactNode;
    failed?: boolean;
    fallback?: ReactNode;
}) {
    const last = useRef<ReactNode>(failed ? null : children);
    if (!failed && children !== undefined) {
        last.current = children;
    }
    return <>{failed ? (last.current ?? fallback) : children}</>;
}

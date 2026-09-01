"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * After load rather than during it: registration competes with the first paint
 * for the same connection, and nothing on the first visit needs it.
 *
 * Development is skipped. A worker caching a dev server's output outlives the
 * dev server, and the resulting stale page is the kind of thing somebody
 * debugs for an hour.
 */
export function ServiceWorker() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production") return;
        if (!("serviceWorker" in navigator)) return;
        const register = () => {
            void navigator.serviceWorker.register("/sw.js").catch(() => {
                /* the site works without it */
            });
        };
        if (document.readyState === "complete") register();
        else window.addEventListener("load", register, { once: true });
        return () => window.removeEventListener("load", register);
    }, []);

    return null;
}

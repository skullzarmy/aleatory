"use client";

import { useEffect } from "react";

// Skipped outside production: a worker caching the dev server's output
// outlives the dev server and leaves a stale page behind.
export function ServiceWorker() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production") return;
        if (!("serviceWorker" in navigator)) return;
        // Registers after load, not during: registration would otherwise
        // compete with first paint for the same connection.
        const register = () => {
            void navigator.serviceWorker.register("/sw.js").catch(() => {});
        };
        if (document.readyState === "complete") register();
        else window.addEventListener("load", register, { once: true });
        return () => window.removeEventListener("load", register);
    }, []);

    return null;
}

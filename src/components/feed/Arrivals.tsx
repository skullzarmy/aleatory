"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Marks the items a refresh brought in, so they fade in rather than appear
 * between one blink and the next.
 *
 * Only the arrivals. Everything present on the first paint is already the
 * answer to what was asked for, and animating a whole grid on load is a page
 * that cannot be read until it finishes.
 *
 * The distinction is made on the mount of each item rather than by diffing
 * lists: `router.refresh()` reconciles in place, so an item that was already
 * on screen stays mounted and only genuinely new keys mount again.
 */
type Registry = { seen: Set<string>; seeded: boolean };

const Ctx = createContext<Registry | null>(null);

export function Arrivals({ children }: { children: ReactNode }) {
    const registry = useRef<Registry>({ seen: new Set(), seeded: false });

    // Child effects run before the parent's, so everything in the first paint
    // has already registered itself by the time this marks the list seeded.
    useEffect(() => {
        registry.current.seeded = true;
    }, []);

    return <Ctx.Provider value={registry.current}>{children}</Ctx.Provider>;
}

export function Arriving({ id, children }: { id: string; children: ReactNode }) {
    const registry = useContext(Ctx);
    const [arrived, setArrived] = useState(false);

    useEffect(() => {
        if (!registry || registry.seen.has(id)) return;
        registry.seen.add(id);
        if (registry.seeded) setArrived(true);
    }, [id, registry]);

    return <div className={arrived ? "arriving" : undefined}>{children}</div>;
}

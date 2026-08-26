"use client";

import { useEffect, useState } from "react";
import { renderLogo, CANONICAL_SEED } from "@/lib/logo";

/**
 * The mark, drawn fresh on every load.
 *
 * The seed is chosen in an effect rather than in `useState`'s initialiser,
 * which is the difference between a mark that is new every visit and one that
 * is new every deploy.
 *
 * An initialiser runs during the server render, and for a statically built
 * page that render happens once, at build time. Hydration then reuses the
 * server's markup rather than reapplying `dangerouslySetInnerHTML`, so the
 * build's seed was baked into the HTML and every visitor saw the same mark
 * until the next deploy.
 *
 * So the server draws the canonical mark, which is stable and needs no
 * hydration suppression, and the browser redraws with its own seed on mount.
 */
export function Logo({
    size = 40,
    fixed = false,
    detail = "full",
    label = "Aleatory",
    className,
}: {
    size?: number;
    /** Hold the canonical mark instead of drawing a new one. */
    fixed?: boolean;
    detail?: "full" | "compact";
    /** Empty marks it decorative, for when it sits beside the word. */
    label?: string;
    className?: string;
}) {
    const [seed, setSeed] = useState(CANONICAL_SEED);

    useEffect(() => {
        if (!fixed) setSeed(`${Date.now()}-${Math.random()}`);
    }, [fixed]);

    return (
        <span
            className={className}
            style={{ display: "inline-flex", width: size, height: size }}
            dangerouslySetInnerHTML={{
                __html: renderLogo({ seed, size, detail, label }),
            }}
        />
    );
}

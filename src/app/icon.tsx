import { ImageResponse } from "next/og";
import { renderLogo, CANONICAL_SEED } from "@/lib/logo";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The favicon, from the canonical seed at compact detail.
 *
 * A tab icon has to be the same every visit, and the full mark's tracery
 * disappears below about forty pixels.
 */
export default function Icon() {
    const svg = renderLogo({
        seed: CANONICAL_SEED,
        size: 64,
        detail: "compact",
        stroke: "#d9b46a",
        background: "#0f1b1a",
    });

    return new ImageResponse(
        (
            <div
                style={{ display: "flex", width: 64, height: 64 }}
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        ),
        size,
    );
}

import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/config";

/**
 * The card any page falls back to.
 *
 * Almost nothing here needs a generated image: every rendered piece already
 * has a PNG pinned, a collection uses its newest one, a wallet uses its
 * avatar. This is for the pages that are not a picture, and for a piece whose
 * render has not landed yet, so a link is never a blank rectangle.
 *
 * Drawn rather than served from a file so it stays in step with the brand
 * without anyone re-exporting a PNG.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${BRAND.name} — ${BRAND.tagline}`;

export default function Image() {
    return new ImageResponse(
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                background: "#17191c",
                color: "#fafafa",
                padding: 72,
                fontFamily: "sans-serif",
            }}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>{BRAND.name}</div>
                <div style={{ fontSize: 38, color: "#a1a1aa", maxWidth: 900 }}>{BRAND.tagline}</div>
            </div>
            <div style={{ fontSize: 26, color: "#71717a" }}>
                A piece is code plus a seed bound to the operation that bought it.
            </div>
        </div>,
        size,
    );
}

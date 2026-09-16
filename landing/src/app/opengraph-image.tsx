import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/config";
import { renderLogo } from "@/lib/logo";

/**
 * The card this address shows when somebody shares it.
 *
 * Without one, the `summary_large_image` this page asks for renders as a large
 * empty box, which is worse than no card at all: the link that goes furthest is
 * the one an artist posts to say they are building here.
 *
 * Drawn rather than exported, so it carries the brand without anyone
 * maintaining a PNG. Matches the app's own card, since these are two views of
 * one thing.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${BRAND.name}, ${BRAND.tagline}`;

export default function Image() {
    // The same mark the page draws, inlined as a data URI because the card is
    // rendered by satori and cannot fetch anything.
    const mark = `data:image/svg+xml;base64,${Buffer.from(
        renderLogo({ size: 180, stroke: "#fafafa", label: "" }),
    ).toString("base64")}`;

    return new ImageResponse(
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                background: "#17181c",
                color: "#fafafa",
                padding: 72,
                fontFamily: "sans-serif",
            }}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mark} width={180} height={180} alt="" />
                <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>{BRAND.name}</div>
                <div style={{ fontSize: 38, color: "#a1a1aa", maxWidth: 900 }}>{BRAND.tagline}</div>
            </div>
            <div style={{ fontSize: 26, color: "#a1a1aa" }}>Opening soon. Artists welcome now.</div>
        </div>,
        size,
    );
}

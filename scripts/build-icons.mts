/**
 * Write the static brand assets.
 *
 *   npx tsx scripts/build-icons.mts
 *
 * The compact mark ignores the seed, so the output is stable and checked in.
 */
import { renderLogo, CANONICAL_SEED } from "../src/lib/logo";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The vector favicon. The rest of the set (favicon.ico, the 96px png, the
// apple touch icon, and the two manifest icons) is raster, from
// RealFaviconGenerator.
writeFileSync(
    resolve(root, "public/favicon.svg"),
    renderLogo({
        seed: CANONICAL_SEED,
        size: 512,
        detail: "compact",
        stroke: "#fbbf24",
        background: "#0d0f12",
    }),
);

writeFileSync(
    resolve(root, "public/mark.svg"),
    renderLogo({
        seed: CANONICAL_SEED,
        size: 512,
        stroke: "#fbbf24",
        background: "#0d0f12",
    }),
);

// Admin's favicon: the site's old pair, in relief rather than line art.
writeFileSync(
    resolve(root, "admin/public/favicon.svg"),
    renderLogo({
        seed: CANONICAL_SEED,
        size: 512,
        detail: "compact",
        stroke: "#d9b46a",
        background: "#0f1b1a",
        fill: true,
    }),
);

console.log("wrote public/favicon.svg, public/mark.svg and admin/public/favicon.svg");

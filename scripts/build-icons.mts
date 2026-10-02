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
        stroke: "#d9b46a",
        background: "#0f1b1a",
    }),
);

writeFileSync(
    resolve(root, "public/mark.svg"),
    renderLogo({
        seed: CANONICAL_SEED,
        size: 512,
        stroke: "#d9b46a",
        background: "#0f1b1a",
    }),
);

// Admin's favicon: the same mark, the same seed, so it reads as the same
// brand at a glance, recolored to admin's own warn-amber so a tab bar with
// both open tells them apart. admin/src/app/globals.css's own --base and
// --warn, not the site's colors.
writeFileSync(
    resolve(root, "admin/public/favicon.svg"),
    renderLogo({
        seed: CANONICAL_SEED,
        size: 512,
        detail: "compact",
        stroke: "#fbbf24",
        background: "#0d0f12",
    }),
);

console.log("wrote public/favicon.svg, public/mark.svg and admin/public/favicon.svg");

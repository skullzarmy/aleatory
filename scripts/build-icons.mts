/**
 * Write the static brand assets.
 *
 *   npx tsx scripts/build-icons.mts
 *
 * The compact mark ignores the seed, so these files are stable and belong in
 * the repo rather than being rendered per request.
 */
import { renderLogo, CANONICAL_SEED } from "../src/lib/logo"
import { writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// The vector favicon, drawn rather than traced.
//
// The rest of the set is raster and comes from RealFaviconGenerator:
// favicon.ico, the 96px png, the apple touch icon, and the two manifest
// icons. Its SVG was a 512px PNG wrapped in an <svg> tag, 160kB that could
// not scale, which is the one format where we already have the real thing.
writeFileSync(
  resolve(root, "public/favicon.svg"),
  renderLogo({
    seed: CANONICAL_SEED,
    size: 512,
    detail: "compact",
    stroke: "#d9b46a",
    background: "#0f1b1a",
  }),
)

// The full mark, for anywhere that wants the real thing as a file.
writeFileSync(
  resolve(root, "public/mark.svg"),
  renderLogo({
    seed: CANONICAL_SEED,
    size: 512,
    stroke: "#d9b46a",
    background: "#0f1b1a",
  }),
)

console.log("wrote public/favicon.svg and public/mark.svg")

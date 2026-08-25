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

// Tab icon. Gold on the dark plate so it holds up against either browser
// theme, since a tab strip is not ours to style.
writeFileSync(
  resolve(root, "src/app/icon.svg"),
  renderLogo({
    seed: CANONICAL_SEED,
    size: 64,
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

console.log("wrote src/app/icon.svg and public/mark.svg")

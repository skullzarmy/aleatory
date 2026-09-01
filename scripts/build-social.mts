/**
 * Write the social profile banner.
 *
 *   npm run build:social
 *
 * X wants 1500x500 and Bluesky wants 3000x1000, so one file at 3000x1000
 * serves both and has the pixels for the larger of the two.
 *
 * The field is the real mark, `renderLogo` output nested as `<svg>` children
 * at varying scale and opacity. Nothing here draws: whatever the mark becomes,
 * this follows, and a banner that drifted away from the favicon would be a
 * second source of truth about what Aleatory looks like.
 *
 * Both platforms lay the profile picture over the bottom left of the banner
 * and crop the bottom on narrow screens, so that corner is left empty and
 * nothing load-bearing sits in the lowest band.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { renderLogo, makeRandom, CANONICAL_SEED } from "../src/lib/logo"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = resolve(root, "public/social")

const W = 3000
const H = 1000

/** The plate the favicon already sits on. */
const PLATE = "#0f1b1a"
const GOLD = "#d9b46a"

/** Where the profile picture lands on both platforms. Kept clear. */
const AVATAR = { x: 0, y: 620, w: 660, h: 380 }

/** The mark that carries the thing, right of the avatar and above the crop. */
const HERO = { cx: 2040, cy: 455, size: 840 }

interface Mark {
    cx: number
    cy: number
    size: number
    opacity: number
    seed: string
}

/**
 * Nest one mark. A child `<svg>` with `x`/`y`/`width`/`height` scales its own
 * viewBox into that box, which is the whole reason the mark can be dropped in
 * at any size without touching its geometry.
 */
function place({ cx, cy, size, opacity, seed }: Mark): string {
    const svg = renderLogo({ seed, size, stroke: GOLD, label: "" })
    const x = Math.round(cx - size / 2)
    const y = Math.round(cy - size / 2)
    return svg.replace("<svg ", `<svg x="${x}" y="${y}" opacity="${opacity}" `)
}

function overlapsAvatar(m: Mark): boolean {
    const r = m.size / 2
    return (
        m.cx - r < AVATAR.x + AVATAR.w &&
        m.cx + r > AVATAR.x &&
        m.cy - r < AVATAR.y + AVATAR.h &&
        m.cy + r > AVATAR.y
    )
}

/**
 * Two marks of similar weight sitting on each other reads as a smudge, so
 * centres are kept apart. Tracery crossing tracery is the point, though, and
 * the spacing is loose enough to let it.
 */
function crowds(m: Mark, placed: Mark[]): boolean {
    return placed.some((p) => {
        const d = Math.hypot(p.cx - m.cx, p.cy - m.cy)
        return d < (p.size + m.size) * 0.26
    })
}

/** The hero needs air. Nothing else comes inside this. */
function crowdsHero(m: Mark): boolean {
    return Math.hypot(HERO.cx - m.cx, HERO.cy - m.cy) < HERO.size * 0.78 + m.size * 0.3
}

function field(): Mark[] {
    const rand = makeRandom(`${CANONICAL_SEED}/banner`)
    const hero: Mark = { ...HERO, opacity: 1, seed: CANONICAL_SEED }
    const placed: Mark[] = []

    // Bleeds past every edge, so the frame reads as a window onto a field that
    // carries on rather than a composition that stops at the border.
    let tries = 0
    while (placed.length < 38 && tries < 12000) {
        tries++
        // Squared so most are small and a few are large, which is what gives
        // the field depth. A flat distribution reads as wallpaper.
        const size = 130 + Math.floor(rand() * rand() * 520)
        const candidate: Mark = {
            cx: -260 + rand() * (W + 520),
            cy: -260 + rand() * (H + 520),
            size,
            // Small and faint together, so scale reads as distance.
            opacity: Number((0.08 + (size / 650) * 0.34 + rand() * 0.07).toFixed(3)),
            seed: `${CANONICAL_SEED}/${placed.length}`,
        }
        if (overlapsAvatar(candidate)) continue
        if (crowdsHero(candidate)) continue
        if (crowds(candidate, placed)) continue
        placed.push(candidate)
    }
    placed.unshift(hero)

    // The hero is drawn last so nothing sits over it.
    return [...placed.slice(1), hero]
}

const marks = field()

const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Aleatory">`,
    `<defs>`,
    // A little depth under the hero. Warm, and weak enough that it reads as
    // light rather than as a shape of its own.
    `<radialGradient id="glow" cx="${HERO.cx / W}" cy="${HERO.cy / H}" r="0.62">`,
    `<stop offset="0" stop-color="#1d2f2b"/>`,
    `<stop offset="1" stop-color="${PLATE}"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="${PLATE}"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glow)"/>`,
    ...marks.map(place),
    `</svg>`,
].join("")

mkdirSync(outDir, { recursive: true })
const svgPath = join(outDir, "banner.svg")
writeFileSync(svgPath, svg)

// Neither platform accepts SVG for a banner, and Chrome is already on any
// machine that develops this, so the raster comes from it rather than from a
// native image dependency.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const pngPath = join(outDir, "banner.png")

if (existsSync(CHROME)) {
    const page = join(tmpdir(), `aleatory-banner-${process.pid}.html`)
    writeFileSync(
        page,
        `<!doctype html><meta charset="utf-8">` +
            `<style>html,body{margin:0;padding:0;background:${PLATE}}svg{display:block}</style>` +
            svg,
    )
    execFileSync(
        CHROME,
        [
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            `--window-size=${W},${H}`,
            `--screenshot=${pngPath}`,
            `file://${page}`,
        ],
        { stdio: "ignore" },
    )
    rmSync(page, { force: true })
    console.log(`wrote ${svgPath} and ${pngPath} (${W}x${H})`)
} else {
    console.log(`wrote ${svgPath}`)
    console.log("Chrome was not found, so no PNG. Both platforms need a raster.")
}

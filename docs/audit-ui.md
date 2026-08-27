# UI audit: SEO and WCAG 2.2 AA

**Run 2026-08-27**, against `main`. Findings measured, not eyeballed: contrast
computed from the tokens in `globals.css`, metadata read out of every
`page.tsx`. Fix order is severity, then blast radius.

---

## SEO

### Blocking

| what | where |
|---|---|
| **The home page has no metadata at all** | `src/app/page.tsx` |
| No `sitemap.ts` | search engines crawl by luck |
| No `robots.ts` | same |
| Six routes emit nothing | see below |
| No canonical URLs | any route reachable two ways splits its own ranking |
| No JSON-LD | a piece is a `VisualArtwork` with a creator and an image, and nothing says so |

Six client components cannot export metadata, so they have none. Next needs a
`layout.tsx` beside each, or the page split into a server shell:

```
/manage            /manage/[address]      /mine
/minted/[c]/[id]   /studio/[draft]        /studio/new
```

`/minted` matters most of the six: it is the page a collector lands on after
paying, and the one they are most likely to share.

### Rich previews

Only `/piece/[c]/[id]` is complete today: openGraph, twitter card, and an image.
`/wallet/[address]` has openGraph and an image but no twitter card, so X renders
it as a small one.

Everything else has no image, which matters more here than on a normal site:
**every rendered piece already has a PNG pinned on IPFS.** A collection can use
its cover, a wallet its avatar, the feed its newest piece. Almost none of this
needs generating.

What does need generating is the fallback: a piece still rendering, a collection
with nothing minted, `/about`, `/collections`, `/market`. Next's `ImageResponse`
covers those, and Netlify runs it.

---

## WCAG 2.2 AA

### Contrast, computed from the tokens

| pair | light | dark | needs | what it affects |
|---|---|---|---|---|
| `--border` on `--background` | **1.00:1** | **1.19:1** | 3:1 (1.4.11) | every card, input, table and divider |
| `--destructive` on `--background` | **2.96:1** | **3.10:1** | 4.5:1 (1.4.3) | every error message |
| `--warning` on `--background` | **2.98:1** | 8.65:1 | 4.5:1 | the network badge, warnings |
| `--foreground` on `--background` | 13.96:1 | 17.00:1 | 4.5:1 | ok |
| `--muted-foreground` on `--background` | 5.45:1 | 5.91:1 | 4.5:1 | ok |
| `--muted-foreground` on `--muted` | 6.31:1 | 4.95:1 | 4.5:1 | ok |

The border one is the widest: at 1.00:1 in light mode the borders are
invisible, and they are the only thing separating most of the UI. Everything
that reads as a card, a field or a row depends on it.

### Level A gaps

- **2.4.1 Bypass Blocks.** No skip link. Every page starts with the same header
  and nav, and a keyboard or screen reader user walks all of it on every
  navigation.
- **2.4.7 / 1.4.11 Focus Visible.** Three files set `outline-none` and put
  nothing back: `ui/dropdown-menu.tsx`, `studio/Workspace.tsx`,
  `studio/ParamsPanel.tsx`. Focus is invisible there.
- **3.3.2 Labels.** Eight inputs have no programmatic label:
  `manage/[address]:314`, `PieceMarket:168`, `DeployForm` ×5, and one more.
- **2.3.3 / 2.2.2.** `pending-shimmer` animates forever and there is no
  `prefers-reduced-motion` rule anywhere in the stylesheet.

### WCAG 2.2 specifically

- **2.5.8 Target Size (Minimum), 24×24.** Not yet measured. The icon buttons in
  the header and the parameter controls are the likely failures.
- **2.4.11 Focus Not Obscured.** The header is `sticky top-0`; a focused element
  scrolled to the top edge can land under it.
- **3.3.7 Redundant Entry.** Publishing asks for values the studio already
  holds. Worth a pass, not obviously failing.

### Not found, which is good

Landmarks are present (`header`, `nav`, `main`, `footer`), `lang` is set, and
`aria-label` appears in seven files. `aria-current` is nowhere, so the nav does
not say which page you are on.

---

## Order

1. Contrast tokens. One file, fixes the widest failure, no structural risk.
2. Skip link, focus-visible, reduced motion, `aria-current`. Small and Level A.
3. Input labels.
4. `sitemap.ts`, `robots.ts`, canonicals, home page metadata.
5. Metadata for the six client routes, `/minted` first.
6. `ImageResponse` fallbacks and JSON-LD.
7. Target size and focus-obscured, measured in a browser rather than guessed.

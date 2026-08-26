# Isolate

Where generator code runs.

It executes and it never fetches. Whoever frames it already has the code and
hands it over:

```
parent  → isolate   { type: "alea:run", code, seed, params, deps }
isolate → parent    { type: "alea:hello" }        ready to receive
                    { type: "alea:ready", … }     the piece signalled
                    { type: "alea:violation", … } it reached for something
```

Fetching was the earlier shape and it contradicted this page's own
`connect-src 'none'`. Executing is the one job it is uniquely suited to,
because it is the one participant that must have no network at all. Every
caller already has its own way of getting the code:

| caller | where the code is |
|---|---|
| the studio | a draft in IndexedDB, never on chain |
| `/piece/*`, `/collection/*` | `art.code` in contract storage |
| the render worker | headless, no frame, its own chain reads |
| a third party | [ALEATORY-001](../docs/interface.md), however they like |

## Its own origin

Deployed as its own Netlify site from this directory, at
`isolate.aleatory.art`. Base directory `isolate`, publish directory `.`, no
build command.

Separate from the app because it runs code we did not write, in every
visitor's browser. A different origin is what keeps that code away from wallet
state and session storage.

The piece itself runs one level deeper, in a nested frame with
`sandbox="allow-scripts"` and no `allow-same-origin`, so it lands in an opaque
origin that cannot reach this one either. Its CSP travels inside that document
as a meta tag; a `srcdoc` child intersects its parent's policy, so it can only
ever be stricter.

## The harness

`$alea` is the entire surface a piece is given. Aliases for other platforms
are not part of this, and a generator written for one is not an Aleatory piece.

- `Math.random` replaced by a seeded stream, `xmur3` then `sfc32`. The seed is
  a base58 operation hash and is **never** parsed as hex: `parseInt` stops at
  the first character outside the radix, so hex parsing yields zero for every
  word and every piece draws the same picture.
- The clock is frozen, so a piece reading the date renders the same way in any
  year.
- Network access is blocked, and what the CSP already refused is reported so an
  artist is told why rather than watching a piece half-run.

`netlify/functions/lib/render.mts` carries the other implementation, the one
that produces the image published on chain. The two agree by conforming to
[ALEATORY-001](../docs/interface.md) §7, not by sharing a file. Change one,
change the other, in the same commit.

## Locally

```
npm run dev:isolate
```

Serves `index.html` on every path with the production CSP, on :4321. Point the
app at it with `NEXT_PUBLIC_ISOLATE_ORIGIN=http://localhost:4321`.

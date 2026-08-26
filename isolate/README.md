# Provider render host

Where a **minted** piece is rendered for a viewer.

This is part of the provider stack, alongside `worker/render.ts` (the headless
capture that produces the image published on chain) and
`netlify/functions/provider.mts` (the queue and the publish). It is the same
harness as the worker, serving live to a browser instead of capturing.

Deployed as its own Netlify site from this directory, at
`isolate.aleatory.art`. Base directory `provider`, publish directory `.`, no
build command.

Its own origin because it executes code published by someone else, and a
different origin is what keeps that code away from wallet state and session
storage.

It is **not** a sandbox. A sandbox is where an artist builds and iterates
before minting; this only ever runs a generator that is already on chain,
addressed by CID.

## The harness

`index.html` installs the same globals as `worker/render.ts`, and the two have
to match: a piece has to look the same here as it does in the image that ends
up on chain.

```
?code=ipfs://<cid>&seed=<operation hash>&params=<json>
```

- `Math.random` replaced by a seeded stream from the seed, via `xmur3` then
  `sfc32`. The seed is a base58 operation hash and is never parsed as hex.
- clock frozen, so a piece reading the date renders the same way in any year
- `$alea` and the `$fx` aliases

Change one of them and change the other in the same commit.

## Locally

```
npm run dev:isolate
```

Serves `index.html` on every path with the production CSP, on :4321. Point the
app at it with `NEXT_PUBLIC_ISOLATE_ORIGIN=http://localhost:4321`.

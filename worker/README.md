# Render worker

Takes a generator, a seed and parameters. Returns a PNG.

```
npm i
npx wrangler secret put RENDER_TOKEN
npx wrangler deploy
```

## What it holds

A shared secret, and nothing else. No chain access, no wallet key, no pinning
credentials, no database. Everything privileged sits in the Netlify function
that calls this, so a compromised worker costs render budget and leaks
nothing.

## Determinism

Two substitutions go in before the artist's first line runs:

- `Math.random` is replaced by a seeded stream derived from the operation
  hash, so every renderer produces the same sequence.
- The clock is frozen. A piece that branches on the date renders the same way
  in 2029 as it does today.

Network is blocked by request interception installed before navigation, so a
script tag or a fetch in the first bytes of the document cannot escape.

## Limits

A hard kill runs independently of the artist supplied capture timeout, since
a piece cannot be trusted to end on its own. Viewport is clamped.

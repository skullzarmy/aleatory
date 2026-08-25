# Sandbox

Where generator code runs.

Deployed as its own Netlify site from this directory, at
`sandbox.aleatory.art`. Base directory `sandbox`, publish directory `.`, no
build command.

Separate from the app because artist code is untrusted and runs in every
visitor's browser. A different origin is what keeps it away from wallet state
and session storage.

## The harness

`index.html` installs the same globals as `worker/render.ts`, and the two have
to match: a piece has to look the same here as it does in the image that ends
up on chain.

```
?code=<ipfs:// or https://>&seed=<operation hash>&params=<json>
```

- `Math.random` replaced by a seeded stream from the seed
- clock frozen, so a piece reading the date renders the same way in any year
- `$alea` and the `$fx` aliases

Change one of them and change the other in the same commit.

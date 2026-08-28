# The website

Next.js App Router. Everything here reads public chain state, so every page it
builds could be built by somebody else from the same sources.

This is the replaceable part. The contracts and
[ALEATORY-001](../docs/interface.md) are the platform; this is one front end
for it, and the project is designed so that losing it costs the artwork
nothing.

## Layout

| | |
|---|---|
| `app/` | Routes. Server components read the chain; client components sign. |
| `components/` | UI, grouped by what it is for: `feed/`, `piece/`, `studio/`, `account/`, `layout/`. |
| `lib/` | Everything that is not React. Chain reads, operation building, metadata, identity. |
| `context/` | Wallet connection, and nothing else. |
| `utils/` | Small shared helpers. |

## What lives in `lib/`

The parts worth knowing before changing anything:

| | |
|---|---|
| `config.ts` | Network, contract addresses, brand. One place, read everywhere. |
| `ops.ts` | Every operation the site can send. Encoded by field name via Taquito, never by position, because SmartPy orders record fields alphabetically. |
| `runtimes.ts` | Runtime kinds and the library catalogue, with each library's npm coordinates and hash. |
| `libraries.ts` | Reading and writing a generator's `alea:library` declarations. |
| `identity.ts` | Address to name, avatar and profile. Tezos Domains, then hack.tez, then objkt. One cached call. |
| `metadata.ts` | Building the TZIP-21 document a provider publishes. |
| `blocklist.ts` | What this site declines to show. The only curation, and deliberately one readable file. |

## Rendering a piece

Artwork never runs in this origin. It runs in [`isolate/`](../isolate/), a
separate origin whose CSP forbids the network entirely, so a piece cannot call
home, cannot load a tracker, and cannot see a wallet. That restriction is
enforced by the browser rather than by our care.

## The studio

Drafts live in the browser's IndexedDB, per device, never uploaded. A generator
is a single self-contained HTML file, and the studio's job is to make one, price
it against the chain, and hand it to the deploy form.

Libraries a generator declares are fetched through `app/api/dep`, which goes to
npm's mirrors server-side and verifies the hash before answering, so the page's
`connect-src` stays `'self'` and no visitor's IP reaches a CDN.

## Tests

```
npm test
```

Runs the metadata golden tests, the studio and template checks, the hook-order
scan, the dependency proxy, ALEATORY-001 conformance across every harness, the
brand contrast ratios, and the documentation link and reference checks.

## Further

- [libraries.md](../docs/libraries.md), how a generator declares what it needs
- [params.md](../docs/params.md), mint-time parameters
- [identity.md](../docs/identity.md), how an address becomes a name

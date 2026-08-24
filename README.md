# Aleatory

Fully on-chain generative art on Tezos. A generator is code, published once and immutable; a piece is that code plus a seed bound to the operation that bought it. The token is not a picture — it is a pointer into a possibility space, and the possibility space is on chain.

**Status: pre-alpha.** Nothing is deployed. The contracts compile and pass their tests; the front end is lifted out of a hack.tez lab and does not yet build standalone. See [docs/decisions.md](docs/decisions.md) for the settled model and [docs/roadmap.md](docs/roadmap.md) for where this is going.

## Start here

| | |
|---|---|
| [docs/decisions.md](docs/decisions.md) | The settled model, end to end. Read this first — where it disagrees with the older documents, it wins. |
| [docs/architecture.md](docs/architecture.md) | Contracts, the generator record, seeds, storage classes, the renderer standard. Being brought in line with the decision record. |
| [docs/params.md](docs/params.md) | Mint-time parameters. A spec: another platform can build a mint UI from it alone. |
| [docs/pipeline.md](docs/pipeline.md) | What the artist actually touches — template, sandbox, publish, market. |
| [docs/open-questions.md](docs/open-questions.md) | Decisions not yet made, with a recommendation where there is one. |

## The shape

Five contracts. The split between them is the design.

- **Factory** — deploys collections. Holds no tokens, which is what makes its `admin_lambda` escape hatch safe.
- **Collection** — one generator, one edition, owned by the artist from origination. No lambda, no upgrade path, no authority retained by anyone else. A bug in it is permanent; that is the price of the guarantee.
- **Resolver** — backend minting keys, rotatable in one place.
- **Provider** — a renderer's price and endpoint. Any contract exposing `get_render_gas` is a provider. That view is the entire membership test.
- **Registry** — the list of providers. Permissionless, no fee.

## How a piece happens

1. The artist deploys a collection. One signature. They own the contract; nothing passes through anyone else's hands.
2. A collector sets parameters and signs once. **The token is minted in that operation** — code, params, royalties, owner, name — showing a placeholder image. The operation's hash is the seed.
3. A render provider produces the image, pins it, and writes the two image URIs. Once, and never again.

An unrevealed piece is a complete artwork with a pending thumbnail, not a promise of a future token.

## What this is not

It is not a marketplace and takes nothing on sales or secondary. Pieces are standard FA2 + TZIP-21, so they trade on objkt and Teia from day one.

The contract template is a reference implementation, not a requirement — the standard is a pair of events and a view. Anyone can run a provider, a front end, or their own factory without permission, and owes nothing for it.

## Contracts

```
SMARTPY_OUTPUT_DIR=contract/output python3 contract/aleatory.py
```

Exit 0 means the test scenarios passed; the suite runs inline, no CLI needed. Always set `SMARTPY_OUTPUT_DIR` or SmartPy writes a folder per scenario into the repo root.

## Provenance

Started as a lab inside [hack.tez](https://hack.tez) and moved here before anything was deployed. The lab entry that remains there is a pointer.

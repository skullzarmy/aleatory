# Aleatory

Fully on-chain generative art on Tezos.

A generator is code, published once and immutable. A piece is that code plus a seed bound to the operation that bought it. The token points into a possibility space, and the possibility space is on chain.

**Status: pre-alpha.** Nothing is deployed. The contracts compile and pass 40 test scenarios; the front end is being built.

## Start here

| | |
|---|---|
| [docs/decisions.md](docs/decisions.md) | The settled model, end to end. Read this first. Where it disagrees with the older documents, it wins. |
| [docs/architecture.md](docs/architecture.md) | Contracts, the generator record, seeds, storage classes, the renderer standard. Being brought in line with the decision record. |
| [docs/params.md](docs/params.md) | Mint-time parameters. A spec: another platform can build a mint UI from it alone. |
| [docs/pipeline.md](docs/pipeline.md) | What the artist actually touches: template, sandbox, publish, market. |
| [docs/open-questions.md](docs/open-questions.md) | Decisions not yet made, with a recommendation where there is one. |

## The shape

Five contracts. The split between them is the design.

- **Factory.** Deploys collections. Holds no tokens, which is what makes its `admin_lambda` escape hatch safe.
- **Marketplace.** Secondary listings and offers, both escrowed. Deliberately has *no* escape hatch, because it holds other people's property.
- **Collection.** One generator, one edition, owned by the artist from origination. No lambda, no upgrade path, no authority retained by anyone else. A bug in it is permanent, which is the price of the guarantee.
- **Resolver.** Our own render-provider keys, rotatable in one place. Any artist can sever it.
- **Provider.** A renderer's price, working key and endpoint. Any contract exposing `get_render_gas` and `get_agent` is a provider. Those views are the entire membership test.
- **Registry.** The list of providers. Permissionless, no fee.

## How a piece happens

1. The artist deploys a collection. One signature. They own the contract; nothing passes through anyone else's hands.
2. A collector sets parameters and signs once. **The token is minted in that operation**, owned and tradeable immediately, carrying the collection's "not revealed yet" metadata. The operation's hash is the seed.
3. A render provider renders the piece, pins it, and publishes that token's metadata document. Once, and never again.

An unrevealed piece is a real token. What it *is* comes from chain state: immutable code, the seed from the buy operation, and the parameters in that same operation. The metadata describes it.

## The secondary market

Pieces are standard FA2, so they trade on objkt and Teia from day one. Aleatory runs its own market for them as well: listings and offers, 2.5% deducted from the sale, copying what objkt and Teia already do.

Royalties come from the collection's own storage, so a seller cannot cheat an artist out of their share.

## Where the money goes

Primary sales take nothing: the mint price goes to the artist, the render gas to the provider. Income is the render service and the 2.5% secondary fee.

The contract template is a reference implementation. The standard itself is a pair of events and a view, so anyone can run a provider, a front end, or their own factory without permission, and owes nothing for it.

## Contracts

```
SMARTPY_OUTPUT_DIR=contract/output     python3 contract/aleatory.py
SMARTPY_OUTPUT_DIR=contract/output-mkt python3 contract/marketplace.py
```

Exit 0 means the test scenarios passed; the suite runs inline, no CLI needed. Always set `SMARTPY_OUTPUT_DIR` or SmartPy writes a folder per scenario into the repo root.

## Provenance

Started as a lab inside [hack.tez](https://hack.tez) and moved here before anything was deployed. The lab entry that remains there points here.

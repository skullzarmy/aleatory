# Working in this repository

Aleatory is fully on-chain generative art on Tezos. A generator is one HTML
file stored on chain; a piece is that file plus a seed fixed at mint. The
contracts and [ALEATORY-001](docs/interface.md) are the platform, and a piece
resolves from chain state, so the code here is one implementation of a spec
anyone can implement.

Writing a generator is a different job with a different document:
[public/llms.txt](public/llms.txt), served at
<https://aleatory.art/llms.txt>. It carries the harness, the three rules, the
two declarations and a worked file.

---

## First time here

```
npm ci
npm test                       no network needed beyond npm
```

SmartPy work also needs Python 3 with `smartpy` installed, which
`npm run build:contracts` and `npm run test:contracts` call.

---

## What is here

Five things ship from one checkout.

| | | |
|---|---|---|
| the site | `src/` | Next 15, App Router. Reads public chain state. |
| the isolate | `isolate/` | A separate origin where artwork runs. |
| the admin console | `admin/` | Its own Next app and its own Netlify site. |
| the render provider | `provider/provider.mts` | Renders pieces, pins them, publishes. Run as a process by `provider/daemon.mts`. |
| the stats bot | `bot/` | Reads the chain, writes figures into Discord channel names. |

The provider and the bot run on a machine the operator keeps. Everything in
`bot/` imports from `bot/`, so the directory is the whole program.

```
contract/     SmartPy sources, tests, build and deploy
docs/         the public documentation, including ALEATORY-001
public/       templates, and llms.txt
scripts/      build steps, the provider runner, one-off tooling
```

---

## Rendering

Artwork runs in `isolate/`, on its own origin, under a CSP that blocks the
network. That CSP is what makes "a piece cannot phone home" a property of the
browser, so a piece draws from the bytes it carries and the seed it is given.

The harness has two implementations: the isolate, and
`provider/render.mts`. Each conforms to ALEATORY-001 §7 and
`src/lib/conformance.test.ts` holds them to it. When they disagree, the spec
decides.

---

## The contracts

Seven, in `contract/aleatory.py` and `contract/marketplace.py`.

| | |
|---|---|
| **Router** | Names the current factory, marketplace, registry and resolver. One address in the environment, the rest read from it. |
| **Factory** | Originates collections, and records what it deployed. |
| **Collection** | One generator, one edition, its tokens. |
| **Marketplace** | Listings, offers, fees. |
| **Provider** | One renderer's price and working key. |
| **Registry** | The list of providers. Permissionless. |
| **Resolver** | Which keys may write resolution entries. |

**The artist holds every authority a collection has**: pause the sale, reprice
the unsold remainder, reduce or close the edition, switch render provider, and
hand the contract on in two steps. `code`, `code_uri`, `code_hash` and
`royalties` are written at origination and stand for the life of the contract.
A bug in the collection template is therefore frozen into every collection made
from it, which is why the template is small and is audited before it ships.

### Things that have cost real time

- **SmartPy lays out record fields alphabetically.** Encode operation
  parameters by field name through Taquito.
- **`sp.cons` prepends**, so `router.factories` runs newest first and
  `factories[0]` is where a deploy goes.
- **The marketplace lineage lives in the router's storage history.** The first
  marketplace is written at origination and emits no event, so an event scan
  finds every marketplace except that one, and loses the listings and escrowed
  offers still held there.
- **The router can name one factory twice.** `add_factory` conses on, so
  re-pointing at an earlier one adds a second entry. Dedupe before querying.
- **Taquito encodes an origination from the contract's own storage schema**,
  taking the keys it finds there. A field left in `deploy.ts` after a rename is
  dropped in silence and the deploy succeeds. `scripts/check-contracts.mjs`
  compares the two.
- **An implicit account always accepts tez; a `KT1` accepts it through a
  `default` entrypoint of type unit.** The marketplace asks
  `sp.contract(sp.unit, recipient)` before paying a royalty and pays the seller
  when the answer is None, because `royalties` is immutable and one bad address
  would otherwise revert every sale of that collection forever.
- **32,768 bytes** is the operation ceiling, code included. The factory embeds
  the collection template, which makes it the largest contract here.
- **On shadownet the per-operation gas cap equals the per-block cap**, so an
  operation at the per-operation maximum consumes the whole block budget and is
  rejected. `contract/deploy.ts` reads both and stays under.

---

## Running things

```
npm test                  the JS suite
npm run test:contracts    SmartPy scenarios
npm run build:contracts   compile to contract/build
npm run deploy            originate. --dry-run prices it first
```

```
npm run dev:all           the isolate and the site together
npm run provider:check    a provider pass that reads only
npm run bot:check         read the chain, print the channel names
```

Reach for a `:check` first. A provider run spends render budget, pinning quota
and gas, and writes a token's metadata permanently: `set_token_metadata`
accepts one write per token and refuses the second.

**The operator runs their own dev server.** Leave the ports alone.

### On tests

Tests here run the code they are about: a template is parsed, a zip is
packaged, a schema is resolved, an API route is called.

Three source scans survive, and each earns it. `hooks.test.ts` is a lint rule
for React hook order. `check-contracts.mjs` counts contracts and compares
`deploy.ts` storage against what each contract declares.
`conformance.test.ts` checks the harness implementations agree. Each caught a
bug that had shipped.

---

## Conventions

**`.gitignore` allow-lists the top level.** A new directory becomes visible to
git when `!/name/` is added, which makes adding one a deliberate act.

**Some docs are private and gitignored**: the audit and its response, the
roadmap, the decision log, open questions, the sitemap, the pipeline notes.
They are working notes. Keep them out of git and out of anything public.

**Prose, in docs, comments, commit messages and replies.** Say what a thing is
and stop. Describe the model as it stands now. Use commas, colons and
parentheses. American spelling. Four habits to keep out: em dashes, "not an X,
a Y" constructions, accounts of decisions since replaced, and justification by
contrast ("rather than", "instead of").

**Git:** work on `main` and `git push origin main`. Pushing one branch onto a
differently named one (`git push origin work:main`) updates the ref and leaves
Netlify without a build.

**`.env` holds secret keys** and is gitignored. Key material stays out of the
repository.

---

## Further

- [docs/architecture.md](docs/architecture.md), the whole model
- [docs/interface.md](docs/interface.md), ALEATORY-001
- [docs/deploying.md](docs/deploying.md), standing up a network and the
  provider
- [docs/provider.md](docs/provider.md), running a render provider
- [bot/README.md](bot/README.md), the stats bot
- [admin/README.md](admin/README.md), the operator console

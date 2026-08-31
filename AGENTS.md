# Working in this repository

Aleatory is fully on-chain generative art on Tezos. A generator is one HTML
file stored on chain; a piece is that file plus a seed fixed at mint. The
contracts and [ALEATORY-001](docs/interface.md) are the platform, and the
artwork resolves from chain state alone, so anyone can rebuild everything else
here from the spec.

**Helping somebody write a generator?** Use
[public/llms.txt](public/llms.txt), served at
<https://aleatory.art/llms.txt>. It is the artist's brief: the harness, the
three rules, library and parameter declarations, and a worked file. This file
is for working on the platform itself.

---

## What is here

Five things ship, from one checkout.

| | | |
|---|---|---|
| the site | `src/` | Next 15, App Router. Reads public chain state. |
| the isolate | `isolate/` | A separate origin where artwork runs. |
| the admin console | `admin/` | Operator console, its own Next app and Netlify site. |
| the render provider | `scripts/provider-daemon.mts` | A process. Renders pieces, pins them, publishes. |
| the stats bot | `bot/` | A process. Writes chain figures into Discord channel names. |

The last two run on a machine the operator keeps. `bot/` stands alone, so it
keeps working from a checkout with the site deleted.

```
contract/     SmartPy sources, tests, build and deploy
docs/         the public documentation, including ALEATORY-001
public/       templates, and llms.txt
scripts/      build steps, the provider, one-off tooling
```

---

## Rendering, and why the isolate exists

Artwork runs in `isolate/`, on its own origin, under a CSP that blocks the
network. A piece draws from the bytes it carries and the seed it is given. The
browser enforces that.

Two implementations of the harness exist, the isolate and
`netlify/functions/lib/render.mts`. They agree by each conforming to
ALEATORY-001 §7, and `src/lib/conformance.test.ts` holds them to it. Treat the
spec as the source of truth when they differ.

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
`royalties` are written once at origination and stand for the life of the
contract. That immutability is what lets an artist be told the work is theirs,
and it is why the template stays boring and is audited before it ships.

### Things that have cost real time

- **SmartPy lays out record fields alphabetically.** Encode operation
  parameters by field name through Taquito.
- **`sp.cons` prepends**, so `router.factories` runs newest first and
  `factories[0]` is where a deploy goes.
- **The marketplace lineage comes from storage history.** The first
  marketplace is written at origination and emits no event, so storage history
  is the only record that carries it, along with every listing and escrowed
  offer on it.
- **The router can name one factory twice.** `add_factory` conses on, so
  re-pointing at an earlier one adds a second entry. Dedupe before querying.
- **Taquito encodes an origination from the contract's own storage schema**,
  taking the keys it finds there. A field left in `deploy.ts` after a rename is
  dropped in silence and the deploy succeeds. `scripts/check-contracts.mjs`
  compares the two.
- **An implicit account always accepts tez; a `KT1` accepts it through a
  `default` entrypoint of type unit.** The marketplace asks
  `sp.contract(sp.unit, recipient)` before paying a royalty and pays the
  seller when the answer is None, because `royalties` is immutable and one bad
  address would otherwise revert every sale of that collection forever.
- **32,768 bytes** is the operation ceiling, code included. The factory embeds
  the collection template, so it is the largest thing here.
- **On shadownet the per-operation gas cap equals the per-block cap**, so an
  operation at the per-operation maximum consumes the whole block budget and is
  rejected. `contract/deploy.ts` reads both and stays under.

---

## Running things

```
npm test                  the whole JS suite
npm run test:contracts    SmartPy scenarios
npm run build:contracts   compile to contract/build
npm run deploy            originate, --dry-run to price it first
```

```
npm run dev:all           the isolate and the site together
npm run provider:check    a provider pass that reads only
npm run bot:check         read the chain, print the channel names
```

Every daemon has a `:check` that reads only. Use it first. A provider run
spends render budget, pinning quota and gas, and writes a token's metadata
permanently: `set_token_metadata` accepts one write per token and refuses the
second.

**The operator runs their own dev server.** Leave the ports alone.

### On tests

Tests here run the code they are about: a template is parsed, a zip is
packaged, a schema is resolved, an API route is called.

Three scans exist, and each is honest about being one. `hooks.test.ts` is a
lint rule for React hook order. `check-contracts.mjs` counts contracts and
compares `deploy.ts` storage against what each contract declares.
`conformance.test.ts` checks the harness implementations agree. Each caught a
bug that had shipped.

---

## Conventions

**`.gitignore` allow-lists the top level.** A new directory becomes visible to
git when `!/name/` is added. A directory that appeared on its own is litter and
stays invisible.

**Some docs are private and gitignored**: the audit and its response, the
roadmap, the decision log, open questions, the sitemap, the pipeline notes.
They are working notes. Keep them out of git and out of anything public.

**Prose, in docs, comments, commit messages and replies.** Say what a thing is
and stop. Describe the model as it stands now. Use commas, colons and
parentheses. American spelling. Four habits to keep out: em dashes, "not an X,
a Y" constructions, accounts of decisions since replaced, and justification by
contrast ("rather than", "instead of").

**Git:** push straight to `main`. Branch names stay plain, and a push names the
same branch on both sides, which is what triggers a Netlify build.

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

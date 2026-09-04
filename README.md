# Aleatory

Fully on-chain generative art on Tezos.

A generator is code, published once and never changed. A piece is that code
plus a seed, and the seed comes from the operation that minted it. Nobody picks
it: not the artist, not us. The token points into a possibility space, and the
possibility space is on chain.

**Running on shadownet** at [shadownet.aleatory.art](https://shadownet.aleatory.art).
Contracts deployed, collections made, pieces minted and rendered, marketplace
taking listings and offers. Not on mainnet yet.

Every contract it runs on, current and retired, is listed at `/contracts` on
whichever host is serving it, read from the router in your own browser and
linked to a block explorer.

---

## What this is for

Generative art on Tezos grew up around fxhash, and most of what an artist
expects from a platform still comes from there.

EditArt showed it can be done properly. The platform is gone and the pieces
still render, because the artwork was put on the chain instead of on a server.
Nothing was lost when the site stopped.

HEN showed the other half. The contracts were unowned and the data was
addressable, so when the front end went the community built another one, and
that rebuild became Teia.

Between them: **the work can outlive the platform, and the front end can be
replaced by whoever cares enough to write one.** This is built so both stay
true of everything made here, and so that what is left behind is something
anyone can pick up and carry on with.

Everything below is what it costs to mean that.

## What that means in practice

**The artwork is on the chain, not behind us.** A generator's code lives in
contract storage. A piece is that code and a seed. No server of ours is between
a collector and what they own, and if this site disappears the pieces still
render.

**Nothing here needs our permission.** Anyone can publish a collection, run a
[render provider](docs/provider.md), trade, or run the whole system themselves.
A collection belongs to its artist from origination and we cannot touch it.

**We are never the authority.** A generator declares the libraries it needs by
npm coordinates and a hash, so any mirror will do and none is trusted. The
registry that lists providers is a type check, not an endorsement. We host
copies for speed and never as the thing being believed.

**What we control is this website.** It shows everything by default, and the
short list of what it hides is one file in the open:
[`src/lib/blocklist.ts`](src/lib/blocklist.ts). Hiding something removes it
from our interface and from nowhere else.

**Anyone can rebuild it.** [ALEATORY-001](docs/interface.md) is the interface a
conforming collection implements. Build against it and every piece made here
renders on your site, with no cooperation from us.

---

## The repository

Each directory has its own README explaining what it holds and why.

| | |
|---|---|
| [`contract/`](contract/) | The Tezos contracts. Factory, collection, marketplace, provider, registry, resolver. |
| [`src/`](src/) | The website: browsing, the studio, minting, the market. |
| [`isolate/`](isolate/) | The sandboxed origin a piece runs in, and nothing else. |
| [`provider/`](provider/) | The render provider: the daemon that draws pieces and publishes their metadata. |
| [`bot/`](bot/) | The stats bot: reads the chain, writes the figures into Discord channel names. |
| [`admin/`](admin/) | The operator console. A separate site, separately deployed. |
| [`scripts/`](scripts/) | Deploying contracts, and the build steps. |
| [`public/templates/`](public/templates/) | The starting points an artist downloads. |
| [`public/skill/`](public/skill/SKILL.md) | The same guidance packaged for agents, one skill per job. |
| [`docs/`](docs/) | Specifications and guides, indexed by who they are for. |

## Where to go next

| You are | Start at |
|---|---|
| Making a generator | [Starter kits](public/templates/), then [libraries.md](docs/libraries.md) |
| Building a front end for these tokens | [ALEATORY-001](docs/interface.md) |
| Running a render provider | [provider.md](docs/provider.md) |
| Understanding how it fits together | [architecture.md](docs/architecture.md) |
| Deploying your own instance | [deploying.md](docs/deploying.md) |

## Working on it

```
npm ci
cp .env.example .env
npm run dev:all
npm test
```

`dev:all` runs the isolate beside the site, which anything that frames a
generator needs. [CONTRIBUTING.md](CONTRIBUTING.md) covers the rest: the
contracts, the admin console, what CI checks, and how to send a change.

Released into the public domain under [the Unlicense](LICENSE). Copy it, change
it, sell it, compete with us. No attribution, no permission, no warranty.

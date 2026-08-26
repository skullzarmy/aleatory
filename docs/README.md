# Aleatory

**2026-08-26.**

A community-run home for generative art on Tezos, art that emerges from **code and seeded randomness**, not from an image model. Built in the HEN/Teia tradition: open, permissionless, honest about its costs, and engineered so that it cannot die with any one company or any one person.

It began in the hack.tez labs and now lives in its own repository.

---

## Why

fxhash's center of gravity moved to Ethereum and Base. EditArt went dark after the death of its creator. Bootloader is good work owned by an exchange. Three different structural failure modes, acquisition drift, single point of failure, corporate dependency, and no indie, community-run option left standing.

HEN proved the alternative: when the contracts are unowned and the data is addressable, the community can rebuild the front end and keep going. That rebuild became Teia. **This project treats that not as a happy accident but as a design requirement.**

---

## The documents

Read in this order.

| Doc | What's in it |
|---|---|
| **[architecture.md](architecture.md)** | The protocol. Contracts, the versioned + typed generator record, seed policies, storage classes, the renderer standard, rescue, indexing. |
| **[pipeline.md](pipeline.md)** | The artist's path: template → sandbox → mint pipeline → market. What an artist actually touches. |
| **[interface.md](interface.md)** | ALEATORY-001, the interface a conforming collection implements. |
| **[params.md](params.md)** | Declared mint-time parameters, as a spec: the declaration format, the exact resolution rule, where it all sits on chain, and how another platform builds a mint UI for our generators without our source. |
| **[roadmap.md](roadmap.md)** | v0 lab (no infra, ships now), v1 protocol (leaves home), v2 Tezos X and the multi-runtime bet. |
| **[identity.md](identity.md)** | How an address becomes a name, a face and a profile, and why we are never the authority behind any of it. |
| **[sitemap.md](sitemap.md)** | Every page, what it is for, and what is left. |
| **[provider.md](provider.md)** | Running a render provider: the two keys, the queue, retries, determinism. |
| **[deploying.md](deploying.md)** | Putting it up: the isolate, the site, and keeping the daemon running on Linux, macOS, Windows and Docker. |
| **[decisions.md](decisions.md)** | The record of what was chosen and what was rejected. |
| **[audit-response.md](audit-response.md)** | What was fixed, what was not, and why. |
| **[open-questions.md](open-questions.md)** | What's undecided, what needs fact-checking before publication, and the naming criteria. Read this before quoting anything publicly. |

---

## The short version

- **Generative means rules + a seed**, deterministic forever. A piece must be reproducible, self-contained, and seed-bound. That rule is archival first, and it happens to exclude AI image generation on technical grounds, without anyone having to police an artist's process.
- **The front end is disposable; the protocol is the platform.** If the site vanishes tonight, every piece still renders and a stranger can rebuild the rest from public artifacts.
- **No admin key over anyone's art.** Contracts can pause new mints and nothing else. Published work is untouchable, including by us.
- **On-chain by default, labeled when not.** Fully on-chain or IPFS, disclosed on every piece. A generator may also declare a standard library rather than carrying it, recorded with npm coordinates and a hash so any renderer can fetch it from anywhere and prove it is the right bytes. We host none of it and are the authority for none of it.
- **No lock-in.** Standard FA2 + TZIP-21, so pieces trade on objkt and Teia from day one without an integration.
- **Nothing stranded.** Import paths and an archival mirror for work marooned by platforms that left.
- **No VC.** Small fees, public treasury, public accounting.
- **Bus factor is a bug.** Multisig keys, a resurrection kit, and a quarterly drill where someone who didn't build it rebuilds it from scratch.

---

## Status

**Running on shadownet.** Deploy, mint, render and publish work end to end: a
collection goes up through the factory, a mint fixes the seed, the provider
daemon draws the piece and writes its metadata, and the gallery rebuilds
everything from chain state. Mainnet is not deployed. See
[roadmap.md](roadmap.md) for what is and is not done, and
[audit-response.md](audit-response.md) for what has to happen first.

The docs came first on purpose: they are what makes this buildable by someone other than the person who wrote it, which is the whole point of the project.

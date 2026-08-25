# Aleatory

**Draft docs, 2026-08-02.**

A community-run home for generative art on Tezos, art that emerges from **code and seeded randomness**, not from an image model. Built in the HEN/Teia tradition: open, permissionless, honest about its costs, and engineered so that it cannot die with any one company or any one person.

It is born and pupates in the [hack.tez labs](../../src/labs/), and leaves home at v1.

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
| **[params.md](params.md)** | Declared mint-time parameters, as a spec: the declaration format, the exact resolution rule, where it all sits on chain, and how another platform builds a mint UI for our generators without our source. |
| **[roadmap.md](roadmap.md)** | v0 lab (no infra, ships now), v1 protocol (leaves home), v2 Tezos X and the multi-runtime bet. |
| **[open-questions.md](open-questions.md)** | What's undecided, what needs fact-checking before publication, and the naming criteria. Read this before quoting anything publicly. |

---

## The short version

- **Generative means rules + a seed**, deterministic forever. A piece must be reproducible, self-contained, and seed-bound. That rule is archival first, and it happens to exclude AI image generation on technical grounds, without anyone having to police an artist's process.
- **The front end is disposable; the protocol is the platform.** If the site vanishes tonight, every piece still renders and a stranger can rebuild the rest from public artifacts.
- **No admin key over anyone's art.** Contracts can pause new mints and nothing else. Published work is untouchable, including by us.
- **On-chain by default, labeled when not.** Fully on-chain, on-chain-plus-shared-library, or IPFS, disclosed on every piece. Shared libraries paid for once, then free forever.
- **No lock-in.** Standard FA2 + TZIP-21, so pieces trade on objkt and Teia from day one without an integration.
- **Nothing stranded.** Import paths and an archival mirror for work marooned by platforms that left.
- **No VC.** Small fees, public treasury, public accounting.
- **Bus factor is a bug.** Multisig keys, a resurrection kit, and a quarterly drill where someone who didn't build it rebuilds it from scratch.

---

## Status

**v0 runs** at [`/labs/aleatory`](../../src/pages/labs/Aleatory.tsx): studio, declared mint-time parameters, seed grid, the mechanical check gate, the live cost estimate, testnet publish + mint, and a gallery that rebuilds pieces from chain state alone. Testnets only. The publish and mint paths still need a funded testnet wallet to be exercised end to end, and the rescue mirror is not built. See [roadmap.md](roadmap.md) §1 for exactly what is and isn't done.

The docs came first on purpose: they are what makes this buildable by someone other than the person who wrote it, which is the whole point of the project.

This directory is self-contained and moves to the new repo unchanged when the project leaves the labs.

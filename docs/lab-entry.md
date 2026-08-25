---
title: Aleatory
slug: aleatory
status: alpha
version: 0.1.0
kind: tool
icon: dices
interactive: true
summary: Seeded generative art on Tezos. Write a system, test it across seeds, see what it costs on chain, publish it to a testnet.
updated: 2026-08-02
---

An indie, community-run home for generative art on Tezos, pupating here in the labs before it leaves for its own platform. The full ethos, protocol and roadmap live in [`docs/aleatory/`](https://github.com/joe-p-webmaster/hack.tez/tree/main/docs/aleatory).

**Generative here means rules plus a seed, not an image model.** A piece is valid when it is deterministic (same seed, same output, forever), self-contained (no network at render time), and seed-bound (all randomness from the token's seed). That rule is archival first, and it happens to exclude AI image generation on technical grounds, so nobody has to police anyone's process.

v0 puts every stage of the pipeline in one place:

- **studio**, four runtime kinds (Canvas 2D, SVG, p5, custom). Load a template, or drop the .html / .zip you already have. Existing fxhash-era code runs unmodified: `fxrand`, `fxpreview` and `$fx` are aliased onto the harness.
- **params**, declare up to five inputs a collector tunes at mint. You name them and set the range; the declaration is published with the generator and readable from contract storage on its own, so a mint page anywhere can build the controls without our front end. Always optional, most pieces are the seed alone.
- **grid**, sixteen seeds at once, because the real question is what the space looks like, not whether one output is good. Params are held fixed there; the grid varies the seed and nothing else.
- **checks**, the same mechanical gate the mint pipeline runs. Two runs of one seed compared byte for byte, network access blocked and reported, `Math.random` caught, capture point verified. No reviewer, no queue.
- **cost**, byte count priced against protocol constants read live from the chain, per storage class. Shared libraries are referenced by hash, never bundled: paid for once by whoever needs them first, then free for every project after.
- **publish**, originate a generator on Shadownet or Tezos X previewnet with the code and the versioned record **in contract storage**. Mint pieces one batched operation at a time; that operation's hash is the seed source, so nobody, including us, knows the seed before it lands.
- **gallery**, point it at any generator contract and it rebuilds every piece from chain state alone: code out of storage, seed derived from each mint's operation hash. No indexer of ours, no server, no saved images.

Testnets only. Mainnet contracts are v1, and most of what they store can never be changed.

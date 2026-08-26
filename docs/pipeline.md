# The artist pipeline, Aleatory

**Status:** draft, 2026-08-01.

The architecture says what's on chain. This is the part the artist actually touches: template → local work → sandbox → mint pipeline → market.

The reference model is the fxhash flow, because it worked and thousands of artists already have it in muscle memory: start from a template like [`tallzy/fxhash-p5-template`](https://github.com/tallzy/fxhash-p5-template), work locally, zip the folder, test it in the sandbox, then run it through a mint pipeline that validates the code, captures previews, provisions the contract, and hands off to the indexer so the work shows up on the market side.

**We keep that flow almost exactly.** Familiarity is the feature. What changes is what happens at the end of it: the code goes on chain instead of into a company's storage bucket, and every stage is reproducible by someone who isn't us.

---

## 1. The whole thing at a glance

```
  TEMPLATE          LOCAL              SANDBOX            MINT PIPELINE           MARKET
 ┌────────┐      ┌────────┐        ┌────────────┐       ┌──────────────┐      ┌──────────┐
 │ p5 /   │ ───▶ │ artist │  ───▶  │ run N      │ ───▶  │ checks       │ ───▶ │ objkt    │
 │ svg /  │      │ writes │  zip   │ seeds      │       │ capture      │      │ teia     │
 │ vanilla│      │ system │        │ determinism│       │ provision    │      │ our site │
 │ three  │      │        │        │ cost est.  │       │ index        │      │ mirrors  │
 └────────┘      └────────┘        └────────────┘       └──────────────┘      └──────────┘
                                    all client-side       one chain op set      free, via FA2
```

No stage is a gate staffed by a human. The checks are mechanical, the outcomes are the same for everyone, and there is no queue to be at the front of.

---

## 2. Template / SDK

A small family of starters, p5, plain canvas, SVG, three.js, WASM later, each one a folder with `index.html` at the root that runs by opening it.

**A template is a starting point and nothing more.** It picks a starting document and a starting parameter schema, and after that the file is the artist's. Nothing about the template is recorded on chain, because nothing needs to be: the generator declares its own libraries, so a renderer reads the piece rather than looking anything up about us.

A piece minted against p5 1.5.0 keeps booting into p5 1.5.0 in ten years, because the version and its hash are in the record. Versions are added, never updated: pinning one forever is the correct behaviour for an artwork, not a maintenance problem.

Adding a template later, a new engine, a new dialect, is an append to the catalogue, not a contract migration. And an artist whose toolchain nobody has heard of uses the `custom` kind: implement the five lifecycle entry points, bundle or reference a harness, and everything downstream (checks, capture, provisioning, indexing, market) works identically. Custom is a supported path, not an escape hatch.

What the template gives the artist:

- A **seeded PRNG** wired in before their code runs, with `random()` and `noise()` already seeded from it so nothing accidentally reaches for `Math.random()`.
- A **dev harness**: reload gives a new seed, a key press pins one, and a URL parameter reproduces any seed exactly. This is the loop artists live in.
- **Canvas sizing / pixel ratio / mobile** handled, because every template in this medium's history has had to solve it and nobody should solve it again.
- A **features** hook to declare traits derived from the seed.
- A **capture signal** to say "the piece is ready to be photographed."
- The **determinism check runnable locally**, so the artist never learns about a violation from a failed mint.

### Compatibility is deliberate

The runtime is a **superset of the conventions artists' existing code already uses**. A compatibility shim maps the older global names (the `fxrand`/`fxpreview`/features trio and the hash URL parameter) onto ours, so a project written for a departed platform runs here unmodified in most cases, and the SDK's own names are just clearer aliases.

Nothing stranded, expressed as an afternoon of shim code. An artist should be able to try this with a system they already finished, not with a rewrite they have to justify.

### Dependencies: declare, don't bundle

The one real divergence from the old flow. In the fxhash model you zip `p5.min.js` into every project. Here a generator declares what it needs and a renderer supplies it:

```html
<meta name="alea:library" content="p5@1.5.0">
```

Consequence: p5 costs an artist none of their generator's size, so a p5 piece is a few KB and goes on chain like any other. Bundled instead, it would be 215 KB gzipped and about 54 ꜩ of burn, per collection, every time. That is the difference between fully-on-chain being a stunt and fully-on-chain being the default.

What makes a declaration safe is the hash, and what makes the hash worth anything is that nobody here is the authority behind it. The record carries npm coordinates plus a blake2b digest; a renderer fetches from any mirror and refuses anything that does not match. Anyone can check a recorded digest against npm's own integrity value without reference to us. Full rules in [ALEATORY-001](interface.md) §1.

A library nobody published has no independent authority behind it, so it goes inside the document, where it is the artist's own code and their own bytes.

---

## 3. Sandbox

A page that takes the zip (or a folder, or a URL) and runs it. Entirely client-side; no upload to anyone's server, no account, nothing recorded. Test as many times as you like, on a project you never publish.

What it does:

| | |
|---|---|
| **Seed grid** | Render N seeds at once. The actual question an artist has: *what does the space look like, not this one output.* |
| **Pin & reproduce** | Any output is addressable by seed, shareable as a URL, and reproducible later. |
| **Determinism check** | Same seed, two isolated runs, compare output. Any difference fails, with a pointer at the usual suspects (unseeded `Math.random`, `Date.now`, animation-frame timing dependence). |
| **Network check** | Rendered in a sandboxed frame with no network. Every attempted request is reported as a violation, not silently swallowed. This is the determinism rule enforced mechanically. |
| **Capture check** | Confirms the capture signal fires, within a timeout, deterministically, so previews are reproducible rather than "whenever the screenshotter felt like it." |
| **Cost estimate** | Byte count → storage burn from live protocol constants, priced per storage class (A sealed / B anchored / C pinned), so the artist sees the number before signing anything. |
| **Features preview** | The trait table across a sample of seeds, with the distribution, so wildly broken rarity is visible before mint rather than after. |

The sandbox is the whole of v0. It is also the piece that stays useful even if every other part of this project never ships, which is a good sign it's the right thing to build first.

---

## 4. Mint pipeline

Where the old model ran server-side inside a company, ours holds to a rule: **anything the pipeline does must be reproducible by someone else, and nothing it produces may be the only copy of anything.**

Stages, in order:

**1. Validate.** Same checks as the sandbox, re-run at submission: root `index.html`, no network, determinism across runs, capture fires, size within limits, every declared library resolvable and matching its hash. Pass/fail is mechanical and the reasons are shown in full. No reviewer, no discretion, no appeal needed because there's no judgment involved.

**2. Resolve libraries.** Each declaration is fetched and checked against its recorded digest. Anything that does not resolve is reported rather than skipped, because a piece rendered without the library it asked for is a blank frame. The final byte count and storage class are fixed here.

**3. Provision.** The chain operations, batched and signed by the artist:
   - FOC/shared: generator code chunked into the Registry, dependency references recorded, edition size, seed policy (op-hash or commit-reveal), royalties, and metadata written.
   - IPFS: content-addressed upload plus pinning, with the hash recorded on chain.
   - The artist signs. **We never hold the artist's key and never publish on their behalf.**

**4. Capture previews.** A headless run of the piece at the declared capture point for each minted seed. This is the one stage that wants a server, and therefore the one stage that gets the most scrutiny:
   - Previews are a **convenience, never a source of truth**. The piece is the code and the seed; an image is a cache of something anyone can regenerate.
   - The capture recipe, renderer version, viewport, pixel ratio, capture signal, is recorded on chain with the project, so any third party can regenerate byte-identical previews and check ours.
   - The capture worker is open source and runnable locally. An artist who wants no dependency on us at all can capture their own and supply the hashes.

**5. Index.** The indexer reads chain events and picks up the project with no coordination from the pipeline, it is a consumer of the chain, not a step in a workflow. If the pipeline dies mid-run after provisioning, the work is already published and the indexer will find it. That property is intentional: **the chain operation is the commit point**, everything after it is derived and re-derivable.

**6. Market.** Because a piece is an ordinary FA2 token with standard metadata and royalties, objkt and Teia index it without an integration, a partnership, or a listing request. Our front end is one view of the collection among several, and it is explicitly not the only place the work can be bought.

---

## 5. Where this can break, and what we do about it

| Failure | Consequence | Design response |
|---|---|---|
| Capture service down | Missing preview images | Pieces still render live from chain; previews regenerate later; recipe is public so anyone can backfill |
| Pipeline abandoned | No new publishes via our tooling | Raw-operation recipes + CLI documented; the contracts don't know the pipeline exists |
| Our front end gone | Nothing to browse | Indexer snapshots published; a replacement front end bootstraps in an afternoon |
| Dep library needed but never uploaded | Artist blocked | Bundle-and-pay path always available; treasury funds common libraries |
| A library upload turns out to be malicious | Poisoned dependency | Deps are append-only and hash-addressed, an existing project's pinned hash cannot be swapped underneath it. Bad entries get flagged in front-end metadata, never mutated on chain |
| Renderer version drift breaks old pieces | The unforgivable one | Renderer version pinned per project on chain; old renderers kept and served forever; conformance suite runs against every historical version |

That last row is the one that kills platforms slowly, and it is worth being blunt about: **a piece minted in year one must render identically in year ten.** Every convenience that makes the renderer easier to evolve is measured against that, and loses.

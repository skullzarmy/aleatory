# Architecture — Aleatory

**Status:** draft, 2026-08-01. Shape, not spec.

The front end is disposable and the protocol is the platform. This document is what that means in contracts.

**What v0 actually implements** (the lab at `/labs/aleatory`, see [roadmap.md](roadmap.md) §1): the record in §3, the seed derivation in §5, the class labelling in §6, the renderer standard in §7 including declared mint-time parameters ([params.md](params.md)), and the chain-only rebuild in §9 are all real and running on testnets. Three things are still stand-ins, and each is called out where it appears: the Runtimes catalogue lives in code rather than in an append-only contract; shared libraries resolve from a manifest rather than from the Deps contract; and a project is a stock FA2 whose contract metadata carries both the record and the code, rather than the four separate contracts below. The record shape does not change when those move on chain — that is the point of designing it first.

---

## 1. The unit

Everything reduces to one relationship:

```
generator (code)  +  seed (per-token)  ->  piece (deterministic output)
```

- A **generator** is authored code plus a declared dependency set plus a display recipe. It is published once and is immutable.
- A **seed** is bytes bound to a single mint, reproducible from chain state by anyone.
- A **piece** is a token that names a generator and a seed. It carries no image. The image is a *consequence*.

The token is not a picture. The token is a pointer into a possibility space, and the possibility space is on chain.

---

## 2. Contracts

Three contracts, and the split between them is the design.

| Contract | Owns | Who controls it |
|---|---|---|
| **Factory** | Deploy fee, the collection template, a registry of what it deployed | Us. Two-step transferable admin, plus `admin_lambda`. |
| **Collection** (FA2) | One project: one generator, one edition, its tokens | The artist, from the moment it exists. |
| **Resolver** | The set of backend minting keys | Us. One flip rotates a leaked key across every collection. |

**The factory holds no tokens.** That is what makes its escape hatch safe: `admin_lambda` transforms factory storage, and there is nothing of anyone else's in factory storage to reach. The contract that needs to be upgradable holds nothing; the contract that holds everything cannot be touched.

**A collection has no escape hatch at all.** No `admin_lambda`, no upgrade path, no platform fee, and no authority retained by us. `code_uri`, `code_hash`, `edition_size` and `royalties` have no setter anywhere in it — editions are immutable to the artist, to the factory, and to us. The artist administers only what established Tezos NFT contracts let an artist administer: pause the sale, reprice the unsold remainder, retire, and hand the contract to another address in two steps.

The price of that guarantee is real: a bug in the template is frozen into every collection already deployed, with no remedy. Which is why the collection stays boring, and why it needs to be audited before the first one ships.

### Deploy is one operation

The artist calls `deploy` with the fee. The factory originates the collection in that same operation with the artist already installed as its administrator *in the initial storage* — nothing is ever held by us and transferred, and there is no second signature.

Storage burn and gas are charged to the operation's source, which is the artist's wallet, as Tezos charges all storage to the payer including for internal originations. The factory fronts nothing.

**The fee is charged once, at deploy, and never again.** Sales carry no platform cut: the entire mint price goes to the artist. The fee is changeable and applies only to deployments made after the change.

### Changing the template means a new factory

The template is Michelson code compiled into the factory, and contract code is immutable — no lambda can rewrite it. So a new template is a new factory. That is cheap: it deploys new collections, existing ones are untouched, and nothing migrates.

### The template is not required

Anything that is standard FA2 + TZIP-21 gets indexed, rendered and traded — by us, by objkt, by anyone. What a third-party contract must match in order to use our render-and-mint backend is the `buy`/`mint` **interface**, not this implementation.

So the artifact that has to be right is the published interface. The template is its reference implementation, and someone who writes their own to that interface is a first-class citizen. Someone who writes something else entirely still gets indexed and displayed; they just mint their own way.

### The resolver, and its failure mode

Collections store the resolver address immutably and consult it through an on-chain view at mint. Rotating a leaked backend key is one operation instead of one per collection ever deployed — which matters most at exactly the moment you are compromised and slow.

The cost, stated plainly: whoever administers the resolver can authorise a minter into every collection that trusts it.

Two things bound that. A collection's resolver is fixed at origination, so we cannot repoint an existing collection at a different authority after the fact. And every collection carries a **local minter override set by the artist**, consulted first, so a resolver that is broken, captured, or gone cannot permanently freeze someone's edition. Their contract, their escape hatch.

---

## 3. The generator record — versioned and typed

The single most consequential design decision, because Registry entries are immutable and the contract is meant to never be replaced. Anything not extensible here becomes a migration later.

### Three independent version axes

Conflating these is the usual mistake. They change at different rates for different reasons and each needs its own field.

| Axis | Field | Answers | Changes when |
|---|---|---|---|
| **Record layout** | `schema_version` | How do I parse this record? | We add fields to the registry |
| **Runtime kind** | `runtime.kind_id` + `kind_version` | What kind of code is this, and against which library version? | An artist picks p5 vs SVG vs three vs custom |
| **Entry-point standard** | `standard_version` | Which lifecycle contract does the code implement? | We revise the renderer standard |

A p5 project pinned to p5 1.5.0 on standard v1 stays exactly that forever, even after the registry is on `schema_version` 4 and the standard is on v3. That is the whole point.

### The record

```
GeneratorRecord {
  schema_version    : nat              # layout of this record
  generator_id      : nat
  artist            : address
  published_at      : timestamp

  runtime : {                          # the type struct
    kind_id         : nat              # -> Runtimes contract
    kind_version    : string           # e.g. "1.5.0" — the library/dialect version
  }
  standard_version  : nat              # entry-point lifecycle the code conforms to

  code              : CodeRef          # OnChain(chunk_ids) | DepRef(hash) | Pinned(multihash)
  deps              : list CodeRef
  storage_class     : A | B | C        # derived at publish, stored for display honesty

  seed_policy       : OpHash | CommitReveal(min_age)
  params_schema     : option bytes     # up to 5 declared mint-time inputs; absent = none ([params.md](params.md))
  capture           : CaptureSpec      # mode, viewport, pixel_ratio, timeout, signal
  edition           : nat              # 0 = open edition
  royalties         : TZIP-21 shares
  metadata          : TZIP-16 pointer
}
```

### The Runtimes catalogue

```
RuntimeKind {
  kind_id        : nat
  name           : string        # "p5", "svg", "three", "vanilla", "wasm", "custom"
  entry_spec     : bytes         # the lifecycle contract this kind must implement
  renderer_ref   : CodeRef       # the harness that boots this kind, itself content-addressed
  added_at       : timestamp
  status         : active | deprecated     # deprecation is advisory; nothing stops rendering
}
```

**Kinds live in an append-only contract, not in an enum in the Registry.** An enum means adding a runtime in 2029 requires a new Registry contract and a migration of everything published before it. A catalogue means it requires one append operation, and every record ever written keeps parsing.

A kind is never edited. A better p5 harness is a *new kind_id*, and old projects keep pointing at the old one. Deprecation marks a kind as discouraged for new publishes and changes nothing about existing work — pieces minted against a deprecated kind render identically forever, which is the promise in [pipeline.md](pipeline.md) §5.

### Standard entry points

Every kind implements the same lifecycle, whatever the underlying library, exported as a single object (`window.ALEA_MAIN` in the v0 harness) rather than as loose globals. The kind decides how the lifecycle is *bound*; the lifecycle itself never varies:

| Entry point | Required | Contract |
|---|---|---|
| **boot(ctx)** | yes | Receives `{ seed, prng, params, paramsSchema, features, ready }`. Called once, before any drawing. Params arrive already resolved against the declaration ([params.md](params.md) §3). |
| **render** | yes | Produces output. For p5 this is `setup`/`draw`; for SVG a returned document; for custom code, an exported function. |
| **ready()** | yes | Fired exactly once, when the piece is at its capture point. Deterministic. |
| **features()** | optional | Returns the trait map derived from the seed. |
| **resize(w, h)** | optional | Absent means the harness re-boots at the new size. |

This is what makes "custom code" a first-class kind rather than an escape hatch. An artist bringing an engine nobody here has heard of implements five functions and declares `kind: custom` with their harness bundled or referenced. They get every guarantee — determinism check, capture, indexing, market — without asking anyone to add support for their toolchain.

### Forward-compatibility rules

1. **Additive only.** New optional fields bump `schema_version`; existing fields never change meaning. A reader that knows version *n* reads every record ≤ *n* and ignores unknown trailing optional fields.
2. **Unknown kind_id → refuse, don't guess.** A renderer that doesn't recognize a kind displays "unsupported runtime" and a pointer to the catalogue entry. It never renders a best-effort approximation. Wrong output is worse than no output in a medium where the output *is* the artwork.
3. **Every (kind, standard_version) harness is archived forever** and content-addressed. Serving old harnesses is a permanent obligation, not a maintenance burden to be optimized away.
4. **Version fields are ids, not strings**, where the value comes from a catalogue. Bytes on chain are money (§5).

---

## 4. Supply and sale — on-demand only

**Pieces are minted on demand, against a purchase.** A collector calls `buy` and pays; nothing is minted in advance and put up for sale.

This is not a preference, it is what makes the seed honest: the seed comes from the buy operation's hash, so a preminted piece would be one whose seed the artist saw before deciding to sell it. On-demand minting and unpredictable seeds are the same mechanism.

An artist who wants pieces of their own buys them like anyone else — **batch buying is supported**, so it is one operation for however many — and lists them wherever they like. The platform has no "put these finished pieces up for sale" flow, because that is the thing on-demand minting exists to avoid.

Batching works with the seed formula as written: `token_id` is in the preimage, so N pieces from one operation get N different seeds. It does slightly sharpen Policy A's known weakness — one ground operation hash now yields several outcomes to inspect rather than one — which is another reason a project that cares reaches for commit-reveal (§5).

### Artist controls

Established Tezos NFT behaviour, not invented here. The artist controls the supply side; the collector controls what they hold; nothing crosses that line.

| | |
|---|---|
| Pause minting | Yes, any time. Pauses the **sale**, never transfers — a paused project still trades on the secondary market. |
| Change price | Yes, for unminted pieces. Never retroactively. |
| Change edition size | **No.** Fixed at publish. Edition size carries collectibility meaning and moving it after the fact rewrites what people bought into. Enforced by the contract, not by a disabled button. |
| Retire the project | Only when **circulating supply is zero** — either nothing was ever minted, or the artist burned every piece they still held. It cannot be reached while someone else owns one. |
| Burn a piece | The holder's own, by transfer to the burn address, as everywhere else on Tezos. There is no admin burn entrypoint. |
| Touch a collector's token | Never. No entrypoint exists for it. |

"Retire" is a tombstone, not an erasure: a flag every reader honours, and optionally removal of the code from the metadata big_map so the contract stops serving it. The bytes remain in the origination operation forever. Nothing on a chain is deleted, and the UI should not use a word that claims otherwise.

---

## 4a. Who mints, and who writes the image

**Decided 2026-08-13.** This section replaces an earlier assumption that the collector's wallet both pays and mints in one operation.

### The problem

A token's `displayUri` is a raster of the piece. Producing it means *executing the generator's JavaScript* — p5, canvas, whatever the artist wrote — which no contract can do and no collector's wallet will do on our behalf.

If any address may write a token's URIs, then anyone can point a token at any CID. Our own client would notice, because the render is deterministic and we can check it. That does not help: the damage lands on objkt, and objkt renders whatever the metadata says. Verifiability is worthless on the surface where the harm actually occurs. This is the same reasoning that led fxhash to run a signer, arrived at independently.

### The decision: authorised backend minters, resolved centrally

Modelled on `zolturd_nft.py` in tezoshitcoin.xyz, which already solves this and is in production.

Only an authorised backend soft wallet may call `mint`. Authorisation is resolved from the Resolver contract (§2), with the artist's local override checked first. A minter cannot pause, cannot reprice, cannot retire, and cannot mint without a payment.

Because no open URI-writing entrypoint exists, the arbitrary-CID hole never exists to be defended against.

**Rejected: a multisig admin.** Considered on 2026-08-13 and set aside. A single admin wallet that can be handed over is the succession mechanism; a multisig can be adopted later by transferring admin to one, without a contract change, since admin is just an address.

### The flow

| | Who signs | What happens |
|---|---|---|
| 1. **`buy`** | the collector, once | Pays the artist the full price and writes a **reservation** recording buyer and level. **This operation's hash is the seed.** |
| 2. *(render)* | nobody | A backend minter picks up the event, renders the piece for that seed, pins it. |
| 3. **`mint`** | a whitelisted soft wallet | Consumes the reservation by id and mints **to the buyer recorded there**, with complete TZIP-21 metadata. |

The reservation is what binds a mint to the payment that funded it. `mint` has no `owner` parameter, so a stolen minting key cannot redirect a paid piece to itself; consuming the reservation makes a retried backend job fail rather than double-mint; and the recorded buyer and level let an indexer locate the funding operation and check the seed independently, instead of taking our word for the pairing.

A related consequence: `retire` closes new sales without requiring outstanding reservations to be filled, so a backend that dies mid-flow cannot permanently trap an artist. On the factory side the deploy fee **accrues in storage** and is swept by a permissionless `withdraw_fees`, because forwarding it inline would let one bad treasury address break deploys entirely.

The collector signs exactly once. The seed is fixed by their own operation before anything renders, so it cannot be chosen by the artist, the backend, or us. The contract never holds funds between operations: there is nothing to drain and no withdraw entrypoint.

**This does not make grinding expensive.** An earlier draft claimed a payment per attempt; that was wrong. The operation hash covers fields the sender controls — counter, fee, gas and storage limits — so candidates are enumerated offline, seeds derived, pieces rendered locally, and only the chosen one is ever injected. One payment, arbitrarily many attempts. Moving the seed source from `mint` to `buy` changed nothing here. This is Policy A's known weakness as documented in §5, and commit-reveal (Policy B) remains the answer for anyone who cares.

**The reveal is UI, not a transaction.** The wrapped-present moment — the piece arriving sealed and being opened — is presentation over the window while the backend works. It costs the collector no second signature.

### `artifactUri` is composed on chain; the raster is a cache

`artifactUri` is the generator's immutable `code_uri` plus the token's seed. That is string concatenation, which Michelson does fine, so it is written at mint from chain state and needs no rendering at all.

Only `displayUri` / `thumbnailUri` need a rasteriser, and they exist so a grid on objkt has a picture in it.

"The piece is the code and the seed; the image is a cache" is doing structural work here rather than being a slogan. **If the render service dies, new pieces arrive without a thumbnail. They do not arrive without art.** That downgrades the signer from existence infrastructure to convenience infrastructure, and it is why the hosting question below is reversible rather than load-bearing.

Consequences worth stating:

- A missing thumbnail heals whenever any minter comes back. The gap is not permanent damage.
- Multiple independent minters can be whitelisted at once, so "what if you disappear" answers with "someone else runs it."
- The front end and the resurrection kit render from chain state on demand, which is already how the v0 gallery works.

One caution for the UI: unopened-as-a-designed-state is good, but unopened-because-the-server-is-down is the same state reached by accident. Keep the aesthetic; do not let it launder an outage.

### Royalties

TZIP-21 shares, defined by the artist at deploy and written into every token at mint. The collection takes nothing on secondary.

An optional platform share is offered in the deploy UI — an explicit, unchecked ask above the royalty settings, never a default. One thing that ask has to say out loud: **royalty shares are baked into each token permanently.** Opting in and changing your mind later drops it from future mints only; pieces already minted keep paying forever. An opt-in that quietly is not reversible is not an honest one.

Still to decide: whether the platform share is a slice of the artist's percentage or added on top. Added-on-top raises the collector's total royalty burden, which marketplaces cap and collectors notice.

### Implementation status

`contract/aleatory.py` implements all three contracts — resolver, collection, factory — with tests. Not yet compiled or deployed.

Still to build: the backend minter itself. Copy `zolturd-mint.mts`'s idempotency work wholesale rather than reinventing it — conditional-`UPDATE` row claim so exactly one attempt wins, **persist the operation hash at injection before confirmation** (the linchpin that makes a crashed process recoverable instead of double-minting), three-outcome chain reconciliation that refuses to retry the indeterminate case, a unique partial index so one payment backs exactly one mint, and the contract address stored beside `token_id` so a redeploy does not rewrite old links.

`src/lib/aleatory/publish.ts` and `record.ts` still encode the superseded model — single-step client mint, artist-set `cover_seed` cover image, seed from the collector's own mint operation. They are what this replaces.

---

## 5. Seeds

The hard part, and the part every platform gets asked about.

**Requirements:** reproducible by anyone from chain state alone; unpredictable enough at mint time that collectors aren't shopping for outcomes; no oracle, no server, no trusted party.

Tezos gives us no block hash in Michelson and no VRF. What a contract can see — `level`, `now`, `sender`, storage counters — is all predictable, so a naive on-chain seed is snipeable: run the generator locally against the seed you know you'll get, mint only when you like the result.

Two supported policies, chosen per project at publish time and recorded immutably in the record:

**Policy A — operation-hash seed (default).**
```
seed = blake2b(buy_op_hash ‖ token_id ‖ generator_id)
```
`buy_op_hash` is the hash of the collector's `buy` operation (§4a) — fixed by the buyer's own signature, before the backend renders anything. The operation hash is chain state — an indexer reads it, anyone can recompute it, no trust involved — it just isn't readable *inside* Michelson, so the binding happens at the metadata/render layer rather than in contract storage. Simple, cheap, and the convention artists coming from other platforms already understand.

Honest limitation: the op hash is computable before submission, so a determined minter can grind counters and fees offline to fish for a seed. This is a known, real, and historically tolerated weakness — it costs effort and gets much worse for the sniper as demand rises. Document it, don't hide it.

**Policy B — commit-reveal seed.**
```
commit:  blake2b(nonce ‖ minter)         # minter commits
reveal:  seed = blake2b(nonce ‖ level ‖ token_id ‖ generator_id)
```
Two operations and a minimum block gap between them, so the seed can't be known when the commitment is made. Slower and more expensive per mint; genuinely resistant to grinding. Projects that care about fairness — big drops, long-form work with a wide quality spread — pick this.

We already run this pattern in production: the hack.tez registrar uses commit-reveal with a minimum commit age (`contract/hack_tez_registrar.py`). The mechanism is proven in-house, which is a real reason to prefer it over inventing something.

**Not doing:** artist-chosen seeds, curated seed lists, or any mechanism where the platform can influence which seed a collector receives. If we can pick, we can be corrupted, and eventually someone will ask.

---

## 6. How a piece is stored — labeled, not policed

Fully on-chain is the goal and is genuinely affordable on Tezos for code-sized payloads. It is not affordable for everything, and pretending otherwise pushes artists into lying about their dependencies.

Storage burn is 0.00025 ꜩ/byte (250 mutez), and a single operation is capped at 32,768 bytes, so large uploads chunk across multiple operations. Both were read live from Shadownet on 2026-08-01 and match the figures below — and the v0 estimator reads them from the chain at runtime rather than trusting this paragraph.

| Payload | Bytes | Rough burn |
|---|---|---|
| A tight generator | 4 KB | ~1 ꜩ |
| A generous generator | 20 KB | ~5 ꜩ |
| A minified library (once, shared, forever) | 500 KB | ~125 ꜩ |

So: an artist can publish a self-contained generator for a few tez. A library costs real money *once*, and then every project that references it pays nothing. That is exactly the cost structure a commons should have, and it is worth funding library uploads from the treasury as a public good.

Every generator carries a class, displayed on the piece:

- **Fully on-chain (FOC).** Code and every dependency on chain. Renders from L1 alone, forever, with no other system in existence. The default we push people toward.
- **On-chain + shared library.** Code on chain, dependencies referenced by hash. Once the Deps contract exists the guarantee is the same as FOC and far cheaper to publish — but in v0 the library is resolved from a CDN manifest, so a piece like this is **not** fully on-chain yet. Say so plainly wherever it is displayed.
- **IPFS.** Code or assets in content-addressed off-chain storage, hash recorded on chain. Legitimate for heavy inputs — audio, large datasets, photographic source material — and honestly labeled as depending on someone continuing to pin it.

IPFS pieces get pinned by us and by anyone else who wants to help; the pin set is public so its health is observable. **No option is forbidden. Every one is visible.** An artist choosing IPFS is making an informed tradeoff, and the collector gets to see it before they buy.

---

## 7. The renderer standard

A generator is HTML/JS (or SVG, or WASM) that receives a seed and renders. That's it. The standard's job is to be boring and compatible.

- **Seed delivery** by URL parameter and a global, matching the convention artists' existing code is already written against. Code that ran on other Tezos snippet platforms should run here with near-zero edits. Compatibility is deliberate: we are not asking anyone to rewrite a body of work to prove loyalty.
- **Lifecycle** as defined in §3 — one contract across every runtime kind.
- **Parameterized mints** — a project may declare **up to five** named, typed parameters via `params_schema`, which the minter sets before signing and which are stored on chain with the token alongside the seed. Determinism holds: (code, seed, params) is still a pure function, which is why the resolution rule is specified rather than left to each implementation. Always optional; most generators declare none. The artist names each one and sets its range — unnamed fixed-arity sliders are the mistake this is deliberately not repeating. Specified in full, as an integration guide for other platforms, in **[params.md](params.md)**. Implemented in v0.
- **Capture** — the declared capture point in `CaptureSpec`, fired by `ready()`, so preview images are reproducible rather than whenever-the-screenshotter-felt-like-it.
- **Sandbox** — rendered in a sandboxed frame with no network. Not a policy, an enforcement: the determinism rule is checked mechanically at publish time, and a generator that tries to fetch gets flagged before it ever mints.
- **SVG-on-chain path** — for pieces that emit pure SVG, the whole thing can live in contract storage with no runtime at all. Neighboring work (Bootloader) shows this is a rich vein; there is no reason for the standard to exclude it.

The standard is published as a spec document with a reference implementation and a conformance test suite, versioned as `standard_version`. Another front end must be able to render our pieces correctly without reading our source.

---

## 8. Rescue: nothing stranded

An import path for work marooned by platforms that left or died.

Given a generator's code and its seed convention, re-homing it here is mostly mechanical: wrap the snippet, map the seed parameter, republish under the original artist's address, mint the same edition size or none at all. The interesting cases are the ones where the *original* is at risk — code that only exists behind a service that may stop paying its bills.

Shape of it:

1. **Mirror** (read-only, no chain writes) — archive at-risk generator code and metadata from existing platforms into content-addressed storage, publicly. This is worth doing *whether or not* anyone re-mints, and it is worth starting before v1. Archives are cheap; regret is not.
2. **Claim** — the original artist, proving control of the original address, republishes their generator here as a FOC/shared entry.
3. **Continue** — new editions of an old system, or a fresh system in the same lineage, at the artist's discretion.

Two hard rules: **only the artist may claim,** and the original provenance is recorded, not laundered. A rescued generator says where it came from.

---

## 9. Indexer and data

- Open schema, open source, runnable by anyone against public RPCs.
- Full snapshots published to content-addressed storage on a schedule, so a new indexer bootstraps from a download rather than a multi-day replay.
- The API is public and unauthenticated for reads. Rate limits, not keys.
- Nothing the front end shows may depend on data that only we hold. If the UI needs it, the dataset has it.

---

## 10. Front end

Static, no build secrets, deployable by a stranger with a checkout and a hosting account. Mirrors expected and encouraged. Brand strings live in one module so that forks and the eventual rename are a one-file change (see [roadmap.md](roadmap.md) §4).

Wallet stack reuses what hack.tez already runs (octez.connect / Beacon), which is also what makes v0 in the labs nearly free.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Seed sniping on Policy A | Documented plainly; Policy B available and recommended for high-demand drops |
| On-chain storage costs deter artists | Shared Deps contract; treasury funds library uploads; publish a cost estimator before anyone signs |
| IPFS rot | Public pin set, multiple pinners, class shown on every piece |
| A runtime we didn't anticipate | Append-only Runtimes catalogue + `custom` kind; no contract replacement needed (§3) |
| Registry needs a field we didn't foresee | `schema_version`, additive-only evolution, readers ignore unknown optional fields |
| Nobody uses it | Interop first — pieces trade on objkt/Teia from day one, so an artist risks nothing by trying it |
| Marketplace fee war | We don't run a marketplace. Not our fight. |
| The steward disappears | Admin is transferable in two steps; minting keys are cyclable; the renderer is open source and replaceable. |
| Protocol constants change (storage cost, op size) | Constants read at runtime where possible; ⚠-marked in docs; estimator is chain-derived, never hardcoded |

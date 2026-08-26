# Architecture, Aleatory

**Status:** draft, 2026-08-01. Shape, not spec.

The front end is disposable and the protocol is the platform. This document is what that means in contracts.

**What v0 actually implements** (the lab at `/labs/aleatory`, see [roadmap.md](roadmap.md) §1): the record in §3, the seed derivation in §5, the class labelling in §6, the renderer standard in §7 including declared mint-time parameters ([params.md](params.md)), and the chain-only rebuild in §9 are all real and running on testnets. Three things are still stand-ins, and each is called out where it appears: the Runtimes catalogue lives in code rather than in an append-only contract; shared libraries resolve from a manifest rather than from the Deps contract; and a project is a stock FA2 whose contract metadata carries both the record and the code, rather than the four separate contracts below. The record shape does not change when those move on chain, that is the point of designing it first.

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

Five contracts, and the split between them is the design.

| Contract | Owns | Who controls it |
|---|---|---|
| **Factory** | The collection template and a registry of what it deployed | Us. Two-step transferable admin, plus `admin_lambda`. |
| **Collection** (FA2) | One project: one generator, one edition, its tokens | The artist, from the moment it exists. |
| **Resolver** | The set of backend minting keys | Us. One flip rotates a leaked key across every collection. |
| **Provider** | One render provider's price and push endpoint | Whoever runs it. Any contract exposing `get_render_gas` is a provider. |
| **Registry** | The list of providers | Nobody. Permissionless, no fee. |

**The factory holds no tokens.** That is what makes its escape hatch safe: `admin_lambda` transforms factory storage, and there is nothing of anyone else's in factory storage to reach. The contract that needs to be upgradable holds nothing; the contract that holds everything cannot be touched.

**A collection has no escape hatch at all.** No `admin_lambda`, no upgrade path, no platform fee, and no authority retained by us. `code_uri`, `code_hash`, `params_schema` and `royalties` have no setter anywhere in it. The artist administers only what established Tezos NFT contracts let an artist administer: pause the sale, reprice the unsold remainder, reduce or close the edition, switch render provider, and hand the contract to another address in two steps (§4).

The price of that guarantee is real: a bug in the template is frozen into every collection already deployed, with no remedy. Which is why the collection stays boring, and why it needs to be audited before the first one ships.

### Deploy is one operation

The artist calls `deploy` with the fee. The factory originates the collection in that same operation with the artist already installed as its administrator *in the initial storage*, nothing is ever held by us and transferred, and there is no second signature.

Storage burn and gas are charged to the operation's source, which is the artist's wallet, as Tezos charges all storage to the payer including for internal originations. The factory fronts nothing.

**There is no deploy fee.** It is zero: the artist's own origination burn and gas are the only cost, which is already a real floor against spam. `deploy_price` exists as an admin-settable field starting at 0 so an anti-spam lever remains possible without a new factory, and any change would be visible on chain. Sales carry no platform cut either, the mint price goes to the artist and the render gas to the provider. Our income is the render service.

### Changing the template means a new factory

The template is Michelson code compiled into the factory, and contract code is immutable, no lambda can rewrite it. So a new template is a new factory. That is cheap: it deploys new collections, existing ones are untouched, and nothing migrates.

### The template is not required

Anything that is standard FA2 + TZIP-21 gets indexed, rendered and traded, by us, by objkt, by anyone. What a third-party contract must match in order to use our render-and-mint backend is the `mint` **interface**, not this implementation.

So the artifact that has to be right is the published interface. The template is its reference implementation, and someone who writes their own to that interface is a first-class citizen. Someone who writes something else entirely still gets indexed and displayed; they just mint their own way.

### The resolver, and its failure mode

Collections store the resolver address immutably and consult it through an on-chain view at mint. Rotating a leaked backend key is one operation instead of one per collection ever deployed, which matters most at exactly the moment you are compromised and slow.

The cost, stated plainly: whoever administers the resolver can authorise a minter into every collection that trusts it.

Two things bound that. A collection's resolver is fixed at origination, so we cannot repoint an existing collection at a different authority after the fact. And every collection carries a **local minter override set by the artist**, consulted first, so a resolver that is broken, captured, or gone cannot permanently freeze someone's edition. Their contract, their escape hatch.

---

## 3. The generator record, versioned and typed

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
    kind_version    : string           # e.g. "1.5.0", the library/dialect version
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

A kind is never edited. A better p5 harness is a *new kind_id*, and old projects keep pointing at the old one. Deprecation marks a kind as discouraged for new publishes and changes nothing about existing work, pieces minted against a deprecated kind render identically forever, which is the promise in [pipeline.md](pipeline.md) §5.

### Standard entry points

Every kind implements the same lifecycle, whatever the underlying library, exported as a single object (`window.ALEA_MAIN` in the v0 harness) rather than as loose globals. The kind decides how the lifecycle is *bound*; the lifecycle itself never varies:

| Entry point | Required | Contract |
|---|---|---|
| **boot(ctx)** | yes | Receives `{ seed, prng, params, paramsSchema, features, ready }`. Called once, before any drawing. Params arrive already resolved against the declaration ([params.md](params.md) §3). |
| **render** | yes | Produces output. For p5 this is `setup`/`draw`; for SVG a returned document; for custom code, an exported function. |
| **ready()** | yes | Fired exactly once, when the piece is at its capture point. Deterministic. |
| **features()** | optional | Returns the trait map derived from the seed. |
| **resize(w, h)** | optional | Absent means the harness re-boots at the new size. |

This is what makes "custom code" a first-class kind rather than an escape hatch. An artist bringing an engine nobody here has heard of implements five functions and declares `kind: custom` with their harness bundled or referenced. They get every guarantee, determinism check, capture, indexing, market, without asking anyone to add support for their toolchain.

### Forward-compatibility rules

1. **Additive only.** New optional fields bump `schema_version`; existing fields never change meaning. A reader that knows version *n* reads every record ≤ *n* and ignores unknown trailing optional fields.
2. **Unknown kind_id → refuse, don't guess.** A renderer that doesn't recognize a kind displays "unsupported runtime" and a pointer to the catalogue entry. It never renders a best-effort approximation. Wrong output is worse than no output in a medium where the output *is* the artwork.
3. **Every (kind, standard_version) harness is archived forever** and content-addressed. Serving old harnesses is a permanent obligation, not a maintenance burden to be optimized away.
4. **Version fields are ids, not strings**, where the value comes from a catalogue. Bytes on chain are money (§5).

---

## 4. Supply and sale, on-demand only

**Pieces are minted on demand, against a purchase.** A collector calls `mint` and pays; nothing is minted in advance and put up for sale.

This is not a preference, it is what makes the seed honest: the seed comes from the mint operation's hash, so a preminted piece would be one whose seed the artist saw before deciding to sell it. On-demand minting and unpredictable seeds are the same mechanism.

An artist who wants pieces of their own buys them like anyone else and lists them wherever they like. The platform has no "put these finished pieces up for sale" flow, because that is the thing on-demand minting exists to avoid.

### Artist controls

Established Tezos NFT behaviour, not invented here. The artist controls the supply side; the collector controls what they hold; nothing crosses that line.

| | |
|---|---|
| Pause / unpause the sale | Any time. Never affects transfers, a paused collection still trades on secondary. |
| Start paused | Chosen at deploy, so a collection can be deployed, checked, announced, then opened. |
| Change price | Any time, for future mints only. Never retroactive. |
| Reduce the edition | Any time, never below what is already minted. Reducing supply only makes existing pieces scarcer, so no holder is harmed. |
| Increase the edition | **Never.** No entrypoint exists. |
| Close the edition | Set the edition size to the number already minted. One-way, and it replaces a separate `retire`. |
| Switch render provider | Any time. |
| Hand over the collection | Two-step propose/accept. |
| Burn a piece | The holder's own, by transfer to the burn address, as everywhere else on Tezos. There is no admin burn entrypoint. |
| Touch a collector's token | Never. No entrypoint exists for it. |

Open editions are `edition_size = 0`. Open → finite is a valid reduction provided the new size is at or above what is minted; finite → open is never allowed.

Reductions and price changes emit events, so a cut from 100 to 50 is visible rather than silent.

Closing an edition is a tombstone, not an erasure. Nothing on a chain is deleted, and the UI should not use a word that claims otherwise.

---

## 4a. Who mints, and who writes the image

**Decided 2026-08-13, revised 2026-08-23.** The collector's wallet both pays and mints, in one operation. What it cannot do is produce the image.

### The problem

A token's `displayUri` is a raster of the piece. Producing it means *executing the generator's JavaScript*, p5, canvas, whatever the artist wrote, which no contract can do and no collector's wallet will do on our behalf.

If any address may write a token's URIs, then anyone can point a token at any CID. Our own client would notice, because the render is deterministic and we can check it. That does not help: the damage lands on objkt, and objkt renders whatever the metadata says. Verifiability is worthless on the surface where the harm actually occurs. This is the same reasoning that led fxhash to run a signer, arrived at independently.

### The decision: authorised render providers

Modelled on `zolturd_nft.py` in tezoshitcoin.xyz, which already solves this and is in production.

Only an authorised address may call `set_token_metadata`. Authorisation is the collection's provider, asked live, so rotating a leaked key revokes it everywhere at once, or an address the artist authorised locally, or one the Resolver contract (§2) vouches for while `trust_resolver` is on. Such an address cannot pause, cannot reprice, cannot change the edition, and cannot mint anything: minting happens in `mint`, by the collector.

Because no open URI-writing entrypoint exists, the arbitrary-CID hole never exists to be defended against.

**Rejected: a multisig admin.** Considered on 2026-08-13 and set aside. A single admin wallet that can be handed over is the succession mechanism; a multisig can be adopted later by transferring admin to one, without a contract change, since admin is just an address.

### The flow

| | Who signs | What happens |
|---|---|---|
| 1. **`mint`** | the collector, once | Pays `price + render_gas`, split in that same operation, price to the artist, render gas to the provider. **Mints the token**: code, parameters, royalties, owner and name, showing the collection's placeholder image. **This operation's hash is the seed.** |
| 2. **`set_token_metadata`** | a render provider | Publishes that piece's metadata URI, once, replacing the collection's pending document. |

**The token is minted in the collector's own operation.** An unrevealed piece is a complete artwork with a pending thumbnail, not a promise of a future token, which is why there is no reservation to strand, no refund to argue about, and nothing a failed provider can take away. It is also why the seed needs no extra record: a token's seed derives from the hash of the operation that created it.

The contract's balance is zero when `mint` returns. Nothing is escrowed, nothing is held, there is no withdraw entrypoint.

**The reveal is a UI moment, not a transaction for the collector.** The wrapped-present framing is presentation over the window while a provider works, and it costs the buyer no second signature.

**This does not make grinding expensive.** The operation hash covers fields the sender controls, counter, fee, gas and storage limits, so candidates are enumerated offline, seeds derived, pieces rendered locally, and only the chosen one is ever injected. One payment, arbitrarily many attempts. Documented, accepted, not hidden.

### `set_token_metadata`, and what it grants

It is the only entrypoint in the contract that modifies an existing token, and it modifies exactly one field of one token, once, but that field is the metadata pointer, so a provider publishes the piece's **whole** metadata document.

That is the conventional Tezos arrangement, and the same trust every generative platform here already extends. It is bounded by being write-once, artist-authorised, and reproducible after the fact by anyone.

Authorised means the collection's provider, an address the artist authorised directly (`set_local_writer`), or one the resolver vouches for. The resolver is consulted through a view that may fail: if it is gone or broken the call falls through to the artist's local set rather than reverting, so a dead resolver cannot freeze every collection that trusted it.

**Collectors cannot self-reveal.** Pinning requires an account, and the only ways to give a collector one are lending them ours or asking every buyer to configure their own IPFS provider. Neither is acceptable, so only providers write images, which also means an artist's grid is protected by default with no flag needed.

Writing an image that does not match the piece is possible and not preventable on chain. It is detectable by anyone: the seed comes from the mint operation, the parameters are in the token, the code is immutable, so the correct image is reproducible. Detection and key rotation, not a guarantee we cannot make.

### The artwork is on chain; the metadata is a description of it

`code_uri` and `code_hash` are immutable collection storage, the seed is the mint operation's hash, and the parameters are in that same operation. So a piece is fully determined by chain state, before any metadata is published and regardless of what is published.

The metadata JSON is where a marketplace reads *about* the piece: its name, its `displayUri`, its royalties. Useful, and not the artwork.

"The piece is the code and the seed; the image is a cache" is doing structural work here rather than being a slogan. **If every render provider disappeared, new pieces would arrive undescribed. They would not arrive without art.**

### Royalties

The **objkt convention**, not TZIP-21, which defines no royalties field at all. objkt and Teia read `{"decimals": n, "shares": {address: value}}`, where each share is an **absolute** fraction of the sale price.

Set once at deploy and written into every piece's metadata document.

Royalties live in the token's metadata JSON and are built off chain, like every other Tezos NFT. The contract neither composes nor validates them.

The UI works in relative terms, a total percentage, then recipients splitting it, and converts to absolute shares before encoding. Mistaking one for the other pays out wrong forever, so the deploy preview shows the decoded result the way objkt will read it before anything is signed. Conventions kept in the UI: total at most 25%, shares summing to 100%, remainder to the first recipient.

An optional platform share is a recipient row that starts absent, an explicit, unchecked ask, never a default. Because royalties are immutable, that choice is permanent for every piece the collection will ever mint, and the UI has to say so at the moment of asking.

### Implementation status

`contract/aleatory.py` implements the factory, collection, resolver and provider contracts with tests. Not yet deployed. The full settled model is in [decisions.md](decisions.md), which wins wherever this document has not caught up.

---

## 5. Seeds

The hard part, and the part every platform gets asked about.

**Requirements:** reproducible by anyone from chain state alone; unpredictable enough at mint time that collectors aren't shopping for outcomes; no oracle, no server, no trusted party.

Tezos gives us no block hash in Michelson and no VRF. What a contract can see, `level`, `now`, `sender`, storage counters, is all predictable, so a naive on-chain seed is snipeable: run the generator locally against the seed you know you'll get, mint only when you like the result.

Two supported policies, chosen per project at publish time and recorded immutably in the record:

**Policy A, operation-hash seed (default).**
```
seed = blake2b(mint_op_hash ‖ token_id ‖ generator_id)
```
`mint_op_hash` is the hash of the collector's `mint` operation (§4a), fixed by the buyer's own signature, before the backend renders anything. The operation hash is chain state, an indexer reads it, anyone can recompute it, no trust involved, it just isn't readable *inside* Michelson, so the binding happens at the metadata/render layer rather than in contract storage. Simple, cheap, and the convention artists coming from other platforms already understand.

Honest limitation: the op hash is computable before submission, so a determined minter can grind counters and fees offline to fish for a seed. This is a known, real, and historically tolerated weakness, it costs effort and gets much worse for the sniper as demand rises. Document it, don't hide it.

~~**Policy B, commit-reveal seed.**~~ Dropped 2026-08-23: the operation hash is always the seed, so `seed_policy` is a constant in the spec rather than a field in the record. Commit-reveal would have meant two collector signatures and a contract that mints separately from the one that pays, both of which the settled model removes. The grinding weakness above is accepted and documented instead.

**Not doing:** artist-chosen seeds, curated seed lists, or any mechanism where the platform can influence which seed a collector receives. If we can pick, we can be corrupted, and eventually someone will ask.

---

## 6. How a piece is stored, labeled, not policed

Fully on-chain is the goal and is genuinely affordable on Tezos for code-sized payloads. It is not affordable for everything, and pretending otherwise pushes artists into lying about their dependencies.

Storage burn is 0.00025 ꜩ/byte (250 mutez), and a single operation is capped at 32,768 bytes, so large uploads chunk across multiple operations. Both were read live from Shadownet on 2026-08-01 and match the figures below, and the v0 estimator reads them from the chain at runtime rather than trusting this paragraph.

| Payload | Bytes | Rough burn |
|---|---|---|
| A tight generator | 4 KB | ~1 ꜩ |
| A generous generator | 20 KB | ~5 ꜩ |
| A minified library (once, shared, forever) | 500 KB | ~125 ꜩ |

So: an artist can publish a self-contained generator for a few tez. A library costs real money *once*, and then every project that references it pays nothing. That is exactly the cost structure a commons should have, and it is worth funding library uploads from the treasury as a public good.

Every generator carries a class, displayed on the piece:

- **Fully on-chain (FOC).** Code and every dependency on chain. Renders from L1 alone, forever, with no other system in existence. The default we push people toward.
- **On-chain + shared library.** Code on chain, dependencies referenced by hash. Once the Deps contract exists the guarantee is the same as FOC and far cheaper to publish, but in v0 the library is resolved from a CDN manifest, so a piece like this is **not** fully on-chain yet. Say so plainly wherever it is displayed.
- **IPFS.** Code or assets in content-addressed off-chain storage, hash recorded on chain. Legitimate for heavy inputs, audio, large datasets, photographic source material, and honestly labeled as depending on someone continuing to pin it.

IPFS pieces get pinned by us and by anyone else who wants to help; the pin set is public so its health is observable. **No option is forbidden. Every one is visible.** An artist choosing IPFS is making an informed tradeoff, and the collector gets to see it before they buy.

---

## 7. The renderer standard

A generator is HTML/JS (or SVG, or WASM) that receives a seed and renders. That's it. The standard's job is to be boring and compatible.

- **Seed delivery** by URL parameter and a global, matching the convention artists' existing code is already written against. Code that ran on other Tezos snippet platforms should run here with near-zero edits. Compatibility is deliberate: we are not asking anyone to rewrite a body of work to prove loyalty.
- **Lifecycle** as defined in §3, one contract across every runtime kind.
- **Parameterized mints**, a project may declare **up to five** named, typed parameters via `params_schema`, which the minter sets before signing and which are stored on chain with the token alongside the seed. Determinism holds: (code, seed, params) is still a pure function, which is why the resolution rule is specified rather than left to each implementation. Always optional; most generators declare none. The artist names each one and sets its range, unnamed fixed-arity sliders are the mistake this is deliberately not repeating. Specified in full, as an integration guide for other platforms, in **[params.md](params.md)**. Implemented in v0.
- **Capture**, the declared capture point in `CaptureSpec`, fired by `ready()`, so preview images are reproducible rather than whenever-the-screenshotter-felt-like-it.
- **Sandbox**, rendered in a sandboxed frame with no network. Not a policy, an enforcement: the determinism rule is checked mechanically at publish time, and a generator that tries to fetch gets flagged before it ever mints.
- **SVG-on-chain path**, for pieces that emit pure SVG, the whole thing can live in contract storage with no runtime at all. Neighboring work (Bootloader) shows this is a rich vein; there is no reason for the standard to exclude it.

The standard is published as a spec document with a reference implementation and a conformance test suite, versioned as `standard_version`. Another front end must be able to render our pieces correctly without reading our source.

---

## 8. Rescue: nothing stranded

An import path for work marooned by platforms that left or died.

Given a generator's code and its seed convention, re-homing it here is mostly mechanical: wrap the snippet, map the seed parameter, republish under the original artist's address, mint the same edition size or none at all. The interesting cases are the ones where the *original* is at risk, code that only exists behind a service that may stop paying its bills.

Shape of it:

1. **Mirror** (read-only, no chain writes), archive at-risk generator code and metadata from existing platforms into content-addressed storage, publicly. This is worth doing *whether or not* anyone re-mints, and it is worth starting before v1. Archives are cheap; regret is not.
2. **Claim**, the original artist, proving control of the original address, republishes their generator here as a FOC/shared entry.
3. **Continue**, new editions of an old system, or a fresh system in the same lineage, at the artist's discretion.

Two hard rules: **only the artist may claim,** and the original provenance is recorded, not laundered. A rescued generator says where it came from.

---

## 9. Indexer and data

- Open schema, open source, runnable by anyone against public RPCs.
- Full snapshots published to content-addressed storage on a schedule, so a new indexer bootstraps from a download rather than a multi-day replay.
- The API is public and unauthenticated for reads. Rate limits, not keys.
- Nothing the front end shows may depend on data that only we hold. If the UI needs it, the dataset has it.

---

## 10. Front end

Next on Netlify, React, Tailwind and Radix, the same stack as [rejkt.xyz](https://rejkt.xyz), so its components, TzKT client and feed machinery lift across rather than being rewritten.

**Wallet is Tezos X Connect** (`@tezos-x/octez.connect-sdk`), as on hack.tez. This is the one part of rejkt that does not transfer: it is still on Beacon.

**Open in the sense that matters: someone else can pick it up.** No build secrets, forkable, and documented well enough, `AGENTS.md`, skills files, these docs, that a newcomer or their agent gets oriented without asking us. That is a documentation problem, not an argument for a smaller stack.

Brand strings live in one module so that forks and the eventual rename are a one-file change (see [roadmap.md](roadmap.md) §4).

**One hard constraint: generator code never renders on the app's own origin.** Artist JavaScript is untrusted, it runs in every visitor's browser, and same-origin would give it reach into wallet state and session storage. Artifacts are served from a separate host in a sandboxed frame, the arrangement fxhash uses, and a DNS decision far cheaper to make before the first piece renders than after.

That host is `provider.aleatory.art`, and it belongs to the provider stack: it is the same harness `worker/render.ts` uses to capture the image that goes on chain, serving live to a browser instead of headless. It renders a piece that is already minted, addressed by CID. It is not a sandbox, and calling it one obscured for a while that there was no sandbox: a sandbox is where an artist builds and iterates before minting.

Wallet stack reuses what hack.tez already runs (octez.connect / Beacon), which is also what makes v0 in the labs nearly free.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Seed grinding on the op-hash seed | Documented plainly and accepted; the cost of one signature and no separate mint step |
| On-chain storage costs deter artists | Shared Deps contract; treasury funds library uploads; publish a cost estimator before anyone signs |
| IPFS rot | Public pin set, multiple pinners, class shown on every piece |
| A runtime we didn't anticipate | Append-only Runtimes catalogue + `custom` kind; no contract replacement needed (§3) |
| Registry needs a field we didn't foresee | `schema_version`, additive-only evolution, readers ignore unknown optional fields |
| Nobody uses it | Interop first, pieces trade on objkt/Teia from day one, so an artist risks nothing by trying it |
| Marketplace fee war | We run one, at 2.5%, and pieces trade freely elsewhere regardless, standard FA2 means no venue can be locked out, including ours. |
| The steward disappears | Admin is transferable in two steps; minting keys are cyclable; the renderer is open source and replaceable. |
| Protocol constants change (storage cost, op size) | Constants read at runtime where possible; ⚠-marked in docs; estimator is chain-derived, never hardcoded |

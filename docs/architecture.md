# Architecture

A piece is code plus a seed. The code is a generator stored in contract
storage, immutable from the moment it is published. The seed is the hash of the
operation that minted the piece, so it is fixed at purchase and chosen by
nobody. Everything below follows from wanting those two facts to hold without
anyone's cooperation, including ours.

Seven contracts hold the state, a render provider turns a piece into an image,
and a website reads all of it. Only the first of those three is load-bearing:
the provider is a role anyone can fill, and the website is one client among
however many exist.

[ALEATORY-001](interface.md) specifies the interface normatively, for building
against without this source. This document is the reasoning behind it: what
each part owns, what it cannot do, and why the boundaries are where they are.

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

Seven contracts. Four we administer, one nobody can, one belongs to whoever
runs it, and one to the artist who deployed it.

| Contract | Owns | Who controls it |
|---|---|---|
| **Router** | Which factory, marketplace, registry and resolver are current | Us. Two-step transferable admin. |
| **Factory** | The collection template and a record of what it deployed | Us. Two-step transferable admin, plus `admin_lambda`. |
| **Marketplace** | Listings, offers, fees, royalties owed | Us. Two-step transferable admin. |
| **Resolver** | Which keys may write resolution entries | Us. One flip rotates a leaked key across every collection. |
| **Collection** (FA2) | One project: one generator, one edition, its tokens | The artist, from the moment it exists. |
| **Provider** | One render provider's price and working key | Whoever runs it. |
| **Registry** | The list of providers | Nobody. Permissionless, no fee. |

**The factory holds no tokens.** That is what makes its escape hatch safe: `admin_lambda` transforms factory storage, and there is nothing of anyone else's in factory storage to reach. The contract that needs to be upgradable holds nothing; the contract that holds everything cannot be touched.

**A collection has no escape hatch at all.** No `admin_lambda`, no upgrade path, no platform fee, and no authority retained by us. `code`, `code_uri`, `code_hash` and `royalties` have no setter anywhere in it. The artist administers only what established Tezos NFT contracts let an artist administer: pause the sale, reprice the unsold remainder, reduce or close the edition, switch render provider, and hand the contract to another address in two steps (§4).

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

## 3. What a collection stores

A collection is one generator, one edition, and its tokens. Everything a
renderer or a marketplace needs is in its storage or its metadata big_map, and
nothing needs an index of ours.

```
art    : code            the generator itself, bytes
         code_encoding   identity, or gzip when it needed compressing
         code_hash       SHA-256 of the decoded source
         code_uri        set only when the generator is past the operation cap
         royalties       address to basis points, capped at 2500
         pending_metadata  the document a token carries until it is rendered

sale   : price, edition_size (0 is open), paused

render : provider        the provider contract the artist chose
         provider_agent  the agent snapshotted at deploy
         resolver, trust_resolver, local_writers
                         who else may write this collection's token metadata

ledger, operators, token_metadata, administrator, proposed_admin, next_token_id
```

Set at deploy and immutable after it: `code`, `code_encoding`, `code_hash`,
`code_uri` and `royalties`. There is no setter for any of them anywhere in the
contract.

### The metadata big_map

| Key | Holds |
|---|---|
| `content` | TZIP-16: name, description, interfaces, authors, `displayUri`, `thumbnailUri`, `aleaCoverSeed` |
| `aleatory:params` | The mint-time parameter declaration, when the generator has one ([params.md](params.md)) |
| `aleatory:libraries` | The libraries the generator declared, with npm coordinates and hashes ([libraries.md](libraries.md)) |

Both `aleatory:` keys are absent when the generator declares nothing, so an
absent key and an empty one never have to mean different things.

### Runtime kinds is not a stored field

A generator records no kind on chain. Libraries come from the generator's own
declarations and one harness runs everything, so nothing at render time
branches on which kind a piece was written against. The kinds below describe
the shapes a generator can take and are a label in the studio.

### Runtime kinds

A kind says which harness a generator was written against. Four exist:

| kind_id | name | Entry |
|---|---|---|
| 1 | `vanilla` | Script runs on load, draws to a `<canvas>`, calls `$alea.ready()`. |
| 2 | `svg` | Script builds an `<svg>` in the document, calls `$alea.ready()`. |
| 3 | `p5` | A p5 sketch, `setup` and `draw`. Calls `$alea.ready()`. |
| 4 | `custom` | Exports `window.ALEA_MAIN = { boot, render, features?, resize? }` and calls `ctx.ready()`. |

The first three run as ordinary scripts. Only `custom` exports a lifecycle
object, because a piece driven by an engine of its own needs the harness to
call it rather than the other way round.

**Kind ids are append-only.** A kind is never edited and an id is never reused.
A better p5 harness is a new kind_id, and pieces already minted keep pointing
at the old one and render as they always did.

**A kind does not decide what loads.** Libraries come from the generator's own
`alea:library` declarations, so a piece asking for p5 gets p5 whichever kind it
records. One harness runs all four, and the kind is a label on the work rather
than a switch in the renderer. That is why a mislabelled piece still renders
correctly, and why the studio can read the kind back out of an uploaded file.

The catalogue lives in `src/lib/runtimes.ts`. Moving it on chain would let a
kind be added without a front-end release; nothing in the record shape changes
if that happens, which is why kind_id is a number rather than a string.

### Forward-compatibility rules

1. **Additive only.** New metadata keys are added; existing keys never change
   meaning. A reader that does not recognise a key ignores it, and a reader
   that expects one absent from an older collection treats it as undeclared.
2. **Every harness is archived and content-addressed.** Serving an old harness
   is a permanent obligation.
3. **Version fields are ids where the value comes from a catalogue.** Bytes on
   chain are money (§5).

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

That is the conventional Tezos arrangement, and the same trust every generative platform here already extends. It is bounded by being artist-authorised, revocable at any time, and reproducible after the fact by anyone.

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

`contract/aleatory.py` implements the factory, collection, resolver, router, registry and provider contracts, with tests.

---

## 5. Seeds

The hard part, and the part every platform gets asked about.

**Requirements:** reproducible by anyone from chain state alone; unpredictable enough at mint time that collectors aren't shopping for outcomes; no oracle, no server, no trusted party.

Tezos gives us no block hash in Michelson and no VRF. What a contract can see, `level`, `now`, `sender`, storage counters, is all predictable, so a naive on-chain seed is snipeable: run the generator locally against the seed you know you'll get, mint only when you like the result.

**The seed is the mint operation's hash.** Not derived from it, not hashed
with anything else: the base58 hash string itself is what a renderer receives
as `$alea.seed`.

```
seed = the hash of the operation that minted the piece
```

It is fixed by the buyer's own signature, before anything renders. It is chain
state, so an indexer reads it and anyone can recompute a piece from it with no
trust involved. It is not readable inside Michelson, which is why the binding
happens at the render layer rather than in contract storage.

One seed policy, and no field selecting it. A record with a choice of policies
would let a collection be published under one nobody else implements.

**Never parse it as a number.** A base58 hash read as base 16 is `NaN`, and
`NaN` coerced by an unsigned shift is 0, so every piece in the collection draws
from one identical stream. This has happened here. Seed the PRNG from the
string, as every harness in this repository does.

Honest limitation: the op hash is computable before submission, so a determined
minter can grind counters and fees offline to fish for a seed. It costs effort
and gets worse for the sniper as demand rises. Documented rather than hidden.

**Not doing:** artist-chosen seeds, curated seed lists, or any mechanism where the platform can influence which seed a collector receives. If we can pick, we can be corrupted, and eventually someone will ask.

---

## 6. How a piece is stored, labeled, not policed

Fully on-chain is the goal and is genuinely affordable on Tezos for code-sized payloads. It is not affordable for everything, and pretending otherwise pushes artists into lying about their dependencies.

Storage burn is 0.00025 ꜩ/byte (250 mutez), and a single operation is capped at 32,768 bytes, so large uploads chunk across multiple operations. The studio reads both from the chain at runtime rather than trusting this paragraph.

| Payload | Bytes | Rough burn |
|---|---|---|
| A tight generator | 4 KB | ~1 ꜩ |
| A generous generator | 20 KB | ~5 ꜩ |
| p5 1.5.0, gzipped, bundled into a generator | 215 KB | ~54 ꜩ |

So an artist publishes a generator for a few tez, and bundling a library costs
about 54 ꜩ on top, per collection, every time. That is the number that settles
the library question: on a chain without ETH-scale prices, a library that has
to be paid for again by every artist who uses it is a library nobody uses.

**Libraries are declared, not stored, and nobody is the authority for them.**
A generator carries `<meta name="alea:library" content="p5@1.5.0">`, the
collection records npm coordinates and a blake2b digest under
`aleatory:libraries`, and any renderer fetches those bytes from anywhere and
refuses them unless they hash to the recorded value. See
[ALEATORY-001](interface.md) §1.

Storing libraries on chain was considered and rejected. It would put us in the
position of uploading, funding and vouching for every version of every library,
which is a supply-chain seat nobody should occupy: a bad `three.js` published
by the platform would run in every piece that named it and no artist would ever
look. Anchoring to a public registry's own integrity digest removes us from the
trust path entirely, and the digest is checkable by anyone, forever, with no
reference to us.

Durability comes from the standard being replicable rather than from bytes on
chain. The repository is public domain, the interface is fully specified, and
the hash makes any copy of a library provably the right one, so a fork can
rebuild every part of this without permission.

Every generator carries a class, displayed on the piece:

- **Fully on-chain (FOC).** The generator is in contract storage. Renders from
  L1 alone, forever, with no other system in existence. The default, and every
  template ships this way.
- **IPFS.** The generator is past the operation cap and lives in
  content-addressed storage with its hash on chain. Legitimate for heavy work,
  and honestly labelled as depending on someone continuing to pin it.

A declared library is orthogonal to both: it is a fetch a renderer performs, it
is verified, and it is disclosed on the piece either way.

IPFS pieces get pinned by us and by anyone else who wants to help; the pin set is public so its health is observable. **No option is forbidden. Every one is visible.** An artist choosing IPFS is making an informed tradeoff, and the collector gets to see it before they buy.

---

## 7. The renderer standard

A generator is HTML/JS (or SVG, or WASM) that receives a seed and renders. That's it. The standard's job is to be boring and compatible.

- **Seed delivery** by URL parameter and a global, matching the convention artists' existing code is already written against. Code that ran on other Tezos snippet platforms should run here with near-zero edits. Compatibility is deliberate: we are not asking anyone to rewrite a body of work to prove loyalty.
- **Lifecycle** as defined in §3, one contract across every runtime kind.
- **Parameterized mints**, a project may declare **up to five** named, typed parameters under `aleatory:params`, which the minter sets before signing and which are stored on chain with the token alongside the seed. Determinism holds: (code, seed, params) is still a pure function, which is why the resolution rule is specified rather than left to each implementation. Always optional; most generators declare none. The artist names each one and sets its range, unnamed fixed-arity sliders are the mistake this is deliberately not repeating. Specified in full, as an integration guide for other platforms, in **[params.md](params.md)**.
- **Capture**, the point the piece declares by calling `$alea.ready()`, so an image is taken when the artwork says it is finished.
- **Sandbox**, rendered in a sandboxed frame with no network. Not a policy, an enforcement: the determinism rule is checked mechanically at publish time, and a generator that tries to fetch gets flagged before it ever mints.
- **SVG-on-chain path**, for pieces that emit pure SVG, the whole thing can live in contract storage with no runtime at all. Neighboring work (Bootloader) shows this is a rich vein; there is no reason for the standard to exclude it.

The standard is published as a spec document with a reference implementation and a conformance test suite, versioned as `standard_version`. Another front end must be able to render our pieces correctly without reading our source.

---

## 8. Rescue: nothing stranded

An import path for work marooned by platforms that left or died.

Given a generator's code and its seed convention, re-homing it here is mostly mechanical: wrap the snippet, map the seed parameter, republish under the original artist's address, mint the same edition size or none at all. The interesting cases are the ones where the *original* is at risk, code that only exists behind a service that may stop paying its bills.

Shape of it:

1. **Mirror** (read-only, no chain writes), archive at-risk generator code and metadata from existing platforms into content-addressed storage, publicly. This is worth doing whether or not anyone re-mints. Archives are cheap; regret is not.
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

Brand strings live in one module, so a fork is a one-file change.

**One hard constraint: generator code never renders on the app's own origin.** Artist JavaScript is untrusted, it runs in every visitor's browser, and same-origin would give it reach into wallet state and session storage. Artifacts are served from a separate host in a sandboxed frame, the arrangement fxhash uses, and a DNS decision far cheaper to make before the first piece renders than after.

That host belongs to the provider stack: it is the same harness `netlify/functions/lib/render.mts` uses to capture the image that goes on chain, serving live to a browser instead of headless. It renders a piece that is already minted, addressed by CID. Which host it is, is deployment; that it is a different origin from the app, is architecture.

It is not a sandbox, and calling it one obscured for a while that there was no sandbox: a sandbox is where an artist builds and iterates before minting.

Wallet connection is octez.connect, the Beacon successor.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Seed grinding on the op-hash seed | Documented plainly and accepted; the cost of one signature and no separate mint step |
| On-chain storage costs deter artists | Libraries are declared and verified rather than stored, so a generator stays small enough to go on chain; publish a cost estimator before anyone signs |
| IPFS rot | Public pin set, multiple pinners, class shown on every piece |
| A runtime we didn't anticipate | The `custom` kind takes any engine, and kind ids are append-only, so nothing needs replacing (§3) |
| A field we didn't foresee | Metadata keys are additive; a reader ignores what it does not recognise |
| Nobody uses it | Interop first, pieces trade on objkt/Teia from day one, so an artist risks nothing by trying it |
| Marketplace fee war | We run one, at 2.5%, and pieces trade freely elsewhere regardless, standard FA2 means no venue can be locked out, including ours. |
| The steward disappears | Admin is transferable in two steps; minting keys are cyclable; the renderer is open source and replaceable. |
| Protocol constants change (storage cost, op size) | Constants read at runtime where possible; ⚠-marked in docs; estimator is chain-derived, never hardcoded |

---

## 12. What this deliberately does not do

Every one of these is a decision rather than a gap.

- **No fee on minting.** The price goes to the artist and the render gas to the
  provider, in the mint operation. Secondary trades on our own marketplace take
  2.5%, the way objkt does.
- **No fee to deploy.** The artist's own storage burn is already a real floor
  against spam.
- **No escrow.** A collection holds no funds between operations, so there is
  nothing in it to drain.
- **No collector self-reveal, and no commit-reveal seed.** The seed is the mint
  operation's hash: nobody picks it and nobody can predict it.
- **No moderation on chain.** A blocklist is this front end declining to
  display something. It is never chain state, and it binds nobody else.
- **No claim of neutrality.** We are the spec author, the reference
  implementation, the first provider and the default front end. Saying so
  plainly is worth more than pretending otherwise.

---

## 13. What it costs, measured

Originated on shadownet, 2026-08-25. Protocol constants read live: 250 mutez
per byte, 32,768 bytes per operation.

| | cost | bytes |
|---|---|---|
| Factory origination, once, ours | 4.22 ꜩ | 16,792 |
| Collection deploy, per artist | 3.56 ꜩ | 14,237 |
| Mint, per collector | 0.052 ꜩ | 208 |

The factory carries a copy of the collection template, and that whole
operation is 16,792 bytes against the 32,768 cap.

**The collection deploy is the number to watch.** It is real money charged to
the people this is built for, and it comes almost entirely from the template's
size, which is why the template stays small on purpose.

A mint costs a collector about five hundredths of a tez in burn on top of the
price and the render gas, and it stays flat as an edition grows.


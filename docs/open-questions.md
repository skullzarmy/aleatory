# Open questions — Aleatory

**Status:** live list, 2026-08-01. Decisions not yet made, with a recommendation where there is one. Nothing here blocks v0.

---

## Needs verification before anything is published

These are claims in the other documents that came from a working session, not from a source. Confirm before any of this goes public — the memorial one especially.

- **Piero / EditArt.** Earlier drafts stated that EditArt went dark after the creator's death, and spelled the name **Piero** (a search surfaced "Piero G" / "pifragile"; the working session spelled it "Pierro"). Confirm the correct spelling and how they would want to be referred to before this is published anywhere public. A memorial with a misspelled name is worse than no memorial.
- **fxhash's Tezos status.** Documented here as "center of gravity moved to Ethereum and Base," which is defensible from the public multichain announcements. A stronger claim — that they have left Tezos outright — was not confirmable in a quick search. Keep the softer framing unless there is a citation.
- ~~**Protocol constants.**~~ Resolved 2026-08-01: read live from Shadownet as 250 mutez/byte and 32,768 bytes per operation, matching the documented figures. The v0 estimator derives both from the target chain's RPC at runtime rather than hardcoding them.

---

## ~~The name~~ — resolved 2026-08-02: **Aleatory**

*Aleatory*: composed by chance operations. The word is the art-historical term for exactly this medium — Cage's aleatoric music, Ellsworth Kelly's chance collages — and it carries the meaning that "generative" used to carry before an image model ate it. It says rules plus randomness without saying either.

It met the criteria the search was run against: not "generative"; evokes chance and rule-following; no founder's name and nothing that reads wrong when someone else holds the keys in 2032.

Renamed out of the working name in one pass on 2026-08-02, before anything was published. Everything moved, including the parts that would have been permanent later:

| | |
|---|---|
| namespace, directories, route, package | `aleatory`, `@aleatory/runtime`, `create-aleatory`, `/labs/aleatory` |
| the global artists write against | `$alea` |
| custom-runtime lifecycle export | `window.ALEA_MAIN` |
| frame protocol | `alea:boot`, `alea:ready`, `alea:violation`, `alea:error` |
| on-chain storage keys | `aleatory:code`, `aleatory:record` |
| TZIP-21 metadata keys | `aleaGenerator`, `aleaCodeHash`, `aleaSeedPolicy`, … |

The last three rows are the ones that matter: once a piece is minted on mainnet those strings are immutable, and every published generator embeds `$alea` in its code forever. Doing this before the first mainnet publish cost an afternoon; after it, it would not have been possible at all.

**Still open:** the domain, and a `.tez` name.

---

## Economics

- **Primary fee rate.** Needs to cover indexer hosting and pinning without being a tax on experimentation. Reference points: HEN/Teia sat in the low single digits. Recommendation: pick the smallest number that plausibly covers costs, publish the arithmetic, and revisit annually in public. Never retroactive.
- **Who pays storage burn for a publish?** Default is the artist (it is their code, on chain, forever). Open: whether the treasury subsidizes first-time artists, and whether shared library uploads are always treasury-funded as a public good. Leaning yes on libraries — that is the clearest case of a commons expenditure with compounding return.
- **Secondary royalties.** Standard TZIP-21 royalties, honored by objkt/Teia. We take nothing on secondary. Confirm.
- **Treasury runway.** What does v1 actually cost per month — indexer host, pinning, domain — and how many months of it should be banked before mainnet? Unanswered, and it should be answered before the first real sale, not after.

---

## Governance

- **Multisig composition.** How many, what threshold, and who. Unrelated people across timezones. The specific humans are the hard part and the most important part. Note the contract does not wait on this: admin is a single swappable address ([architecture.md](architecture.md) §4a), so a multisig is adopted by transferring admin to one whenever the people exist.
- **Council → community transition trigger.** Time-based, volume-based, or by vote? Undecided. Bias toward a written trigger set in advance, so it happens on schedule rather than when someone gets tired.
- **Blocklist process.** Intended scope: public, forkable, illegal content and documented plagiarism claims only. The plagiarism process itself is unwritten and is where every platform like this eventually gets hurt. Needs drafting before v1, borrowing from Teia's experience rather than inventing.

---

## Technical

- **Where the JS render runtime lives.** ⬅ **the open decision.** Undecided as of 2026-08-13.

  The backend minter must execute the generator's JavaScript to produce a raster for `displayUri`. p5 and canvas need a real browser engine, so a rasteriser like `@resvg/resvg-js` alone is not enough — that is the one thing that does not transfer from Zolturd, which composes its own SVG and never runs untrusted JS.

  Everything else about the minter is already settled and already in this stack: the chain work, the idempotency handling, and the Pinata pin function all have working precedent. This is the only genuinely new infrastructure in the design.

  | Option | For | Against |
  |---|---|---|
  | **Netlify** background function + `@sparticuz/chromium` | One vendor, same shape as `zolturd-mint.mts`, 15-minute budget is ample | Chromium sits near Lambda's unzipped bundle ceiling before our own code; multi-second cold starts; fails quietly under pressure |
  | **Cloudflare Browser Rendering** | Purpose-built; Cloudflare operates the browsers; no Chromium in our bundle | Second vendor; priced (already checked); leaving Netlify for one job |
  | **Hosted Chrome endpoint** (Browserless or similar) | Function stays on Netlify and just POSTs generator + seed; no Chromium in the bundle; swappable | A third party in the mint path; another bill |

  Stated preference: Netlify, with Cloudflare as the fallback and not loved.

  **Why this is safe to defer.** Because `artifactUri` is composed on chain and the raster is only a thumbnail ([architecture.md](architecture.md) §4a), a wrong or dead choice here costs thumbnails, not artworks. It is reversible, it needs no contract change, and it can be tried on shadownet before it is decided. Nothing else is blocked on it.

- ~~**Who mints, and who may write a token's image URI.**~~ Resolved 2026-08-13: a `minters` whitelist of backend soft wallets, with a swappable two-step administrator holding the whitelist and nothing else. A multisig admin was considered and set aside — admin is just an address, so pointing it at one later is a transfer, not a migration. See [architecture.md](architecture.md) §4a.

- ~~**Math.random attribution.**~~ Resolved 2026-08-02, by deleting the question rather than answering it. Attribution needed stack-frame parsing, which is brittle across engines. Instead: the harness still substitutes the seeded stream (so the run stays reproducible) but no longer reports the call as a violation, and the standalone "seed-bound" check row is gone. The count rides on the ready message and is surfaced in one place — as a likely cause when two runs of one seed actually differ. A cause is only worth reporting when there is a symptom.
- **Default seed policy.** Architecture recommends op-hash (Policy A) as default with commit-reveal (Policy B) available. Alternative: make commit-reveal the default and accept the extra operation. Decide after v0 exercises both — the answer probably depends on how bad the UX of two operations actually feels.
- ~~**Parameterized mints in v1 or later?**~~ Resolved 2026-08-23, earlier than planned: v0 ships them. The deciding argument was that reserving room is not free — `params_schema` was already a field in an immutable record, and leaving it `null` while guessing at its shape risked getting the shape wrong at v1, when it can no longer be changed. Shipped shape: up to five, always optional, artist-named with artist-set ranges, resolution specified so every renderer agrees, and the declaration readable from contract storage so another platform can build a mint UI for our generators without our source. See [params.md](params.md). What is still open is the buy → mint path (§4a): the collector's chosen values have to survive the reservation, and that is not exercised end to end yet.
- **WASM generators.** Determinism across engines is not free (floating point, threading). Worth supporting eventually; needs a conformance answer first.
- **Multi-deployment identity.** If the same generator exists on L1 and on a rollup, is that one work or two? Affects seed derivation and provenance display. Must be answered before v1 contracts are immutable, even though v2 is only a position ([roadmap.md](roadmap.md) §3).
- **Rescue mirror legality/etiquette.** Archiving public generator code from other platforms is defensible, but the artist relationship matters more than the legal question. Opt-out on request, at minimum. Ask a few artists before shipping it.

---

## Community

- **Who else is in this?** One person cannot hold this alone. Finding two or three more people who want to hold keys is not a v1 task, it is the v0 task that everything else depends on.
- **Where does it talk?** hack.tez already runs chat infrastructure and is exploring federated Matrix ([tezocean-matrix-spec.md](../tezocean-matrix-spec.md)). Reuse or separate, undecided.
- **Launch artists.** A handful of people whose work would define what the place is for. Not curation — the first pieces set the tone whether or not anyone plans it.

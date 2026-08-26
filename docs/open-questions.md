# Open questions, Aleatory

**Status:** live list, 2026-08-01. Decisions not yet made, with a recommendation where there is one. Nothing here blocks v0.

---

## Needs verification before anything is published

These are claims in the other documents that came from a working session, not from a source. Confirm before any of this goes public, the memorial one especially.

- **Piero / EditArt.** Earlier drafts stated that EditArt went dark after the creator's death, and spelled the name **Piero** (a search surfaced "Piero G" / "pifragile"; the working session spelled it "Pierro"). Confirm the correct spelling and how they would want to be referred to before this is published anywhere public. A memorial with a misspelled name is worse than no memorial.
- **fxhash's Tezos status.** Documented here as "center of gravity moved to Ethereum and Base," which is defensible from the public multichain announcements. A stronger claim, that they have left Tezos outright, was not confirmable in a quick search. Keep the softer framing unless there is a citation.
- ~~**Protocol constants.**~~ Resolved 2026-08-01: read live from Shadownet as 250 mutez/byte and 32,768 bytes per operation, matching the documented figures. The v0 estimator derives both from the target chain's RPC at runtime rather than hardcoding them.

---

## ~~The name~~, resolved 2026-08-02: **Aleatory**

*Aleatory*: composed by chance operations. The word is the art-historical term for exactly this medium, Cage's aleatoric music, Ellsworth Kelly's chance collages, and it carries the meaning that "generative" used to carry before an image model ate it. It says rules plus randomness without saying either.

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

- ~~**Primary fee rate.**~~ Resolved 2026-08-23: **there is no fee on sales.** Not on primary, not on secondary, not on deploys, not on provider registration. Income is the render service, compute and pinning sold to people who would otherwise run both themselves, which is a real recurring cost rather than a toll on other people's work. See [decisions.md](decisions.md) §10.
- **Who pays storage burn for a publish?** The artist, and it is charged to their wallet directly by the protocol, we never front it. **Settled 2026-08-26:** libraries are never uploaded on chain, so there is nothing to fund. They are declared, fetched from a public registry, and verified against a hash recorded with the piece, which keeps the platform out of the supply chain and off the hook for hosting. See [architecture.md](architecture.md) §6.
- ~~**Secondary royalties.**~~ Resolved 2026-08-23. We take nothing on secondary. Royalties follow the **objkt convention**, *not* TZIP-21, which defines no royalties field at all, and live in the token's metadata JSON, built off chain like every other Tezos NFT. An earlier draft had the contract composing them; that went away with the rest of the on-chain metadata. An optional platform share exists as an explicit, unchecked, absent-by-default ask; because royalties are immutable, that choice is permanent for the collection.
- **Treasury runway.** What does v1 actually cost per month, indexer host, pinning, domain, and how many months of it should be banked before mainnet? Unanswered, and it should be answered before the first real sale, not after.

---

## Governance

- **Multisig composition.** How many, what threshold, and who. Unrelated people across timezones. The specific humans are the hard part and the most important part. Note the contract does not wait on this: admin is a single swappable address ([architecture.md](architecture.md) §4a), so a multisig is adopted by transferring admin to one whenever the people exist.
- **Council → community transition trigger.** Time-based, volume-based, or by vote? Undecided. Bias toward a written trigger set in advance, so it happens on schedule rather than when someone gets tired.
- **Blocklist process.** Intended scope: public, forkable, illegal content and documented plagiarism claims only. The plagiarism process itself is unwritten and is where every platform like this eventually gets hurt. Needs drafting before v1, borrowing from Teia's experience rather than inventing.

---

## Technical

- ~~**Where the JS render runtime lives.**~~ Resolved 2026-08-23: **Cloudflare Browser Rendering, behind a Netlify function.** The worker is stateless, code, seed and params in, image bytes out, with no chain access, no wallet key, no pinning credentials and no database, so a compromised worker leaks nothing and moving to another vendor is a one-URL change. Netlify keeps the privileged side: pinning, keys, queue.

  This also stopped being a single decision. Rendering is a *provider* role now, and anyone can run one ([decisions.md](decisions.md) §7), so the question is only where *our* provider runs, not where rendering happens for everyone.

- ~~**Who mints, and who may write a token's image URI.**~~ Resolved 2026-08-23, and the two halves separated. **Minting** is the collector, in their own `mint` operation. **Publishing the metadata** is an authorised render provider through `set_token_metadata`, which replaces one token's metadata pointer, once. A multisig admin was considered and set aside, admin is just an address, so pointing it at one later is a transfer, not a migration. See [decisions.md](decisions.md).

- ~~**Math.random attribution.**~~ Resolved 2026-08-02, by deleting the question rather than answering it. Attribution needed stack-frame parsing, which is brittle across engines. Instead: the harness still substitutes the seeded stream (so the run stays reproducible) but no longer reports the call as a violation, and the standalone "seed-bound" check row is gone. The count rides on the ready message and is surfaced in one place, as a likely cause when two runs of one seed actually differ. A cause is only worth reporting when there is a symptom.
- ~~**Default seed policy.**~~ Resolved 2026-08-23: the operation hash is always the seed. Commit-reveal is not offered, because it needs a second collector signature and a mint separate from the payment, and `mint` now does both at once. The grinding weakness is accepted and documented rather than engineered around.
- ~~**Parameterized mints in v1 or later?**~~ Resolved 2026-08-23, earlier than planned: v0 ships them. The deciding argument was that reserving room is not free, `params_schema` was already a field in an immutable record, and leaving it `null` while guessing at its shape risked getting the shape wrong at v1, when it can no longer be changed. Shipped shape: up to five, always optional, artist-named with artist-set ranges, resolution specified so every renderer agrees, and the declaration readable from contract storage so another platform can build a mint UI for our generators without our source. See [params.md](params.md). What is still open is exercising it end to end on a testnet: `mint` writes the collector's resolved values into the token in their own operation, so there is no handoff to survive, but the path has not been run.
- **WASM generators.** Determinism across engines is not free (floating point, threading). Worth supporting eventually; needs a conformance answer first.
- ~~**Multi-deployment identity.**~~ Resolved 2026-08-23: **two works.** One contract, one chain, one edition. Sharing supply across chains needs bridging and cross-chain messaging, which is not something to put in a contract that can never be fixed. UI filters can show that an artist has an edition elsewhere without coupling the contracts. Copyminting is neither detected nor expected; a policy against it belongs in front-end and community rules, never chain state.

  Left open deliberately: because a piece is code plus a seed plus params, the same work *is* reproducible on another chain by construction. A multichain-mint conversation with Teia and objkt becomes worth having once there are artists and a working standard to point at.
- **Rescue mirror legality/etiquette.** Archiving public generator code from other platforms is defensible, but the artist relationship matters more than the legal question. Opt-out on request, at minimum. Ask a few artists before shipping it.

---

## Community

- **Who else is in this?** One person cannot hold this alone. Finding two or three more people who want to hold keys is not a v1 task, it is the v0 task that everything else depends on.
- **Where does it talk?** hack.tez already runs chat infrastructure and is exploring federated Matrix ([tezocean-matrix-spec.md](../tezocean-matrix-spec.md)). Reuse or separate, undecided.
- **Launch artists.** A handful of people whose work would define what the place is for. Not curation, the first pieces set the tone whether or not anyone plans it.

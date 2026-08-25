# Roadmap, Aleatory

**Status:** draft, 2026-08-01.

Three versions. v0 is a lab in hack.tez and ships with no infrastructure. v1 is the protocol leaving home. v2 is Tezos X and the multi-runtime bet. Each one is useful on its own; none of them assumes the next one happens.

The artist-facing surface of all three, template, sandbox, mint pipeline, market, is specified in [pipeline.md](pipeline.md).

---

## 1. v0, the lab (pupation)

Lives at `/labs/<slug>` in hack.tez. Follows the existing lab pattern: a markdown entry in `src/labs/`, a page in `src/pages/labs/`, registered in `App.tsx`. Static, no backend, no mainnet contracts, no money.

The goal of v0 is **not** a marketplace. It is to make the core loop real and to find out what's wrong with the architecture before anything is immutable.

**Ships:**

1. ✅ **Generator sandbox**, four runtime kinds (Canvas 2D, SVG, p5, custom), templates that also run by being opened from disk, .html/.zip import with local files flattened in, and a 16-seed grid. The thing every artist actually does all day.
2. ✅ **Declared mint-time parameters**, up to five, always optional, named and ranged by the artist rather than five unlabelled sliders imposed on every project. The declaration is published with the generator and readable from contract storage on its own, so a mint UI can be built for an Aleatory generator by a platform that has never seen our front end; the values a minter picks are written to their token beside the seed. Specified in [params.md](params.md).
3. ✅ **Determinism check**, mechanical enforcement of the determinism rule: the same seed run twice in two fresh sealed frames and compared by capture digest, network access blocked by CSP *and* by API override and reported either way, `Math.random` substituted and reported, capture point verified. Verified to catch a deliberately non-conforming piece, not just to pass a good one.
4. ✅ **Cost estimator**, byte count priced against `cost_per_byte` and `max_operation_data_length` read live from the target chain's RPC, with the storage class derived and displayed. Publishing is blocked when the payload exceeds one operation, since v0 does not chunk.
5. ✅ **Testnet publish + mint**, Shadownet and Tezos X previewnet. Origination writes the generator record and the code into contract metadata; each mint is one batched `create_token` + `mint_tokens` whose operation hash is the seed source. Policy A only; commit-reveal (Policy B) is v1.
   ⬜ *Untested end to end*, the publish and mint paths need a funded testnet wallet, which is the first thing to do with this.
6. ⬜ **Rescue mirror (read-only)**, point at an existing generative token from another Tezos platform, pull the code and metadata, archive to content-addressed storage. No claiming, no minting, no chain writes. Just: the code is safe now. **Not built yet, and it is the piece with a clock on it**, archives get more valuable and harder to make as time passes.

Also shipped, and worth more than it sounds: **a gallery that rebuilds a generator entirely from chain state**, code out of contract storage, seed derived from each mint's operation hash, no indexer of ours and no saved images. Rebuild-from-chain as a working feature rather than a promise, at v0 scale.

**Explicitly not in v0:** mainnet, real sales, a treasury, governance, curation, social features, a name.

**Cost:** ~$0. Reuses hack.tez's wallet stack, hosting, and lab chrome. Testnet tez is free.

**Exit criteria into v1:** the contracts have survived a rewrite (they will need one), the renderer standard has a conformance suite, at least a handful of artists have published on testnet and told us what's broken, and the resurrection kit exists in draft.

---

## 2. v1, the protocol leaves home

Mainnet contracts, own domain, own repo. This is the version that has to be right, because mainnet contracts are immutable, most of it can never be changed.

**Ships:**

- Registry, Editions (FA2), Deps, and Mint on mainnet. Verified builds, published deploy scripts.
- Open indexer with published snapshots, public read API.
- Static front end on its own domain, mirrored, with brand strings isolated to one module.
- Pieces indexed by objkt and Teia on day one, this is a consequence of using standard FA2 + TZIP-21, not an integration project.
- Renderer standard published as a versioned spec with a conformance suite.
- **Resurrection kit**, and the first quarterly rebuild drill run by someone who didn't build it, with results published.
- Multisig live across unrelated holders; treasury policy published; bus-factor page live.
- Rescue claim flow: original artists prove control and re-home their own work.

**The transition out of hack.tez** is a planned exit, not a fork: the labs entry becomes a pointer to the new home, the shared wallet/lib code gets vendored into the new repo, and hack.tez names keep working as artist identity. See §4 below.

**Open at v1:** fee rate, governance structure, and the name. Tracked in [open-questions.md](open-questions.md).

---

## 3. v2, Tezos X and the multi-runtime bet

Tezos X puts the EVM and Michelson interfaces on **one chain with native atomic composability**. Previewnet is live and experimental; no mainnet date. hack.tez already has working Tezos X tooling, address-square derivation, resolution semantics, a testnet FA2 deployer, so we are not starting from zero here. See [xray-vision.md](../xray-vision.md) and the `tezos-x` skill.

Three things this unlocks that are worth positioning for now.

**1. Rollup storage economics make sealed art normal.**
The reason fully-on-chain generative art stays a niche is that L1 storage burn caps how much code you can afford to seal in. Rollup storage is dramatically cheaper. If FOC becomes the affordable default rather than the expensive virtue, "the artwork is permanently on chain" stops being a premium feature and becomes the baseline, with the L1 anchoring the hashes for settlement-grade permanence. That is a genuinely different product, and it is the single strongest reason to care about Tezos X for this project specifically.

**2. Generators readable from both interfaces.**
A Michelson-side registry whose views are callable from Solidity through the NAC gateway means an EVM marketplace, an EVM curation contract, or an EVM aggregator can read our generators natively, one deployment, two ecosystems, no bridge and no wrapped-token theater. Nobody has built a generative art protocol that is natively legible from both sides of one chain. That is the flag worth planting.

**3. EVM exposure without leaving Tezos.**
The artists are here. The larger art market's tooling, wallets, and buyers are in EVM land. Tezos X is the first arrangement where serving both does not mean picking one, deploying twice, or splitting a community across chains. Mint Tezos-native, sell to whoever shows up.

**Design constraint to adopt now, at v0:** write the protocol **rollup-agnostic**. No assumption of a single deployment, no hardcoded chain IDs or rollup addresses (they change on every previewnet reset), and identity/seed derivation that is well-defined when the same generator exists on more than one execution environment. The cost of this discipline in v0 is nearly zero. The cost of retrofitting it after mainnet contracts are immutable is a migration.

**Honest status:** Tezos X is previewnet, experimental, resets without warning, and has no mainnet date. v2 is a *position*, not a plan with dates. v0 and v1 must be fully valuable if v2 never happens.

---

## 4. Keeping the transition cheap

The project is born in someone else's repo and has to leave cleanly. Rules to follow from the first commit:

- **Namespace everything** under `aleatory`, directories, contract names, storage keys, API routes, CSS classes. Done: the working name was renamed out in one pass on 2026-08-02, which is the whole reason it cost an afternoon rather than a migration.
- **Brand strings in one module.** No project name hardcoded in components, meta tags, or contract metadata templates.
- **No hack.tez-only dependencies in the protocol layer.** The lab UI may use hack.tez chrome freely; the contracts, renderer standard, indexer, and CLI must not. If it can't be lifted out on its own, it's in the wrong layer.
- **These docs are the handoff.** They live in `docs/aleatory/` as a self-contained set and move to the new repo's `docs/` unchanged. Anything a newcomer needs in order to pick this up belongs here, not in a chat log.
- **Contract addresses, endpoints, and constants in config, never in source.**

---

## 5. Sequencing summary

| | v0 lab | v1 protocol | v2 Tezos X |
|---|---|---|---|
| Chain | Shadownet / previewnet | Mainnet | + Tezos X |
| Money | None | Real, small fees | Same |
| Governance | Steward | Council + multisig | Community |
| Infra cost | ~$0 | Indexer + pinning | + second deployment |
| Front end | hack.tez lab | Own domain, mirrored | Same |
| Can it die safely? | Yes, nothing at stake | No, real money at stake | No |

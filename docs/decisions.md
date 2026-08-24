# Decision record — Aleatory

**Status:** settled, 2026-08-23. This is the model to build. Where it disagrees with [architecture.md](architecture.md), this document wins until that one is rewritten.

It supersedes two earlier models: a single shared contract holding every generator, and a backend-mints-after-render flow with escrowed reservations. Both are gone.

---

## 1. The shape

| Contract | Owns | Controlled by |
|---|---|---|
| **Factory** | The collection template and a registry of what it deployed | Us. Two-step admin, plus `admin_lambda`. |
| **Collection** | One generator, one edition, its tokens | The artist, from origination. |
| **Resolver** | Our backend keys | Us. One flip rotates a leaked key everywhere. |
| **Provider** | One renderer's price and endpoint | Whoever runs it. |
| **Registry** | The list of providers | Nobody — permissionless, no fee. |

**The factory holds no tokens.** That is what makes `admin_lambda` safe there: it transforms factory storage, and there is nothing of anyone else's in it.

**The collection has no escape hatch.** No lambda, no upgrade path, no authority retained by us. A bug in the template is frozen into every collection already deployed. That is the price of the guarantee, and the reason the template stays boring and gets audited before mainnet.

---

## 2. Deploy

One operation. The artist calls `deploy` with the fee; the factory originates the collection in that same operation with the artist already installed as administrator **in the initial storage**. Nothing is held by us and handed over, and there is no second signature.

Storage burn and gas are charged to the operation's source — the artist's wallet — as Tezos charges all storage to the payer, including for internal originations. We front nothing.

The template is compiled once and lives as Michelson inside the factory. Every collection is byte-identical code; only storage differs. There is no build server, no key custody, and anyone can verify a collection is the real template by comparing code hashes. Changing the template means deploying a new factory — old collections are untouched and nothing migrates.

**There is no deploy fee.** It is zero, and the artist's own origination burn and gas are the only cost of deploying — which is already a real floor against spam without us charging for anything. `deploy_price` exists as an admin-settable field starting at 0 so an anti-spam lever is possible later without a new factory; any change to it would be visible on chain. Income is the render service.

Set at deploy and immutable thereafter: `code_uri`, `code_hash`, `params_schema`, royalties, token name, placeholder image.

---

## 3. Sale — `buy`

One signature. Pays `price + render_gas`, split in that same operation: price to the artist, render gas to the provider. The contract's balance is zero when it returns — nothing to drain, no withdraw entrypoint.

**The token is minted here, in the collector's own operation.** It exists, is owned, and is tradeable the moment `buy` returns, carrying the collection's "not revealed yet" metadata document until a provider publishes the piece's own.

An unrevealed piece is a real token, not a promise of one. That is why there is nothing to strand, nothing to refund, and nothing a failed provider can take away.

What the artwork *is* does not depend on that metadata: the code is immutable in contract storage, the seed is the buy operation's hash, and the parameters are in that operation. Metadata is where a marketplace reads *about* a piece, not where the piece is defined.

**The seed is the hash of this operation.** Always — commit-reveal is not offered. Since `buy` both pays and mints, the binding needs no extra record: a token's seed derives from the hash of the operation that created it.

This does not make grinding expensive. The operation hash covers sender-controlled fields, so candidates are enumerated offline and only the chosen one is injected — one payment, arbitrarily many attempts. Documented, accepted, not hidden.

**Parameters** are chosen by the collector, resolved per [params.md](params.md) §3, and written into the token by `buy` itself. Their own signature commits what they chose; nobody can alter it afterwards.

---

## 4. Reveal — `set_token_metadata`

An authorised writer publishes one token's metadata URI, once, replacing the collection's pending document.

**This follows the ordinary Tezos arrangement rather than inventing one.** `token_info[""]` holds an `ipfs://` pointer to a JSON document carrying name, `artifactUri`, `displayUri`, royalties and attributes — the same shape objkt, Teia and fxhash all use. Nothing is composed on chain.

The consequence, stated plainly: a provider writes a token's **whole** metadata, not two fields of it. That is a real grant of trust, and it is the same one every platform doing generative art on Tezos already makes — there is no way to produce a rendered image without executing the artwork, and no way to publish one without saying where it lives.

What bounds it: once per token, only by someone the artist authorised, and never for a token whose metadata is already published. Write-once — a second attempt fails.

Authorised means the collection's provider, an address the artist authorised directly, or one the resolver vouches for. The resolver is consulted through a view that may fail — if it is gone or broken the call falls through to the local set rather than reverting, so a dead resolver cannot freeze every collection that trusted it.

**Collectors cannot self-reveal.** Pinning requires an account, and the only two ways to give collectors that are lending them ours or asking every buyer to configure their own IPFS provider. Neither is acceptable, so only providers write images — which also means an artist's grid is protected by default, with no flag needed.

Publishing metadata that does not match the piece is possible and not preventable on chain. It is detectable by anyone: the seed comes from the mint operation, the parameters are in that same operation, and the code is immutable, so the correct output is reproducible. Detection and key rotation, not a guarantee we cannot make.

**The artist can sever our access entirely.** `trust_resolver` starts on, so our provider works out of the box, and `set_trust_resolver(false)` removes the resolver as an authorisation path — otherwise an artist who moved to a rival provider would still leave us able to publish into their collection forever.

---

## 5. Artist controls

Established Tezos NFT behaviour. The artist controls supply; the collector controls what they hold; nothing crosses that line.

| | |
|---|---|
| Pause / unpause the sale | Any time. Never affects transfers — a paused collection still trades on secondary. |
| Start paused | Chosen at deploy, so a collection can be deployed, checked, announced, then opened. |
| Change price | Any time, for future mints only. Never retroactive. |
| Reduce the edition | Any time. Never below what is already minted. |
| Increase the edition | **Never.** No entrypoint exists. |
| Close the edition | Set edition size to the number already minted. This replaces a separate `retire`. |
| Switch provider | Any time. |
| Hand over the collection | Two-step propose/accept. |
| Touch a collector's token | Never. No entrypoint exists. |

Open editions are `edition_size = 0`. Open → finite is a valid reduction provided the new size is at or above what is minted. Finite → open is never allowed.

Reductions and price changes emit events, so a cut from 100 to 50 is visible rather than silent.

---

## 6. Royalties

The objkt convention — **not** TZIP-21, which defines no royalties field at all. objkt and Teia read `{"decimals": n, "shares": {address: value}}` where each share is an **absolute** fraction of the sale price.

Royalties live in the token's metadata JSON, like everything else, and are built off chain by whoever pins that document. **The contract does not compose or validate them.**

An earlier draft had the contract composing the JSON so a client could never mis-encode it. That was abandoned once the metadata moved to a CID — and it was never as cheap as it sounded, because rendering a recipient as `tz1…` text requires base58check encoding, which Michelson has no instruction for.

**The UI still works in relative terms** because that is how people think: a total percentage, then recipients splitting it. 25% total, two wallets at 50% each becomes `decimals: 4` with shares `1250` and `1250`. Getting that conversion backwards pays out wrong forever, so the deploy preview shows the decoded result the way objkt will read it — "tz1abc… receives 12.5% of each sale" — before anything is signed.

Conventions kept in the UI rather than the contract: total at most 25%, shares summing to 100%, remainder to the first recipient.

**The platform share** is a recipient row that starts absent. An explicit, unchecked ask above the royalty settings — never pre-added. Its copy must say what is true: the split is permanent for every piece this collection will ever mint, and there is no later removal.

---

## 7. Providers

**A provider is any contract exposing a `get_render_gas` view.** That view is the entire membership test. Deploying one is how you join; there is no application, no allowlist, and no fee.

The artist picks a provider at deploy and can switch any time. The price is **snapshotted** when they pick — `buy` never calls out to the provider's contract, because a sale must not depend on a contract we cannot audit, and a price change mid-block would fail the amount check.

Providers are paid at `buy`, before delivering. If one takes fees and stops rendering, the artist switches and stops paying them; the backlog is already paid to the wrong party and is the artist's to settle. Bounded, because a stuck piece is missing a thumbnail, not an artwork.

**We only ever pin what our own renderer produced.** Never client-submitted bytes, regardless of who is asking or what they signed — verifying someone else's image costs the same as rendering it ourselves, and accepting arbitrary bytes makes us a host for arbitrary content.

---

## 8. Discovery

The chain is the authoritative work queue. Any push notification is a latency optimisation, never the mechanism.

- **Which collections a provider serves** — `set_provider` events naming their address.
- **Which pieces need rendering** — `buy` events, plus a sweep for pieces whose `token_info[""]` still equals the collection's pending document. That rule covers backlogs, restarts, and collections inherited from another provider, with no state of the provider's own.
- **Where to push** — the provider's TZIP-16 contract metadata, not storage. URLs rot; metadata is free to update and a provider who advertises nothing still works by polling.

This works identically for collections our factory did not deploy. Anything emitting those two events and honouring the placeholder rule is servable by any provider, which is the openness actually paying off: the standard is events and a view, not our contracts.

---

## 9. Ranking providers

Every trust signal an artist needs is derivable from events we already index: pieces delivered, median reveal time as a block delta from `buy` to `set_token_metadata`, failure rate from pieces still holding the pending document past a window, time in service.

Precomputed hourly into a small JSON so the UI loads instantly, with a TzKT fallback for when our API is down. Same numbers, slower.

**The algorithm is open source and fully commented**, the window and method are stated beside the sort control, and our own row is marked as ours. We do not pin ourselves to the top. Anyone can recompute the ranking and rank us lower.

We still choose the default ordering, and default ordering is power. Say so in the docs.

---

## 10. Money

| | |
|---|---|
| Deploy | Nothing. The artist pays their own origination burn and gas, as they would anywhere. |
| Mint | Price to the artist, render gas to the provider. We take nothing. |
| Secondary | Nothing. |
| Provider registration | Nothing. |
| Our income | Render and pinning, sold to people who would otherwise run both themselves. |

We are not in the mandatory path of any mint. Anyone can run a provider, a factory, or an entire front end without our permission and owes us nothing for it.

---

## 11. Names and identity

Token names are `[collection name] #[n]`, written into each piece's metadata JSON by whoever publishes it. `token_id` is 0-based; the displayed number is `token_id + 1`, so the first mint is token 0 named "Collection #1". This is the convention everywhere and objkt expects it.

An earlier draft composed names on chain, which needed a nat-to-decimal helper since Michelson has no `NAT_TO_STRING`. Gone with the rest of the on-chain metadata.

**Each deployment is its own work.** The same generator on L1 and on a rollup is two pieces, not one — sharing supply across chains needs bridging, and that is not something to put in an immutable contract. Copyminting is not detected or expected; a stated policy against it belongs in front-end and community rules, never chain state.

Worth leaving the door open for: because a piece is code plus a seed plus params, the same work *is* reproducible on another chain by construction. A multichain-mint conversation with Teia and objkt becomes real once there are artists and a working standard to point at.

---

## 12. What we deliberately do not do

- No collector self-reveal.
- No escrow, and the collection holds no funds between operations.
- No commit-reveal seed.
- No cross-chain supply.
- No fee on mints or secondary.
- No moderation on chain — a blocklist is our front end declining to display something, never chain state.
- No claim of neutrality. We are the spec author, the reference implementation, the first provider, and the default front end. Say it plainly.

---

## 13. Still open

- **A number for `deploy_price`** — resolved 2026-08-23: zero.
- **Renderer hardening** — network blocked before the first byte, frozen clock, bundled fonts only, hard kill, server-side hashing. Tracked as work, not as an open question.
- **objkt royalty verification** on testnet before any mainnet collection exists.
- **Template audit** before mainnet. The single largest remaining risk.

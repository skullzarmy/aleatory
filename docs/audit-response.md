# Response to the security audit

Against [third-party-audit.md](../third-party-audit.md), which reviewed `main` at
`77c1af7` on 2026-08-25.

The audit's central observation is the one worth repeating: **the comments
described controls the code did not implement.** That is the pattern behind
most of what follows, and it is worse than a missing control, because a
docstring asserting a safety property stops the next reader from checking.

---

## The caveat the audit could not resolve

`AleatoryCollection` inherits `main.Nft` from `fa2_lib`, and the audit could
not compile to check whether that base class contributes a `mint` entrypoint.
It does not. The deployed collection on shadownet exposes thirteen
entrypoints:

```
accept_admin, balance_of, buy, propose_admin, set_edition_size,
set_local_writer, set_paused, set_price, set_provider,
set_token_metadata, set_trust_resolver, transfer, update_operators
```

That list is the contract deployed at the time of the audit. The entrypoint
shown there as `buy` has since been renamed `mint`, which is what it does and
what the rest of the ecosystem calls it; the rename lands with the redeploy
below. Either way there is one token-creating path and no second one, so
edition size, payment and the seed binding cannot be bypassed.

---

## Fixed

**C1, arbitrary JS on the app origin.** The copy of the shell under `public/`
is gone, along with the rewrite that served it. The provider's render host is
a separate Netlify site on its own domain. The shell now refuses anything but
`ipfs://<cid>`, validates the CID shape, and refuses to run at all unless it
is framed.

**C2, SSRF through `code_uri`.** The provider accepts `ipfs://` with a CID
shape and resolves it against its own gateway. Response size is capped and
every outbound fetch has a timeout.

**C3, the work queue trusting event payloads.** Candidates still come from
events, and every one is now confirmed against the emitting contract's own
storage before any work is done. Storage is the authority; an event is a hint
about where to look. Collections are additionally restricted to trusted
factories, set explicitly rather than defaulted.

**H1, unauthenticated and not idempotent.** The ping path requires a shared
secret compared in constant time; the cron is identified by Netlify. Claims
are held in Netlify Blobs with a TTL, so two invocations do not both render
the same piece. One toolkit and signer per invocation, with each confirmation
awaited, so the agent's counter is not read concurrently.

**H2, the served render-host CSP.** The provider's render host serves
`connect-src 'none'` with no `https:` in `script-src`, matching what the source always described.
The render worker prepends the same policy to the document, since request
interception covers HTTP and misses WebSocket and WebRTC.

**H3, collections born trusting the resolver.** `trust_resolver` is a deploy
parameter and it is off unless an artist asks for it.

**H4, listings from arbitrary contracts.** Fixed at the display layer, and
deliberately not at the contract layer. See below.

**H5, no security headers.** The application origin now sends a CSP naming the
provider's render host as the only frame source, plus `nosniff`, a referrer
policy, HSTS and a permissions policy. Metadata URIs are validated as `ipfs://` with a CID
shape before they reach an `img` tag, so a hostile `displayUri` cannot make a
visitor's browser call an arbitrary host.

**M1, worker auth and limits.** Refuses to run without a token rather than
comparing against `"Bearer undefined"`, compares in constant time, caps the
body, and races the browser launch against a timeout so a hung launch fails
instead of leaving nothing for the kill timer to close.

**M2, render isolation.** The document-level CSP is the control now, and the
docs say the JavaScript overrides are reporting.

**M3, a reverting royalty recipient.** Royalties are credited to a balance and
paid by `claim_royalties`. A recipient that cannot receive tez affects only
its own claim.

Both suites cover the change: the marketplace holds fee plus credited
royalties after a sale, `claim_royalties` is callable by anyone and pays the
recipient, a second claim against a drained balance fails, and the balance
reaches zero once every party has pulled. The integration suite asserts the
same across the contract boundary on both the listing and the offer path,
including the hostile collection that asks for 100% and is credited the 25%
cap.

**M4, the unpinned CDN dependency.** `DepSpec` carries `expectedHash` and
`resolveDep` refuses a mismatch. The p5 hash is still empty and has to be
filled from a known-good copy before any mainnet publish.

**M5, undeclared dependencies.** `blakejs` and `fflate` are direct
dependencies.

**M6, undeletable registry entries.** `register` requires `get_operator` too,
so an entry that could never be removed cannot be created.

**M7, collapsed deploy defaults.** The deploy refuses when the admin or agent
address is unset, and refuses when they are the same address. The fallback
storage limit is a measured ceiling rather than the protocol maximum.

**M8, unvalidated price input.** `parseTez` parses once and rejects anything
that is not a sane positive amount; the preview and the operation read the
same number. Offers above a threshold ask for confirmation before escrowing.

**M9, internal errors returned to callers.** The response carries counts and a
correlation id. Error text goes to the logs.

**M10, the marketplace constructor.** `__init__` applies the same fee ceiling
`set_fee` does.

**L1, L2, L3, L4, L7, L8, L10.** The invalid `X-Frame-Options` is gone.
Addresses are validated where route params reach path building. The unused
`next/image` allowlist is removed. Hex decoding rejects malformed input.
Roughly 3,000 lines of dead and drifted code are deleted, including the second
harness implementation, so there is one. The gateway is configurable.

**L5, silent pagination loss.** Token scanning paginates, and the buy lookup
queries the specific token rather than scanning a window.

**L6, mutez precision.** Chain amounts are `bigint` end to end. Formatting
works from the integer rather than dividing, so a large amount keeps every
digit it arrived with, and parsing goes through the decimal string so `0.1`
does not arrive as `99999.99999999999`.

**L9, determinism.** The claim is corrected rather than enforced. The harness
replaces `Math.random` and freezes the clock, and the CSP blocks the network,
which is what makes a render reproducible in practice. Artist code runs after
the harness and can reach a fresh realm to recover both, so a piece that
insists on varying will vary.

A provider renders once and that render is the piece. Testing a generator,
including on shadownet against the provider they intend to use, is the
artist's job, and the docs say that plainly rather than implying the platform
checks it for them.

**L11, `admin_lambda` and fee withdrawal.** `withdraw_fees` never sends more
than the contract holds, so an inflated `fees_accrued` cannot brick it.

**M8's adjacent note, params never reaching the mint.** The mint panel renders
a control per declared parameter, resolves the values through `params.ts`, and
sends the canonical encoding with the mint. Every piece minted before this
carried an empty document.

---

## Two findings answered by decision rather than by code

Both of these were built the way the audit recommended, and both were then
changed on the owner's instruction. Recording the direction and the reasoning,
because a reviewer looking at the code will otherwise read the audit's
recommendation and find something different.

### H4, at the contract level: deliberately not gated

I first added a trusted-factory allowlist to the marketplace, so `list_token`
and `make_offer` would ask a factory whether it had originated the collection
before accepting either.

**That was removed on instruction.** The direction, in the owner's words: show
everything unless it is blocklisted, blocklist rather than allowlist, and that
is website only. The contracts are not controlled, and anyone can publish and
run the whole system on their own.

So the marketplace contract gates nothing. Anyone can list any FA2, including
one that accepts a transfer and drops it. What ships instead is
`src/lib/blocklist.ts`, two empty sets applied to what this front end
displays, with the same treatment for providers. Hiding an entry changes
nothing on chain: the collection still trades, the provider still works for
every collection naming it, and a fork that disagrees deletes the file.

The residual risk is unchanged from the audit's description: a buyer who finds
a listing outside this site, or who calls the contract directly, can pay for a
token that never moves. That is a consequence of a permissionless market, it
is accepted knowingly, and the marketplace is one venue among several for
standard FA2 tokens.

The factory's `is_collection` view stayed. It asserts nothing and gates
nothing, and it lets anyone build the check for themselves.

### L9, determinism: one render, no refusal

I first had the provider render every piece twice and refuse to publish one
whose two renders disagreed.

**That was removed on instruction.** The direction: render once, the artist
gets that render, and it is the artist's job to test properly, including on
shadownet against the provider they intend to use.

So the harness and the CSP are what make a render reproducible, and neither
can stop artist code that runs afterwards from reaching a fresh realm and
recovering an unpatched `Math.random`. The docs say this plainly in the
README, the interface spec, and here. A provider renders once and that render
is the piece.

---

## Still to do before mainnet

- Fill `expectedHash` for p5 from a known-good copy.
- Verify whether the shadownet deployment took the collapsed-key path, and
  rotate if so. `deploy.ts` now refuses to run without both addresses set and
  refuses when they match, so it cannot recur.
- Redeploy the contracts carrying H3, M3, M6, M10, the factory's
  `is_collection` view, and the `buy` to `mint` rename. The addresses in
  `contract/deployments/shadownet.json` predate all of it. The rename changes
  the entrypoint and the event tag, so the front end and the provider queue
  only match the new contracts, not the deployed ones.
- `npm audit` with the lockfile, now that the two hidden dependencies are
  declared.

---

## Where the provider ranking actually stands

The audit did not raise this and it is worth stating, because I described the
ranking as finished when two of its four figures were stubs returning `null`
and `0`.

All four are computed now, each from something a provider does by working, so
none of it is a claim a provider makes about itself:

- **delivered**, its agent's applied `set_token_metadata` calls in the window
- **median blocks from mint to publish**, each publish paired with the `mint`
  event that asked for it, over a fifty-publish sample
- **outstanding**, pieces in collections whose storage names it that still
  carry the pending document and were bought over thirty minutes ago
- **time in service**, from its first publish

Sorted by delivered, then the share still waiting, then speed, then time in
service. The method is printed next to the list, our own row is marked as
ours, and the queries are in `src/lib/providers.ts` so anyone can recompute
the table and order it differently.

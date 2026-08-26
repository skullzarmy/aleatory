# Running a render provider

A provider draws the image for every piece minted from a collection that names
it, and publishes that piece's metadata. Anyone can run one. The membership
test is two views on a contract, and listing in the registry is free.

This describes the reference implementation in this repository. Nothing here is
required: conform to [ALEATORY-001](interface.md) §5 and the rest is yours.

---

## Two keys, and why

```
collection.render.provider  →  provider contract
                            →  get_agent()   asked live, on every write
                            →  agent wallet  →  set_token_metadata
```

**Operator.** Owns the provider contract, sets the price, collects the render
gas, and rotates the agent. This is a wallet with money in it. Keep it the way
you keep a wallet with money in it.

**Agent.** Signs `set_token_metadata` and nothing else. It lives in a
serverless function's environment, which is to say somewhere a leak is
plausible. It cannot pause a collection, move a token, change a price, or touch
the provider contract's balance. Losing it costs the gas in it.

Fund the agent with a few tez and no more. A publish costs about 0.0015 ꜩ, so
that is thousands of pieces, and it caps what a leak is worth.

The collection asks `get_agent()` **live**, on every write, and a live answer
overrides the address it snapshotted at deploy. That is what makes rotation
work: one `set_agent` on your own contract and every collection using you
follows immediately, with no artist doing anything. If collections trusted
their snapshot, a leaked key would stay valid until every artist re-pointed it,
which is the same as never.

---

## Standing one up

```
npm run provider:setup          # what it would do
npm run provider:setup -- --go  # generate the agent, fund it, reveal it
```

It prints `ALEA_AGENT_ADDRESS` and `ALEA_AGENT_SK` for `.env`. The secret key
goes nowhere a browser can read it.

Deploying the provider contract and listing it in the registry is
`contract/deploy.ts`, run by the operator.

### The reveal is not optional

A Tezos account cannot transact until its public key is on chain. Taquito
normally bundles that reveal with the account's first operation, and on a chain
where `hard_gas_limit_per_operation` equals the per-*block* limit, a bundled
reveal overflows and the whole batch is refused. The symptom is an agent that
is funded, looks correctly configured, and has never landed an operation.

`provider:setup` sends the reveal on its own for that reason.

---

## Running it

```
npm run provider:daemon                   # the process. This is how it runs.
npm run provider:check                    # what is waiting, change nothing
npm run provider:run                      # one pass, then exit
npm run provider:retry -- <KT1…> <token>  # one piece, by name
```

`provider:daemon` stays up and polls, so a piece minted now has its image
seconds later. It is the provider. The single-pass commands are for looking at
the queue and for reaching a piece by hand.

Polling rather than a subscription, because the queue rule is a comparison
against chain state and not an event: it finds new mints, pieces missed while
the process was down, and pieces inherited from a provider an artist switched
away from, and it keeps no state of its own that could be wrong. A push
endpoint can sit in front of it so a mint UI says "look now" instead of
waiting for the next tick, and polling still has to work underneath, or the
provider is only as reliable as whoever remembers to call it.

One bad piece does not stop the queue. It stays pending, the next pass tries
again, and `provider:retry` reaches it if it needs a hand. A failure of the
cycle itself backs off, doubling to five minutes, rather than hammering a
dependency that is down.

`SIGINT` finishes the piece in flight and then stops, so nothing is left half
published.

### What the queue finds

A piece needs rendering when its `token_info[""]` still equals the collection's
pending document. That one comparison covers new mints, pieces missed while you
were down, and pieces inherited from a provider an artist switched away from,
and it needs no state of your own.

Collections come from two places, because neither alone is complete. A
factory-deployed collection names its provider in its *initial storage* and
never emits `set_provider`, so an event scan alone never sees a new collection
at all. A collection that switched to you later does emit one. Both are
checked against the collection's own storage afterwards, which is the only
thing that actually decides whether work is yours.

### What the queue cannot find, and what to do about it

The pending-document rule has no notion of "published, but wrong". Any write at
all takes a piece out of the queue: a metadata document pinned somewhere that
later went away, a publish whose confirmation you never saw, a render that came
out wrong.

`provider:retry` is for those. `set_token_metadata` is a plain write, not a
write-once, precisely so that it can be. Who may write is the bound, and the
artist can revoke it at any time.

---

## Libraries

A collection declares what its generator needs under `aleatory:libraries`, and
resolving that is part of rendering. This provider tries its own deployment
first, then unpkg, then jsdelivr, and checks every candidate against the
recorded blake2b digest. A mirror that is stale, wrong, or hostile is skipped
rather than used.

**If nothing resolves, the piece is not rendered at all.** A p5 sketch drawn
without p5 produces a blank frame, and publishing that frame would put a
permanent image of an error on a token nobody told. The piece stays pending,
which is a state the queue already understands and `provider:retry` can act on.

Where the bytes come from is not part of the interface. Any source is fine
because none of them is trusted: the digest was recorded when the piece was
published, and it either matches or the library is refused. See
[ALEATORY-001](interface.md) §1.

---

## Determinism

Rebuilding a piece produces the same bytes and the same CID. The seed is the
mint operation's hash, the parameters are in that operation, and the generator
is immutable, so a retry is not a second opinion, it is the same answer.

Two harness implementations exist: `netlify/functions/lib/render.mts`, which
draws headless, and `isolate/index.html`, which draws for a viewer. They agree
by conforming to [ALEATORY-001](interface.md) §7 rather than by sharing a file.
When they once disagreed on how to seed, every piece rendered from one
identical stream. If you change one, change the other.

---

## What this holds

The agent key, a pinning credential, and a Cloudflare token. No chain access
beyond the agent, no wallet with funds, no database, and no library store: a
declared library is fetched and verified per render, and cached by its digest.

Rendering goes through Cloudflare Browser Run's REST endpoint, which takes the
document directly. There is no worker to deploy and no public URL to guard.

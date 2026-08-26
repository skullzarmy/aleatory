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
npm run provider:check                    # what is waiting, change nothing
npm run provider:run                      # render, pin, publish
npm run provider:retry -- <KT1…> <token>  # one piece, by name
```

In production the same code runs as a Netlify function on a cron.

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
beyond the agent, no wallet with funds, no database.

Rendering goes through Cloudflare Browser Run's REST endpoint, which takes the
document directly. There is no worker to deploy and no public URL to guard.

# Running a render provider

A provider draws the image for every piece minted from a collection that names
it, and publishes that piece's metadata. Anyone can run one. The membership
test is three views on a contract, and listing in the registry is free.

This describes the reference implementation in this repository. Nothing here is
required: conform to [ALEATORY-001](interface.md) §5 and the rest is yours.

---

## Why anyone would

You charge render gas, once, per mint. The artist sets nothing: your contract
holds the price, the collection reads it when the artist picks you, and every
mint pays it to your contract in the same operation that pays the artist.

Against that, a publish costs roughly 0.0015 ꜩ in chain fees, plus whatever
your rendering and pinning cost you off chain. The provider this site runs
charges 0.05 ꜩ, so the chain-fee margin is about thirty to one. That is not
the whole picture, because a headless browser and a pinning service are not
free, and it is the number to start from.

Nothing about this is exclusive. Any number of providers can serve any number
of collections, an artist picks one per collection at deploy, and can switch
later. You are competing on delivery, not on access.

---

## Getting listed

Deploy a provider contract, then call `register` on the registry with its
address. That is the whole process. It is permissionless, free, and asks us
for nothing.

The registry checks that your contract answers `get_render_gas`, `get_agent`
and `get_operator`, and lists it if it does. That is a type check, not an
endorsement: nobody reviews you, nobody approves you, and nobody can refuse
you. The third view is asked at registration so that an entry nobody could
ever remove cannot be created, since deregistering asks the contract who its
operator is.

Leaving is `deregister`, callable only by your own operator. Collections
already pointing at you keep working; the registry is a directory, not a
dependency.

---

## How artists find you

The list on /providers is sorted by what you have delivered, in this order:

1. **Pieces published** in the last 30 days.
2. **Backlog share**, outstanding over outstanding plus delivered. Lower wins.
3. **Median blocks from mint to publish.** Faster wins.
4. **Time in service**, as the tiebreak.

Every figure comes from public chain events, so anyone can recompute the list
and order it differently, including ranking us below you. The queries are in
`src/lib/providers.ts`.

**Your price is not in the ranking.** Undercutting moves you nowhere. What
moves you is publishing pieces and not leaving any waiting, which is the same
thing artists actually care about: a piece that never renders is a piece whose
image never exists.

The corollary matters more than the ranking. An artist who picks you and finds
their collection half-rendered will switch, and switching is one call on their
own contract. Nothing binds them to you for a second mint.

---

## Getting paid

Render gas accumulates in your provider contract. `withdraw(amount, to_)`
moves it, and only your operator key can call it, to any destination you name.
This is the one call in the system that a signature can misdirect, so it is
worth being deliberate about where it goes.

`set_render_gas` changes your price for collections that snapshot it
afterwards. Collections already deployed keep the price they recorded, so a
change is never retroactive and never surprises an artist who already chose
you.

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

## What has to be in the environment

Set these before running anything. The setup command's first act is to check
for the operator key and stop, and every step below fails the same way if what
it needs is absent.

| Variable | For | Needed by |
|---|---|---|
| `TEZOS_WALLET_PRIV_KEY` | the operator wallet, which owns the provider contract and pays | `provider:setup`, `deploy` |
| `ALEA_AGENT_SK` | the agent's secret key, generated by setup | the daemon |
| `ALEA_AGENT_ADDRESS` | the agent's address | the daemon |
| `ALEA_PROVIDER_ADDRESS` | your provider contract, once deployed | the daemon |
| `ALEA_ROUTER_ADDRESS` | the platform's index, how collections are found | the daemon |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | Cloudflare Browser Rendering, which draws | the daemon |
| `PINATA_JWT` | pinning what was drawn | the daemon |
| `TEZOS_NETWORK`, `TEZOS_RPC`, `TZKT_API` | which chain, and where to read it | everything |

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are accepted as alternative
names for the Cloudflare pair, so an existing environment usually needs no
renaming.

Optional, and worth setting once you are listed:

| Variable | For |
|---|---|
| `ALEA_PROVIDER_NAME`, `ALEA_PROVIDER_DESC`, `ALEA_PROVIDER_AVATAR` | how you appear in the provider list, in place of a bare KT1 |
| `ALEA_POLL_MS` | how often the daemon looks, 15000 by default |
| `ALEA_PROVIDER_URL`, `ALEA_PROVIDER_PING_TOKEN`, `ALEA_PROVIDER_PORT` | the push endpoint, below |

`.env.example` in the repository root carries the same list with blanks.

### The push endpoint, and whether you want one

**Start by not running it.** Polling every fifteen seconds finds everything: new
mints, pieces missed while the process was down, and pieces inherited from a
provider an artist switched away from. The push shortens one interval. That is
its whole value, and it costs you an open port on the machine holding your
agent key.

Run it when a first reveal in two seconds instead of fifteen is worth that
trade to you. Plenty of providers should decide it is not.

#### What it is

| | |
|---|---|
| `ALEA_PROVIDER_PING_TOKEN` | the daemon listens once this is set. At least 32 characters, or it refuses to start. |
| `ALEA_PROVIDER_BIND` | interface. `127.0.0.1` by default. |
| `ALEA_PROVIDER_PORT` | port. 8787 by default. |
| `ALEA_PROVIDER_URL` | the public https URL, written into your contract's metadata as `endpoint` |

`ALEA_PROVIDER_URL` is the part that connects it. A mint UI reads the
collection's provider address off the chain, reads `endpoint` out of that
provider's TZIP-016 metadata, and calls it. Publish no `endpoint` and nothing
will ever call you.

**It is written when the provider contract is originated**, by
`contract/deploy.ts` from `ALEA_PROVIDER_URL`, alongside the name, description
and avatar:

```
ALEA_PROVIDER_URL=https://provider.example/push npx tsx contract/deploy.ts --only provider
```

`npm run provider:setup` does not write it. That command generates and funds
the agent key and nothing else. Changing the URL later means writing your
contract's metadata again, and a provider contract you originated yourself is
yours to update however you built it.

```
openssl rand -hex 32
```

#### What the daemon does to protect itself

A valid push sets a flag and returns `202`. That is the entire effect.

| | |
|---|---|
| binds loopback | reaching it from outside is a decision you make, not a default |
| refuses in order | wrong method, then a constant-time token compare |
| destroys refused sockets | no response body, so a prober learns nothing about which check failed |
| never reads a body | nothing a caller sends changes what happens |
| rate limits after the token | an anonymous flood cannot spend a real caller's allowance |
| caps headers and timeouts | 20 headers, 3s for headers, 5s per request, 4 requests per socket |

Measured: 400 unauthenticated requests are refused in 0.6 seconds, and a valid
push arriving immediately afterwards still gets its `202`.

#### What it does not protect you from

**It speaks plain HTTP and it does not authenticate you to the caller.** The
daemon is one process on your machine. Everything below is yours.

- **Exposing it directly.** Setting `ALEA_PROVIDER_BIND=0.0.0.0` puts an
  unencrypted port on the internet and the token crosses it in the clear. The
  daemon warns about this at startup, every start, and then does as it is told.
- **TLS.** Terminate it in nginx, Caddy or a tunnel, and proxy to
  `127.0.0.1:8787`. `ALEA_PROVIDER_URL` is the https address of that front end.
- **Volume.** The in-process gate protects the daemon's own work; it does
  nothing about the bandwidth arriving at your machine. A reverse proxy with
  connection limits, or a firewall that only admits the hosts you expect, is
  what handles that.
- **Firewalling.** If you bind loopback and proxy, no inbound rule is needed at
  all. If you bind publicly, allow that one port and nothing else.

A leaked token buys somebody the ability to make your daemon look at the chain,
which it already does on its own clock. It cannot make it render, publish, or
spend: the queue is computed from chain state, and a push only shortens the
wait before that computation runs.

---

## Standing one up

```
npm run provider:setup                # generate the agent, fund it, reveal it
npm run provider:setup -- --dry-run   # show what that would do, change nothing
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
npm run provider:run                      # one pass, then exit
npm run provider:check                    # a pass that changes nothing
npm run provider:retry -- <KT1…> <token>  # one piece, by name
```

Every command here does its work when you run it. `--dry-run` is how you ask
any of them to show you instead, and `provider:check` is the name for
`provider:run -- --dry-run`, which is the one worth having a name.

`provider:daemon` stays up and polls, so a piece minted now has its image
seconds later. It is the provider. The single-pass commands are for looking at
the queue and for reaching a piece by hand.

Polling rather than a subscription, because the queue rule is a comparison
against chain state and not an event: it finds new mints, pieces missed while
the process was down, and pieces inherited from a provider an artist switched
away from, and it keeps no state of its own that could be wrong. The push
endpoint sits in front of it and shortens one interval; polling underneath is
what makes the provider reliable on its own.

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

Two harness implementations exist: `provider/render.mts`, which
draws headless, and `isolate/index.html`, which draws for a viewer. They agree
by conforming to [ALEATORY-001](interface.md) §7 rather than by sharing a file.
When they once disagreed on how to seed, every piece rendered from one
identical stream. If you change one, change the other.

---

## Staying good at it

Four things go wrong, and three of them are silent.

**The agent runs dry.** It pays its own gas, and empty it does not error
anywhere you would see: publishing simply stops and pieces sit pending, which
looks exactly like a rendering fault. Watch its balance and set a floor. This
is the single most common way a provider quietly stops being one.

**A publish half-lands.** A confirmation you never saw still took the piece out
of the queue, because any write at all does. `provider:retry` exists for that
and is worth running on a schedule rather than after somebody complains.

**A library stops resolving.** The piece stays pending rather than rendering
blank, which is correct and also invisible. A backlog that will not clear is
usually this.

**The agent leaks.** Rotate with one `set_agent` on your own contract. Every
collection using you follows immediately, because they ask `get_agent()` live
rather than trusting what they snapshotted. If you also write resolver
entries, remove the old key there too: two calls, no artist involved.

None of these announce themselves, so the only real answer is to watch the
backlog. Outstanding work is public, it is what the ranking counts, and an
artist can see it before they choose you.

---

## What this holds

The agent key, a pinning credential, and a Cloudflare token. No chain access
beyond the agent, no wallet with funds, no database, and no library store: a
declared library is fetched and verified per render, and cached by its digest.

Rendering goes through Cloudflare Browser Run's REST endpoint, which takes the
document directly. There is no worker to deploy and no public URL to guard.

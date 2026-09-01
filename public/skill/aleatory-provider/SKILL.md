---
name: aleatory-provider
description: Run a render provider for Aleatory, the fully on-chain generative art platform on Tezos. Use when someone wants to draw minted pieces and publish their images, register a provider contract, understand render gas, or operate the daemon. Covers the membership test, the two keys, how work is found, and the push endpoint.
---

# Running a render provider

A piece is minted before its image exists. Something has to run the generator
once, capture what it drew, pin it, and write the result to the token. That is
a render provider.

It is a role, never an authority. Anyone can run one, list it without asking
anybody, and set their own price. An artist picks a provider per collection and
can switch at any time.

## The membership test

A provider is any contract exposing three views:

```
get_render_gas() -> mutez     price per piece
get_agent()      -> address   the key that calls set_token_metadata
get_operator()   -> address   who may deregister it
```

That is the whole test. Call `register` on the registry with the contract's
address and it is listed. Free, permissionless, and nobody reviews it: the
registry checks the three views answer and lists it if they do, which is a type
check and not an endorsement.

The third view is asked at registration as well as at deregistration, so an
entry nobody could ever remove cannot be created. A contract answering only the
first two would otherwise list itself and stay listed forever, because
deregistering has nothing to ask about who is allowed to do it.

**The contract has to be able to receive tez**, since a collection pays it on
every mint.

## The two keys

Keep them separate. This is the part that limits what a compromise costs.

**Operator** owns the provider contract, sets the price, collects the render
gas, and rotates the agent. A wallet with money in it, used rarely.

**Agent** signs `set_token_metadata` and nothing else. It lives in a running
process's environment, which is somewhere a leak is plausible. It cannot pause
a collection, move a token, change a price, or touch the provider contract's
balance. Fund it with a few tez: a publish costs roughly 0.0015 ꜩ, so that is
thousands of pieces, and it caps what a leak is worth.

Collections ask the provider contract for the current agent on every write
rather than trusting what they recorded at deploy time, so one `set_agent`
revokes a leaked key everywhere at once and no artist has to do anything.

## How work is found

**A piece needs rendering when its `token_info[""]` still equals the
collection's pending document.**

One comparison, computed from chain state, and it covers new mints, pieces
missed while the process was down, and pieces inherited from a provider an
artist switched away from. Keep no queue of your own: a queue is a thing that
can be wrong, and this one is derived fresh every pass.

Poll on a clock. Fifteen seconds is a reasonable interval.

## What a render must be

The image is the artwork's canonical form, so the same piece has to produce the
same bytes anywhere.

- Install `$alea` exactly as ALEATORY-001 §7 specifies, seeded from the mint
  operation's hash.
- Replace `Math.random` with the seeded stream and freeze the clock.
- Block the network for the duration.
- Supply every declared library **after verifying its hash**, and refuse to
  draw if you cannot. A sketch rendered without the library it asked for
  produces a blank frame, and publishing that as the artwork is worse than
  publishing nothing.
- Capture when the piece calls `$alea.ready()`.

Rebuilding a piece later produces the same bytes and the same CID, because the
seed, the parameters and the generator are all immutable. A retry is the same
answer, never a second opinion.

## Publishing

```
set_token_metadata(token_id: nat, metadata_uri: bytes)
```

**Rewritable by an authorised writer, on purpose.** Refusing a second write
would mean a publish that landed without its confirmation being seen could
never be corrected or retried, and the writer is already trusted with the whole
document. The URI cannot equal the pending document, which would leave the
piece looking unrendered forever.

What a run does spend is render budget, pinning quota and the agent's gas, so
dry-run first.

## The push endpoint

Optional, and polling finds everything without it.

A provider may advertise a URL in its TZIP-016 metadata as `endpoint`, and a
mint UI will call it when a piece is minted. **It carries no authentication and
cannot**: the UI calling you holds none of your secrets, and any UI may call
any provider, so a credential would mean an endpoint that worked for one caller
and refused the rest.

Treat it as a shoulder tap from a stranger. Let it do no more than bring
forward the moment you next read the chain, make ignoring it free, and rate
limit what it can achieve. A caller who reaches you should be unable to make
you render, publish or spend.

## What you are judged on

Pieces published, and pieces left waiting. Price is not part of any ranking
worth having, so undercutting moves you nowhere and delivering does. Every
figure is computable from public chain events, so anyone can check yours.

## What it takes to run

A headless browser, somewhere to pin what it draws, and a key with a few tez in
it that signs nothing but metadata.

The reference implementation is `provider/` in
<https://github.com/skullzarmy/aleatory>, with `docs/provider.md` beside it.
You are under no obligation to use either. The three views are the whole
contract between you and everybody else.

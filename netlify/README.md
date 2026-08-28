# The render provider

A piece is minted before its image exists. Something has to run the generator
once, capture what it drew, pin it, and write the result to the token. That is
a render provider, and this is ours.

It is a role, not an authority. Anyone can run one, list it in the registry
without asking us, and set their own price. Artists pick a provider per
collection and can switch. See [provider.md](../docs/provider.md) for running
one, and [ALEATORY-001 §5](../docs/interface.md) for what conformance requires.

## What is here

| | |
|---|---|
| `functions/provider.mts` | The work: find pieces needing rendering, draw, pin, publish. |
| `functions/lib/render.mts` | The harness. Installs `$alea`, seeds it, freezes the clock, blocks the network, captures. |
| `functions/lib/libraries.mts` | Resolving a piece's declared libraries and verifying them by hash. |

The daemon that drives it is [`scripts/provider-daemon.mts`](../scripts/).

## Two keys

**Operator** owns the provider contract, sets the price, collects the render
gas, and rotates the agent. A wallet with money in it.

**Agent** signs `set_token_metadata` and nothing else. It lives in a
process's environment, which is somewhere a leak is plausible. It cannot pause
a collection, move a token, change a price, or touch the provider contract's
balance. Fund it with a few tez: a publish costs about 0.0015 ꜩ, so that is
thousands of pieces, and it caps what a leak is worth.

Collections ask the provider contract for the current agent on every write
rather than trusting what they recorded at deploy, so one `set_agent` revokes a
leaked key everywhere at once and no artist has to do anything.

## How work is found

A piece needs rendering when its `token_info[""]` still equals the collection's
pending document. One comparison, and it covers new mints, pieces missed while
the process was down, and pieces inherited from a provider an artist switched
away from. No state of our own that could be wrong.

## Determinism

Rebuilding a piece produces the same bytes and the same CID. The seed is the
mint operation's hash, the parameters are in that operation, and the generator
is immutable, so a retry is the same answer rather than a second opinion.

`render.mts` and [`isolate/index.html`](../isolate/) are two implementations of
the same harness, and they agree by both conforming to ALEATORY-001 rather than
by sharing code. `npm test` checks that they still do. When they once disagreed
about seeding, every piece from one of them drew the same picture.

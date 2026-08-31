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
| `provider.ts` | The work: find pieces needing rendering, draw, pin, publish. |
| `render.ts` | The harness. Installs `$alea`, seeds it, freezes the clock, blocks the network, captures. |
| `libraries.ts` | Resolving a piece's declared libraries and verifying them by hash. |
| `metadata.ts` | The TZIP-21 document a piece carries. One builder, so a published document and the studio's preview agree. |
| `daemon.ts` | The process. `run.ts`, `retry.ts` and `setup.ts` are its one-shot siblings. |

```
npm run provider:setup     generate the agent, fund it, reveal it
npm run provider:check     a pass that reads only
npm run provider:run       one pass
npm run provider:daemon    the process. This is how it runs.
```

Everything here imports from here, apart from the npm packages in the root
`package.json`. Copy this directory and the lockfile to a box and it runs.

## The push endpoint

Optional, and off unless `ALEA_PROVIDER_PUSH=on`. Polling finds everything on
its own; this shortens one interval and opens a port.

It is unauthenticated, because a mint UI tapping a provider holds none of that
provider's secrets and any UI may tap any provider. A tap brings the next chain
read forward and does nothing else, at most once every five seconds, so
ignoring one costs nothing and flooding achieves nothing. Binds loopback. TLS,
volume and firewalling are the operator's, and
[provider.md](../docs/provider.md) spells out which is which.

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

`render.ts` and [`isolate/index.html`](../isolate/) are two implementations of
the same harness. Each conforms to ALEATORY-001, and `npm test` checks that they
agree. A disagreement about seeding once made every piece from one of them draw
the same picture.

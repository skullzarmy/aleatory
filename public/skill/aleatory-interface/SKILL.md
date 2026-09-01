---
name: aleatory-interface
description: ALEATORY-001, the interface for Aleatory pieces on Tezos. Use when building a renderer, viewer, indexer, wallet or marketplace that has to read Aleatory collections correctly, or when writing a collection contract that conforms. Covers the seed, token metadata, events, declared libraries, royalties and the render harness.
---

# ALEATORY-001

The interface. A collection conforming to this is rendered by any provider,
traded on any Aleatory market, and indexed by anything that reads this
document. The reference contracts are one implementation; this is the thing to
build against.

## 1. What a collection is

A standard FA2 (TZIP-012) contract holding one generator and its edition.
Beyond FA2 it exposes one entrypoint and one view, emits two events, and
follows one rule about token metadata.

Declare conformance in TZIP-016 contract metadata:

```json
{ "interfaces": ["TZIP-012", "TZIP-016", "ALEATORY-001"] }
```

### `mint`

```
mint :: bytes -> unit
```

Payable, callable by anyone, and it creates the token in the caller's own
operation. The argument is the collector's parameters as canonical JSON, or
empty when the generator declares none. The amount covers the price and the
render gas together.

It is called `mint` because it mints. `buy` is the marketplace verb, for a
token that already exists.

### The generator

Four immutable fields, none with a setter:

| field | meaning |
|---|---|
| `code` | the generator, a self-contained HTML document, as `bytes` |
| `code_encoding` | `identity` or `gzip` |
| `code_hash` | **SHA-256** of the decoded source, raw, as `bytes` |
| `code_uri` | `ipfs://` pointer, only for a generator past the operation cap |

Exactly one of `code` and `code_uri` is set. A Tezos operation is capped at
32,768 bytes, and `gzip` buys roughly 2.5x before that limit bites. The hash
covers the decoded source either way, so it verifies what actually runs.

## 2. The seed

**The hash of the `mint` operation is the piece's seed. Nothing else defines
it.** A renderer derives it from the operation hash, and so does anyone
checking the result. Nobody picks it, including the collector whose signature
produced it.

## 3. Token metadata

`token_info[""]` holds an `ipfs://` pointer to a JSON document.

**Every token mints carrying the same document**, the collection's pending
document. A provider replaces it, once, with that piece's own.

**A piece needs rendering when its `token_info[""]` still equals the
collection's pending document.** That single comparison is the whole work
queue: new mints, pieces missed while a provider was down, and pieces inherited
when an artist switches provider. Expose the pending document so a provider can
make the comparison.

## 4. Events

### `mint`

| field | type | meaning |
|---|---|---|
| `token_id` | nat | the piece |
| `buyer` | address | who owns it |
| `params` | bytes | canonical JSON of the collector's parameters, empty when none |
| `paid` | mutez | total paid |
| `render_gas` | mutez | the provider's share |

### `set_provider`

| field | type | meaning |
|---|---|---|
| `provider` | address | the provider contract |
| `agent` | address | the key that will publish metadata |
| `render_gas` | mutez | agreed price per piece |

A provider watches for its own address here to learn which collections it
serves.

## 5. Publishing metadata

```
set_token_metadata(token_id: nat, metadata_uri: bytes)
```

Rewritable by an authorised writer, deliberately: refusing a second write means
a publish whose confirmation was missed can never be corrected or retried, and
the writer is already trusted with the whole document. The URI cannot equal the
pending document. Who counts as authorised is the collection's business.

## 6. The render harness

A conforming renderer installs `$alea` and **exactly this**:

```
$alea.seed              the mint operation hash
$alea.random()          seeded stream
$alea.rand()            the same function
$alea.randInt(lo, hi)   inclusive
$alea.randBetween(lo, hi)
$alea.pick(array)
$alea.chance(p)
$alea.params            resolved parameter values
$alea.param(name, fallback)
$alea.features(object)
$alea.ready()           the capture point
```

Aliases borrowed from other platforms are not part of this interface.

Two substitutions, both required: `Math.random` is replaced by the seeded
stream, and the clock is frozen so `Date.now()` and `performance.now()` return
a fixed value. Network access is blocked for the duration. Artist code runs
afterwards and can undo them, so a generator that varies will vary; a provider
renders once, and that render is the piece.

Capture when the piece calls `$alea.ready()`.

### What conformance requires of a generator

Three things, all mechanical, and nothing else. No restriction on technique,
library, medium, or how the document was authored.

1. **Self-contained.** Nothing fetched while rendering. Declared libraries are
   supplied by the renderer beforehand, so they are not a fetch.
2. **Deterministic.** One seed, one capture. Run it twice from a clean frame
   and the captures agree.
3. **Signals its capture point** by calling `$alea.ready()`.

## 7. Declared libraries

A generator declares a library with a meta tag, and the collection repeats the
declaration in its metadata under `aleatory:libraries`:

```html
<meta name="alea:library" content="p5@1.5.0">
```

```json
[{ "id": "p5", "version": "1.5.0", "path": "lib/p5.min.js", "hash": "16f48a…" }]
```

`id`, `version` and `path` are npm coordinates, enough to fetch the file from
npm or any mirror. `hash` is **blake2b-256** of that file's bytes.

**A renderer must verify the hash and must refuse to draw if it cannot.** A
sketch rendered without the library it asked for produces a blank frame, and
publishing that as the piece is worse than publishing nothing.

Cache by hash, never by `id@version`, so a generator declaring `p5@1.5.0` with
different bytes can only harm itself. Nobody is the authority for what a
library is: the coordinates point at a public registry, and the registry
publishes its own digest, so a recorded hash is checkable against a source with
no relationship to the platform the piece was minted on.

## 8. Royalties

The objkt convention, which is what objkt and Teia read:

```json
"royalties": { "decimals": 4, "shares": { "tz1…": 1250 } }
```

Each share is an absolute fraction of the sale price. Royalties live in the
token's metadata JSON and are built off chain, like every other Tezos NFT. A
collection also exposes them on chain:

```
get_royalties() -> map(address, nat)   basis points of the sale price
```

A marketplace paying them inside the sale should ask whether a recipient can
take a plain transfer before sending: an implicit account always can, a `KT1`
only through a `default` entrypoint of type unit. `royalties` has no setter, so
one unpayable address would otherwise revert every sale of that collection
forever.

## 9. Being a provider

Any contract exposing three views:

```
get_render_gas() -> mutez     price per piece
get_agent()      -> address   the key that calls set_token_metadata
get_operator()   -> address   who may deregister it
```

That is the entire membership test. See the `aleatory-provider` skill for
running one.

## 10. Reading a piece back

Everything needed to reproduce a piece is on chain: the generator (`code` or
`code_uri` plus `code_hash`), the seed (the mint operation's hash), the
parameters (in that operation), and the declared libraries (in the collection's
metadata). A viewer that resolves those and runs the harness above gets the
same image as the provider did, and can say so.

Full text: `docs/interface.md` in
<https://github.com/skullzarmy/aleatory>, served at `/docs/interface` on any
site running this platform.

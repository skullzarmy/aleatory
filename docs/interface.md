# ALEATORY-001

The interface. Conform to this and your collection is rendered by any
provider, traded on any Aleatory market, and indexed by anything that reads
this document.

Our contracts are a reference implementation. This is the thing to build
against.

---

## 1. What a collection is

A standard FA2 (TZIP-012) contract holding one generator and its edition.
Beyond FA2 it exposes one entrypoint and one view, emits two events, and
follows one rule about token metadata.

Declare conformance in TZIP-016 contract metadata so an indexer can find you:

```json
{
  "name": "Your collection",
  "interfaces": ["TZIP-012", "TZIP-016", "ALEATORY-001"]
}
```

### `mint`

The collector-facing primary sale. Payable, callable by anyone, and it
creates the token in the caller's own operation.

```
mint :: bytes -> unit
```

The argument is the collector's parameters as canonical JSON, or empty when
the generator declares none (§8 of [params.md](params.md)). The amount must
cover the price and the render gas together.

It is called `mint` because it mints. `buy` is the marketplace verb, for a
token that already exists, and a collection that names its creation path
`buy` will be read wrong by everyone who has used any other Tezos contract.

### The generator

Four immutable fields, and none has a setter anywhere:

| field | meaning |
|---|---|
| `code` | the generator itself, a self-contained HTML document, as `bytes` |
| `code_encoding` | `identity` or `gzip` |
| `code_hash` | **SHA-256** of the DECODED source, raw, as `bytes` |
| `code_uri` | `ipfs://` pointer, only for a generator past the operation cap |

**Exactly one of `code` and `code_uri` is set.** The generator belongs in
storage: a typical one is well under 10KB, which is about half a dollar of
storage burn paid once by the artist, and a pointer costs less while being
worth less. A gateway's content policy can change and the art stops resolving.

`code_uri` exists because a protocol operation is capped at 32,768 bytes and a
generator larger than that cannot be carried on chain. `gzip` buys roughly
2.5x before that limit bites.

The hash covers the decoded source either way, so it verifies what actually
runs. For a pointer it is the only defence against a gateway handing back
something other than what was published.

### Declared libraries

"Self-contained" means the document carries everything it needs **except** the
libraries it declares. A generator declares one with a meta tag:

```html
<meta name="alea:library" content="p5@1.5.0">
```

One tag per library, and they load in the order they appear. A renderer inlines
them ahead of the artist's code.

The collection repeats the declaration in its metadata, under
`aleatory:libraries`, so a renderer can resolve a piece without parsing the
generator first:

```json
[{ "id": "p5", "version": "1.5.0", "path": "lib/p5.min.js", "hash": "16f48a…" }]
```

| field | meaning |
|---|---|
| `id` | package name on npm |
| `version` | exact, never a range |
| `path` | file inside the published package |
| `hash` | **blake2b-256** of that file's bytes, hex |

`id`, `version` and `path` make the library resolvable from npm or any mirror
of it. `hash` decides whether what came back is usable.

**A renderer must verify the hash and must refuse to draw if it cannot.** A
sketch rendered without the library it asked for produces a blank frame, and
publishing that as the piece is worse than publishing nothing.

**Nobody is the authority for what a library is.** The declaration points at a
public registry, and the registry publishes its own integrity digest for the
package, so anyone can check a recorded hash against a source that has no
relationship to the platform the piece was minted on. Cache by hash, never by
`id@version`: a generator declaring `p5@1.5.0` with different bytes must be
able to harm only itself.

A library that is not on a public registry has no independent authority behind
it, so it belongs inside the document.

This section specifies the mechanism. [libraries.md](libraries.md) is the same
thing for the person writing a generator: which libraries can be declared
today, what happens at each stage, and what to do when the one you want is not
among them.

---

## 2. Token metadata

`token_info[""]` holds an `ipfs://` pointer to a JSON document, which is the
ordinary Tezos arrangement.

**Every token mints carrying the same document**, the collection's pending
document. A provider replaces it, once, with that piece's own.

**A piece needs rendering when its `token_info[""]` still equals the
collection's pending document.** That single comparison is the whole work
queue. It covers new mints, pieces missed while a provider was down, and
pieces inherited when an artist switches provider, and it requires no state on
the provider's side.

Expose the pending document so a provider can make that comparison. Ours is
`storage.art.pending_metadata`, as bytes.

---

## 3. Events

Two, both required.

### `mint`

Emitted when a piece is sold and minted.

| field | type | meaning |
|---|---|---|
| `token_id` | nat | the piece |
| `buyer` | address | who owns it |
| `params` | bytes | canonical JSON of the collector's parameters, empty when none |
| `paid` | mutez | total paid |
| `render_gas` | mutez | the provider's share of that total |

**The hash of this operation is the piece's seed.** Nothing else defines it.
A renderer derives the seed from the operation hash, and so does anyone
checking the result.

### `set_provider`

Emitted when a collection chooses or changes its render provider.

| field | type | meaning |
|---|---|---|
| `provider` | address | the provider contract |
| `agent` | address | the key that will publish metadata |
| `render_gas` | mutez | agreed price per piece |

A provider watches for its own address here to learn which collections it
serves.

---

## 4. Publishing metadata

One entrypoint, callable by an authorised writer:

```
set_token_metadata(token_id: nat, metadata_uri: bytes)
```

Rules a conforming collection enforces:

- Rewritable by an authorised writer. Refusing a second write means a publish
  whose confirmation was missed can never be corrected or retried, and the
  writer is already trusted with the whole document.
- The URI cannot equal the pending document, which would leave the piece
  looking unrendered forever.
- Authorisation is the collection's business. Ours accepts the provider's
  current agent, an address the artist authorised directly, or one our
  resolver vouches for while the artist trusts it.

---

## 5. Being a provider

A provider is any contract exposing two views:

```
get_render_gas() -> mutez     price per piece
get_agent()      -> address   the key that calls set_token_metadata
```

That is the entire membership test. Deploy one, list it in the registry for
free, and set your own price.

The contract has to be able to receive tez, since a collection pays it on
every mint.

Advertise a push endpoint in your TZIP-016 metadata if you want mint UIs to
notify you directly. Polling the chain works without it.

---

## 6. Royalties

The objkt convention, in the metadata document:

```json
"royalties": { "decimals": 4, "shares": { "tz1...": 1250 } }
```

Shares are absolute fractions of the sale price. `decimals: 4` means 1250 is
12.5% of the sale.

**Also expose them on chain**, because a marketplace contract cannot read
IPFS:

```
get_royalties() -> map(address, nat)   basis points of the sale price
```

A marketplace that pays artists reads this view. Without it, a seller could
list a piece with the royalties zeroed out.

---

## 7. The render harness

A generator receives its seed and parameters from globals installed before its
first line runs:

```js
$alea.seed              // the mint operation hash
$alea.random()          // seeded stream, deterministic
$alea.rand()            // the same function, shorter
$alea.randInt(lo, hi)   // inclusive
$alea.randBetween(lo, hi)
$alea.pick(array)
$alea.chance(p)
$alea.params            // resolved parameter values
$alea.param(name, fallback)
$alea.features(object)  // traits, indexed and shown to collectors
$alea.ready()           // signal the capture point
```

Everything above `params` draws from one seeded stream, so calling any of them
advances it. `random` and `rand` are the same function under two names.

`$alea` is the entire surface. A conforming renderer installs that and
nothing else: aliases for other platforms are not part of this interface, and a
generator written for one is not an Aleatory piece.

`$alea` is the global. Code that uses it usually binds it first, which is why
the templates read `alea.ready()` rather than `$alea.ready()`:

```js
var alea = window.$alea;      // vanilla, svg and p5 templates do this
```

A custom-runtime piece receives it as an argument instead, since the harness
calls its lifecycle:

```js
window.ALEA_MAIN = { render: function (alea) { /* ... */ alea.ready(); } };
```

Same object either way. The name with the dollar is the one that exists
without you making it.


Two substitutions make a render reproducible, and any conforming renderer
installs both. Artist code runs afterwards and can undo them, so a generator
that varies will vary: a provider renders once, and that render is the piece.

- `Math.random` is replaced by the seeded stream.
- The clock is frozen. `Date.now()` and `performance.now()` return a fixed
  value, so a piece that reads the date renders the same way in any year.

Network access is blocked for the duration.

Parameters are specified in [params.md](params.md).

### What conformance actually requires

Three things, all mechanical, and nothing else. No restriction on technique,
library, medium, or how the document was authored.

1. **Self-contained.** Nothing fetched while rendering. Declared libraries are
   supplied by the renderer before the piece runs, so they are not a fetch.
2. **Deterministic.** One seed, one capture. Run the piece twice from a clean
   frame and the captures agree.
3. **Signals its capture point** by calling `$alea.ready()`.

What happens after the capture is the artist's business. A piece that responds
to a mouse forever still has exactly one canonical image, and that image is
what goes on chain.

---

## 8. Reading it all back

Everything a front end needs, from public chain data:

| Question | Query |
|---|---|
| Which collections came from a factory | contracts where `creator` is the factory |
| Which collections a provider serves | `set_provider` events naming its address |
| Which pieces need rendering | tokens whose `token_info[""]` is the pending document |
| A piece's seed | the hash of the `mint` operation that created it |
| A piece's parameters | the `params` field of that same event |
| Who to pay on a sale | `get_royalties()` on the collection |

No index held by anyone is required for any of it.

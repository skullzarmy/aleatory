# ALEATORY-001

The interface. Conform to this and your collection is rendered by any
provider, traded on any Aleatory market, and indexed by anything that reads
this document.

Our contracts are a reference implementation. This is the thing to build
against.

---

## 1. What a collection is

A standard FA2 (TZIP-012) contract holding one generator and its edition.
Beyond FA2 it emits two events, exposes one view, and follows one rule about
token metadata.

Declare conformance in TZIP-016 contract metadata so an indexer can find you:

```json
{
  "name": "Your collection",
  "interfaces": ["TZIP-012", "TZIP-016", "ALEATORY-001"]
}
```

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

### `buy`

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

- Write once. A token whose metadata has already been published rejects a
  second write.
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
every `buy`.

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
$alea.seed      // the buy operation hash
$alea.random()  // seeded stream, deterministic
$alea.params    // resolved parameter values
$alea.param(name, fallback)
$alea.ready()   // signal the capture point
```

fxhash era names are aliased, so existing work runs unchanged: `$fx.hash`,
`$fx.rand`, `$fx.getParam`, `$fx.getParams`, `$fx.preview`.

Two substitutions make a render reproducible, and any conforming renderer
installs both:

- `Math.random` is replaced by the seeded stream.
- The clock is frozen. `Date.now()` and `performance.now()` return a fixed
  value, so a piece that reads the date renders the same way in any year.

Network access is blocked for the duration.

Parameters are specified in [params.md](params.md).

---

## 8. Reading it all back

Everything a front end needs, from public chain data:

| Question | Query |
|---|---|
| Which collections came from a factory | contracts where `creator` is the factory |
| Which collections a provider serves | `set_provider` events naming its address |
| Which pieces need rendering | tokens whose `token_info[""]` is the pending document |
| A piece's seed | the hash of the `buy` operation that minted it |
| A piece's parameters | the `params` field of that same event |
| Who to pay on a sale | `get_royalties()` on the collection |

No index held by anyone is required for any of it.

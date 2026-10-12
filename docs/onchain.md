# What is on chain

Generative art platforms all say "on chain" and mean different things by it.
This says exactly what Aleatory means, shows one real piece taken apart to the
bytes, and gives you the commands to check any of it without trusting us or
any indexer.

Where it says a number, that number came from running the command printed
beside it.

## The claim

**The artwork is a program, the program is in contract storage, and every
piece is that program plus a seed that Tezos itself produced.**

Everything needed to produce a piece exists on chain. No server of ours is
involved in deciding what a piece looks like, and none of our infrastructure
continuing to exist is a condition of it remaining what it is.

That is the whole claim. The sections below are what it rests on, and the last
two are the parts people usually find after an argument has already started,
so they are here at the front of the queue.

## Where the artwork is

A generator holds its own source in storage, in `art.code`. Not a link to the
source. The bytes.

Take `KT1KD3b5LZQ8qaoXcN4ZM7w6sk1miapkZodY`, a live mainnet generator. Ask any
Tezos node for its storage:

```
curl -s https://rpc.tzbeta.net/chains/main/blocks/head/context/contracts/KT1KD3b5LZQ8qaoXcN4ZM7w6sk1miapkZodY/storage
```

That is a node, not an indexer. No TzKT, no Better Call Dev, no API key, and
no part of Aleatory. Ask a second node and compare; the answers are identical
because both are reading the same chain.

Inside is `art.code`: **49,180 bytes**, gzipped, which decompresses to
**146,231 characters** of HTML beginning `<!doctype html>`. That document is
the artwork. Open it in a browser and it draws.

Beside it sits `art.code_hash`, the SHA-256 of the decompressed source:

```
6bb55609ffb3ff073faad87edb0e2433f74f0b09d9a3d0908de240b29d6690cd
```

Decompress the bytes yourself, hash them, and compare. They match, which means
the storage carries its own proof: nobody has to be believed about what the
code is, including us.

Neither field has a setter. `code` is written until `seal_code` closes it and
never after, and nothing in the contract can rewrite `code_hash` at all. The
contract has no admin lambda and no upgrade path, so there is no privileged
call that could reach them.

A generator too large to fit one operation can point at IPFS through
`code_uri` instead, and that one is weaker: it depends on a gateway. The
generator says which arrangement it uses, so you never have to guess, and the
hash still decides whether what came back is right.

## Where the seed comes from

A piece is the program plus a seed. The seed is the hash of the operation that
minted it.

Token 10 of that generator was created by the eleventh mint, operation
`oonnqfeE3WPqMbwPoh3gouYzLMWDqApCeqH2v7mtQ696nU6E38s`. Its document records
`aleaSeed` as that same string. The operation exists on chain, its hash is
fixed by the protocol, and no part of it is chosen by the artist or by us.

This is also the honest version of a limitation. An operation hash covers
fields the sender controls, so a determined collector can enumerate candidate
operations offline and inject only the one they like. That is a documented
property of an operation-hash seed and it was accepted knowingly. It costs one
payment and arbitrarily many attempts, and it is written down in
[interface.md](interface.md) rather than discovered later.

Mint-time parameters, where a generator declares any, travel in that same
operation as the collector's own signed argument. Token 10's generator
declares none, so its `aleaParams` is `{}`.

## Nothing in the document is taken on trust

A piece's metadata document is a JSON file pinned on IPFS, which is where
every Tezos NFT keeps it. The pointer to it lives in contract storage, under
`token_info[""]`:

```
ipfs://QmXZMmnrxiK7RkfkMbSArA2VBAT8FJ5ZLvvnin2gexBkva
```

Fetch it and every claim it makes is checkable against the chain:

| The document says | The chain says |
|---|---|
| `aleaSeed: oonnqfeE3W…` | the hash of the operation that minted token 10 |
| `aleaCodeHash: 6bb55609…` | `art.code_hash` in the generator's storage |
| `aleaCode: art.code` | where to find the source, in that same storage |
| `creators: [tz1ae2d…]` | who the contract records as having made it |
| `royalties` | `art.royalties`, which the marketplace pays from |

The document is a convenience for marketplaces that cannot read contract
storage. It is not a source of truth, and it does not have to be, because
everything it asserts is checkable against something that is.

`aleaCode` is the newest of those fields and it exists because of a fair
criticism. A checker that read only the three image fields found three IPFS
links and reported the work as stored off chain. It was wrong, and the reason
it was wrong is that nothing in the document pointed at the source, so finding
it required already knowing how our storage is laid out. That was our failure
to document, so the document now carries the pointer.

## Checking it yourself

Nothing below contacts Aleatory.

**Read the source off the chain.** Any node, the command above. Decompress
`art.code`, hash it, compare to `art.code_hash`.

**Read a token's pointer off the chain.** `token_metadata` is a big map in the
generator's own storage, keyed by token id, holding the `ipfs://` URI under
the empty-string key.

**Find the seed.** The mint operation for a token id is a transaction to the
generator calling `mint`. Its hash is the seed, and the document has to agree.

**Reproduce the image.** Run the decompressed HTML with that seed, through a
harness conforming to [ALEATORY-001](interface.md) section 7. Deterministic,
so it draws what was published.

If any of those disagree, something is wrong and it is visible to anyone
checking. That is the property worth having. Not that we are trustworthy, but
that trusting us is unnecessary.

## What is on IPFS, and what follows from it

Two things: the rendered image, and the metadata document above.

Both are reproducible from chain data. The image is the program plus the seed
plus the parameters, all on chain, through a deterministic harness. The
document is assembled from the generator's own storage and that same
operation. Pinning them is a convenience for marketplaces and feeds that need
a picture and a JSON file without executing anything.

So if every pin vanished tomorrow, every piece could be regenerated, byte for
byte, by anybody. What would be lost is the convenience, and the time it takes
to rebuild it.

## What is not claimed

Overclaiming is how this argument gets lost, so here is the full list of
things that are not on chain.

**The rendered image.** It is pinned on IPFS. It is derived, not authored, and
it is reproducible, but it is not in contract storage.

**Declared libraries.** A generator may declare a library from npm, recorded
with its exact version and a blake2b hash of the file. The bytes come from a
public registry, not from the chain. The chain names precisely which bytes are
acceptable, so nobody can substitute others, and any mirror or cache serves
them. A generator that declares none depends on nothing outside the chain.

**The harness.** Reproducing a piece requires an implementation of
[ALEATORY-001](interface.md) section 7, which is a specification rather than a
contract. It is small, it is public, and it is tested, and it is still
something a reader has to implement or trust somebody else's implementation
of.

That third one has a counterpart worth stating in the same breath. Storing a
base64 image on chain also requires a specification, PNG, to become a picture.
The difference between that approach and this one is how widely the decoder is
already installed, which is a fact about adoption and not about where the art
lives.

## Why the program and not the picture

Storing a rendered image on chain and storing the program that draws it are
the same kind of claim: in both cases the bytes on chain are not the artwork
until something interprets them. Neither a PNG nor an HTML document is
viewable as raw storage.

What differs is what each buys.

A program yields an edition of any size from one upload. Prancer Portraits is
49KB of storage serving forty pieces so far, and it would serve four thousand
at the same cost. The equivalent in stored images grows with every mint.

A program is also verifiable in a way a stored image is not. `code_hash` says
these exact bytes are the artwork, and anyone can re-run them with any token's
seed and check the output against what was published. A stored image has
nothing to check against. It is the output, and whether it is the right output
is unanswerable.

Keeping the program is the arrangement where the chain holds the thing that
decides, and everything else is derived from it.

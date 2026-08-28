# Libraries

How a generator asks for p5 or three.js instead of carrying a copy, what that
costs, what happens at each stage, and what to do when the library you want is
not one we can load.

Written for the artist. The protocol view is
[ALEATORY-001 §1](interface.md#declared-libraries).

---

## Why declare instead of bundle

A generator is stored on chain, and you pay for the bytes once, at publish. p5
minified is about 900 kB. Pasting it into your file means paying to store a
copy of p5 that thousands of other pieces also store, and it means your
generator no longer fits in a single Tezos operation.

Declaring is the alternative. Your file says which library it needs, and
whoever draws it supplies that library before your code runs. Your bytes stay
yours.

You are never required to declare. Bundle anything you like, up to what fits.
Declaring exists so you do not have to spend your size on a library everybody
already has.

---

## The tag

One meta tag, in `<head>`, per library:

```html
<meta name="alea:library" content="p5@1.5.0">
```

`name` is always `alea:library`. `content` is `package@version`, an exact
version, never a range and never `latest`. Two libraries means two tags, and
they load in the order they appear.

That tag is the whole declaration. It travels inside your file, so you can
download a template, work on it for a month in your own editor, upload it
again, and it still says what it needs. Nothing is remembered on our side.

**Do not add a `<script src="https://...">` tag.** A piece is refused the
network while it renders. A generator that tries to fetch anything gets
nothing, draws nothing, and is captured as a blank frame, which you discover
after minting, when the piece can no longer be changed. Declaring is how you
ask for a library; a script tag is how you lose a piece.

---

## What you can declare today

| Tag | Size | Notes |
|---|---|---|
| `p5@1.5.0` | ~900 kB | The p5 global build. `setup`/`draw` work as normal. |
| `three@0.160.1` | ~670 kB | The last three.js release with a classic global build. Later versions ship ES modules only, which a generator cannot use from a plain script tag. |

That is the list. It is short because each entry has to be pinned, hashed and
checked, not because the mechanism is limited.

**Anything else fails**, and it fails the same way everywhere: the local server
in your starter kit refuses it and tells you, the studio warns that nothing
will load it, and no renderer will draw it. If you need a library that is not
here, bundle it into your file.

---

## What happens, in order

**While you work.** The local server in your starter kit reads your tags and
loads those libraries from a CDN so your piece runs. It never edits your file.

**In the studio.** The same tags are read, and the library is fetched through
our own origin and checked against the hash we recorded for it. If the bytes
are not what we expect, it does not load, and the preview says so rather than
drawing something wrong.

**At publish.** The declaration is written into your collection's metadata
alongside your code:

```json
[{ "id": "p5", "version": "1.5.0", "path": "lib/p5.min.js", "hash": "16f48a…" }]
```

`id`, `version` and `path` are npm coordinates, enough for anyone to find the
file. `hash` is blake2b-256 of its exact bytes.

**At render.** A provider reads that record, fetches the library from npm or
any mirror of it, and hashes what came back. Matching bytes are used. Anything
else is refused and the piece is not drawn, because drawing a p5 sketch without
p5 produces a blank image, and publishing that as the artwork is worse than
publishing nothing.

**Forever after.** The record is on chain and does not depend on us. Anyone can
resolve your piece from it: the coordinates say what to fetch and the hash says
whether they got it. If this platform disappears, your piece still renders.

---

## Why a hash and not a URL

A URL says where. A hash says what.

If the record named a CDN, whoever runs that CDN would decide what your piece
executes, forever, and could change it after you minted. With coordinates and a
hash, the mirror is interchangeable and untrusted. Any of them either returns
the right bytes or is ignored.

We are not the authority either. `id@version` points at npm, npm publishes its
own integrity digest for every package it serves, and anyone can check the hash
we recorded against a source with no relationship to us:

```
npm view p5@1.5.0 dist.integrity
npm pack p5@1.5.0 && tar xzOf p5-1.5.0.tgz package/lib/p5.min.js | sha256sum
```

We host a fast copy of p5 because it is one hop instead of two. We are never
the thing being trusted.

Caching is by hash, never by `id@version`, so a generator declaring `p5@1.5.0`
with different bytes can only ever harm itself.

---

## Getting a library added

Open an issue. A library can be added when:

- It is on npm, publicly, with an integrity digest.
- It has a build that works from a plain `<script>` tag and defines a global.
  ES-module-only packages cannot be loaded this way.
- A specific version can be pinned. Not a range, not a dist-tag.

Adding one means recording its coordinates and hash in the catalogue, after
which it works in the kit, the studio and every renderer at once.

---

## If your library is not on the list

Bundle it. Paste the minified source into a `<script>` block in your file. It
costs you the bytes and it always works, which for anything unusual is the
right trade. The three rules do not change: self-contained, deterministic, and
call `$alea.ready()` when the drawing is done.

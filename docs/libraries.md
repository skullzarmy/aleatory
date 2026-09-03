# Libraries

How a generator asks for a library instead of carrying a copy: what it costs,
what happens at each stage, and why the record is a hash rather than a URL.

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

`name` is always `alea:library`. `content` is `package@version`, optionally
followed by `/path/to/file.js`. The version is exact, never a range and never
`latest`. Two libraries means two tags, and they load in the order they
appear.

That tag is the whole declaration. It travels inside your file, so you can
download a template, work on it for a month in your own editor, upload it
again, and it still says what it needs. Nothing is remembered on our side.

**Do not add a `<script src="https://...">` tag.** A piece is refused the
network while it renders. A generator that tries to fetch anything gets
nothing, draws nothing, and is captured as a blank frame, which you discover
after minting, when the piece can no longer be changed. Declaring is how you
ask for a library; a script tag is how you lose a piece.

---

## What you can declare

**Any package on npm.** Name it and pin a version.

```html
<meta name="alea:library" content="p5@1.5.0">
<meta name="alea:library" content="three@0.160.1">
<meta name="alea:library" content="d3@7.9.0">
<meta name="alea:library" content="@tweenjs/tween.js@23.1.3">
```

There is no list of approved libraries and no request to make. A package's own
default browser build is used, which is what a bare `name@version` means. When
a package has several builds and you want a particular one, name the file:

```html
<meta name="alea:library" content="d3@7.9.0/dist/d3.min.js">
```

Two things to watch, both about the file rather than the package:

**It has to work from a plain `<script>` tag.** A build that only exists as an
ES module or a CommonJS file cannot be loaded this way. three.js is the common
case: `0.160.1` is the last release shipping the classic global build, and
later ones are modules only.

**Pin an exact version.** Not a range, not `latest`. The version is recorded
with your piece and has to mean one thing forever.

If a package has nothing loadable, bundle it into your file instead. It costs
you the bytes and it always works. The bundler kit on
[starter kits](../src/app/templates/page.tsx) does that with esbuild, dropping
the parts you did not use: `simplex-noise` comes to 709 bytes bundled,
`d3-scale` and `d3-shape` together to about 10 kB, against 279 kB to declare
all of d3. It prints the size against what one operation can carry, so you know
whether the piece is still going on chain.

### Having it checked for you

The kit builder on [starter kits](../src/app/templates/page.tsx) does both of
those checks before you download anything. It reads the package's default build
off jsDelivr, says whether a script tag can load it and what name it puts on
`window`, and when the default is a module it looks through the package for one
that is not: `@tweenjs/tween.js` ships `dist/tween.cjs` by default and
`dist/tween.umd.js` beside it, so the coordinate it hands you names the file.

Nothing is executed to work that out. A build says which of the three it is in
its first few lines, and the name it exports is in the wrapper.

---

## What happens, in order

**While you work.** The local server in your starter kit reads your tags and
loads those libraries from a CDN so your piece runs. It never edits your file.

**In the studio.** The same tags are read, and the library is fetched through
our own origin rather than by your browser, so no CDN sees you. It is checked
against the digest jsDelivr publishes for that exact file, and bytes that do
not match are refused instead of drawn. The digest of what did arrive is what
gets recorded when you publish.

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

We are not the authority either. `id@version` points at npm, and anyone can
check a recorded hash against a source with no relationship to us:

```
npm pack p5@1.5.0
tar xzOf p5-1.5.0.tgz package/lib/p5.min.js | b2sum -l 256
```

We host a copy of p5 because it is one hop instead of two. We are never the
thing being trusted.

Caching is by hash, never by `id@version`, so a generator declaring `p5@1.5.0`
with different bytes can only ever harm itself.

---

## If a package will not load

Some packages have no build that works from a `<script>` tag. Modern three.js
is the clearest case: after `0.160.1` it ships ES modules only.

Two ways through. Pin the last version that has a classic build, which is what
`three@0.160.1` is. Or bundle it, with the bundler kit: you import the package
and esbuild writes it into your file, dropping the parts you did not use.

Which one depends on the package. three.js does not shrink, because its core is
interconnected, so even six named imports come to 132 kB and it has to be
declared. Most other things do shrink, and bundling them is both smaller and
one less thing your piece depends on at render time.

The three rules do not change either way: self-contained, deterministic, and
call `$alea.ready()` when the drawing is done.

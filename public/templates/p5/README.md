# Aleatory starter: p5.js

A generative piece, ready to work on. No install and no build step.

## Run it

```
node serve.mjs
```

Then open http://localhost:4321. Reload for a new seed. Edit `index.html`
and reload again. That is the entire loop.

- `?seed=<hex>` draws one particular piece, every time.
- `?p.<name>=<value>` sets a declared parameter, e.g. `?p.density=220`.

You can also open `index.html` directly from disk, but this kind declares a library and the server is what loads it, so the file on its own will not draw.

## What you are editing

`index.html` is the whole piece. It is what gets published, byte for byte,
and it is the only file that ends up on chain. `serve.mjs` and this README
are for you and are not part of the work.

This piece declares p5@1.5.0 in a meta tag:

```html
<meta name="alea:library" content="p5@1.5.0">
```

That tag is how the piece asks for a library. The local server reads it and
loads that library from a CDN; a renderer reads it from the record on chain
and loads a copy it has verified. Either way you never write a script tag
pointing at a CDN, and you should not add one: a piece that fetches anything
while rendering is refused the network, and the capture is of a blank frame.

## The three rules

1. **Self-contained.** Nothing fetched while rendering. Declared libraries do
   not count, because the renderer supplies them before your code runs.
2. **Deterministic.** One seed, one image. Draw twice from a fresh page and
   the two agree. Take every random decision from `$alea`, never from
   `Math.random` or the clock.
3. **Say when you are finished** by calling `$alea.ready()`. Forgetting this
   is the one mistake that yields a blank piece: the renderer captures a frame
   because nothing told it the drawing was done.

`$alea` is the global. This file binds it to `alea` first, which is why the
code reads `alea.ready()`. Same object, shorter name.

## Publishing

Drag `index.html` into the studio at https://aleatory.art/studio, or paste
it in. Nothing about it needs changing first.

Declaring a library is explained in full at
https://aleatory.art/docs/libraries, and the whole interface at
https://aleatory.art/docs/interface.

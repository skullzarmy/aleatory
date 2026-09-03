# Aleatory, the bundler kit

For packages you cannot declare.

A declared library is loaded from a meta tag and costs your generator none of
its size, but it has to work from a plain `<script>` tag, and most of npm no
longer ships anything that does. This kit imports those packages instead and
writes them into your file.

```
npm install
npm run dev          # then open http://localhost:4321
```

Reload for a new seed. Edit `src/sketch.js` and reload again. The build runs on
every request, so there is no watcher and nothing to keep in sync.

```
npm run build        # writes dist/index.html
```

`dist/index.html` is the piece. Drag it into the studio to publish it.

## What is in here

| | |
|---|---|
| `src/sketch.js` | Your generator. Import what you like. |
| `src/index.html` | The page it runs in, and where you declare libraries. |
| `build.mjs` | Bundles the sketch into one self-contained file. |
| `serve.mjs` | The local preview. |
| `dist/index.html` | The output, and the only thing that gets published. |

## Bundling against declaring

Both, as it suits you. They compose: a declared library is loaded before your
first line runs, a bundled one is part of your file.

**Declare** a large library that publishes a browser build. three.js is the
case that matters: at 132 kB even with six named imports it does not fit on
chain, and it does not shrink, because its core is interconnected. Declare
`three@0.160.1`, the last release with a global build.

**Bundle** everything else. The parts you did not use are dropped, and most
packages worth having come out small:

| | gzipped |
|---|---|
| `simplex-noise` | 709 bytes |
| `@tweenjs/tween.js` | 3.7 kB |
| `delaunator` | 3.8 kB |
| `d3-scale` + `d3-shape` | 10 kB |

That last one is the argument for this kit in one line: bundling those two
costs 10 kB and stays on chain, where declaring all of d3 makes a renderer
fetch 279 kB.

## Size

`npm run build` prints the gzipped size against 32,068 bytes, which is what one
operation can carry. Under it, your generator is stored on chain. Over it, the
piece is still publishable: it goes to IPFS and the contract stores a pointer.
That works, and it is a different promise, so the build tells you which one you
are about to make.

## The three rules

Nothing about the bundler changes them.

1. **Self-contained.** Nothing fetched while rendering. Declared libraries do
   not count: the renderer supplies them before your code runs. Never write a
   script tag pointing at a CDN into `src/index.html`.
2. **Deterministic.** One seed, one image. Take every random decision from
   `$alea`, never from `Math.random` or the clock. Pass `alea.rand` to any
   library that wants a source of randomness.
3. **Say when you are finished** by calling `alea.ready()`. Forgetting it is
   the one mistake that yields a blank piece.

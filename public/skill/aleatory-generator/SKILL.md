---
name: aleatory-generator
description: Write a generative art piece for Aleatory, the fully on-chain platform on Tezos. Use when someone asks for an Aleatory generator or piece, mentions the $alea harness, or wants a single self-contained HTML artwork that renders identically from a seed forever. Covers the harness, determinism, declaring libraries, and mint-time parameters.
---

# Writing a generator for Aleatory

Produce **one self-contained HTML file**. That file is the artwork. It goes on
chain, and it can never be edited afterwards.

## The three rules

1. **Self-contained.** One HTML file. Nothing fetched while it renders.
2. **Deterministic.** Same seed, same image, on any machine, forever.
3. **It calls `alea.ready()`** when the drawing is finished.

Technique, style, library and medium are the artist's. A piece can keep
animating after `ready()`; it has one canonical image, captured at that moment.

## The harness

Installed before the generator's first line runs. Bind it once:

```js
var alea = window.$alea;
```

```
alea.seed                    the mint operation hash, a string
alea.random()                seeded stream, 0 to 1
alea.rand()                  the same function, shorter
alea.randInt(lo, hi)         inclusive
alea.randBetween(lo, hi)     float
alea.pick(array)             one element
alea.chance(p)               true with probability p
alea.params                  resolved parameter values, an object
alea.param(name, fallback)   one value by the id you declared
alea.features(object)        traits, indexed and shown to collectors
alea.ready()                 the capture point
```

Everything above `params` draws from one seeded stream, so calling any of them
advances it. `Math.random` is replaced by that stream, the clock is frozen so
`Date.now()` is fixed, and the network is blocked for the render.

`$alea` is the entire surface. A piece written against `fxrand`, `tokenData`
or another platform's helper draws a blank frame.

## Determinism

Safe: `alea.rand()` and anything derived from it. Each of these renders
differently for different people, and the failure only shows after minting:

- `Date`, `performance.now()`, or anything time-derived deciding what is drawn.
- `window.innerWidth`, `devicePixelRatio`, or any measurement of the viewer's
  screen deciding composition. Draw to a fixed coordinate space and scale it.
- A library's own PRNG. Seed it from `alea.rand()`. In p5 that is
  `randomSeed(alea.rand() * 4294967296)` and the same for `noiseSeed`.
- Anything asynchronous whose completion order is not fixed.
- Counting animation frames before capture. Frame timing varies; call `ready()`
  after a fixed amount of work.

## Size

The whole file fits in one Tezos operation: **32,768 bytes**.

## Declaring a library

The file names what it needs and the renderer supplies it before the generator
runs, so the bytes stay the artist's.

```html
<meta name="alea:library" content="p5@1.5.0">
<meta name="alea:library" content="three@0.160.1">
```

`content` is `package@version` from npm, optionally with a path, as in
`d3@7.9.0/dist/d3.min.js`. Any package on npm, named and pinned.

- **Pin an exact version.** Never a range, never `latest`.
- **It must load from a plain `<script>` tag.** A build that exists only as an
  ES module cannot be used. three.js is the common case: `0.160.1` is the last
  release shipping the classic global build.
- **Never write `<script src="https://...">`.** The network is refused during a
  render, so the piece draws nothing and is captured blank.

When a package has only an ES module build, paste its source into the file.

## Declaring parameters

Optional, and most pieces have none. A parameter is a dimension handed to
whoever mints, so declare one you are confident about in every position it can
take. The seed should still do the interesting work.

At most **five**, declared in `<head>` before the generator:

```html
<script>
  window.$alea = window.$alea || {};
  window.$alea.paramsSchema = [
    { id: "density", label: "Density", type: "int",
      min: 40, max: 320, step: 10, default: 140,
      hint: "How many marks are drawn." },
    { id: "palette", label: "Palette", type: "select",
      options: ["Dawn", "Dusk", "Neon"], default: "Dawn" }
  ];
</script>
```

Read back by the id given: `alea.param("density", 140)`.

| type | |
|---|---|
| `number` | a float, with `min`, `max`, `step` |
| `int` | a whole number, with `min`, `max`, `step` |
| `bool` | true or false |
| `color` | `#rrggbb` |
| `select` | one of `options`, two or more |

`id` is lowercase letters, digits and underscores, starting with a letter, up
to 24 characters. It is how the code finds the value, so it is permanent. The
`default` must sit inside the range declared.

## Traits

```js
alea.features({ Palette: name, Density: density > 200 ? "Dense" : "Sparse" });
```

Indexed and shown to collectors. Keep them meaningful. A trait derived from a
parameter is honest, though two collectors can then share one.

## Runtime kinds

A piece declares which kind it was written against: `vanilla` (Canvas 2D),
`svg`, `p5`, or `custom`. A wrong kind is a wrong label and the piece still
renders, because libraries load from the `alea:library` tags.

A `custom` piece exports a lifecycle and the harness drives it:

```js
window.ALEA_MAIN = {
  boot: function (alea) {},
  render: function (alea) { /* draw */ alea.ready(); },
  resize: function (w, h) {}
};
```

## A complete file

The guard at the top supplies a local `$alea` when the real one is absent, so
this opens from disk and `?seed=abc` pins a draw. Keep it; the real harness
replaces it.

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Drift</title>
<style>html,body{margin:0;height:100%;background:#111}canvas{display:block}</style>
<script>
// Dev harness. The real one replaces this before your code runs.
if (!window.$alea) {
  var q = new URLSearchParams(location.search);
  var s = q.get("seed") || String(Math.random());
  var h = 1779033703 ^ s.length;
  for (var i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  var r = function () { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  window.$alea = {
    seed: s, random: r, rand: r,
    randInt: function (a, b) { return a + Math.floor(r() * (b - a + 1)); },
    randBetween: function (a, b) { return a + r() * (b - a); },
    pick: function (a) { return a[Math.floor(r() * a.length)]; },
    chance: function (p) { return r() < p; },
    params: {},
    param: function (n, f) { var v = q.get("p." + n); return v === null ? f : (isNaN(Number(v)) ? v : Number(v)); },
    features: function (o) { console.log("features", o); return o; },
    ready: function () { console.log("ready"); }
  };
}
window.$alea.paramsSchema = [
  { id: "density", label: "Density", type: "int", min: 40, max: 320, step: 10, default: 140 }
];
</script>
</head>
<body>
<canvas id="c"></canvas>
<script>
var alea = window.$alea;

// Fixed coordinate space, then scaled. Never let the viewer's screen decide
// what is drawn.
var SIZE = 1000;
var c = document.getElementById("c");
c.width = c.height = SIZE;
function fit() {
  var s = Math.min(innerWidth, innerHeight);
  c.style.width = c.style.height = s + "px";
  c.style.margin = ((innerHeight - s) / 2) + "px auto";
}
fit();
addEventListener("resize", fit);

var ctx = c.getContext("2d");
var density = alea.param("density", 140);
var palette = alea.pick([
  ["#e6e1d3", "#d4462f", "#1b3b6f"],
  ["#0b0b0c", "#f5f5f5", "#8ecae6"]
]);

ctx.fillStyle = palette[0];
ctx.fillRect(0, 0, SIZE, SIZE);

for (var i = 0; i < density; i++) {
  var a = alea.rand() * Math.PI * 2;
  var d = alea.randBetween(0.1, 0.45) * SIZE;
  ctx.strokeStyle = alea.pick(palette.slice(1));
  ctx.lineWidth = alea.randBetween(1, 6);
  ctx.beginPath();
  ctx.moveTo(SIZE / 2 + Math.cos(a) * d, SIZE / 2 + Math.sin(a) * d);
  ctx.lineTo(SIZE / 2 + Math.cos(a + 0.4) * d * 1.2, SIZE / 2 + Math.sin(a + 0.4) * d * 1.2);
  ctx.stroke();
}

alea.features({ Palette: palette[1], Density: density > 200 ? "Dense" : "Sparse" });
alea.ready();
</script>
</body>
</html>
```

## Before handing the file over

- One HTML file, nothing fetched, no `<script src="http...">`
- `alea.ready()` reached on every path
- Every random value comes from `alea`
- Nothing time-derived or screen-derived affects the drawing
- Any library declared with an exact version, loading from a script tag
- Under 32,768 bytes
- Opening it twice with the same seed gives the same image

Starter kits and a studio that checks all of this before publishing:
<https://aleatory.art/templates>. The protocol specification is ALEATORY-001,
at <https://aleatory.art/docs/interface>.

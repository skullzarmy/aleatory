# Aleatory, the PurelyArachnid layered PNG kit

For generative profile picture (PFP) and trait-stacking collections.

This kit turns a directory of layered transparent PNG assets into a single,
self-contained, fully on-chain Aleatory generator.

```
npm install
npm run dev          # opens http://localhost:4321
```

Reload for a new seed, or pass `?seed=<hex>` in the URL to pin one.

```
npm run build        # writes dist/index.html
```

`dist/index.html` is the piece. Drag it into the studio at https://aleatory.art/studio to publish it.

## How layers work

Think of the layers as a stack of transparent images drawn from bottom to top.

Save your layer folders inside `layers/` using this naming convention:

```
order-(options)-name
```

- **Order**: A two-digit number deciding the draw order, with `00` drawn first at the bottom of the stack.
- **Options** (optional): Parentheses containing settings like `hide` or `blend-<mode>`.
- **Name**: The trait category name reported to `$alea.features()`. Underscores become spaces.

### Layer options

| Option | Values | Meaning |
|---|---|---|
| `hide` | `true`, `false` | When true, the layer is drawn to canvas but omitted from the reported traits. |
| `blend` | Any Canvas 2D `globalCompositeOperation` | Sets the blend mode (e.g. `multiply`, `overlay`, `screen`). Default is `source-over`. |

Examples:
- `00-background`
- `01-head`
- `02-eyes`
- `05-(hide_blend-multiply)-shade`
- `08-(hide)-outline`

### Layer variations and chances

Inside each folder, save your PNG variations:

```
chance-name.png
```

- **Chance**: A positive integer relative weight. A variation with chance `10` is twice as likely to appear as one with chance `5`. Chances do not need to sum to 100.
- **Name**: The trait value recorded for collectors. Underscores become spaces.

All images should share the same dimensions (such as 1000x1000 for high resolution, or 24x24 for pixel art). An empty file or a variation named `none` draws nothing and costs no image bytes.

## On-chain size and storage

Aleatory puts generators fully on chain. The build inlines and compresses your
images into a single document.

`npm run build` quotes your generator's size against what one operation
carries (up to 26,768 bytes inline) and against walked storage chunks. A
generator past one operation is gzipped and walked on chain across multiple
signatures, paying storage burn only on the compressed bytes.

## The three rules

1. **Self-contained.** The build inlines all images as data URIs. No external requests are made while rendering.
2. **Deterministic.** One seed, one image. Every layer choice comes from `$alea.rand()`.
3. **Signals completion.** The runtime calls `$alea.ready()` once all images are drawn.

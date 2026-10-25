# @aleatory/embed

Portable, deterministic renderer and embed component for [ALEATORY-001](https://aleatory.art/docs/interface) generative artworks on Tezos.

Aleatory generators are self-contained HTML files stored immutably on chain, drawing deterministically from a mint operation hash seed. This package handles the execution harness, zero-warmup PRNG, dependency resolution, metadata extraction, and sandboxed iframe isolation for any web application or indexer.

## Installation

```bash
npm install @aleatory/embed
```

`@aleatory/embed` ships dual ESM and CommonJS builds with TypeScript declarations.

---

## Usage

### 1. React Component

```tsx
import { AleatoryViewer } from "@aleatory/embed/react";

export function ArtCard({ code, seed, params }) {
  return (
    <div style={{ width: "100%", aspectRatio: "1 / 1" }}>
      <AleatoryViewer
        code={code}
        seed={seed}
        params={params}
        liveClock={true}
        onReady={(detail) => console.log("Piece ready:", detail)}
        onError={(err) => console.error("Piece error:", err)}
      />
    </div>
  );
}
```

The component parses `<meta name="alea:library">` declarations, resolves and verifies external scripts (e.g. `p5.js`, `three.js`), and executes the piece inside a sandboxed iframe with `connect-src 'none'`.

### 2. Custom Web Component

Zero-framework, works in vanilla HTML, Vue, Svelte, or Angular:

```html
<script type="module" src="@aleatory/embed/viewer"></script>

<aleatory-viewer
  code="<!doctype html>..."
  seed="ooKxY..."
  params='{"density": 120}'
  live-clock="true"
></aleatory-viewer>

<script>
  const viewer = document.querySelector("aleatory-viewer");
  viewer.addEventListener("ready", (e) => {
    console.log("Ready, traits:", e.detail.features);
  });
</script>
```

### 3. Core Document Assembler (Headless / Node / Puppeteer)

For static thumbnail captures, CI determinism checks, or headless capture pipelines:

```ts
import { buildDocument, createPrng } from "@aleatory/embed/core";

// Generate standalone sandboxed document string with CSP and harness:
const html = buildDocument({
  code: generatorHtml,
  seed: "ooKxY...",
  params: { density: 140 },
  liveClock: false, // Freezes Date.now() and performance.now() at 0
  maxDpr: 1        // Canonical 1000x1000 DPR 1 capture
});

// Or evaluate PRNG numbers directly:
const prng = createPrng("ooKxY...");
console.log(prng.rand()); // Float [0, 1) with canonical zero-warmup sfc32
console.log(prng.randInt(1, 10)); // Inclusive
```

### 4. Indexer & Metadata Extraction

Standardized extraction of seed and parameters across TzKT and marketplace indexers:

```ts
import { extractPieceMetadata, decodeCode, fetchMintRecord } from "@aleatory/embed/indexer";

// 1. Extract from token metadata JSON:
const { seed, params, features } = extractPieceMetadata(tokenMetadata);

// 2. Fetch mint transfer and seed from TzKT when metadata is pending:
const mint = await fetchMintRecord("KT1...", 0);
console.log("Canonical seed:", mint.hash);

// 3. Decode contract storage code (gzip or identity):
const html = await decodeCode(storageHex, "gzip");
```

---

## Architectural Rules

1. **Zero-warmup PRNG:** The PRNG uses `xmur3` seeding into `sfc32` directly with 0 warmup cycles. Discarding initial draws shifts the stream and diverges from the canonical render.
2. **String Seed:** The seed is the base58 mint operation hash. Parsing it as hex or an integer (`parseInt`) produces `NaN` and coerces the seed to `0`.
3. **Execution Order:** The harness replaces `Math.random` before any declared libraries (such as `p5.js`) load, ensuring library noise and internal random states are deterministic.
4. **Clock Modes:** Captures run with frozen time (`liveClock: false`). Interactive viewers run with live time (`liveClock: true`).

---

## Subpath Exports

* `@aleatory/embed`: Everything
* `@aleatory/embed/core`: Pure PRNG, harness generator, and document assembler
* `@aleatory/embed/libraries`: Dependency coordinate parser, CDN resolver, and blake2b integrity
* `@aleatory/embed/indexer`: Metadata parsing, storage code decoder, and TzKT query recipes
* `@aleatory/embed/viewer`: Sandboxed iframe manager and `<aleatory-viewer>` web component
* `@aleatory/embed/react`: React `<AleatoryViewer />` component

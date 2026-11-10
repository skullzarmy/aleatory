# Piece exports

A generator produces media from a seed and parameters. A piece renders live in
the browser, and collectors and artists frequently need concrete digital
artifacts from that render: print-ready raster images, looping animations,
audio recordings, vector plots, 3D meshes, and symbolic data.

This document describes how exports work, the constraints that govern them, and
the contract between the artwork and the host.

---

## The two models

Generators approach interaction differently, so two paths exist:

| Model | Where the UI lives | When to use it |
|---|---|---|
| **In-artwork** | Inside the piece itself (canvas, SVG, or DOM) | Pieces with custom HUDs, menus, or interactive tools |
| **Host-mediated** | In the platform chrome around the frame | Pure generative art that keeps the canvas clean |

Both models run under the same sandbox and network constraints.

---

## 1. In-artwork exports

An artist can build an export button or keyboard trigger directly into their
generator.

The isolate allows user-initiated downloads by declaring `allow-downloads` on
its sandboxed frames. A piece creates a standard `Blob` or data URI and triggers
a download using native browser APIs:

```javascript
function saveSvg(svgElement, filename) {
  var data = new XMLSerializer().serializeToString(svgElement);
  var blob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
```

### Constraints

- **User activation required.** Modern browsers require a user gesture (such as
  a click or pointer event) to trigger a download from a sandboxed frame.
  Programmatic downloads on initial load without interaction are blocked by the
  browser.
- **Local origin.** Blob URLs created in an opaque-origin sandbox cannot be
  copied and pasted into other tabs. The download must be initiated within the
  frame context.

---

## 2. Host-mediated exports

Many generative works are pure compositions that avoid overlays, buttons, or
chrome over the art.

To support exports without forcing UI onto the canvas, a generator can declare
its export capabilities to `$alea`. The viewer reads these declarations and
renders uniform controls in the host page.

### The interface

A generator declares its supported exports during initialization:

```javascript
$alea.exports = [
  { id: "png-4k", label: "Print PNG (4000x4000)", ext: "png" },
  { id: "wav", label: "Master Audio (WAV)", ext: "wav" }
];
```

The generator defines an export handler that returns a `Promise` resolving to a
`Blob`, `ArrayBuffer`, or data URL:

```javascript
$alea.onExport = function (id, progress) {
  if (id === "png-4k") {
    return renderPrintCanvas(progress);
  }
  if (id === "wav") {
    return synthesizeAudio(progress);
  }
  return Promise.reject(new Error("Unknown export: " + id));
};
```

### Progress reporting

Heavy operations (such as multi-frame GIF rendering or software audio synthesis)
take seconds to complete. The `progress` callback accepts a value from `0.0` to
`1.0`:

```javascript
function synthesizeAudio(progress) {
  return new Promise(function (resolve) {
    var totalBlocks = 100;
    var current = 0;
    function step() {
      current++;
      progress(current / totalBlocks);
      if (current < totalBlocks) {
        setTimeout(step, 10);
      } else {
        resolve(audioBlob);
      }
    }
    step();
  });
}
```

The host displays a progress indicator in the viewer chrome while the export
computes, keeping the live artwork responsive.

---

## 3. Direct egress helper: `$alea.download`

The harness also exposes a direct convenience helper:

```javascript
$alea.download(filename, blobOrDataUrl);
```

This helper forwards the payload to the parent window over the established
`postMessage` channel. The parent window executes the file download from its own
context.

This provides two guarantees:
1. **Mobile reliability:** Avoids WebKit bugs on iOS Safari where opaque-origin
   sandboxed iframes fail to trigger the native "Save to Files" prompt.
2. **Type verification:** The host viewer inspects the filename and MIME type,
   verifying that only media and data files are saved.

---

## 4. Security model

Exporting files transfers data out of the running memory of the sandbox to the
user's local storage. The security boundaries remain intact:

- **Network isolation is permanent.** `Content-Security-Policy: connect-src 'none'`
  is enforced at every level. An export cannot phone home, report downloads to an
  external server, or fetch remote assets.
- **Opaque origin isolation.** `allow-same-origin` is absent. A piece has no
  access to cookies, local storage, or wallet sessions on `aleatory.art` or
  `isolate.aleatory.art`.
- **Executable filtering.** Host-mediated exports reject executable extensions
  (`.exe`, `.sh`, `.bat`, `.html`, `.svg` with inline `<script>` tags) and
  restrict downloads to safe media types:

| Allowed categories | Extensions |
|---|---|
| **Images** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg` |
| **Audio** | `.wav`, `.mp3`, `.ogg`, `.flac`, `.aac` |
| **Vector & 3D** | `.svg`, `.gltf`, `.glb`, `.stl`, `.obj` |
| **Data & Music** | `.mid`, `.midi`, `.json`, `.csv`, `.txt`, `.zip` |

---

## 5. Architectural roadmap

```
Phase 1: Sandbox unblocking (allow-downloads)          [Complete - PR #160]
Phase 2: Harness helper ($alea.download)               [Next]
Phase 3: Declarative registry ($alea.exports)          [Next]
Phase 4: Starter templates (WAV, GIF, 4K PNG)          [Next]
```

### Phase 1: Sandbox unblocking
Adds `allow-downloads` to `IsolateFrame.tsx`, `checks.ts`, and
`isolate/index.src.html`. Enables native `<a download>` and Blob URLs for pieces
carrying their own UI.

### Phase 2: Harness helper
Adds `$alea.download` to the harness inside `isolate/index.src.html`. Relays
`alea:download` messages through the isolate bridge to `IsolateFrame.tsx`, which
executes the download in the parent origin.

### Phase 3: Declarative registry
Expands `ArtifactFrame.tsx` to inspect declared `$alea.exports`. Renders an
"Export" menu in the bottom tray of the piece viewer, handles progress tracking,
and triggers the download on completion.

### Phase 4: Starter templates
Adds reference examples to `public/templates/`:
- **Canvas 2D:** 4K high-resolution capture with offscreen canvas.
- **Web Audio:** Pure JavaScript PCM-to-WAV encoder producing standard `.wav`
  blobs.
- **Animation:** Deterministic GIF loop recorder using an inlined or declared
  encoder.

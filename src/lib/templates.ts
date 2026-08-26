/**
 * Aleatory, starter templates.
 *
 * One per runtime kind. Each is a complete, single-file index.html that also
 * runs by being opened directly from disk: the `$alea` guard at the top provides
 * a local dev harness with a random seed when the real one isn't there. That
 * is the loop artists actually live in, reload for a new seed, pin one by URL
 * (?seed=…), and it means nothing about working locally depends on us.
 */
import type { ParamSpec } from "./params";
import { RUNTIME_KINDS } from "./runtimes";

/** The dev-harness guard prepended to every template. */
const DEV_SHIM = `    // Dev harness, only used when this file is opened outside the sandbox.
    // Reload for a new seed, pin one with ?seed=<hex>, and set any declared
    // parameter with ?p.<name>=<value>, e.g. ?p.density=220.
    if (!window.$alea) {
      var query = new URLSearchParams(location.search);
      var q = query.get("seed");
      var seed = q || Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      // xmur3, the same construction the isolate and the renderer use, so a
      // seed pinned here draws what it will draw on chain. Never parseInt: a
      // real seed is a base58 operation hash, base 16 of it is NaN, and NaN
      // coerced by an unsigned shift is 0, which is a stream of nothing.
      var h = 1779033703 ^ seed.length;
      for (var si = 0; si < seed.length; si++) {
        h = Math.imul(h ^ seed.charCodeAt(si), 3432918353);
        h = (h << 13) | (h >>> 19);
      }
      var next = function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
      };
      var a = next(), b = next(), c = next(), d = next();
      var rand = function () {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        var t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
      };
      for (var i = 0; i < 16; i++) rand();
      window.$alea = {
        seed: seed, hash: seed, params: {}, rand: rand,
        randInt: function (lo, hi) { return Math.floor(rand() * (hi - lo + 1)) + lo; },
        randBetween: function (lo, hi) { return lo + rand() * (hi - lo); },
        pick: function (arr) { return arr[Math.floor(rand() * arr.length)]; },
        chance: function (p) { return rand() < p; },
        // Declared parameters. In the lab and on chain these come from the
        // generator's declaration; here they come from the URL, so the local
        // loop can exercise the same ranges a collector will get.
        param: function (n, f) {
          var v = query.get("p." + n);
          if (v === null) return f;
          if (v === "true") return true;
          if (v === "false") return false;
          return v !== "" && !isNaN(Number(v)) ? Number(v) : v;
        },
        features: function (o) { console.log("features", o); return o; },
        ready: function () { console.log("ready, captured here"); }
      };
      window.$alea.paramsSchema = [];

      // A ALEA_MAIN piece is driven by the harness, not by itself, so opened
      // directly, with no harness present, nothing would ever call it. The dev
      // harness drives the lifecycle in the same order the real one does, after
      // layout, so a custom-runtime piece behaves the same in both places.
      var booted = false;
      var devBoot = function () {
        if (booted) return;
        booted = true;
        var main = window.ALEA_MAIN;
        if (!main) return;
        try {
          if (typeof main.boot === "function") main.boot(window.$alea);
          if (typeof main.render === "function") main.render(window.$alea);
        } catch (err) {
          console.error("[alea] lifecycle threw:", err);
          return;
        }
        if (typeof main.resize === "function") {
          window.addEventListener("resize", function () {
            main.resize(window.innerWidth, window.innerHeight);
          });
        }
      };
      var devBootWhenLaidOut = function () {
        // Never wait on requestAnimationFrame alone, it is throttled to nothing in
        // a background tab, and a piece that only boots when watched is not a piece.
        requestAnimationFrame(devBoot);
        setTimeout(devBoot, 250);
      };
      if (document.readyState === "complete") devBootWhenLaidOut();
      else window.addEventListener("load", devBootWhenLaidOut);
    }`;

const VANILLA = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>untitled system</title>
  <style>html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script>
(function () {
${DEV_SHIM}

  var alea = window.$alea;

  // ---- the system --------------------------------------------------------
  // Everything below is a pure function of alea.rand(). Same seed, same picture,
  // on any machine, forever. That is the whole contract.

  var PALETTES = [
    ["#e6e1d3", "#d4462f", "#1b3b6f", "#f2b134"],
    ["#0b0b0c", "#f5f5f5", "#8ecae6", "#fb8500"],
    ["#fef6e4", "#001858", "#f582ae", "#8bd3dd"],
    ["#111111", "#e8e8e8", "#c9184a", "#ffb703"]
  ];

  var palette = alea.pick(PALETTES);
  var drift   = alea.randBetween(0.15, 0.9);

  // ---- what the collector gets to turn ------------------------------------
  // Declared parameters, read by the name you gave them in the params panel.
  // The fallback is what a reader gets outside the lab, so keep it inside the
  // range you declared. Params are optional: delete these two lines and the
  // piece is seed-only, which is a perfectly good thing for it to be.
  //
  // Where to draw the line: the seed should still do the interesting work. A
  // parameter is a dimension you are handing over on purpose, not a way to make
  // the collector responsible for whether the piece is any good.
  var density = alea.param("density", 140);
  var spread  = alea.param("spread", 0.35);

  // Declare traits. These are indexed and shown to collectors, keep them
  // meaningful, not decorative. Traits derived from a parameter are honest;
  // just remember two collectors can now share one.
  alea.features({
    Palette: PALETTES.indexOf(palette) + 1,
    Density: density > 220 ? "dense" : density > 110 ? "medium" : "sparse",
    Drift: Math.round(drift * 100) / 100
  });

  // ---- resolve the composition ONCE, in normalized 0..1 space --------------
  // Draw the seed into data, not into pixels. Two reasons, and both matter:
  //  - the PRNG is consumed exactly once, so a redraw at a different size can
  //    never produce a different picture. Resize-safe is the same property as
  //    deterministic.
  //  - the piece renders identically as a 150px grid thumbnail and a full
  //    screen view, which is how it will actually be looked at.
  var marks = [];
  for (var i = 0; i < density; i++) {
    var t = i / density;
    marks.push({
      x: 0.5 + Math.cos(t * Math.PI * 2 + drift * 6) * (0.1 + alea.rand() * spread),
      y: 0.5 + Math.sin(t * Math.PI * 2 * drift) * (0.1 + alea.rand() * spread),
      r: 0.004 + alea.rand() * 0.06 * (1 - t),
      fill: palette[1 + Math.floor(alea.rand() * (palette.length - 1))],
      alpha: 0.25 + alea.rand() * 0.6
    });
  }

  var canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  function draw() {
    // Square and centred. The fallback matters: a frame that has not been laid
    // out yet reports 0, and a 0x0 canvas is a blank piece.
    var side = Math.min(window.innerWidth || 0, window.innerHeight || 0) || 1000;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = side * dpr;
    canvas.height = side * dpr;
    canvas.style.width = side + "px";
    canvas.style.height = side + "px";
    canvas.style.margin = Math.max(0, (window.innerHeight - side) / 2) + "px auto";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, side, side);

    for (var m = 0; m < marks.length; m++) {
      var mark = marks[m];
      ctx.beginPath();
      ctx.arc(mark.x * side, mark.y * side, mark.r * side, 0, Math.PI * 2);
      ctx.fillStyle = mark.fill;
      ctx.globalAlpha = mark.alpha;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  window.addEventListener("resize", draw);

  // Draw once the frame has been laid out, so the first paint is full size.
  // Never wait on requestAnimationFrame alone: browsers throttle it to nothing
  // in an offscreen frame, and a piece that only draws when visible is a piece
  // that fails to render in a grid, a check run, or a headless capture.
  var drawn = false;
  function start() {
    if (drawn) return;
    drawn = true;
    draw();
    // The capture point. Fire it once, when the piece is finished, previews
    // are taken here, and they must be reproducible.
    alea.ready();
  }
  requestAnimationFrame(start);
  setTimeout(start, 100);
})();
</script>
</body>
</html>
`;

const SVG_TEMPLATE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>untitled subdivision</title>
  <style>html,body{margin:0;height:100%;background:#0b0b0c;display:grid;place-items:center}svg{max-width:100vmin;max-height:100vmin}</style>
</head>
<body>
<script>
(function () {
${DEV_SHIM}

  var alea = window.$alea;

  // SVG output is text, which makes it the cheapest thing to seal fully on
  // chain, the entire artwork, code and all, in contract storage.

  // Declared parameters, the names come from the params panel, and a mint UI
  // anywhere builds its own controls from the same declaration.
  var INK = { black: "#111111", red: "#d4462f", blue: "#1b3b6f", amber: "#f2b134", green: "#3a7d44" };
  var ink = INK[alea.param("ink", "black")] || INK.black;
  var minCell = alea.param("grain", 0.08);
  var bg = "#f4f1ea";

  alea.features({ Ink: ink, Grain: minCell < 0.06 ? "fine" : minCell < 0.09 ? "medium" : "coarse" });

  var parts = [];
  function subdivide(x, y, w, h, depth) {
    var small = w < minCell || h < minCell;
    if (small || depth > 7 || (depth > 2 && alea.chance(0.22))) {
      if (alea.chance(0.55)) {
        var inset = Math.min(w, h) * alea.randBetween(0.08, 0.3);
        parts.push('<rect x="' + (x + inset) + '" y="' + (y + inset) +
          '" width="' + (w - inset * 2) + '" height="' + (h - inset * 2) +
          '" fill="' + (alea.chance(0.3) ? ink : "none") +
          '" stroke="' + ink + '" stroke-width="0.004"/>');
      } else {
        parts.push('<circle cx="' + (x + w / 2) + '" cy="' + (y + h / 2) +
          '" r="' + (Math.min(w, h) / 2) * alea.randBetween(0.3, 0.9) +
          '" fill="none" stroke="' + ink + '" stroke-width="0.004"/>');
      }
      return;
    }
    if (w > h) {
      var cut = w * alea.randBetween(0.3, 0.7);
      subdivide(x, y, cut, h, depth + 1);
      subdivide(x + cut, y, w - cut, h, depth + 1);
    } else {
      var cutY = h * alea.randBetween(0.3, 0.7);
      subdivide(x, y, w, cutY, depth + 1);
      subdivide(x, y + cutY, w, h - cutY, depth + 1);
    }
  }
  subdivide(0.05, 0.05, 0.9, 0.9, 0);

  document.body.insertAdjacentHTML("beforeend",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1000" height="1000">' +
    '<rect width="1" height="1" fill="' + bg + '"/>' + parts.join("") + '</svg>');

  alea.ready();
})();
</script>
</body>
</html>
`;

const P5_TEMPLATE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>untitled sketch</title>
  <style>html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}canvas{display:block}</style>
  <!--
    p5 1.5.0 is inlined above this comment, in full. It is part of your piece,
    the same way it is part of an fxhash bundle: whatever is not in this file is
    not in the artwork, and a piece that needs this website to fill in the
    missing half is a piece that dies with this website.

    It is large, so a p5 collection is published to IPFS with its hash on chain
    rather than into contract storage. The Cost panel says which you are getting
    before you sign anything.
  -->
</head>
<body>
<script>
${DEV_SHIM}

var alea = window.$alea;
var palette, count, scale;

function setup() {
  // The fallback covers a frame that has not been laid out yet.
  var side = min(windowWidth, windowHeight) || 1000;
  createCanvas(side, side);
  pixelDensity(min(window.devicePixelRatio || 1, 2));
  noLoop();

  // Seed p5's own generators, or nothing here is reproducible. These are the
  // two most important lines in a p5 template.
  //
  // Draw them from alea.rand(), which is already seeded from the piece's seed.
  // Not from the seed string: that is a base58 operation hash, parseInt of it
  // in base 16 is NaN, and p5 coerces its seed with an unsigned shift, which
  // turns NaN into 0. Every piece then shares one perlin table, so every piece
  // is the same drawing in a different palette.
  randomSeed(alea.rand() * 4294967296);
  noiseSeed(alea.rand() * 4294967296);

  palette = alea.pick([
    ["#0b0b0c", "#e6e1d3", "#d4462f"],
    ["#fef6e4", "#001858", "#f582ae"],
    ["#f4f1ea", "#111111", "#3a7d44"]
  ]);
  // Declared parameters, read by the names in the params panel.
  count = alea.param("count", 800);
  scale = alea.param("flow", 0.004);

  alea.features({
    Palette: palette[2],
    Flow: scale > 0.006 ? "turbulent" : scale > 0.004 ? "rolling" : "calm",
    Count: count
  });
}

function draw() {
  background(palette[0]);
  stroke(palette[1]);
  strokeWeight(width * 0.0015);
  noFill();

  for (var i = 0; i < count; i++) {
    var x = alea.rand() * width;
    var y = alea.rand() * height;
    if (alea.chance(0.12)) stroke(palette[2]); else stroke(palette[1]);

    beginShape();
    for (var s = 0; s < 60; s++) {
      vertex(x, y);
      var a = noise(x * scale, y * scale) * TWO_PI * 2;
      x += cos(a) * 3;
      y += sin(a) * 3;
      if (x < 0 || x > width || y < 0 || y > height) break;
    }
    endShape();
  }

  // The capture point. Fire it once, when the piece is finished.
  alea.ready();
}
</script>
</body>
</html>
`;

const CUSTOM_TEMPLATE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>untitled custom runtime</title>
  <style>html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script>
${DEV_SHIM}

// The "custom" kind: bring any engine you like. Implement the lifecycle and
// everything downstream, determinism checks, capture, cost, publishing,
// indexing, market, works identically to a first-party runtime.
//
//   boot(ctx)      required, called once, before anything is drawn
//   render(ctx)    required, produce the output
//   features()     optional, traits derived from the seed
//   resize(w, h)   optional, omit and the harness re-boots at the new size
//
// ctx is $alea: { seed, rand(), randInt(), randBetween(), pick(), chance(),
//               param(name, fallback), features(obj), ready() }

window.ALEA_MAIN = {
  canvas: null,
  ctx2d: null,
  hue: 0,
  bars: 0,
  rows: null,

  // boot() consumes the seed exactly once and turns it into data. render()
  // only paints that data. Keep this split: it is what makes a piece safe to
  // redraw at any size, and it is the same property as determinism.
  boot: function (alea) {
    this.canvas = document.createElement("canvas");
    document.body.appendChild(this.canvas);
    this.ctx2d = this.canvas.getContext("2d");

    this.hue = alea.randInt(0, 359);
    // Declared parameters. ctx.param(name, fallback) is the same call in every
    // runtime kind, the declaration lives in the params panel, not in here.
    this.bars = alea.param("bars", 18);
    var chroma = alea.param("chroma", 0.6);
    this.rows = [];
    for (var i = 0; i < this.bars; i++) {
      this.rows.push({
        fill: "hsl(" + ((this.hue + i * 7) % 360) + "," + (10 + alea.rand() * 70 * chroma) + "%," + (20 + alea.rand() * 60) + "%)",
        x: alea.rand() * 0.4,
        w: 0.2 + alea.rand() * 0.6,
        h: alea.randBetween(0.3, 0.95)
      });
    }
  },

  render: function (alea) {
    var side = Math.min(window.innerWidth || 0, window.innerHeight || 0) || 1000;
    this.canvas.width = this.canvas.height = side;
    this.canvas.style.margin = Math.max(0, (window.innerHeight - side) / 2) + "px auto";

    var c = this.ctx2d;
    c.fillStyle = "hsl(" + this.hue + ",18%,8%)";
    c.fillRect(0, 0, side, side);

    var h = side / this.bars;
    for (var i = 0; i < this.rows.length; i++) {
      var row = this.rows[i];
      c.fillStyle = row.fill;
      c.fillRect(side * row.x, i * h, side * row.w, h * row.h);
    }

    alea.ready();
  },

  features: function () {
    return { Hue: this.hue, Bars: this.bars };
  },

  resize: function () {
    if (window.$alea) this.render(window.$alea);
  }
};
</script>
</body>
</html>
`;

const BY_KIND: Record<string, string> = {
    vanilla: VANILLA,
    svg: SVG_TEMPLATE,
    p5: P5_TEMPLATE,
    custom: CUSTOM_TEMPLATE,
};

/**
 * The parameter declarations each template's code is written against.
 *
 * Loading a template loads these into the params panel, so the two halves , 
 * the `alea.param("density", …)` call and the declaration a collector's control
 * is built from, arrive already agreeing with each other. An artist starting
 * from a template sees a working example of the whole mechanism rather than a
 * feature they have to go find.
 */
const PARAMS_BY_KIND: Record<string, ParamSpec[]> = {
    vanilla: [
        { id: "density", label: "Density", type: "int", min: 40, max: 320, step: 10, default: 140, hint: "How many marks are drawn." },
        { id: "spread", label: "Spread", type: "number", min: 0.05, max: 0.5, step: 0.01, default: 0.35, hint: "How far marks wander from the ring." },
    ],
    svg: [
        {
            id: "ink",
            label: "Ink",
            type: "select",
            options: ["black", "red", "blue", "amber", "green"],
            default: "black",
            hint: "The single colour every line is drawn in.",
        },
        { id: "grain", label: "Grain", type: "number", min: 0.03, max: 0.16, step: 0.005, default: 0.08, hint: "Smaller subdivides further." },
    ],
    p5: [
        { id: "count", label: "Lines", type: "int", min: 200, max: 1600, step: 50, default: 800 },
        { id: "flow", label: "Turbulence", type: "number", min: 0.001, max: 0.01, step: 0.0005, default: 0.004 },
    ],
    custom: [
        { id: "bars", label: "Bars", type: "int", min: 4, max: 48, step: 1, default: 18 },
        { id: "chroma", label: "Chroma", type: "number", min: 0, max: 1, step: 0.01, default: 0.6, hint: "0 is grey, 1 is fully saturated." },
    ],
};

export function templateFor(kindId: number): string {
    const kind = RUNTIME_KINDS.find((k) => k.kindId === kindId);
    return BY_KIND[kind?.name ?? "vanilla"] ?? VANILLA;
}

export function templateParamsFor(kindId: number): ParamSpec[] {
    const kind = RUNTIME_KINDS.find((k) => k.kindId === kindId);
    // Copied, not shared: the panel edits these in place.
    return (PARAMS_BY_KIND[kind?.name ?? "vanilla"] ?? []).map((p) => ({ ...p, options: p.options ? [...p.options] : undefined }));
}

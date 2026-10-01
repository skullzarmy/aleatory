// The one seeded-PRNG construction every $alea implementation must share:
// isolate/index.html, provider/render.mts, and the starter templates under
// public/templates/. Read as raw text (fs.readFileSync) and interpolated into
// each surface's own harness by provider/render.mts, isolate's build step
// (isolate/build.mjs), and the template build (scripts/build-templates.mts) —
// never hand-retyped. A seed pinned anywhere draws the same numbers everywhere,
// or nothing else about this platform's determinism claim holds.
//
// Each consumer still does its own seeding call (`xmur3(seed)`, `sfc32(s(),s(),s(),s())`)
// and its own Math.random wiring — those legitimately differ (isolate counts
// calls, the provider doesn't, templates read from the URL) and stay separate.
function xmur3(str) {
  var h = 1779033703 ^ str.length;
  for (var i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    var t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

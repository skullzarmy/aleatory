/**
 * Aleatory, the runtime harness.
 *
 * This is the code that boots inside the sandbox frame, before the artist's
 * code, and provides the whole contract described in docs/aleatory:
 *
 *   - a seeded PRNG, so the piece is a pure function of (code, seed, params)
 *   - the $alea lifecycle: boot / render / ready / features / resize
 *   - a compatibility shim for the older fxhash-era globals, so existing
 *     artist code runs unmodified, nothing stranded
 *   - mechanical enforcement of the determinism rule: network access is
 *     blocked and reported, Math.random is substituted and reported
 *   - deterministic capture at the declared capture point, digested so two
 *     runs of the same seed can be compared
 *
 * It is shipped as a source string because it must be injected into a
 * sandboxed srcdoc frame with an opaque origin, nothing here can be imported
 * by the frame, so everything the frame needs travels with it.
 */

/**
 * Bumped when the harness changes behaviour. Recorded on chain per generator
 * as `standard_version`, so a piece always boots the harness it was made for.
 *
 * v2 adds declared mint-time parameters: `$alea.params` is populated from the
 * generator's schema, `$alea.paramsSchema` exposes the declaration to the piece,
 * and a read of an undeclared name is reported. v1 code is unaffected, it
 * declared nothing, so it receives nothing, and every v1 entry point still
 * means exactly what it meant. Serving one harness for both is the v0 shortcut;
 * archiving a harness per (kind, standard_version) is v1 work (architecture §3).
 */
export const STANDARD_VERSION = 2;

/** Messages posted from the frame to the lab. */
export type FrameMessage =
    | { type: "alea:boot"; seed: string }
    | {
          type: "alea:ready";
          seed: string;
          /** sha-256 (or fallback) of the captured output, the determinism digest. */
          digest: string;
          /** data: URL of the capture, only when requested. */
          image: string | null;
          /** What the capture came from. */
          source: "canvas" | "svg" | "none";
          features: Record<string, string | number | boolean>;
          violations: Violation[];
          /**
           * How many times the piece reached for Math.random. Not a violation:
           * the seeded stream is substituted, so the run stays reproducible, and
           * libraries call it too (p5 does, during init). Reported only where it
           * is actionable, as a likely cause when two runs of one seed differ.
           */
          mathRandomCalls: number;
          /** ms from boot to ready(). */
          elapsed: number;
          /** true when ready() never fired and we captured on the timeout. */
          autoCaptured: boolean;
      }
    | { type: "alea:violation"; violation: Violation }
    | { type: "alea:error"; message: string }
    /** An fxhash-era piece declaring its params in code. Offered to the studio
     *  for import into the panel, see the `$fx.params` shim. */
    | { type: "alea:params-declared"; params: unknown[] };

export interface Violation {
    kind: "network" | "capture" | "runtime";
    detail: string;
}

export interface HarnessConfig {
    /** 64 hex chars, the seed. */
    seed: string;
    /**
     * The mint-time parameter values, ALREADY resolved against the schema by
     * params.resolveParams. The harness clamps nothing: resolution is one rule
     * in one place, shared by every caller, or it is two rules that disagree.
     */
    params: Record<string, unknown>;
    /** The declaration the values were resolved against. Empty when none. */
    paramsSchema?: ParamDeclaration[];
    /** Return the capture image, not just its digest. */
    wantImage: boolean;
    /** ms after load before we give up waiting for ready() and capture anyway. */
    timeout: number;
}

/** The subset of a ParamSpec the frame needs. Structurally a ParamSpec; typed
 *  loosely here so runtime.ts stays importable by anything, including the
 *  frame-side tooling that has no business knowing about the studio. */
export interface ParamDeclaration {
    id: string;
    label: string;
    type: string;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    default: number | boolean | string;
    hint?: string;
}

/**
 * The harness source. `__GX_CONFIG__` is replaced with a JSON literal by
 * buildSandboxDoc. Written as ES5-flavoured JS on purpose: it runs before
 * anything else in a frame we do not control, and it should never be the
 * reason a piece fails to boot.
 */
export const HARNESS_SOURCE = String.raw`
(function () {
  "use strict";
  var CFG = __GX_CONFIG__;
  var t0 = Date.now();
  var violations = [];
  var featureStore = {};
  var captured = false;
  var booted = false;

  function post(msg) {
    try { parent.postMessage(msg, "*"); } catch (e) { /* frame is gone */ }
  }

  function violate(kind, detail) {
    for (var i = 0; i < violations.length; i++) {
      // Collapse repeats, one fetch in a loop is one problem, not five hundred.
      if (violations[i].kind === kind && violations[i].detail === detail) return;
    }
    var v = { kind: kind, detail: detail };
    violations.push(v);
    post({ type: "alea:violation", violation: v });
  }

  // --- seeded prng ---------------------------------------------------------
  // sfc32, seeded from the first 128 bits of the seed. The same construction
  // artists already know; a piece is a pure function of this stream.
  function word(hex, i) { return parseInt(hex.substr(i * 8, 8), 16) >>> 0; }
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
  var rand = sfc32(word(CFG.seed, 0), word(CFG.seed, 1), word(CFG.seed, 2), word(CFG.seed, 3));
  for (var w = 0; w < 16; w++) rand();

  // --- determinism enforcement --------------------------------------------
  // Math.random is replaced by the seeded stream, so a piece that reaches for it
  // still runs reproducibly. The call is counted but NOT reported as a violation:
  // libraries call Math.random too (p5 does, during its own init), and the harness
  // cannot tell library frames from artist frames without parsing stack strings.
  //
  // Reporting it standalone meant every p5 project tripped a warning its author
  // could do nothing about, which is how a warning becomes noise. The count rides
  // along on the ready message instead, and is surfaced only where it is
  // actionable: as a likely cause when two runs of one seed actually differ.
  var mathRandomCalls = 0;
  Math.random = function () {
    mathRandomCalls++;
    return rand();
  };

  function blocked(name) {
    return function () {
      violate("network", name + " was called at render time. A piece must run with no network.");
      throw new Error("[alea] network access is not allowed: " + name);
    };
  }
  try { window.fetch = blocked("fetch()"); } catch (e) {}
  try { XMLHttpRequest.prototype.open = blocked("XMLHttpRequest.open()"); } catch (e) {}
  try { window.WebSocket = blocked("new WebSocket()"); } catch (e) {}
  try { window.EventSource = blocked("new EventSource()"); } catch (e) {}
  try { window.Worker = blocked("new Worker()"); } catch (e) {}
  try { navigator.sendBeacon = blocked("navigator.sendBeacon()"); } catch (e) {}

  // Catches what the API overrides cannot: <img src>, @font-face, <link>, and
  // anything else the document itself reaches for. The CSP does the blocking;
  // this only reports it.
  document.addEventListener("securitypolicyviolation", function (e) {
    var uri = e.blockedURI || "(unknown)";
    if (uri === "data" || uri === "blob" || uri === "about") return;
    violate("network", "blocked request to " + uri + " (" + (e.violatedDirective || "csp") + ")");
  });

  window.addEventListener("error", function (e) {
    post({ type: "alea:error", message: String((e && e.message) || "unknown error") });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    post({ type: "alea:error", message: String((r && r.message) || r || "unhandled rejection") });
  });

  // --- capture -------------------------------------------------------------
  function largestCanvas() {
    var list = document.getElementsByTagName("canvas");
    var best = null, bestArea = -1;
    for (var i = 0; i < list.length; i++) {
      var c = list[i], area = (c.width || 0) * (c.height || 0);
      if (area > bestArea) { bestArea = area; best = c; }
    }
    return bestArea > 0 ? best : null;
  }

  function grab() {
    var canvas = largestCanvas();
    if (canvas) {
      try { return { data: canvas.toDataURL("image/png"), source: "canvas" }; }
      catch (e) { violate("capture", "canvas could not be read: " + e.message); }
    }
    var svg = document.querySelector("svg");
    if (svg) {
      try {
        var xml = new XMLSerializer().serializeToString(svg);
        return { data: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml))), source: "svg" };
      } catch (e) { violate("capture", "svg could not be serialized: " + e.message); }
    }
    return { data: null, source: "none" };
  }

  function digest(text) {
    if (!text) return Promise.resolve("");
    try {
      if (crypto && crypto.subtle && crypto.subtle.digest) {
        var buf = new TextEncoder().encode(text);
        return crypto.subtle.digest("SHA-256", buf).then(function (out) {
          var b = new Uint8Array(out), s = "";
          for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
          return s;
        });
      }
    } catch (e) { /* fall through */ }
    // Opaque origins without subtle crypto: a cheap rolling hash is enough to
    // tell "same output" from "different output", which is all the check needs.
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < text.length; i++) {
      h1 = (h1 ^ text.charCodeAt(i)) >>> 0;
      h1 = (h1 * 16777619) >>> 0;
      h2 = (h2 + text.charCodeAt(i) * (i + 1)) >>> 0;
    }
    return Promise.resolve("fnv" + h1.toString(16) + h2.toString(16));
  }

  function collectFeatures() {
    var out = {};
    for (var k in featureStore) if (Object.prototype.hasOwnProperty.call(featureStore, k)) out[k] = featureStore[k];
    var main = window.ALEA_MAIN;
    if (main && typeof main.features === "function") {
      try {
        var extra = main.features();
        if (extra) for (var j in extra) if (Object.prototype.hasOwnProperty.call(extra, j)) out[j] = extra[j];
      } catch (e) { violate("runtime", "features() threw: " + e.message); }
    }
    // fxhash-era: window.$fxhashFeatures
    if (window.$fxhashFeatures) {
      var f = window.$fxhashFeatures;
      for (var m in f) if (Object.prototype.hasOwnProperty.call(f, m)) out[m] = f[m];
    }
    var clean = {};
    for (var n in out) {
      var v = out[n];
      var tv = typeof v;
      clean[n] = (tv === "number" || tv === "boolean" || tv === "string") ? v : String(v);
    }
    return clean;
  }

  function finish(auto) {
    if (captured) return;
    captured = true;
    // One frame of slack so the last draw call has actually painted, but never
    // wait on rAF alone: an offscreen frame (the determinism check runs two of
    // them) can be throttled hard enough that it never fires.
    var grabbed = false;
    function take() {
      if (grabbed) return;
      grabbed = true;
      var shot = grab();
      if (shot.source === "none") {
        violate("capture", "nothing to capture, no canvas and no svg in the document.");
      }
      digest(shot.data || "").then(function (d) {
        post({
          type: "alea:ready",
          seed: CFG.seed,
          digest: d,
          image: CFG.wantImage ? shot.data : null,
          source: shot.source,
          features: collectFeatures(),
          violations: violations,
          mathRandomCalls: mathRandomCalls,
          elapsed: Date.now() - t0,
          autoCaptured: !!auto,
        });
      });
    }
    requestAnimationFrame(function () { setTimeout(take, 0); });
    setTimeout(take, 300);
  }

  // --- declared parameters ---------------------------------------------------
  // Values arrive already resolved against the declaration (clamped, snapped to
  // the step grid, defaults filled in), see lib/aleatory/params.ts. The frame
  // re-resolves nothing, because two implementations of one rule is how the same
  // token ends up rendering differently in two places.
  var paramSchema = CFG.paramsSchema || [];
  var paramValues = CFG.params || {};
  var declared = {};
  for (var pi = 0; pi < paramSchema.length; pi++) declared[paramSchema[pi].id] = paramSchema[pi];

  function readParam(name, fallback) {
    if (Object.prototype.hasOwnProperty.call(paramValues, name)) return paramValues[name];
    if (Object.prototype.hasOwnProperty.call(declared, name)) return declared[name]["default"];
    // A read of a name the generator never declared. Not fatal, the fallback
    // stands and the piece renders, but it is almost always a typo or a param
    // that was renamed in one place and not the other, and the collector's mint
    // UI will have no control for it. Reported so the checks catch it before the
    // record is immutable.
    violate("runtime", 'the piece read an undeclared parameter "' + name + '". ' +
      "Declare it in the params panel, or the value a collector sets will never reach the code.");
    return fallback;
  }

  // --- the $alea surface -----------------------------------------------------
  var alea = {
    version: 2,
    seed: CFG.seed,
    hash: CFG.seed,
    params: paramValues,
    /** The declaration itself, so a piece can label its own controls. */
    paramsSchema: paramSchema,
    rand: rand,
    randInt: function (min, max) { return Math.floor(rand() * (max - min + 1)) + min; },
    randBetween: function (min, max) { return min + rand() * (max - min); },
    pick: function (arr) { return arr[Math.floor(rand() * arr.length)]; },
    chance: function (p) { return rand() < p; },
    param: readParam,
    features: function (obj) {
      if (!obj) return featureStore;
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) featureStore[k] = obj[k];
      return featureStore;
    },
    ready: function () { finish(false); },
  };
  window.$alea = alea;

  // --- fxhash-era compatibility -------------------------------------------
  // An artist should be able to bring a finished system here without editing it.
  window.fxhash = CFG.seed;
  window.fxrand = rand;
  window.fxpreview = function () { alea.ready(); };
  window.isFxpreview = false;
  window.$fxhashFeatures = window.$fxhashFeatures || undefined;
  window.$fx = {
    hash: CFG.seed,
    rand: rand,
    preview: function () { alea.ready(); },
    isPreview: false,
    features: function (obj) { window.$fxhashFeatures = obj; return obj; },
    getFeature: function (name) { var f = window.$fxhashFeatures || {}; return f[name]; },
    getFeatures: function () { return window.$fxhashFeatures || {}; },
    getParam: function (name) { return readParam(name, undefined); },
    getParams: function () { return paramValues; },
    getRawParam: function (name) { return readParam(name, undefined); },
    // fxhash-era projects declare their params by calling this at load time. We
    // keep the declaration in the record instead, a mint UI has to be buildable
    // by reading chain state, never by executing the artwork. So the call is not
    // ignored: it is forwarded to the studio, which offers to import it into the
    // params panel. An imported project arrives with its controls intact rather
    // than with a silently dead declaration.
    params: function (definition) {
      try { post({ type: "alea:params-declared", params: definition || [] }); } catch (e) {}
      return definition;
    },
    on: function () { return function () {}; },
    emit: function () {},
  };

  // --- lifecycle -----------------------------------------------------------
  function boot() {
    if (booted) return;
    booted = true;
    post({ type: "alea:boot", seed: CFG.seed });
    var main = window.ALEA_MAIN;
    if (main && typeof main.boot === "function") {
      try { main.boot(alea); } catch (e) { post({ type: "alea:error", message: "boot() threw: " + e.message }); }
    }
    if (main && typeof main.render === "function") {
      try { main.render(alea); } catch (e) { post({ type: "alea:error", message: "render() threw: " + e.message }); }
    }
    if (main && typeof main.resize === "function") {
      window.addEventListener("resize", function () {
        try { main.resize(window.innerWidth, window.innerHeight); } catch (e) { /* artist's problem, not fatal */ }
      });
    }
    // The capture deadline. A piece that never signals still produces a preview,
    // and the missing signal is reported rather than silently tolerated.
    setTimeout(function () {
      if (captured) return;
      violate("capture", "ready() was never called, captured on the " + CFG.timeout + "ms deadline instead. " +
        "Call $alea.ready() (or fxpreview()) at the capture point so previews are reproducible.");
      finish(true);
    }, CFG.timeout);
  }

  // Boot after layout, never merely after parse. A frame that has not been laid
  // out yet reports innerWidth 0, and a piece that sizes itself from the window
  // at parse time draws nothing at all, the single most common way a first run
  // comes back blank.
  function bootWhenLaidOut() {
    requestAnimationFrame(function () { setTimeout(boot, 0); });
    // rAF can be starved in a hidden or offscreen frame; boot anyway.
    setTimeout(boot, 250);
  }
  if (document.readyState === "complete") {
    bootWhenLaidOut();
  } else {
    window.addEventListener("load", bootWhenLaidOut);
    // If something in the document never finishes loading, don't wait forever.
    setTimeout(bootWhenLaidOut, 1500);
  }
})();
`;

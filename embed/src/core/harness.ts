import type { HarnessOptions } from "./types.js";

/**
 * Builds the canonical in-page harness script.
 */
export function buildHarnessScript(options: HarnessOptions): string {
    const config = JSON.stringify({
        seed: String(options.seed || "unseeded"),
        params: options.params || {},
        paramsSchema: options.paramsSchema || [],
        wantImage: Boolean(options.wantImage),
        freezeClock: options.liveClock === false,
        maxDpr: options.maxDpr,
        timeout: options.timeout || 20000,
    }).replace(/<\/script/gi, "<\\/script");

    return `(function () {
  "use strict";
  var CFG = ${config};

  if (CFG.maxDpr) {
    Object.defineProperty(window, "devicePixelRatio", {
      get: function () { return CFG.maxDpr; }
    });
  }

  var t0 = Date.now();
  var violations = [];
  var featureStore = {};
  var captured = false;
  var autoCaptured = false;

  function post(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, "*");
      }
    } catch (e) {}
  }

  function violate(kind, detail) {
    for (var i = 0; i < violations.length; i++) {
      if (violations[i].kind === kind && violations[i].detail === detail) return;
    }
    var v = { kind: kind, detail: detail };
    violations.push(v);
    post({ type: "alea:violation", violation: v, kind: kind, detail: detail });
  }

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

  var s = xmur3(String(CFG.seed || "unseeded"));
  var rand = sfc32(s(), s(), s(), s());

  var mathRandomCalls = 0;
  Math.random = function () {
    mathRandomCalls++;
    return rand();
  };

  var RealDate = Date;
  if (CFG.freezeClock) {
    var FIXED = 0;
    Date = class extends RealDate {
      constructor() {
        if (arguments.length === 0) super(FIXED);
        else super(...arguments);
      }
      static now() { return FIXED; }
    };
    performance.now = function () { return 0; };
  }

  window.addEventListener("error", function (e) {
    var where = e.lineno ? " (line " + e.lineno + ")" : "";
    post({
      type: "alea:error",
      message: (e.message || "Script error") + where,
      line: e.lineno || null
    });
  });

  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    post({
      type: "alea:error",
      message: "Unhandled rejection: " + ((r && r.message) || String(r)),
      line: null
    });
  });

  window.addEventListener("securitypolicyviolation", function (e) {
    violate("network", e.violatedDirective + " " + (e.blockedURI || ""));
  });

  ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"].forEach(function (name) {
    var target = name === "sendBeacon" ? navigator : window;
    var original = target[name];
    if (!original) return;
    target[name] = function () {
      violate("network", name + "()");
      throw new Error("Network access is not available to a piece.");
    };
  });

  var schema = CFG.paramsSchema || [];
  var declared = {};
  for (var i = 0; i < schema.length; i++) declared[schema[i].id] = true;

  function readParam(name, fallback) {
    if (!(name in declared) && schema.length > 0) {
      violate("runtime", 'param("' + name + '") is not declared');
    }
    return name in CFG.params ? CFG.params[name] : fallback;
  }

  var COVER_PX = 1200;
  function rasterize(svg, done) {
    var settled = false;
    var timer = null;
    function settle(url) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      done(url);
    }
    timer = setTimeout(function () { settle(null); }, 4000);

    try {
      var box = svg.getBoundingClientRect();
      var view = svg.viewBox && svg.viewBox.baseVal;
      var w = (view && view.width) || parseFloat(svg.getAttribute("width")) || box.width || 1000;
      var h = (view && view.height) || parseFloat(svg.getAttribute("height")) || box.height || 1000;

      var clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      if (!(view && view.width)) clone.setAttribute("viewBox", "0 0 " + w + " " + h);

      var sheets = "";
      var styles = document.querySelectorAll("style");
      for (var si = 0; si < styles.length; si++) {
        if (styles[si].id !== "alea-frame") sheets += styles[si].textContent || "";
      }
      if (sheets) {
        var style = document.createElementNS("http://www.w3.org/2000/svg", "style");
        style.textContent = sheets;
        clone.insertBefore(style, clone.firstChild);
      }

      var scale = Math.max(1, COVER_PX / Math.max(w, h));
      var W = Math.max(1, Math.round(w * scale));
      var H = Math.max(1, Math.round(h * scale));
      clone.setAttribute("width", String(W));
      clone.setAttribute("height", String(H));

      var markup = new XMLSerializer().serializeToString(clone);
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = W;
          c.height = H;
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(img, 0, 0, W, H);
          settle(c.toDataURL("image/png"));
        } catch (e) { settle(null); }
      };
      img.onerror = function () { settle(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    } catch (e) { settle(null); }
  }

  function send(digest, image, source) {
    document.documentElement.setAttribute("data-alea-ready", "1");
    document.documentElement.setAttribute("data-alea-auto-captured", autoCaptured ? "1" : "0");
    document.documentElement.setAttribute("data-alea-features", JSON.stringify(featureStore));

    post({
      type: "alea:ready",
      seed: CFG.seed,
      digest: digest,
      image: image,
      source: source,
      features: featureStore,
      violations: violations,
      mathRandomCalls: mathRandomCalls,
      elapsed: RealDate.now() - t0,
      autoCaptured: autoCaptured
    });
  }

  function finish() {
    if (captured) return;
    captured = true;
    var canvas = document.querySelector("canvas");
    if (canvas && canvas.toDataURL) {
      var url = "";
      try {
        url = canvas.toDataURL("image/png");
      } catch (e) {
        send("unreadable", null, "canvas");
        return;
      }
      send(url.slice(-64), CFG.wantImage ? url : null, "canvas");
      return;
    }

    var svg = document.querySelector("svg");
    var digest = String(document.body ? document.body.innerHTML.length : 0);
    if (!svg) {
      send(digest, null, "none");
      return;
    }
    if (!CFG.wantImage) {
      send(digest, null, "svg");
      return;
    }
    rasterize(svg, function (url) {
      send(digest, url, "svg");
    });
  }

  var alea = {
    version: 2,
    seed: CFG.seed,
    hash: CFG.seed,
    params: CFG.params,
    paramsSchema: schema,
    random: rand,
    rand: rand,
    randInt: function (lo, hi) { return Math.floor(rand() * (hi - lo + 1)) + lo; },
    randBetween: function (lo, hi) { return lo + rand() * (hi - lo); },
    pick: function (arr) { return arr[Math.floor(rand() * arr.length)]; },
    chance: function (p) { return rand() < p; },
    param: readParam,
    features: function (obj) {
      if (!obj) return featureStore;
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) featureStore[k] = obj[k];
      return featureStore;
    },
    ready: finish
  };
  window.$alea = alea;

  var booted = false;
  function tryBootMain() {
    if (booted) return;
    var main = window.ALEA_MAIN;
    if (!main) return;
    booted = true;
    try {
      if (typeof main.boot === "function") main.boot(window.$alea);
      if (typeof main.render === "function") main.render(window.$alea);
    } catch (err) {
      post({
        type: "alea:error",
        message: "ALEA_MAIN error: " + ((err && err.message) || String(err)),
        line: null
      });
      return;
    }
    if (typeof main.resize === "function") {
      window.addEventListener("resize", function () {
        main.resize(window.innerWidth, window.innerHeight);
      });
    }
  }

  if (document.readyState === "complete") {
    setTimeout(tryBootMain, 0);
  } else {
    window.addEventListener("load", tryBootMain);
  }

  setTimeout(function () {
    if (captured) return;
    autoCaptured = true;
    finish();
  }, CFG.timeout);
})();`;
}

import React, { useState } from "react";
import { AleatoryViewer } from "../src/react/index.js";
import type { ReadyEventPayload } from "../src/core/types.js";

const SAMPLE_CANVAS_2D = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Canvas 2D Sample</title>
  <style>html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script>
(function() {
  var alea = window.$alea;
  var canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  function draw() {
    var side = Math.min(window.innerWidth, window.innerHeight) || 1000;
    canvas.width = side;
    canvas.height = side;
    canvas.style.margin = Math.max(0, (window.innerHeight - side) / 2) + "px auto";

    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, side, side);

    var rings = alea.randInt(5, 15);
    for (var i = 0; i < rings; i++) {
      ctx.beginPath();
      ctx.arc(side / 2, side / 2, (side / 2) * ((i + 1) / rings) * 0.9, 0, Math.PI * 2);
      ctx.strokeStyle = "hsl(" + alea.randInt(0, 360) + ", 75%, 60%)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    alea.features({ Rings: rings });
    alea.ready();
  }

  draw();
  window.addEventListener("resize", draw);
})();
</script>
</body>
</html>`;

const SAMPLE_P5 = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>p5.js Sample</title>
  <meta name="alea:library" content="p5@1.5.0">
  <style>html,body{margin:0;height:100%;background:#0b0b0c;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script>
var alea = window.$alea;
var palette, count;

function setup() {
  var side = min(windowWidth, windowHeight) || 1000;
  createCanvas(side, side);
  noLoop();

  randomSeed(alea.rand() * 4294967296);
  noiseSeed(alea.rand() * 4294967296);

  palette = ["#e6e1d3", "#d4462f", "#1b3b6f", "#f2b134"];
  count = alea.randInt(200, 600);

  alea.features({ Count: count });
}

function draw() {
  background("#0b0b0c");
  strokeWeight(2);
  noFill();

  for (var i = 0; i < count; i++) {
    stroke(alea.pick(palette));
    var x = alea.rand() * width;
    var y = alea.rand() * height;
    line(x, y, x + cos(alea.rand() * TWO_PI) * 40, y + sin(alea.rand() * TWO_PI) * 40);
  }

  alea.ready();
}
</script>
</body>
</html>`;

function randomSeed(): string {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let out = "op";
    for (let i = 0; i < 49; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

/**
 * Interactive React demo illustrating `@aleatory/embed` usage with stateful seed
 * generation, dynamic library loading, and lifecycle event inspection.
 */
export function ReactEmbedDemo() {
    const [template, setTemplate] = useState<"p5" | "canvas">("p5");
    const [seed, setSeed] = useState("op4B5nJ2K8LxY7mP9qR3sT1uV2wX3yZ4aB5cD6eF7gH8jK9mN");
    const [liveClock, setLiveClock] = useState(true);
    const [maxDpr, setMaxDpr] = useState(1);
    const [readyData, setReadyData] = useState<ReadyEventPayload | null>(null);
    const [error, setError] = useState<string | null>(null);

    const code = template === "p5" ? SAMPLE_P5 : SAMPLE_CANVAS_2D;

    return (
        <div style={{ display: "flex", gap: "2rem", padding: "2rem", fontFamily: "monospace" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div>
                    <label>Template: </label>
                    <button type="button" onClick={() => setTemplate("p5")}>p5.js</button>{" "}
                    <button type="button" onClick={() => setTemplate("canvas")}>Canvas 2D</button>
                </div>
                <div>
                    <label>Seed: </label>
                    <input
                        style={{ width: "100%" }}
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                    />
                    <button type="button" onClick={() => setSeed(randomSeed())}>Randomize</button>
                </div>
                <div>
                    <label>Clock: </label>
                    <button type="button" onClick={() => setLiveClock(!liveClock)}>
                        {liveClock ? "Live (Interactive)" : "Frozen (0ms)"}
                    </button>
                </div>
                <div>
                    <label>DPR: </label>
                    <select value={maxDpr} onChange={(e) => setMaxDpr(Number(e.target.value))}>
                        <option value={1}>1 (Canonical)</option>
                        <option value={2}>2 (Retina)</option>
                    </select>
                </div>
                <div style={{ padding: "1rem", border: "1px solid #333", borderRadius: "8px" }}>
                    <h4>Telemetry:</h4>
                    {error && <div style={{ color: "red" }}>{error}</div>}
                    {readyData ? (
                        <div>
                            <div>Elapsed: {readyData.elapsed}ms</div>
                            <pre>{JSON.stringify(readyData.features, null, 2)}</pre>
                        </div>
                    ) : (
                        <div>Rendering...</div>
                    )}
                </div>
            </div>

            <div style={{ width: "500px", height: "500px", border: "1px solid #333" }}>
                <AleatoryViewer
                    code={code}
                    seed={seed}
                    liveClock={liveClock}
                    maxDpr={maxDpr}
                    onReady={(payload) => {
                        setReadyData(payload);
                        setError(null);
                    }}
                    onError={(err) => setError(err.message)}
                />
            </div>
        </div>
    );
}

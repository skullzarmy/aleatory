// Your generator. Import whatever you need; the build writes it into the file.
//
// `simplex-noise` is here because it is the shape of package this kit exists
// for: an ES module, so it cannot be declared, and 709 bytes once bundled.
import { createNoise2D } from "simplex-noise";

const alea = window.$alea;

// Everything below is a pure function of alea.rand(). Same seed, same picture,
// on any machine, forever. That is the whole contract.
//
// The noise generator takes alea.rand as its source, so it is seeded too.
// Left to its own devices it would call Math.random, which the harness has
// already replaced, but passing it is what makes that explicit.
const noise2D = createNoise2D(alea.rand);

const PALETTES = [
    ["#e6e1d3", "#d4462f", "#1b3b6f", "#f2b134"],
    ["#0b0b0c", "#f5f5f5", "#8ecae6", "#fb8500"],
    ["#fef6e4", "#001858", "#f582ae", "#8bd3dd"],
];

const palette = alea.pick(PALETTES);
const scale = alea.param("scale", 0.004);
const lines = alea.param("lines", 240);

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const ctx = canvas.getContext("2d");

function draw() {
    const size = Math.min(window.innerWidth, window.innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = 0.6;

    for (let i = 0; i < lines; i++) {
        let x = alea.rand() * size;
        let y = alea.rand() * size;
        ctx.strokeStyle = alea.pick(palette.slice(1));
        ctx.globalAlpha = 0.15 + alea.rand() * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let step = 0; step < 180; step++) {
            const angle = noise2D(x * scale, y * scale) * Math.PI * 2;
            x += Math.cos(angle) * 2;
            y += Math.sin(angle) * 2;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

draw();

alea.features({ palette: PALETTES.indexOf(palette), lines });

// The capture point. Forgetting this is the one mistake that yields a blank
// piece: nothing is ever drawn as far as a renderer is concerned.
alea.ready();

window.addEventListener("resize", draw);

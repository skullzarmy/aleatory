import LAYERS from "virtual:layers";

const alea = window.$alea;

const features = {};
const picks = [];

// 1. Deterministic trait selection
for (const layer of LAYERS) {
    if (!layer.variants || layer.variants.length === 0) continue;
    let totalWeight = 0;
    for (const v of layer.variants) totalWeight += v.weight;
    if (totalWeight <= 0) totalWeight = 1;

    const roll = alea.rand() * totalWeight;
    let acc = 0;
    let selected = layer.variants[0];
    for (const v of layer.variants) {
        acc += v.weight;
        if (roll < acc) {
            selected = v;
            break;
        }
    }

    picks.push({ layer, variant: selected });

    if (!layer.hide) {
        features[layer.name] = selected.name;
    }
}

// 2. Report features to Aleatory
alea.features(features);

// 3. Canvases and display
const onScreen = document.getElementById("theCanvas");
const onScreenCtx = onScreen ? onScreen.getContext("2d") : null;
const offScreen = document.createElement("canvas");
const offScreenCtx = offScreen.getContext("2d");
const dlButton = document.getElementById("download");

function loadImage(src) {
    return new Promise((resolve) => {
        if (!src) {
            resolve(null);
            return;
        }
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => {
            console.error("Failed to load layer image:", src.slice(0, 40));
            resolve(null);
        };
        img.src = src;
    });
}

function calculateFit(srcW, srcH, maxW, maxH) {
    const ratio = Math.min(maxW / srcW, maxH / srcH);
    return {
        width: Math.max(1, Math.floor(srcW * ratio)),
        height: Math.max(1, Math.floor(srcH * ratio)),
    };
}

function resizeOnScreen() {
    if (!onScreen || !onScreenCtx || offScreen.width === 0 || offScreen.height === 0) return;
    const fit = calculateFit(offScreen.width, offScreen.height, window.innerWidth, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    onScreen.width = fit.width * dpr;
    onScreen.height = fit.height * dpr;
    onScreen.style.width = `${fit.width}px`;
    onScreen.style.height = `${fit.height}px`;

    onScreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Pixel art looks best with nearest-neighbor interpolation
    if (offScreen.width <= 128 && offScreen.height <= 128) {
        onScreenCtx.imageSmoothingEnabled = false;
        onScreen.style.imageRendering = "pixelated";
    } else {
        onScreenCtx.imageSmoothingEnabled = true;
        onScreen.style.imageRendering = "auto";
    }

    onScreenCtx.drawImage(offScreen, 0, 0, fit.width, fit.height);
}

function downloadImage() {
    const link = document.createElement("a");
    link.download = "purelyarachnid-piece.png";
    link.href = offScreen.toDataURL("image/png");
    link.click();
}

if (onScreen && dlButton) {
    onScreen.addEventListener("click", () => {
        dlButton.classList.toggle("visible");
    });
    dlButton.addEventListener("click", () => {
        downloadImage();
    });
}

// 4. Preload picked layer images and render
Promise.all(picks.map((p) => loadImage(p.variant.src))).then((loadedImages) => {
    let width = 1000;
    let height = 1000;
    for (const img of loadedImages) {
        if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
            width = img.naturalWidth;
            height = img.naturalHeight;
            break;
        }
    }

    offScreen.width = width;
    offScreen.height = height;

    for (let i = 0; i < picks.length; i++) {
        const img = loadedImages[i];
        if (!img) continue;
        const layer = picks[i].layer;
        offScreenCtx.globalCompositeOperation = layer.blend || "source-over";
        offScreenCtx.drawImage(img, 0, 0, width, height);
    }

    resizeOnScreen();
    window.addEventListener("resize", resizeOnScreen);

    // 5. Signal capture point
    alea.ready();
});

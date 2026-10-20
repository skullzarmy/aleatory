/**
 * The example layers the PurelyArachnid kit ships with: a 24 by 24 character
 * in five stacked layers, drawn here as text and encoded as PNG so the kit
 * carries no binary files in the repository.
 *
 * Each folder shows one part of the naming convention: weights in file names,
 * a fully transparent "none", and a hidden layer with a blend mode.
 */

import { crc32, deflateSync } from "node:zlib";

const SIZE = 24;

function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
}

/** RGBA, 8 bits a channel, no filtering. */
export function encodePng(width, height, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(rows, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

function hex(color) {
    const n = Number.parseInt(color.slice(1, 7), 16);
    const a = color.length > 7 ? Number.parseInt(color.slice(7, 9), 16) : 255;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** `rows` is a picture in characters, `colors` says what each one paints. `.` is clear. */
function paint(rows, colors) {
    const out = Buffer.alloc(SIZE * SIZE * 4);
    rows.forEach((row, y) => {
        if (row.length > SIZE) throw new Error(`sample row ${y} is ${row.length} wide`);
        [...row].forEach((ch, x) => {
            if (ch === ".") return;
            const color = colors[ch];
            if (!color) throw new Error(`sample uses "${ch}" with no color`);
            hex(color).forEach((v, i) => {
                out[(y * SIZE + x) * 4 + i] = v;
            });
        });
    });
    return encodePng(SIZE, SIZE, out);
}

const solid = (color) => paint(Array(SIZE).fill("x".repeat(SIZE)), { x: color });

const HEAD = [
    "",
    "",
    "",
    "",
    ".......oooooooooo",
    "......osssssssssso",
    ".....osssssssssssso",
    ".....osssssssssssso",
    ".....osssssssssssso",
    ".....osssssssssssso",
    "....oosssssssssssso",
    "....ossssssssssssso",
    "....oosssssssssssso",
    ".....osssssssssssso",
    ".....osssssssssssso",
    ".....osssssssssssso",
    ".....ossssssssssso",
    "......osssssssssso",
    ".......ossssssso",
    ".......osssssso",
    ".......osssssso",
    "......osssssssso",
    ".....osssssssssso",
    ".....osssssssssso",
];

const at = (y, row) => {
    const rows = Array(SIZE).fill("");
    rows[y] = row;
    return rows;
};

const OUTLINE = "#1d1a1f";

export function sampleLayers() {
    const files = {
        "00-background/3-slate.png": solid("#64748b"),
        "00-background/3-sand.png": solid("#d6c7a1"),
        "00-background/2-mint.png": solid("#9fd8b5"),
        "00-background/2-rose.png": solid("#e8a5b4"),
        "00-background/1-gold_leaf.png": solid("#f2c14e"),

        "01-head/3-peach.png": paint(HEAD, { o: OUTLINE, s: "#f1c27d" }),
        "01-head/3-tan.png": paint(HEAD, { o: OUTLINE, s: "#c68642" }),
        "01-head/2-umber.png": paint(HEAD, { o: OUTLINE, s: "#8d5524" }),
        "01-head/1-alien.png": paint(HEAD, { o: OUTLINE, s: "#9be3c4" }),

        "02-eyes/4-plain.png": paint(at(11, "........we...we"), { w: "#ffffff", e: OUTLINE }),
        "02-eyes/3-sleepy.png": paint(at(11, "........ee...ee"), { e: OUTLINE }),
        "02-eyes/2-shades.png": paint(
            [...Array(10).fill(""), "......kkkkkkkkkk", ".......kkk..kkk"],
            { k: "#0d0d0d" },
        ),
        "02-eyes/1-laser.png": paint(at(11, "........rr...rrRRRRRRRRR"), {
            r: "#ff2d2d",
            R: "#ff2d2d99",
        }),

        "03-mouth/4-flat.png": paint(at(15, "..........mmmm"), { m: OUTLINE }),
        "03-mouth/3-smile.png": paint(
            [...Array(15).fill(""), ".........m....m", "..........mmmm"],
            { m: OUTLINE },
        ),
        "03-mouth/2-frown.png": paint(
            [...Array(15).fill(""), "..........mmmm", ".........m....m"],
            { m: OUTLINE },
        ),
        "03-mouth/1-pipe.png": paint(
            [
                ...Array(12).fill(""),
                "...................gg",
                "..................g",
                "...................bb",
                "..........mmmmppppbbb",
                "..................bb",
            ],
            { m: OUTLINE, p: "#6b4226", b: "#8a5a36", g: "#d9d9d9aa" },
        ),

        // Fully transparent. The build stores no image for it, so "none" costs a name.
        "04-hat/6-none.png": paint([], {}),
        "04-hat/3-cap.png": paint(
            ["", "", "", ".......cccccccccc", "......cccccccccccc", "......ccccccccccccvvvv"],
            { c: "#2f6fdf", v: "#1f4fa8" },
        ),
        "04-hat/2-beanie.png": paint(
            [
                "",
                "",
                "........nnnnnnnn",
                ".......nnnnnnnnnn",
                "......nnnnnnnnnnnn",
                "......wwwwwwwwwwww",
            ],
            { n: "#c8553d", w: "#f4e9d8" },
        ),
        "04-hat/1-crown.png": paint(
            [
                "",
                ".......y..y..y..y",
                ".......yyyyyyyyyy",
                ".......yyryyyyryy",
                ".......yyyyyyyyyy",
            ],
            { y: "#f2c14e", r: "#c8102e" },
        ),

        // Hidden from the traits, multiplied over everything below it.
        "05-(hide_blend-multiply)-shade/1-shade.png": paint(
            HEAD.map((row) => row.replace(/[os]/g, (ch, x) => (x >= 13 ? "d" : "."))),
            { d: "#00000040" },
        ),
    };
    return Object.entries(files).map(([name, data]) => ({ name: `layers/${name}`, data }));
}

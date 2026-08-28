import { declaredIn } from "./libraries";
import { RUNTIME_KINDS } from "./runtimes";

/**
 * Which runtime kind a generator was written against, read from the generator.
 *
 * Asking an artist to pick this on the way back in is asking them to remember
 * a choice they made on the way out, and to be punished for misremembering it.
 * The file already says: what it declares, and which lifecycle it implements.
 *
 * Getting it wrong is not fatal, which is what makes guessing acceptable here.
 * Libraries load from the `alea:library` tags rather than from the kind, so a
 * mislabelled piece still renders. The kind selects a default parameter set
 * and describes the work, so a wrong answer is a wrong label, and the caller
 * shows what was detected rather than silently applying it.
 */

export interface Detection {
    kindId: number;
    /** What in the file gave it away, for showing to the artist. */
    because: string;
    /** False when nothing matched and the fallback was used. */
    certain: boolean;
}

const idOf = (name: string) =>
    RUNTIME_KINDS.find((k) => k.name === name)?.kindId ?? RUNTIME_KINDS[0].kindId;

export function detectKind(html: string): Detection {
    const declared = declaredIn(html);

    // A custom-runtime piece is driven by the harness rather than by itself,
    // so this is the strongest signal there is: nothing else exports it.
    // Assignment, not mention. The dev harness in every template reads
    // window.ALEA_MAIN to drive a custom piece, so merely naming it says
    // nothing about which kind this is.
    if (/\bALEA_MAIN\s*=[^=]/.test(html)) {
        return {
            kindId: idOf("custom"),
            because: "it exports ALEA_MAIN, the custom runtime lifecycle",
            certain: true,
        };
    }

    const p5 = declared.find((c) => /^p5@/.test(c));
    if (p5) {
        return { kindId: idOf("p5"), because: `it declares ${p5}`, certain: true };
    }

    // Anything else declared is somebody's own engine, which is what the
    // custom kind is for.
    if (declared.length > 0) {
        return {
            kindId: idOf("custom"),
            because: `it declares ${declared.join(", ")}`,
            certain: true,
        };
    }

    // Vector work builds an svg element rather than drawing to a canvas. Look
    // for the element being made, not merely mentioned, so a comment about SVG
    // in a canvas piece does not decide this.
    if (
        /createElementNS\s*\(\s*["']http:\/\/www\.w3\.org\/2000\/svg/.test(html) ||
        /<svg\b/i.test(html)
    ) {
        return { kindId: idOf("svg"), because: "it builds an <svg>", certain: true };
    }

    if (/getContext\s*\(\s*["']2d["']/.test(html) || /<canvas\b/i.test(html)) {
        return { kindId: idOf("vanilla"), because: "it draws to a canvas", certain: true };
    }

    return {
        kindId: idOf("vanilla"),
        because: "nothing in the file identified it, so this is a guess",
        certain: false,
    };
}

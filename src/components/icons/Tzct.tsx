/**
 * TezCity's own TZCT monogram, their `currentColor` variant, which inherits
 * whatever colour the button around it uses. Their brand notes ask that the
 * square proportions and built-in spacing are kept, so the 512 viewBox is
 * used as published rather than cropped to the glyph.
 */
export function Tzct({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 512 512" fill="currentColor" aria-hidden>
            <path d="M106 99H250V127H193V248H163V127H106Z" />
            <path d="M266 99H407V122L310 221H407V248H266V225L362 127H266Z" />
            <path d="M106 275H247V303H135V393H250V421H106Z" />
            <path d="M266 275H407V303H354V421H324V303H266Z" />
        </svg>
    );
}

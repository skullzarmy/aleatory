"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { ReactNode } from "react";

/**
 * A grid that animates its own changes.
 *
 * The feeds refresh on a timer, so items appear, leave and move while somebody
 * is looking at them. Inserting a card at the head of a list moves every card
 * after it, and done as a layout change that is a jump under the reader's eyes
 * and it counts against CLS.
 *
 * AutoAnimate measures before and after and plays the difference as a
 * transform, so nothing is laid out anywhere unexpected: the browser sees one
 * silent reflow and the movement the reader sees is the animation. It also
 * leaves the children it finds on mount alone, which is what keeps a whole grid
 * from animating on load, and it honours `prefers-reduced-motion` on its own.
 */
export function AutoGrid({ className, children }: { className?: string; children: ReactNode }) {
    const [parent] = useAutoAnimate<HTMLDivElement>();
    return (
        <div ref={parent} className={className}>
            {children}
        </div>
    );
}

export function AutoList({ className, children }: { className?: string; children: ReactNode }) {
    const [parent] = useAutoAnimate<HTMLUListElement>();
    return (
        <ul ref={parent} className={className}>
            {children}
        </ul>
    );
}

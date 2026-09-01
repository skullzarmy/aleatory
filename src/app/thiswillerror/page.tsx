"use client";

import { useState } from "react";

/**
 * A page that throws, so the error boundary can be looked at.
 *
 * Temporary. Delete it once the two error pages have been seen.
 *
 * Noindex is set below, and the throw happens on a click rather than on load
 * so the route itself stays reachable: a page that threw during render would
 * show the boundary and never the button.
 */
export default function ThisWillError() {
    const [boom, setBoom] = useState(false);

    if (boom) {
        throw new Error("Deliberate: /thiswillerror");
    }

    return (
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Break it on purpose</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                This throws inside the page, so <code className="font-mono">error.tsx</code>{" "}
                catches it and draws the fracture. The seed is the digest, so this one
                failure always makes the same piece.
            </p>
            <button
                type="button"
                onClick={() => setBoom(true)}
                className="mt-8 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
                Throw
            </button>
            <p className="mt-8 text-xs text-muted-foreground">
                The layout boundary, <code className="font-mono">global-error.tsx</code>, is
                only reachable when the layout itself fails, so it cannot be triggered from
                a page. Delete this route when you are done with it.
            </p>
        </div>
    );
}

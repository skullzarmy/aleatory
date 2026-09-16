/**
 * A dead man's switch for a process nobody is watching.
 *
 * The daemon and the bot both run unattended, and both fail quietly: a scan
 * that throws is caught, logged to a console nobody is reading, and the loop
 * sleeps as if there had been nothing to do. Failing to render is
 * indistinguishable from having nothing to render, from the outside and from
 * the inside.
 *
 * So the process says it is working, on a schedule, to something that will
 * complain when it stops. Absence is the signal, which is the only kind that
 * survives the machine catching fire: a check that has to reach the process
 * cannot tell a wedged loop from a dead network, and neither can it tell you
 * anything at all once the host is gone.
 *
 * Deliberately a URL and nothing more. Uptime Kuma's push monitors,
 * Healthchecks.io, Cronitor, Better Stack and Dead Man's Snitch all accept
 * "fetch this secret URL to say you are alive", so a URL is the portable
 * interface between us and whichever of them is in use. The `status` and `msg`
 * parameters are Kuma's shape; a service that does not understand them ignores
 * them and still hears the beat.
 *
 * The URL is a credential. Anyone holding it can report a dead process healthy,
 * so it lives in the environment and never in the repository.
 */

/** Long enough to be useful in an alert, short enough for a query string. */
const MAX_MSG = 200;

/** A beat must never be the reason a render did not happen. */
const TIMEOUT_MS = 5_000;

export interface Beat {
    /** `down` is for a pass that ran and achieved nothing it should have. */
    status?: "up" | "down";
    /** What the monitor shows. The pass summary is the useful one. */
    msg?: string;
    /** Milliseconds the work took, which Kuma plots. */
    ping?: number;
}

/**
 * Returns a function that reports a beat, or one that does nothing when no URL
 * is configured. Beating is optional and its absence is not an error: a
 * developer running the daemon locally should not have to stand up a monitor.
 */
export function heartbeat(url: string | undefined): (beat?: Beat) => void {
    if (!url) return () => {};

    // Parsed once. A malformed URL is a configuration mistake worth knowing
    // about immediately rather than on the first beat, and it must not take
    // the process down.
    let base: URL;
    try {
        base = new URL(url);
    } catch {
        console.error("heartbeat: not a URL, beating disabled");
        return () => {};
    }

    return (beat: Beat = {}) => {
        const target = new URL(base);
        if (beat.status) target.searchParams.set("status", beat.status);
        if (beat.msg) target.searchParams.set("msg", beat.msg.slice(0, MAX_MSG));
        if (typeof beat.ping === "number") {
            target.searchParams.set("ping", String(Math.max(0, Math.round(beat.ping))));
        }

        // Sent and forgotten. The caller is in a render loop and a monitor that
        // is down is not a reason to stop working, so nothing here is awaited
        // and nothing here throws.
        void fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {});
    };
}

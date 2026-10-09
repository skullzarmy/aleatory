import { LiveRefresh } from "@/components/LiveRefresh";
import { LastGood } from "@/components/LastGood";

/**
 * What a page renders when its chain read failed. Inside `LastGood`, so a page
 * already on screen stays there and this shows only on a first load.
 */
export function ReadFailed() {
    return (
        <LastGood
            failed
            fallback={
                <div className="mx-auto max-w-2xl px-4 py-16 text-center">
                    <LiveRefresh seconds={8} />
                    <h1 className="text-xl font-semibold tracking-tight">
                        The chain did not answer
                    </h1>
                    <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                        The indexer this page reads from was slow or unreachable just now. Nothing
                        on chain is affected. This page asks again on its own every few seconds.
                    </p>
                    <p
                        className="mt-6 text-sm text-muted-foreground"
                        role="status"
                        aria-live="polite"
                    >
                        Retrying
                    </p>
                </div>
            }
        />
    );
}

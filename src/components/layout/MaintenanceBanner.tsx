import { AlertTriangle } from "lucide-react";
import { MAINTENANCE_WINDOW } from "@/lib/config";

export function MaintenanceBanner() {
    if (!MAINTENANCE_WINDOW) return null;

    return (
        <div role="status" className="border-b border-warning/40 bg-warning/10 text-foreground">
            <div className="mx-auto flex max-w-7xl items-center justify-center gap-2.5 px-4 py-2 text-xs leading-relaxed sm:text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <p>
                    <span className="font-semibold text-warning">
                        ALEATORY is undergoing routine maintenance.
                    </span>{" "}
                    Token preview rendering may take longer than normal during this period. Core
                    website, minting, and publishing remains available.
                </p>
            </div>
        </div>
    );
}

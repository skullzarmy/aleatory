import type { Metadata } from "next";
import { BRAND } from "@/lib/config";

/**
 * A plain-string title here would clear the root template for everything
 * nested under it, so the publish page below would lose the site name. The
 * template is restated rather than inherited for that reason.
 */
export const metadata: Metadata = {
    title: {
        default: `Draft · ${BRAND.name}`,
        template: `%s · ${BRAND.name}`,
    },
    description: "Preview, seeds, parameters, checks and cost for one generator.",
};

export default function DraftLayout({ children }: { children: React.ReactNode }) {
    return children;
}

import type { Metadata } from "next";
import { PublishShell } from "@/components/studio/PublishShell";
import { fetchProviders } from "@/lib/providers";

export const metadata: Metadata = { title: "Publish" };
export const revalidate = 300;

/**
 * The providers are public chain state, so they are fetched here and cached for
 * everyone. The draft is in the artist's browser, so it is loaded by the shell.
 */
export default async function PublishPage() {
    const providers = await fetchProviders().catch(() => []);
    return <PublishShell providers={providers} />;
}

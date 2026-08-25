import type { Metadata } from "next";
import { DeployForm } from "@/components/studio/DeployForm";
import { fetchProviders } from "@/lib/providers";
import { CONTRACTS } from "@/lib/config";

export const metadata: Metadata = { title: "Studio" };
export const revalidate = 300;

export default async function StudioPage() {
    const providers = CONTRACTS.registry ? await fetchProviders().catch(() => []) : [];

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <h1 className="text-xl font-semibold tracking-tight">Deploy a collection</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Your generator, your contract, your terms. Everything marked permanent is fixed
                for the life of the collection.
            </p>

            <div className="mt-8">
                <DeployForm providers={providers} />
            </div>
        </div>
    );
}

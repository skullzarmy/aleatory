import type { Metadata } from "next";
import { fetchGenerator } from "@/lib/generator";
import { shortAddress } from "@/lib/utils";

// The page itself is a client component, so its metadata lives here. noindex: this is
// a control panel useless without the key; /generator/[address] is the public page.
export async function generateMetadata({
    params,
}: {
    params: Promise<{ address: string }>;
}): Promise<Metadata> {
    const { address } = await params;
    const c = await fetchGenerator(address).catch(() => null);
    return {
        title: `Manage ${c?.name || shortAddress(address)}`,
        robots: { index: false, follow: false },
        alternates: { canonical: `/generator/${address}` },
    };
}

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

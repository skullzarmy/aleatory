import type { Metadata } from "next";

// Noindex, like the rest of the account-scoped pages: a control panel is
// useless without the key, and /providers is the public directory.
export const metadata: Metadata = {
    title: "Your render provider",
    description:
        "List a provider contract in the registry, set what a render costs, rotate its agent key, and withdraw what it has earned.",
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}

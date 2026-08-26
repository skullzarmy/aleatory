import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Manage",
    description: "Manage the collections you have published.",
};

export default function ManageLayout({ children }: { children: React.ReactNode }) {
    return children;
}

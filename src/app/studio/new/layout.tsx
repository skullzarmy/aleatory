import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "New generator",
    description: "Start from a template, a file on disk, or an empty page.",
};

export default function NewGeneratorLayout({ children }: { children: React.ReactNode }) {
    return children;
}

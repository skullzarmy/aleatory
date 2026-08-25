import Link from "next/link";
import { BRAND } from "@/lib/config";

export function Footer() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>{BRAND.tagline}</p>
                <div className="flex gap-4">
                    <Link href="/about" className="hover:text-foreground">
                        About
                    </Link>
                    <a
                        href={BRAND.repo}
                        className="hover:text-foreground"
                        rel="noreferrer"
                        target="_blank"
                    >
                        Source
                    </a>
                </div>
            </div>
        </footer>
    );
}

import Link from "next/link";
import { BRAND } from "@/lib/config";

export function Footer() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>{BRAND.tagline}</p>
                <p className="text-muted-foreground text-xs opacity-50">
                    Created by{" "}
                    <a href="https://skllzrmy.com/" target="_blank" rel="noreferrer" className="hover:text-foreground">
                        skllzrmy.tez
                    </a>
                    , inspired by Piero.
                </p>
                <div className="flex gap-4">
                    <Link href="/about" className="hover:text-foreground">
                        About
                    </Link>
                    <Link href="/docs/interface" className="hover:text-foreground">
                        ALEATORY-001
                    </Link>
                    <Link href="/tezos" className="hover:text-foreground">
                        New to Tezos
                    </Link>
                    <Link href="/terms" className="hover:text-foreground">
                        Terms
                    </Link>
                    <Link href="/terms/privacy" className="hover:text-foreground">
                        Privacy
                    </Link>
                    <a href={BRAND.repo} className="hover:text-foreground" rel="noreferrer" target="_blank">
                        Source
                    </a>
                </div>
            </div>
        </footer>
    );
}

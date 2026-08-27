"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/themeToggle";
import { ConnectButton } from "./ConnectButton";
import { BRAND, NETWORK } from "@/lib/config";

const NAV = [
    { href: "/", label: "Recent" },
    { href: "/collections", label: "Collections" },
    { href: "/market", label: "Market" },
    { href: "/studio", label: "Studio" },
    { href: "/manage", label: "Manage" },
    { href: "/providers", label: "Providers" },
];

export function Header() {
    const pathname = usePathname();

    return (
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
            <div className="mx-auto flex h-20 max-w-7xl items-center gap-6 px-4">
                {/* The mark carries the brand on its own, drawn fresh on
                    every load. */}
                <Link
                    href="/"
                    aria-label={`${BRAND.name}, home`}
                    className="shrink-0 transition-opacity hover:opacity-80"
                >
                    <Logo size={72} label="" />
                </Link>

                <nav aria-label="Main" className="hidden gap-4 text-sm text-muted-foreground sm:flex">
                    {NAV.map((item) => {
                        // Marked for assistive tech, not only coloured in.
                        const here =
                            item.href === "/"
                                ? pathname === "/"
                                : pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={here ? "page" : undefined}
                                className={`transition-colors hover:text-foreground ${
                                    here ? "font-medium text-foreground" : ""
                                }`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="ml-auto flex items-center gap-3">
                    {NETWORK !== "mainnet" && (
                        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                            {NETWORK}
                        </span>
                    )}
                    <ThemeToggle />
                    <ConnectButton />
                </div>
            </div>
        </header>
    );
}

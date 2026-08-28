"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
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

function isHere(pathname: string, href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Header() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    // Navigating is the end of the menu's usefulness. Without this, tapping a
    // link leaves the panel covering the page that was just asked for.
    useEffect(() => setOpen(false), [pathname]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open]);

    return (
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:h-20 sm:gap-6">
                {/* The mark carries the brand on its own, drawn fresh on
                    every load. Two sizes rather than one scaled by CSS,
                    because Logo sets its dimensions as an inline style and a
                    class cannot win against that. */}
                <Link
                    href="/"
                    aria-label={`${BRAND.name}, home`}
                    className="shrink-0 transition-opacity hover:opacity-80"
                >
                    <span className="sm:hidden">
                        <Logo size={44} label="" />
                    </span>
                    <span className="hidden sm:inline-flex">
                        <Logo size={72} label="" />
                    </span>
                </Link>

                <nav
                    aria-label="Main"
                    className="hidden gap-4 text-sm text-muted-foreground sm:flex"
                >
                    {NAV.map((item) => {
                        // Marked for assistive tech, not only coloured in.
                        const here = isHere(pathname, item.href);
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

                <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
                    {NETWORK !== "mainnet" && (
                        <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                            {NETWORK}
                        </span>
                    )}
                    {/* Moved into the menu on small screens. The network badge
                        stays out here at every width, because which chain you
                        are about to sign against is not a preference. */}
                    <span className="hidden sm:inline-flex">
                        <ThemeToggle />
                    </span>
                    <ConnectButton />

                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        aria-controls="mobile-nav"
                        aria-label={open ? "Close menu" : "Open menu"}
                        className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:hidden"
                    >
                        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {open && (
                <nav
                    id="mobile-nav"
                    aria-label="Main"
                    className="border-t border-border bg-background sm:hidden"
                >
                    <ul className="mx-auto max-w-7xl px-2 py-2">
                        {NAV.map((item) => {
                            const here = isHere(pathname, item.href);
                            return (
                                <li key={item.href}>
                                    <Link
                                        href={item.href}
                                        aria-current={here ? "page" : undefined}
                                        className={`flex min-h-[44px] items-center rounded-md px-3 text-base transition-colors hover:bg-accent ${
                                            here
                                                ? "font-medium text-foreground"
                                                : "text-muted-foreground"
                                        }`}
                                    >
                                        {item.label}
                                    </Link>
                                </li>
                            );
                        })}
                        <li className="mt-2 flex items-center justify-between border-t border-border px-3 pt-3">
                            <span className="text-sm text-muted-foreground">Theme</span>
                            <ThemeToggle />
                        </li>
                    </ul>
                </nav>
            )}
        </header>
    );
}

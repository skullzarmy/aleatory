import Link from "next/link";
import { ThemeToggle } from "@/components/themeToggle";
import { ConnectButton } from "./ConnectButton";
import { BRAND, NETWORK } from "@/lib/config";

const NAV = [
    { href: "/", label: "Recent" },
    { href: "/collections", label: "Collections" },
    { href: "/market", label: "Market" },
    { href: "/studio", label: "Studio" },
];

export function Header() {
    return (
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
                <Link href="/" className="font-semibold tracking-tight">
                    {BRAND.name}
                </Link>

                <nav className="hidden gap-4 text-sm text-muted-foreground sm:flex">
                    {NAV.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="transition-colors hover:text-foreground"
                        >
                            {item.label}
                        </Link>
                    ))}
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

"use client";

import { useState } from "react";
import { Boxes, ExternalLink } from "lucide-react";
import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { collektGeneratorUrl, collektPieceUrl } from "@/lib/config";

interface CollektGalleryModalProps {
    generatorAddress: string;
    generatorName: string;
    tokenId?: string;
    trigger?: React.ReactNode;
}

export function CollektGalleryModal({
    generatorAddress,
    generatorName,
    tokenId,
    trigger,
}: CollektGalleryModalProps) {
    const [open, setOpen] = useState(false);

    const embedUrl = tokenId
        ? collektPieceUrl(generatorAddress, tokenId, true)
        : collektGeneratorUrl(generatorAddress, true);

    const externalUrl = tokenId
        ? collektPieceUrl(generatorAddress, tokenId, false)
        : collektGeneratorUrl(generatorAddress, false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger ?? (
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                        title="Explore this collection in a 3D gallery"
                    >
                        <Boxes size={14} aria-hidden className="shrink-0" />
                        <span>3D Gallery</span>
                    </button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-5xl w-[95vw] h-[88vh] flex flex-col p-4 sm:p-6">
                <DialogHeader className="pr-8 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <DialogTitle className="text-base font-semibold truncate">
                            {generatorName} · 3D Gallery
                        </DialogTitle>
                        <a
                            href={externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mr-6"
                        >
                            <span>Open on colleKT</span>
                            <ExternalLink size={12} aria-hidden />
                        </a>
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground">
                        3D virtual gallery powered by colleKT. Use WASD or arrow keys to move, mouse
                        to look around.
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-3 relative flex-1 w-full min-h-0 rounded-md border border-border bg-black overflow-hidden">
                    {open && (
                        <iframe
                            src={embedUrl}
                            title={`${generatorName} 3D Gallery`}
                            className="w-full h-full border-0"
                            allow="accelerometer; camera; gyroscope; vr; fullscreen"
                            allowFullScreen
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

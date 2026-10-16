"use client";

import Image from "next/image";

import { EMOTES } from "@/lib/emotes";
import { cn } from "@/lib/utils";

interface EmoteGalleryProps {
  onSelect?: (emote: { type: "discord" | "site"; src: string; name: string; alt: string }) => void;
  className?: string;
}

export function EmoteGallery({ onSelect, className }: EmoteGalleryProps) {
  return (
    <div className={cn("space-y-8", className)}>
      {/* Site Emotes */}
      <div>
        <h4 className="text-sm font-medium text-slate-500 mb-4 sticky top-0 bg-background py-2 z-10">
          Site (Haute Qualité)
        </h4>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-4">
          {Object.values(EMOTES).map(emote => (
            <button
              key={emote.name}
              className={cn(
                "aspect-square p-2 rounded-lg border border-transparent transition-all flex items-center justify-center",
                onSelect ? "hover:border-primary hover:bg-primary/5 cursor-pointer" : "cursor-default",
              )}
              onClick={() =>
                onSelect?.({
                  alt: emote.alt,
                  name: emote.name,
                  src: emote.path,
                  type: "site",
                })
              }
              title={emote.alt}
            >
              <Image src={emote.path} alt={emote.alt} width={64} height={64} className="object-contain" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

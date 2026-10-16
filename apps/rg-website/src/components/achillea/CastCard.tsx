"use client";

import Image from "next/image";
import type { CasterPublic } from "@rosegriffon/achillea-types";
import { Badge, Button } from "@rosegriffon/ui";
import { FaTwitch } from "react-icons/fa6";

interface CastCardProps {
  caster: CasterPublic;
  className?: string;
}

export function CastCard({ caster, className }: CastCardProps) {
  const avatarUrl = caster.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";

  return (
    <div
      className={`flex flex-col items-center gap-3 p-5 rounded-2xl border border-outline/20 bg-surface hover:border-primary/40 hover:shadow-md transition-all text-center ${
        className ?? ""
      }`}
    >
      <div className="relative size-20 rounded-full overflow-hidden border-2 border-outline/30 bg-surface-variant shrink-0">
        <Image src={avatarUrl} alt={caster.displayName} fill unoptimized className="object-cover" />
      </div>

      <div className="space-y-1 w-full">
        <h4 className="font-bold text-base text-on-surface truncate">{caster.displayName}</h4>
        {caster.bio && <p className="text-xs text-on-surface-variant line-clamp-2">{caster.bio}</p>}
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-center pt-1">
        <Badge variant="secondary" className="text-xs">
          {caster.recentCasts} cast{caster.recentCasts > 1 ? "s" : ""} récent
          {caster.recentCasts > 1 ? "s" : ""}
        </Badge>

        {caster.twitchUrl && (
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-7 rounded-full text-purple-600 hover:text-purple-700"
          >
            <a href={caster.twitchUrl} target="_blank" rel="noopener noreferrer" aria-label="Chaîne Twitch">
              <FaTwitch className="size-3.5" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

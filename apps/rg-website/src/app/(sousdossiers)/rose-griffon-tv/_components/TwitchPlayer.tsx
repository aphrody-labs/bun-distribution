"use client";

import { Button, Skeleton } from "@rosegriffon/ui";
import dynamic from "next/dynamic";

import { AlertCircle, Play, Radio } from "@/lib/icons-config";

import type { TwitchEmbedProps, TwitchPlayerProps } from "react-twitch-embed";

import { useTwitch } from "../_context/twitch-context";

const TwitchEmbed = dynamic(() => import("react-twitch-embed").then(mod => mod.TwitchEmbed), {
  loading: () => <Skeleton className="w-full h-full aspect-video" />,
  ssr: false,
}) as unknown as React.ComponentType<TwitchEmbedProps>;

// This component is used for VODs
const TwitchPlayerComponent = dynamic(() => import("react-twitch-embed").then(mod => mod.TwitchPlayer), {
  loading: () => <Skeleton className="w-full h-full aspect-video" />,
  ssr: false,
}) as unknown as React.ComponentType<TwitchPlayerProps>;

export function TwitchPlayer() {
  const { data, error, isLoading, mutate, channel } = useTwitch();

  // Loading state
  if (isLoading) {
    return (
      <div className="aspect-video w-full rounded-lg overflow-hidden border-2 border-[#9146FF]/50">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="aspect-video w-full flex flex-col items-center justify-center bg-red-950/20 border-2 border-red-500/50 rounded-lg gap-4">
        <AlertCircle className="size-8 text-red-400" />
        <div className="text-center">
          <p className="font-semibold text-red-200">Impossible de charger le statut de la chaîne Twitch</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          className="text-red-200 border-red-500/50 hover:bg-red-500/10"
        >
          Réessayer
        </Button>
      </div>
    );
  }

  // No data
  if (!data) {
    return (
      <div className="aspect-video w-full bg-slate-900/50 flex items-center justify-center rounded-lg border-2 border-[#9146FF]/30">
        <p className="text-gray-400">Chargement...</p>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full rounded-lg overflow-hidden border-2 border-[#9146FF]/50 shadow-lg relative group">
      {/* Status Badge */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-slate-900/80 px-3 py-1 rounded-full border border-[#9146FF]/50">
        <div className={`size-2 rounded-full ${data.isLive ? "bg-red-500 animate-pulse" : "bg-gray-500"}`} />
        <span className="text-xs font-semibold text-purple-300">{data.isLive ? "🔴 EN DIRECT" : "📹 VOD"}</span>
      </div>

      {data.isLive ? (
        <TwitchEmbed channel={channel} withChat={false} height="100%" width="100%" />
      ) : data.videoId ? (
        <TwitchPlayerComponent video={data.videoId} height="100%" width="100%" />
      ) : (
        <div className="aspect-video w-full bg-linear-to-br from-slate-900/50 to-slate-800/50 flex flex-col items-center justify-center gap-4 border-2 border-dashed border-purple-500/30">
          <div className="text-center">
            <Play className="size-12 text-purple-400 mx-auto mb-3 opacity-50" />
            <p className="text-gray-400 font-semibold">Aucune diffusion récente disponible</p>
            <p className="text-gray-500 text-sm mt-1">Le dernier stream sera affiché ici</p>
          </div>
          <Button
            asChild
            className="bg-linear-to-r from-[#9146FF] to-purple-600 text-white hover:from-[#772CE8] hover:to-purple-700"
          >
            <a
              href={`https://twitch.tv/${channel}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <Radio className="size-4" />
              Regarder sur Twitch
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

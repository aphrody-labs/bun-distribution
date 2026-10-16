"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import useSWR from "swr";

import type { TwitchData } from "@/types/twitch";

export type TwitchChannel = "rose_griffontv" | "achillea_ie";

interface TwitchContextType {
  data: TwitchData | null;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<TwitchData | undefined>;
  channel: TwitchChannel;
}

const TwitchContext = createContext<TwitchContextType | undefined>(undefined);

const fetcher = (url: string) =>
  fetch(url)
    .then(res => res.json())
    .then(data => ({
      isLive: data.live?.is_live || false,
      videoId: null,
      followers: data.followers || 0,
      streamInfo: data.live?.is_live
        ? {
            title: data.live.title,
            game_name: data.live.category,
            viewer_count: data.live.viewers,
            started_at: data.live.started_at,
            language: "fr",
            tags: [],
          }
        : null,
      channelInfo: data.channelInfo || null,
      recentVideos: data.videos || [],
      topClips: data.clips || [],
    }));

export function TwitchProvider({
  children,
  channel = "rose_griffontv",
}: {
  children: ReactNode;
  channel?: TwitchChannel;
}) {
  const { data, error, isLoading, mutate } = useSWR<TwitchData>(`/api/public/rgtv/status?channel=${channel}`, fetcher, {
    dedupingInterval: 60000, // Cache for 1 minute
    focusThrottleInterval: 300000, // Revalidate at most every 5 minutes when window focused
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  // Auto-retry on error with exponential backoff
  useEffect(() => {
    if (error && retryCount < maxRetries) {
      const timeoutId = setTimeout(
        () => {
          setRetryCount(prev => prev + 1);
          mutate();
        },
        2 ** retryCount * 3000,
      ); // 3s, 6s, 12s

      return () => clearTimeout(timeoutId);
    }
  }, [error, retryCount, mutate]);

  // A new successful response owns a fresh retry budget.
  const [lastData, setLastData] = useState(data);
  if (data !== lastData) {
    setLastData(data);
    if (data) setRetryCount(0);
  }

  return (
    <TwitchContext.Provider value={{ channel, data: data ?? null, error, isLoading, mutate }}>
      {children}
    </TwitchContext.Provider>
  );
}

export function useTwitch() {
  const context = useContext(TwitchContext);
  if (context === undefined) {
    throw new Error("useTwitch must be used within a TwitchProvider");
  }
  return context;
}

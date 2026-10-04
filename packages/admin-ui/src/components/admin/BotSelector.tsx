"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@aphrody/admin-ui/client";

export interface BotSummary {
  id: string;
  name: string;
  username: string | null;
  avatar: string | null;
  online: boolean;
  uptime: number | null;
  wsPing: number;
  intents: number;
  guildCount: number;
  commandCount: number;
}

interface BotsResponse {
  bots: BotSummary[];
}

/**
 * Hook utilitaire — synchronise un `botId` avec le query param `?bot=` de l'URL.
 */
export function useBotId(defaultId = "shenron") {
  const [id, setId] = useState<string>(() => {
    if (typeof window === "undefined") return defaultId;
    return new URLSearchParams(window.location.search).get("bot") ?? defaultId;
  });

  useEffect(() => {
    const onPop = () => {
      setId(new URLSearchParams(window.location.search).get("bot") ?? defaultId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [defaultId]);

  const change = (next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("bot", next);
    window.history.replaceState({}, "", url);
    setId(next);
  };

  return [id, change] as const;
}

export function useBots() {
  return useQuery({
    queryKey: ["bots"],
    queryFn: () => api.get<BotsResponse>("/bots"),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

interface BotSelectorProps {
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * Sélecteur du client Gateway unifié (les anciens aliases restent acceptés).
 */
export function BotSelector({ value, onChange, className }: BotSelectorProps) {
  const { data, isLoading } = useBots();

  if (isLoading) {
    return (
      <div className={`flex gap-2 ${className ?? ""}`}>
        {["a", "b", "c", "d", "e", "f"].map((k) => (
          <div key={k} className="h-10 w-32 animate-pulse rounded-lg bg-dbz-card" />
        ))}
      </div>
    );
  }

  const bots = data?.bots ?? [];

  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      {bots.map((b) => {
        const active = b.id === value;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            title={b.online ? `Ping ${b.wsPing} ms` : "Hors ligne"}
            className={`group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              active
                ? "border-dbz-orange bg-dbz-orange/10 text-dbz-orange"
                : "border-dbz-border bg-dbz-bg/40 text-white/80 hover:border-white/30 hover:bg-dbz-card/60"
            }`}
          >
            {b.avatar ? (
              <img
                src={b.avatar}
                alt=""
                className={`h-6 w-6 rounded-full ${b.online ? "" : "grayscale"}`}
              />
            ) : (
              <div className="h-6 w-6 rounded-full bg-dbz-border" />
            )}
            <span className="font-medium">{b.name}</span>
            <span
              className={`h-2 w-2 rounded-full ${b.online ? "bg-emerald-400" : "bg-red-500"}`}
            />
          </button>
        );
      })}
    </div>
  );
}

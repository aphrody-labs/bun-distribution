"use client";

import { useEffect, useRef, useState } from "react";

type BotEvent = {
  id: number;
  ts: number;
  type: string;
  data: unknown;
};

const EVENT_LABEL: Record<string, string> = {
  "level-up": "Montée de niveau",
  "achievement-unlocked": "Succès débloqué",
  "fusion-created": "Fusion créée",
  "message-xp": "XP de message",
  "voice-xp": "XP vocal",
  sanction: "Sanction",
  jail: "Mise en jail",
  "daily-quest": "Quête quotidienne",
};

const COLOR_BY_TYPE: Record<string, string> = {
  "level-up": "text-dbz-yellow border-dbz-yellow",
  "achievement-unlocked": "text-purple-400 border-purple-400",
  "fusion-created": "text-pink-400 border-pink-400",
  "message-xp": "text-cyan-400 border-cyan-400",
  "voice-xp": "text-cyan-400 border-cyan-400",
  sanction: "text-red-400 border-red-400",
  jail: "text-red-400 border-red-400",
  "daily-quest": "text-green-400 border-green-400",
};

export function EventsStream() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const counterRef = useRef(0);

  useEffect(() => {
    const es = new EventSource("/api/bot-admin/a2a/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        counterRef.current++;
        setEvents((prev) =>
          [
            {
              id: counterRef.current,
              ts: Date.now(),
              type: parsed.type ?? "unknown",
              data: parsed.data ?? parsed,
            },
            ...prev,
          ].slice(0, 100),
        );
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  return (
    <div className="space-y-4">
      <div className="dbz-panel p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              connected ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500"
            }`}
          />
          <span className="font-saiyan text-sm uppercase tracking-widest">
            {connected ? "Connecté" : "Déconnecté — reconnexion auto"}
          </span>
        </div>
        <div className="text-xs text-zinc-500 font-mono">
          {events.length} événement{events.length > 1 ? "s" : ""} · max 100
        </div>
      </div>

      {!connected && (
        <div className="dbz-panel p-3 text-xs text-red-300 border border-red-800 bg-red-900/20">
          La connexion est interrompue. Les événements reprendront
          automatiquement dès que le bot sera joignable.
        </div>
      )}

      <div className="space-y-2">
        {events.length === 0 ? (
          <div className="dbz-panel p-8 text-center text-zinc-500 text-sm">
            {connected
              ? "En attente du prochain événement A2A…"
              : "Connexion en cours…"}
          </div>
        ) : (
          events.map((e) => {
            const colorClass =
              COLOR_BY_TYPE[e.type] ?? "text-dbz-blue-light border-dbz-border";
            const label = EVENT_LABEL[e.type] ?? e.type;
            return (
              <article
                key={e.id}
                className={`dbz-panel p-3 border-l-4 ${colorClass} hover:bg-dbz-blue-light/5 transition-colors`}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-saiyan text-sm font-bold ${colorClass.split(" ")[0]}`}
                    >
                      {label}
                    </span>
                    <code className="text-[9px] text-zinc-500 font-mono">
                      {e.type}
                    </code>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {new Date(e.ts).toLocaleTimeString("fr-FR", {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <details>
                  <summary className="text-[10px] text-zinc-500 cursor-pointer select-none">
                    Données détaillées
                  </summary>
                  <pre className="text-[11px] text-zinc-300 font-mono overflow-x-auto bg-dbz-bg p-2 mt-1 max-h-32 rounded">
                    {JSON.stringify(e.data, null, 2)}
                  </pre>
                </details>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

"use client";

import { useRef } from "react";
import { useLiveEvents, type BotEvent } from "@/lib/use-live-events";

const STATUS_LABEL = {
  connecting: "Connexion en cours…",
  open: "CONNECTÉ",
  closed: "DÉCONNECTÉ",
} as const;

const STATUS_COLOR = {
  connecting: "text-dbz-yellow",
  open: "text-green-400",
  closed: "text-red-400",
} as const;

const EVENT_TYPE_LABEL: Record<string, string> = {
  "level-up": "Montée de niveau",
  "achievement-unlocked": "Succès débloqué",
  "fusion-created": "Fusion créée",
  "message-xp": "XP de message",
  "voice-xp": "XP vocal",
  sanction: "Sanction",
  jail: "Mise en jail",
  "daily-quest": "Quête quotidienne",
  ping: "Ping keepalive",
  hello: "Connexion établie",
};

const EVENT_TYPE_COLOR: Record<string, string> = {
  "level-up": "text-dbz-yellow border-dbz-yellow/60",
  "achievement-unlocked": "text-purple-400 border-purple-400/60",
  "fusion-created": "text-pink-400 border-pink-400/60",
  "message-xp": "text-cyan-400 border-cyan-400/60",
  "voice-xp": "text-cyan-400 border-cyan-400/60",
  sanction: "text-red-400 border-red-400/60",
  jail: "text-red-400 border-red-400/60",
  "daily-quest": "text-green-400 border-green-400/60",
  ping: "text-zinc-500 border-zinc-700",
  hello: "text-green-400 border-green-400/60",
};

export function LiveEventsStream() {
  const { events, status } = useLiveEvents({ max: 200 });

  // Le tampon empile les nouveaux événements EN TÊTE : une clé de rendu par
  // position fait migrer l'état du DOM (le repli « Données » resté ouvert, la
  // couleur en cours de transition) d'un événement au suivant à chaque arrivée.
  // On rattache donc un numéro d'ordre stable à l'IDENTITÉ de l'objet reçu ;
  // la WeakMap le libère avec l'événement lorsqu'il sort du tampon.
  const clesRef = useRef(new WeakMap<BotEvent, number>());
  const compteurRef = useRef(0);
  const cleDe = (e: BotEvent): number => {
    let cle = clesRef.current.get(e);
    if (cle === undefined) {
      cle = ++compteurRef.current;
      clesRef.current.set(e, cle);
    }
    return cle;
  };

  // Filtrer les pings de keepalive pour ne pas polluer l'affichage
  const visibleEvents = events.filter((e) => e.name !== "ping");

  return (
    <div className="dbz-panel p-4">
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full inline-block ${
              status === "open"
                ? "bg-green-400 shadow-[0_0_6px_#4ade80]"
                : status === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-red-500"
            }`}
            aria-hidden
          />
          <span
            className={`font-scouter text-xs tracking-[0.2em] ${STATUS_COLOR[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>
        <span className="text-[10px] text-dbz-blue-light/70 font-mono">
          {visibleEvents.length} événement{visibleEvents.length > 1 ? "s" : ""}{" "}
          · tampon 200
        </span>
      </div>

      {status === "closed" && (
        <div className="mb-3 rounded border border-red-800 bg-red-900/20 p-2 text-xs text-red-300">
          La connexion au bot est interrompue. La page se reconnectera
          automatiquement.
        </div>
      )}

      <div className="font-mono text-xs space-y-1 max-h-[70vh] overflow-y-auto bg-dbz-bg/60 p-3 border border-dbz-border rounded">
        {visibleEvents.length === 0 && (
          <p className="text-dbz-blue-light/50 italic py-4 text-center">
            {status === "connecting"
              ? "Connexion au flux d'événements…"
              : "En attente du prochain événement…"}
          </p>
        )}
        {visibleEvents.map((e) => {
          const colorClass =
            EVENT_TYPE_COLOR[e.name] ?? "text-dbz-blue-light border-dbz-border";
          const label = EVENT_TYPE_LABEL[e.name] ?? e.name;
          return (
            <div
              key={cleDe(e)}
              className={`border-l-2 pl-2 py-1 hover:bg-dbz-blue-light/5 transition-colors ${colorClass.split(" ")[1] ?? "border-dbz-border"}`}
            >
              <div className="flex items-center gap-3">
                <span className={`font-bold ${colorClass.split(" ")[0]}`}>
                  {label}
                </span>
                <code className="text-zinc-600 text-[9px]">{e.name}</code>
                {e.ts && (
                  <span className="text-dbz-blue-light/50 text-[10px] ml-auto">
                    {new Date(e.ts).toLocaleTimeString("fr-FR")}
                  </span>
                )}
              </div>
              {e.payload !== undefined && (
                <details className="mt-0.5">
                  <summary className="text-[10px] text-zinc-500 cursor-pointer select-none">
                    Données
                  </summary>
                  <pre className="text-[10px] text-dbz-blue-light/80 mt-1 whitespace-pre-wrap break-all pl-2">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

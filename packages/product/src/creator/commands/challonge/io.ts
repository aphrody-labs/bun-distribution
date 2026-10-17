import { type Fetch, realSleep, type Sleep } from "./http.ts";

/** Dépendances externes injectables : les tests n'ont besoin d'aucun réseau ni terminal. */
export interface Io {
  env: Record<string, string | undefined>;
  fetch: Fetch;
  sleep: Sleep;
  random: () => number;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Constructeur WebSocket (Gateway Discord). */
  WebSocketImpl?: typeof WebSocket;
  /** Arrêt propre du bot (SIGINT/SIGTERM en production). */
  signal?: AbortSignal;
}

export function defaultIo(): Io {
  return {
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    sleep: realSleep,
    random: Math.random,
    out: line => console.log(line),
    err: line => console.error(line),
  };
}

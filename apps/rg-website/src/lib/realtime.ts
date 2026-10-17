"use client";

// Client de temps réel — Supabase Realtime (Broadcast).
//
// Le trigger `public.rg_realtime_notify()` assainit chaque changement des
// tables publiques (comments, settings, profiles, tables Discord) puis le
// diffuse avec `realtime.send()` sur le topic public `rg:<table>`. Le
// navigateur n'écoute donc jamais `postgres_changes` : seule la charge déjà
// filtrée côté base quitte Postgres. Un canal est partagé par table et
// distribué aux abonnés locaux, qui appliquent leur filtre `colonne=eq.valeur`.
import { createSupabaseBrowserClient } from "@rosegriffon/db/browser";

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface RealtimeEvent<T = Record<string, unknown>> {
  schema: string;
  table: string;
  eventType: RealtimeEventType;
  new: T | null;
  old: T | null;
  /** Charge utile réduite (ligne privée ou trop grosse) : seuls les identifiants sont fournis. */
  truncated?: boolean;
}

export interface SubscribeOptions {
  table: string;
  schema?: string;
  /** Filtre au format `postgres_changes` : `colonne=eq.valeur`. */
  filter?: string;
}

type RealtimeChannel = ReturnType<ReturnType<typeof createSupabaseBrowserClient>["channel"]>;

type Listener = (event: RealtimeEvent) => void;

interface SharedChannel {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
}

const channels = new Map<string, SharedChannel>();

function parseFilter(raw: string | undefined): { column: string; value: string } | null {
  if (!raw) return null;
  const match = raw.match(/^([a-z0-9_]+)=eq\.(.*)$/i);
  return match ? { column: match[1], value: match[2] } : null;
}

function topicOf(schema: string, table: string): string {
  return schema === "public" ? `rg:${table}` : `rg:${schema}.${table}`;
}

function acquire(topic: string): SharedChannel {
  const existing = channels.get(topic);
  if (existing) return existing;
  const listeners = new Set<Listener>();
  const channel = createSupabaseBrowserClient()
    .channel(topic, { config: { private: false } })
    .on("broadcast", { event: "*" }, message => {
      const event = message.payload as RealtimeEvent;
      for (const listener of listeners) listener(event);
    })
    .subscribe();
  const shared = { channel, listeners };
  channels.set(topic, shared);
  return shared;
}

/**
 * Ouvre un flux d'événements sur une table et renvoie la fonction de
 * désabonnement. La reconnexion est prise en charge par le client Realtime.
 */
export function subscribeTable<T = Record<string, unknown>>(
  options: SubscribeOptions,
  onEvent: (event: RealtimeEvent<T>) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const schema = options.schema ?? "public";
  const filter = parseFilter(options.filter);
  const topic = topicOf(schema, options.table);
  const shared = acquire(topic);

  const listener: Listener = event => {
    if (event.table !== options.table || event.schema !== schema) return;
    if (filter) {
      const row = event.new ?? event.old;
      if (String(row?.[filter.column] ?? "") !== filter.value) return;
    }
    onEvent(event as RealtimeEvent<T>);
  };
  shared.listeners.add(listener);

  return () => {
    shared.listeners.delete(listener);
    if (shared.listeners.size > 0) return;
    channels.delete(topic);
    void createSupabaseBrowserClient().removeChannel(shared.channel);
  };
}

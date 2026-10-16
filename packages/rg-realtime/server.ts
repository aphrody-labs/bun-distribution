// Service Realtime self-host — remplace le Realtime Supabase (Elixir/Phoenix).
//
// Une seule connexion Postgres tient `LISTEN rg_realtime` ; chaque événement
// émis par les triggers `public.rg_realtime_notify()` est rediffusé en SSE aux
// navigateurs abonnés, avec le même filtrage que `postgres_changes`
// (`table`, `schema`, et un filtre `colonne=eq.valeur`).
//
// Contrat client : GET /realtime/v1/stream?table=comments&filter=target_id=eq.42
// Chaque message SSE porte { schema, table, eventType, new, old, truncated? }.
// `Bun.SQL` n'expose pas LISTEN/NOTIFY (1.4.0) : la fabrique SQL commune
// fournit donc la connexion dédiée nécessaire à ce flux long.
import { createPgClient } from "@rosegriffon/db/pg";
import { isPublicSubscription, publicEvent, type RealtimeEvent } from "./events";

const PORT = Number(process.env.RG_REALTIME_PORT ?? 8812);
const HOST = process.env.RG_REALTIME_HOST ?? "127.0.0.1";
const CHANNEL = "rg_realtime";

function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "";
}

interface Subscriber {
  table: string;
  schema: string;
  /** Filtre `colonne=eq.valeur`, décomposé une fois à l'abonnement. */
  filter: { column: string; value: string } | null;
  send: (event: RealtimeEvent) => void;
  close: () => void;
}

const subscribers = new Set<Subscriber>();

/** Décompose un filtre `postgres_changes` (`colonne=eq.valeur`). */
function parseFilter(raw: string | null): Subscriber["filter"] {
  if (!raw) return null;
  const match = raw.match(/^([a-z0-9_]+)=eq\.(.*)$/i);
  return match ? { column: match[1], value: match[2] } : null;
}

/** Vrai si l'événement concerne l'abonnement (table, schéma et filtre). */
function matches(sub: Subscriber, event: RealtimeEvent): boolean {
  if (sub.table !== event.table || sub.schema !== event.schema) return false;
  if (!sub.filter) return true;
  const row = event.new ?? event.old;
  return String(row?.[sub.filter.column] ?? "") === sub.filter.value;
}

// ── Écoute Postgres ──
// La connexion d'écoute est dédiée et se reconnecte seule : une coupure ne doit
// jamais laisser le service muet sans le signaler.
async function listen(): Promise<void> {
  for (;;) {
    const dbUrl = getDatabaseUrl();
    if (!dbUrl) break;
    const client = createPgClient(dbUrl);
    try {
      await client.connect();
      client.on("notification", message => {
        if (message.channel !== CHANNEL || !message.payload) return;
        let event: RealtimeEvent;
        try {
          event = JSON.parse(message.payload) as RealtimeEvent;
        } catch {
          return;
        }
        const safeEvent = publicEvent(event);
        if (!safeEvent) return;
        for (const sub of subscribers) {
          if (matches(sub, safeEvent)) sub.send(safeEvent);
        }
      });
      await client.query(`LISTEN ${CHANNEL}`);
      console.log(`rg-realtime listen=${CHANNEL}`);
      // La connexion reste ouverte jusqu'à une erreur ou une fermeture serveur.
      await new Promise<void>(resolve => {
        client.once("error", resolve);
        client.once("end", resolve);
      });
    } catch (error) {
      console.error("[rg-realtime] ecoute interrompue", error);
    }
    await client.end().catch(() => {});
    await Bun.sleep(2_000);
  }
}

let listening = false;
export async function startRealtimeListener(): Promise<void> {
  if (listening) return;
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    console.warn("[rg-realtime] DATABASE_URL manquant, ecoute pg ignoree");
    return;
  }
  listening = true;
  void listen();
}

export function handleRealtime(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/realtime\/v1/, "") || "/";
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, apikey, content-type",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (path === "/health" || path === "/") {
    return Response.json({ ok: true, service: "rg-realtime", abonnes: subscribers.size }, { headers: cors });
  }

  if (path !== "/stream") return new Response("Not found", { status: 404, headers: cors });

  const table = url.searchParams.get("table");
  if (!table) return new Response("parametre `table` requis", { status: 400, headers: cors });
  const schema = url.searchParams.get("schema") ?? "public";
  if (!isPublicSubscription(schema, table)) return new Response("table non publique", { status: 403, headers: cors });
  const rawFilter = url.searchParams.get("filter");
  const filter = parseFilter(rawFilter);
  if (rawFilter && !filter) return new Response("filtre invalide", { status: 400, headers: cors });
  if ((table === "profiles" && filter && filter.column !== "id") || (table === "settings" && filter)) {
    return new Response("filtre non public", { status: 403, headers: cors });
  }

  let sub: Subscriber;
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // flux déjà fermé côté client
        }
      };
      sub = {
        table,
        schema,
        filter,
        send: event => write(`data: ${JSON.stringify(event)}\n\n`),
        close: () => {
          try {
            controller.close();
          } catch {
            // déjà fermé
          }
        },
      };
      subscribers.add(sub);
      write(": connecte\n\n");
      // Battement régulier : garde le flux ouvert à travers nginx et les proxys.
      const beat = setInterval(() => write(": ping\n\n"), 25_000);
      cleanup = () => {
        clearInterval(beat);
        subscribers.delete(sub);
        req.signal.removeEventListener("abort", cleanup);
        sub.close();
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

if (import.meta.main) {
  void startRealtimeListener();
  const server = Bun.serve({
    port: PORT,
    hostname: HOST,
    idleTimeout: 0,
    fetch(req) {
      return handleRealtime(req);
    },
  });

  console.log(`rg-realtime port=${server.port}`);
}

import "server-only";

import type { SqlQuery } from "@rosegriffon/db/platform";

import { getPgPool } from "./pg";

/**
 * Adapte le pool `pg` du site à la signature attendue par
 * `@rosegriffon/db/platform`.
 *
 * Les requêtes d'inspection vivent dans le paquet partagé pour que le tableau
 * de bord d'administration et le serveur MCP racontent exactement la même
 * chose ; seule la façon de parler à Postgres change d'un consommateur à
 * l'autre (pool `pg` ici, `Bun.SQL` côté MCP).
 *
 * Ces requêtes passent par la **connexion Postgres directe**, pas par
 * PostgREST : elles interrogent les catalogues système (`pg_class`,
 * `pg_policies`, `information_schema`) que l'API REST n'expose pas, et elles
 * doivent rester disponibles même si PostgREST est en panne — c'est justement
 * l'état qu'on cherche à diagnostiquer.
 */
export const pgQuery: SqlQuery = async <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> => {
  const result = await getPgPool().query(text, params as unknown[] | undefined);
  return result.rows as T[];
};

export interface ServiceHealth {
  name: string;
  url: string;
  role: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error?: string;
}

/**
 * Les services HTTP qui remplacent Supabase Cloud depuis le 11/8/2026.
 *
 * Sondés sur leur boucle locale : c'est l'état du service lui-même qui
 * intéresse ici, pas celui de nginx ni du DNS.
 */
const SERVICES: { name: string; url: string; role: string; expect?: number[] }[] = [
  {
    expect: [200, 404],
    name: "Storage",
    role: "Fichiers (/storage/v1) — index dans storage.objects",
    url: "http://127.0.0.1:8810/",
  },
  {
    expect: [200, 400, 404],
    name: "Realtime",
    role: "Flux SSE (/realtime/v1) — LISTEN/NOTIFY",
    url: "http://127.0.0.1:8812/",
  },
];

/** Sonde les services de la pile en parallèle, avec un plafond de temps court. */
export async function getStackHealth(): Promise<ServiceHealth[]> {
  return Promise.all(
    SERVICES.map(async ({ name, url, role, expect }) => {
      const started = Date.now();
      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(3_000),
        });
        const accepted = expect ?? [200];
        return {
          latencyMs: Date.now() - started,
          name,
          ok: accepted.includes(res.status),
          role,
          status: res.status,
          url,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "injoignable",
          latencyMs: null,
          name,
          ok: false,
          role,
          status: null,
          url,
        };
      }
    }),
  );
}

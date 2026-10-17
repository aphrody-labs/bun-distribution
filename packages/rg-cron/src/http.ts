/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Surface HTTP des tâches cron, montée dans l'API (`/v1/cron/*`).
 *
 *   GET  /v1/cron            → catalogue, planifications, tâches hors serverless
 *   POST /v1/cron/<tâche>    → lance la tâche (202, exécution poursuivie après la réponse)
 *   POST /v1/cron/<tâche>?attendre=1 → attend la fin et rend le résultat
 *
 * Authentification unique : `Authorization: Bearer $CRON_SECRET`. C'est
 * `pg_cron` (Supabase) qui appelle cette route, avec le secret lu dans Vault.
 * Corps JSON optionnel : `{ "origine": "planifie" | "manuel", "argument": "<slug>" }`.
 *
 * Le travail continue après la réponse grâce à `waitUntil` : `pg_net` n'attend
 * que l'accusé de réception, et la fonction reste en vie jusqu'à la fin de la
 * tâche, dans la limite de sa durée maximale (`CRON_BUDGET_MS`).
 */

import { waitUntil } from "@vercel/functions";
import { timingSafeEqual } from "node:crypto";
import {
  CATALOGUE_TACHES,
  lancerTache,
  PLANIFICATIONS,
  REGISTRE_TACHES,
  resoudreNomTache,
  TACHES_CRON,
  type OrigineExecution,
} from "./registry";

/**
 * Temps accordé à une exécution HTTP, en millisecondes : la durée maximale de
 * la fonction moins une marge pour écrire l'historique avant d'être tuée.
 */
const BUDGET_DEFAUT_MS = 280_000;

function budgetMs(): number {
  const brut = Number.parseInt(Bun.env.CRON_BUDGET_MS ?? "", 10);
  return Number.isFinite(brut) && brut > 0 ? brut : BUDGET_DEFAUT_MS;
}

function autorise(request: Request): boolean {
  const secret = Bun.env.CRON_SECRET;
  if (!secret) return false;
  const recu = request.headers.get("authorization") ?? "";
  const attendu = `Bearer ${secret}`;
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Nom de tâche après `/cron/` dans le chemin, décodé ; chaîne vide pour la racine. */
function tacheDuChemin(pathname: string): string | null {
  const indice = pathname.indexOf("/cron");
  if (indice < 0) return null;
  const reste = pathname.slice(indice + "/cron".length).replace(/^\/+|\/+$/g, "");
  try {
    return decodeURIComponent(reste);
  } catch {
    return null;
  }
}

async function lireCorps(request: Request): Promise<{ origine: OrigineExecution; argument?: string }> {
  const texte = await request.text().catch(() => "");
  if (!texte.trim()) return { origine: "manuel" };
  try {
    const corps = JSON.parse(texte) as { origine?: unknown; argument?: unknown };
    return {
      origine: corps.origine === "planifie" ? "planifie" : "manuel",
      argument: typeof corps.argument === "string" && corps.argument ? corps.argument : undefined,
    };
  } catch {
    return { origine: "manuel" };
  }
}

/** Point d'entrée `fetch` de la surface cron : `(Request) → Response`. */
export async function handleCronHttp(request: Request): Promise<Response> {
  if (!autorise(request)) return Response.json({ error: "Non autorisé" }, { status: 401 });

  const url = new URL(request.url);
  const tache = tacheDuChemin(url.pathname);
  if (tache === null) return Response.json({ error: "Chemin invalide" }, { status: 400 });

  if (tache === "") {
    if (request.method !== "GET") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    return Response.json({
      tasks: TACHES_CRON,
      schedules: PLANIFICATIONS,
      catalogue: CATALOGUE_TACHES,
      horsServerless: Object.fromEntries(
        Object.entries(REGISTRE_TACHES).flatMap(([nom, def]) =>
          def.horsServerless ? [[nom, def.horsServerless]] : [],
        ),
      ),
    });
  }

  if (request.method !== "POST") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
  const nom = resoudreNomTache(tache);
  if (!nom) return Response.json({ error: `Tâche « ${tache} » inconnue.` }, { status: 404 });
  const motif = REGISTRE_TACHES[nom]!.horsServerless;
  if (motif && Bun.env.VERCEL) {
    return Response.json({ error: `Tâche « ${nom} » indisponible en serverless : ${motif}.` }, { status: 409 });
  }

  const { origine, argument } = await lireCorps(request);
  const travail = lancerTache(nom, { origine, argument, echeance: Date.now() + budgetMs() });

  if (url.searchParams.get("attendre") === "1") {
    const resultat = await travail;
    return Response.json(resultat, { status: resultat.ignoree ? 409 : resultat.success ? 200 : 500 });
  }

  waitUntil(travail.catch(err => console.error(`[Cron HTTP] « ${nom} » :`, err)));
  return Response.json({ success: true, task: nom, message: `Tâche « ${nom} » démarrée.` }, { status: 202 });
}

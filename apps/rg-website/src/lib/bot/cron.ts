import "server-only";

import {
  CATALOGUE_TACHES,
  decrireTache,
  peutDeclencher,
  raisonRefus,
  type DescriptionTache,
  type SanteCron,
} from "@rosegriffon/types/cron";
import { createPostgresClient } from "@rosegriffon/db/service";

/**
 * Client de `rg-cron.service` — l'ordonnanceur, vu depuis le site.
 *
 * ── LA POLITIQUE D'ACCÈS EST APPLIQUÉE DEUX FOIS, ET C'EST VOULU ───────────
 * Le démon a sa propre garde (`CRON_SECRET` ou cookie de session
 * administrateur). Le site applique EN PLUS `peutDeclencher()` avant d'envoyer
 * quoi que ce soit : un `staff` ne doit pas pouvoir lancer une tâche classée
 * `admin-strict` en devinant l'URL de l'API, et les quatre tâches interdites
 * doivent l'être depuis toutes les surfaces, pas seulement depuis Discord.
 *
 * On ne fait jamais confiance au seul appelant, même quand cet appelant est
 * notre propre interface d'administration.
 */

const BASE = (process.env.CRON_API_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const DELAI_MS = 5_000;

export class CronIndisponibleError extends Error {
  constructor(
    message: string,
    readonly statut?: number,
  ) {
    super(message);
    this.name = "CronIndisponibleError";
  }
}

function entetes(): HeadersInit {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  return secret === ""
    ? { accept: "application/json" }
    : { accept: "application/json", authorization: `Bearer ${secret}` };
}

async function appeler<T>(chemin: string, init: RequestInit = {}): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(`${BASE}${chemin}`, {
      ...init,
      cache: "no-store",
      headers: { ...entetes(), ...init.headers },
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (erreur) {
    const raison =
      erreur instanceof Error
        ? erreur.name === "TimeoutError"
          ? `aucune réponse en ${DELAI_MS} ms`
          : erreur.message
        : String(erreur);
    throw new CronIndisponibleError(`L'ordonnanceur est injoignable (unité \`rg-cron.service\`) — ${raison}`);
  }
  if (!reponse.ok) {
    throw new CronIndisponibleError(
      reponse.status === 401
        ? "L'ordonnanceur a refusé l'authentification : `CRON_SECRET` est absent ou ne correspond pas à celui du service."
        : `L'ordonnanceur a répondu ${reponse.status}.`,
      reponse.status,
    );
  }
  const texte = await reponse.text();
  return (texte.length === 0 ? null : JSON.parse(texte)) as T;
}

export interface EtatCron {
  joignable: boolean;
  sante: SanteCron | null;
  erreur: string | null;
  /**
   * Le catalogue tel que le DÉMON le sert.
   *
   * Il vient de `@rosegriffon/types/cron` des deux côtés, donc il est identique
   * par construction ; on le lit quand même plutôt que de l'importer, parce
   * qu'un démon pas encore redéployé servirait l'ancienne liste — et c'est
   * précisément l'écart que l'interface doit montrer.
   */
  taches: readonly DescriptionTache[];
  /** Vrai quand le démon sert encore une liste plus ancienne que le site. */
  catalogueDesynchronise: boolean;
}

/** État de l'ordonnanceur. Ne lève jamais : un cron arrêté est un affichage. */
export async function etatDuCron(): Promise<EtatCron> {
  try {
    const sante = await appeler<SanteCron>("/health");
    let taches: readonly DescriptionTache[] = CATALOGUE_TACHES;
    let desynchronise = false;
    try {
      const liste = await appeler<{
        tasks?: string[];
        catalogue?: DescriptionTache[];
      }>("/tasks");
      if (Array.isArray(liste?.catalogue) && liste.catalogue.length > 0) {
        taches = liste.catalogue;
      } else if (Array.isArray(liste?.tasks)) {
        // Démon antérieur au catalogue partagé : il ne rend que des noms.
        desynchronise = liste.tasks.length !== CATALOGUE_TACHES.length;
        taches = liste.tasks.map(nom => decrireTache(nom)).filter((t): t is DescriptionTache => t !== null);
      }
    } catch {
      // `/health` répond mais `/tasks` refuse : le plus souvent un
      // `CRON_SECRET` absent côté site. On garde le catalogue local.
      desynchronise = false;
    }
    return { joignable: true, sante, erreur: null, taches, catalogueDesynchronise: desynchronise };
  } catch (erreur) {
    return {
      joignable: false,
      sante: null,
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
      taches: CATALOGUE_TACHES,
      catalogueDesynchronise: false,
    };
  }
}

export interface ResultatDeclenchement {
  ok: boolean;
  tache: string;
  message: string;
}

/**
 * Déclenche une tâche, après avoir vérifié le rôle CONTRE le catalogue.
 *
 * Le démon lance en tâche de fond et répond 202 : le résultat de la tâche
 * elle-même n'arrive pas ici, et c'est normal — certaines durent des minutes.
 * L'interface doit donc dire « démarrée », jamais « réussie ».
 */
export async function declencherTache(nom: string, role: string | null | undefined): Promise<ResultatDeclenchement> {
  const tache = decrireTache(nom);
  if (!tache) {
    return { ok: false, tache: nom, message: raisonRefus(nom) };
  }
  if (!peutDeclencher(tache.nom, role)) {
    return { ok: false, tache: tache.nom, message: raisonRefus(tache.nom) };
  }

  try {
    await appeler(`/tasks/${encodeURIComponent(tache.nom)}/run`, { method: "POST" });
    return {
      ok: true,
      tache: tache.nom,
      message: `« ${tache.titre} » démarrée en tâche de fond${
        tache.dureeIndicative ? ` (${tache.dureeIndicative})` : ""
      }.`,
    };
  } catch (erreur) {
    return {
      ok: false,
      tache: tache.nom,
      message: erreur instanceof Error ? erreur.message : String(erreur),
    };
  }
}

export interface TelemetrieDiscord {
  [clef: string]: unknown;
}

/** Une exécution persistée par `rg-cron` dans PostgreSQL. */
export interface ExecutionCron {
  tache: string;
  demarre_le: string;
  duree_ms: number;
  succes: boolean;
  erreur: string | null;
  origine: string;
}

/**
 * Historique administratif depuis la même table que le démon alimente.
 *
 * L'observabilité ne doit jamais rendre l'administration inutilisable : une
 * migration en attente ou une base momentanément indisponible donne une liste
 * vide, tandis que l'état live du démon reste affiché.
 */
export async function historiqueDuCron(limite = 20): Promise<ExecutionCron[]> {
  const plafond = Math.min(Math.max(Math.trunc(limite), 1), 100);
  try {
    const db = createPostgresClient();
    const { data, error } = await db
      .from("cron_executions")
      .select("tache, demarre_le, duree_ms, succes, erreur, origine")
      .order("demarre_le", { ascending: false })
      .limit(plafond);
    if (error) throw error;
    return (data ?? []) as ExecutionCron[];
  } catch {
    return [];
  }
}

/** Télémétrie Discord du démon (présences, salons vocaux), ou `null`. */
export async function telemetrieDiscord(): Promise<TelemetrieDiscord | null> {
  try {
    return await appeler<TelemetrieDiscord>("/discord-telemetry");
  } catch {
    return null;
  }
}

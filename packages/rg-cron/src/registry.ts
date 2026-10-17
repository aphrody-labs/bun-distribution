/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registre des tâches cron : nom → fonction, et l'exécuteur commun.
 *
 * ── CE QUI A REMPLACÉ LE DÉMON ─────────────────────────────────────────────
 * `rg-cron` était un processus permanent (`Bun.cron`, serveur WebSocket de
 * journaux, pont IPC). Les planifications vivent désormais dans Supabase
 * (`pg_cron` + `pg_net`, migration `20261017_cron_pg_net.sql`), qui appelle
 * `POST /v1/cron/<tâche>` sur l'API ; la route (`http.ts`) et la CLI
 * (`--run <tâche>`) passent toutes deux par `lancerTache` ci-dessous. C'est le
 * SEUL endroit qui associe un nom de tâche à une fonction.
 *
 * ── SÉMANTIQUE CONSERVÉE ───────────────────────────────────────────────────
 * Délai maximal par tâche, historique dans `public.cron_executions`, alerte
 * Discord sur échec répété (une par série), verrou d'unicité. Sans mémoire
 * partagée entre deux appels, le verrou est un BAIL en base
 * (`public.cron_task_leases`) et la série d'échecs se relit dans l'historique.
 *
 * Les modules de tâches sont chargés à la demande : une fonction qui publie
 * les articles programmés ne charge ni le navigateur CDP ni le client X.
 */

import { CATALOGUE_TACHES, normaliserNomTache, PLANIFICATIONS, TACHES_CRON } from "@rosegriffon/types/cron";
import { signalerDecisionAlerte } from "./lib/alertes-cron.js";
import { decisionDepuisHistorique, type OrigineExecution, type ResultatExecution } from "./lib/executions.js";
import {
  echecsConsecutifsAvant,
  enregistrerExecutionEnBase,
  prendreBail,
  rendreBail,
} from "./lib/executions-postgres.js";

export { CATALOGUE_TACHES, PLANIFICATIONS, TACHES_CRON };
export type { OrigineExecution };

/** Paramètre libre passé après le nom de tâche (`--run x:campagnes <slug>`). */
export interface OptionsTache {
  argument?: string;
}

export interface DefinitionTache {
  executer: (options: OptionsTache) => Promise<unknown>;
  /** Nom consigné dans l'historique, quand il diffère du nom public. */
  historique?: string;
  /** Tâches lancées à la suite, seulement si celle-ci réussit. */
  ensuite?: readonly string[];
  /**
   * Motif pour lequel la tâche ne peut pas tourner en fonction serverless
   * (disque local, navigateur, sous-processus). Elle reste lançable en CLI sur
   * une machine qui a ces ressources, mais n'est planifiée nulle part.
   */
  horsServerless?: string;
}

/** Slug optionnel, ignoré s'il ressemble à une option de ligne de commande. */
function slug(options: OptionsTache): { slug?: string } {
  return options.argument && !options.argument.startsWith("-") ? { slug: options.argument } : {};
}

export const REGISTRE_TACHES: Readonly<Record<string, DefinitionTache>> = Object.freeze({
  db: {
    executer: () => import("./tasks/db").then(m => m.runInaglePush()),
    historique: "db:sync",
    // `db:sync` vide puis réécrit `inagle_skills` : `zukan:videos` doit passer après.
    ensuite: ["zukan:videos"],
    horsServerless: "lance `bun run --filter @rosegriffon/inagle push` sur les fichiers du jeu (disque local)",
  },
  "zukan:videos": { executer: () => import("./tasks/zukan-videos").then(m => m.rafraichirVideosTechniques()) },
  cdn: {
    executer: () => import("./tasks/cdn").then(m => m.syncCdnAssets()),
    horsServerless: "copie les assets vers le disque statique du CDN (`CDN_STATIC_ROOT`)",
  },
  crawl: {
    executer: () => import("./tasks/ie-crawl").then(m => m.runIeCrawl()),
    horsServerless: "pilote un navigateur CDP et écrit ses corpus sur disque",
  },
  "website:qa": {
    executer: () => import("./tasks/ie-crawl/website-qa").then(m => m.runWebsiteQa()),
    horsServerless: "lance le script shell agent-browser et un navigateur",
  },
  publish: { executer: () => import("./tasks/api").then(m => m.triggerPublishScheduled()) },
  "github-publish": { executer: () => import("./tasks/api").then(m => m.triggerGithubPublishWorkflow()) },
  patreon: { executer: () => import("./tasks/api").then(m => m.triggerPatreonRefresh()) },
  reminders: {
    executer: options => import("./tasks/api").then(m => m.triggerPatreonReminders(options.argument || "announce")),
  },
  warm: { executer: () => import("./tasks/api").then(m => m.warmCaches()) },
  discord: {
    executer: () => import("./tasks/discord").then(m => m.runDiscordSync()),
    historique: "discord:sync",
    // La projection recopie ce que la collecte vient d'écrire : l'ordre compte.
    ensuite: ["sync:achillea"],
  },
  "discord:scan": { executer: () => import("./tasks/discord").then(m => m.runDiscordChannelScan()) },
  "discord:messages": { executer: () => import("./tasks/discord-messages").then(m => m.runDiscordMessagesSync()) },
  "discord:backfill": { executer: () => import("./tasks/discord-messages").then(m => m.runDiscordMessagesBackfill()) },
  "discord:archives": {
    executer: async () => {
      const m = await import("./tasks/discord-messages");
      const categories = await m.armerSalonsDeCategories();
      const depots = await m.armerSalonsDeDepot();
      return {
        success: true,
        stats: {
          salonsExamines: categories.examines,
          salonsArmes: categories.armes,
          salonsDejaSuivis: categories.deja,
          salonsDepotArmes: depots,
        },
      };
    },
  },
  "discord:polls": { executer: () => import("./tasks/discord-polls").then(m => m.runDiscordPollsImport()) },
  "noctaly:import": {
    executer: () => import("./tasks/discord-noctaly").then(m => m.runNoctalyImport()),
    horsServerless: "lance le script d'import du bot en sous-processus (`Bun.spawn`)",
  },
  x: {
    // UNIQUEMENT le dernier post d'`@Azalee_IE` : c'est lui qui alimente l'annonce Discord.
    executer: () =>
      import("./tasks/ie-crawl/twitter").then(m => m.crawlTwitter({ comptes: ["Azalee_IE"], parCompte: 1 })),
  },
  "x-search": { executer: () => import("./tasks/ie-crawl/harvest-search").then(m => m.crawlTwitterSearch()) },
  "x:campagnes": {
    executer: options => import("./tasks/ie-crawl/hashtag-harvest").then(m => m.crawlHashtagCampaigns(slug(options))),
  },
  "campagnes:discord": {
    executer: options => import("./tasks/campagnes-discord").then(m => m.recolterCreationsDiscord(slug(options))),
  },
  "campagnes:instagram": {
    executer: options =>
      import("./tasks/campagnes-instagram").then(m => m.revaliderCreationsInstagram(slug(options))),
  },
  "campagnes:relais": {
    executer: options => import("./tasks/campagnes-relais-discord").then(m => m.relayerCampagnesDiscord(slug(options))),
  },
  "seo:indexnow": { executer: () => import("./tasks/seo/indexnow").then(m => m.runSeoIndexNow()) },
  "seo:llms-txt": {
    executer: () => import("./tasks/seo/llms-txt").then(m => m.runSeoLlmsTxt()),
    horsServerless: "écrit les fichiers llms.txt dans le répertoire partagé servi par nginx",
  },
  "stats:achillea": {
    executer: () => import("./tasks/stats/achillea").then(m => m.collecterAudienceAchillea()),
    horsServerless: "lit le journal nginx local (`/var/log/nginx/rg-stats.log`) et écrit un cache sur disque",
  },
  "sync:achillea": { executer: () => import("./tasks/achillea-sync").then(m => m.runAchilleaSync()) },
  "achillea:seasons": { executer: () => import("./tasks/achillea-seasons").then(m => m.runAchilleaSeasonRollover()) },
  "achillea:weekly-payout": {
    executer: () => import("./tasks/achillea-weekly-payout").then(m => m.runAchilleaWeeklyPayout()),
  },
});

const PAR_NOM_NORMALISE = new Map(Object.keys(REGISTRE_TACHES).map(nom => [normaliserNomTache(nom), nom]));

/** Nom canonique du registre (`discord-messages` → `discord:messages`), ou `null`. */
export function resoudreNomTache(nom: string | null | undefined): string | null {
  if (!nom) return null;
  return PAR_NOM_NORMALISE.get(normaliserNomTache(nom)) ?? null;
}

/**
 * Délai maximal par défaut d'une tâche, en millisecondes.
 *
 * HONNÊTETÉ SUR LA PORTÉE : le délai libère le SUIVI (historique, alerte, bail),
 * il n'interrompt pas la promesse sous-jacente — JavaScript ne le permet pas.
 * Les annulations réelles sont posées au plus près des I/O (`AbortSignal.timeout`).
 * En serverless, l'échéance de la fonction le raccourcit encore (`lancerTache`).
 */
const DELAI_TACHE_DEFAUT_MS = 30 * 60_000;

/** Délais calés sur la durée réellement observée des tâches longues (noms d'historique). */
const DELAIS_TACHES_MS: Record<string, number> = {
  "website:qa": 2 * 3600_000,
  crawl: 4 * 3600_000,
  "db:sync": 2 * 3600_000,
  "discord:backfill": 4 * 3600_000,
  "discord:scan": 3600_000,
  cdn: 3600_000,
  "x:campagnes": 3600_000,
  "campagnes:discord": 3600_000,
  "campagnes:instagram": 3600_000,
  "campagnes:relais": 900_000,
  "seo:llms-txt": 3600_000,
  x: 3600_000,
  "x-search": 3600_000,
};

function delaiMaximalTache(nom: string): number {
  const surcharge = Number.parseInt(Bun.env.CRON_DELAI_TACHE_MS ?? "", 10);
  if (Number.isFinite(surcharge) && surcharge > 0) return surcharge;
  return DELAIS_TACHES_MS[nom] ?? DELAI_TACHE_DEFAUT_MS;
}

/** Levée quand une tâche dépasse son délai maximal. */
class ErreurDelaiDepasse extends Error {
  constructor(nom: string, delaiMs: number) {
    super(`Délai maximal dépassé (${Math.round(delaiMs / 1000)} s) pour la tâche « ${nom} ».`);
    this.name = "ErreurDelaiDepasse";
  }
}

export interface ResultatTache {
  nom: string;
  success: boolean;
  error?: string;
  /** Vrai quand la tâche tournait déjà ailleurs : rien n'a été lancé. */
  ignoree?: boolean;
  dureeMs?: number;
  /** Tâches enchaînées après celle-ci. */
  suites?: ResultatTache[];
}

/**
 * Consigne une exécution terminée : historique en base, puis alerte Discord si
 * la série d'échecs franchit le seuil (ou se referme). Ne lève jamais : ni
 * l'historique ni Discord ne doivent faire échouer une tâche de production.
 */
async function consignerExecution(resultat: ResultatExecution): Promise<void> {
  try {
    const echecsPrecedents = await echecsConsecutifsAvant(resultat.nom, resultat.debutLe);
    await enregistrerExecutionEnBase(resultat);
    const decision = decisionDepuisHistorique(resultat, echecsPrecedents);
    if (decision.type !== "aucune") await signalerDecisionAlerte(decision);
  } catch (err) {
    console.warn("[Cron Runner] exécution non consignée :", err);
  }
}

/**
 * Enveloppe l'exécution d'une tâche : bail d'unicité, délai maximal,
 * historique persisté et alerte sur échec répété.
 */
export async function executeTask(
  nom: string,
  fn: () => Promise<unknown>,
  origine: OrigineExecution = "planifie",
  echeance = Number.POSITIVE_INFINITY,
): Promise<ResultatTache> {
  const delaiMs = Math.max(1000, Math.min(delaiMaximalTache(nom), echeance - Date.now()));
  const jeton = await prendreBail(nom, delaiMs);
  if (jeton === null) {
    const message = `La tâche « ${nom} » tourne déjà : lancement ignoré.`;
    console.warn(`[Cron Runner] ${message}`);
    return { nom, success: false, error: message, ignoree: true };
  }

  console.log(`[Cron Runner] Début de la tâche : ${nom}`);
  const debut = Date.now();
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let resultat: ResultatTache;
  let expiree = false;

  try {
    const expiration = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new ErreurDelaiDepasse(nom, delaiMs)), delaiMs);
    });
    const res = await Promise.race([fn(), expiration]);
    const succes = res && typeof res === "object" && "success" in res ? Boolean(res.success) : true;
    const brut = res && typeof res === "object" && "error" in res ? res.error : undefined;
    const erreur = brut === undefined || brut === null ? undefined : String(brut);
    resultat = { nom, success: succes, error: succes ? undefined : erreur, dureeMs: Date.now() - debut };
  } catch (err) {
    expiree = err instanceof ErreurDelaiDepasse;
    resultat = {
      nom,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      dureeMs: Date.now() - debut,
    };
    console.error(`[Cron Runner] Erreur critique lors de la tâche : ${nom} :`, err);
  } finally {
    clearTimeout(minuteur);
  }

  if (resultat.success) console.log(`[Cron Runner] Tâche complétée avec succès : ${nom} en ${resultat.dureeMs}ms`);
  else console.error(`[Cron Runner] Échec de la tâche : ${nom} en ${resultat.dureeMs}ms : ${resultat.error}`);

  await consignerExecution({
    nom,
    debutLe: debut,
    dureeMs: resultat.dureeMs ?? 0,
    succes: resultat.success,
    erreur: resultat.error,
    origine,
    expiree,
  });
  await rendreBail(nom, jeton);
  return resultat;
}

/**
 * Lance une tâche du registre, puis ses suites si elle réussit.
 *
 * `echeance` (epoch ms) borne l'ensemble : une fonction serverless est tuée à
 * sa durée maximale, et l'historique doit être écrit AVANT.
 */
export async function lancerTache(
  nomBrut: string,
  options: { origine?: OrigineExecution; echeance?: number; argument?: string } = {},
): Promise<ResultatTache> {
  const nom = resoudreNomTache(nomBrut);
  if (!nom) return { nom: nomBrut, success: false, error: `Tâche « ${nomBrut} » inconnue.` };
  const definition = REGISTRE_TACHES[nom]!;
  const echeance = options.echeance ?? Number.POSITIVE_INFINITY;
  const resultat = await executeTask(
    definition.historique ?? nom,
    () => definition.executer({ argument: options.argument }),
    options.origine ?? "manuel",
    echeance,
  );
  if (resultat.success && definition.ensuite?.length) {
    resultat.suites = [];
    for (const suite of definition.ensuite) {
      resultat.suites.push(await lancerTache(suite, { origine: options.origine, echeance }));
    }
  }
  return resultat;
}

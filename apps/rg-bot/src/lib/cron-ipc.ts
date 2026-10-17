/**
 * Pont bot → tâches cron, EN PROCESSUS.
 *
 * Le démon `rg-cron.service` et sa socket UNIX ont disparu : les tâches serverless sont planifiées
 * par `pg_cron` (`POST /v1/cron/<tâche>`), les tâches lourdes tournent dans `rg-core`, le même
 * processus que ce bot. Les verbes historiques du pont (`health`, `tasks.list`, `metrics`,
 * `task.status`, `task.run`, `telemetry.discord`, `scrape.*`, `x.*`) sont donc servis ici
 * directement par le registre de `@rosegriffon/cron`, sans socket ni sérialisation. Le contrat
 * des appelants (`appelerCron`, `abonnerCron`, `CronInjoignableError`) est inchangé.
 *
 * `@rosegriffon/cron` est chargé à la demande : une commande qui n'appelle jamais le pont ne
 * charge ni le registre ni sa connexion Postgres.
 */
import { clientActif } from "./client-actif";

/** Requête : `cmd` est le verbe. */
export interface RequeteIpc {
  cmd: string;
  [clef: string]: unknown;
}

/** Réponse. `success` est toujours présent. */
export interface ReponseIpc {
  success: boolean;
  error?: string;
  code?: string;
  [clef: string]: unknown;
}

/** Poussée spontanée vers les abonnés (`task.done`, `tweets.signal`). */
export interface EvenementIpc {
  event: string;
  [clef: string]: unknown;
}

export class CronInjoignableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronInjoignableError";
  }
}

const DELAI_DEFAUT_MS = 10_000;
const demarreLe = new Date().toISOString();
const enCours = new Set<string>();
const abonnes = new Set<(evenement: EvenementIpc) => void>();
const compteurs = { tasksTriggered: 0, tasksSucceeded: 0, tasksFailed: 0 };

function diffuser(evenement: EvenementIpc): void {
  for (const abonne of abonnes) {
    try {
      abonne(evenement);
    } catch (err) {
      console.warn("[cron-ipc] abonné en erreur :", err);
    }
  }
}

/** Dernière exécution de chaque tâche, relue dans `public.cron_executions`. */
async function dernieresExecutions(): Promise<
  Record<string, { time: string; durationMs: number; success: boolean; error?: string }>
> {
  const { historiqueExecutions } = await import("@rosegriffon/cron");
  const dernieres: Record<string, { time: string; durationMs: number; success: boolean; error?: string }> = {};
  for (const ligne of await historiqueExecutions(200)) {
    if (dernieres[ligne.tache]) continue;
    dernieres[ligne.tache] = {
      time: new Date(ligne.demarre_le).toISOString(),
      durationMs: ligne.duree_ms,
      success: ligne.succes,
      ...(ligne.erreur ? { error: ligne.erreur } : {}),
    };
  }
  return dernieres;
}

/** Télémétrie de la passerelle de ce processus, ou `null` si aucune n'est ouverte. */
function telemetrieDiscord(): Record<string, unknown> | null {
  const client = clientActif();
  if (!client?.isReady()) return null;
  return {
    utilisateur: client.user.tag,
    pingMs: client.ws.ping,
    serveurs: client.guilds.cache.map(g => ({
      id: g.id,
      nom: g.name,
      membres: g.memberCount,
    })),
    pretDepuis: client.readyAt?.toISOString() ?? null,
  };
}

/** Lance une tâche en tâche de fond ; le verdict arrive par `task.done`. */
async function lancer(requete: RequeteIpc): Promise<ReponseIpc> {
  const { resoudreNomTache, lancerTache } = await import("@rosegriffon/cron");
  const nom = resoudreNomTache(typeof requete.nom === "string" ? requete.nom : "");
  if (!nom)
    return {
      success: false,
      error: `Tâche « ${String(requete.nom)} » inconnue.`,
      code: "inconnue",
    };
  if (enCours.has(nom))
    return {
      success: false,
      error: `La tâche « ${nom} » tourne déjà.`,
      code: "en_cours",
    };
  enCours.add(nom);
  compteurs.tasksTriggered++;
  const debut = Date.now();
  void lancerTache(nom, { origine: "manuel" })
    .then(resultat => {
      if (resultat.success) compteurs.tasksSucceeded++;
      else compteurs.tasksFailed++;
      diffuser({
        event: "task.done",
        nom,
        success: resultat.success,
        error: resultat.error,
        durationMs: Date.now() - debut,
      });
      if (resultat.success && nom.startsWith("x")) diffuser({ event: "tweets.signal", nom });
    })
    .catch(err => {
      compteurs.tasksFailed++;
      diffuser({
        event: "task.done",
        nom,
        success: false,
        error: String(err),
        durationMs: Date.now() - debut,
      });
    })
    .finally(() => enCours.delete(nom));
  return { success: true, nom };
}

async function repondre(requete: RequeteIpc): Promise<ReponseIpc> {
  switch (requete.cmd) {
    case "health":
      return { success: true, uptime: process.uptime(), abonnes: abonnes.size };
    case "tasks.list":
    case "tasks.schedules": {
      const { TACHES_CRON, PLANIFICATIONS } = await import("@rosegriffon/cron");
      return {
        success: true,
        taches: [...TACHES_CRON],
        schedules: { ...PLANIFICATIONS },
      };
    }
    case "metrics":
      return {
        success: true,
        metrics: {
          startedAt: demarreLe,
          ...compteurs,
          lastExecution: await dernieresExecutions(),
        },
      };
    case "task.status": {
      const nom = typeof requete.nom === "string" ? requete.nom : "";
      return {
        success: true,
        nom,
        derniere: (await dernieresExecutions())[nom] ?? null,
        enCours: enCours.has(nom),
      };
    }
    case "task.run":
      return await lancer(requete);
    case "telemetry.discord": {
      const telemetry = telemetrieDiscord();
      return telemetry
        ? { success: true, telemetry }
        : {
            success: false,
            error: "Télémétrie Discord indisponible.",
            code: "indisponible",
          };
    }
    default: {
      const { servirVerbeScrape } = await import("@rosegriffon/cron");
      return (await servirVerbeScrape(requete.cmd, requete)) as ReponseIpc;
    }
  }
}

/**
 * Sert un verbe du pont. Lève `CronInjoignableError` si le registre ne peut pas être chargé ou si
 * le verbe dépasse son délai : les commandes distinguent ainsi « refusé » de « absent ».
 */
export async function appelerCron<T extends ReponseIpc = ReponseIpc>(
  requete: RequeteIpc,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const delai = options.timeoutMs ?? DELAI_DEFAUT_MS;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const expiration = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new CronInjoignableError(`Aucune réponse en ${delai} ms.`)), delai);
  });
  try {
    return (await Promise.race([repondre(requete), expiration])) as T;
  } catch (err) {
    if (err instanceof CronInjoignableError) throw err;
    throw new CronInjoignableError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(minuteur);
  }
}

/** Vrai si le registre répond. */
export async function cronDisponible(): Promise<boolean> {
  try {
    return (await appelerCron({ cmd: "health" }, { timeoutMs: 2_000 })).success === true;
  } catch {
    return false;
  }
}

/** Pousse un évènement aux abonnés (planificateur de `rg-core` : `tweets.signal`, `task.done`). */
export function signalerCron(evenement: EvenementIpc): void {
  diffuser(evenement);
}

/** S'abonne aux poussées (`task.done`, `tweets.signal`). Renvoie la fonction de désabonnement. */
export function abonnerCron(surEvenement: (evenement: EvenementIpc) => void): () => void {
  abonnes.add(surEvenement);
  return () => abonnes.delete(surEvenement);
}

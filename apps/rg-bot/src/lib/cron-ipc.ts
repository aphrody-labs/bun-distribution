/**
 * Pont natif bot → `rg-cron.service`, sur une SOCKET UNIX.
 *
 * ── POURQUOI PAS LES PORTS EXISTANTS ───────────────────────────────────────
 * Mesuré le 12/8/2026 : `:3005` (plan de contrôle du cron) et `:3006` (serveur
 * d'annonces) écoutent sur `*`, et `ufw` laisse passer `3000:3010/tcp` depuis
 * n'importe où. Pire, `DISCORD_ANNOUNCE_SECRET` est absent de l'environnement
 * des deux démons : le code retombe sur le littéral `"default-secret-key-12345"`
 * écrit dans `packages/cron/src/index.ts`, et une requête portant ce secret
 * depuis Internet passe l'authentification (réponse 400 sur la charge, pas 401).
 * Bâtir le pont sur ces ports, c'était bâtir sur une porte ouverte.
 *
 * Une socket UNIX n'a pas de port, pas de secret à faire tourner, et ses
 * permissions sont appliquées par le noyau. Les deux démons tournent en
 * `ubuntu` ; `/var/lib/rg` appartient à `ubuntu` et figure déjà dans les
 * `ReadWritePaths` de `rg-cron.service`.
 *
 * ⚠ Le bot ne peut PAS créer cette socket (`ProtectSystem=strict` rend `/var`
 * en lecture seule pour lui) — mais il n'en a pas besoin : s'y CONNECTER
 * fonctionne, car le noyau n'oppose `EROFS` qu'aux fichiers réguliers, aux
 * dossiers et aux liens, jamais aux sockets. Vérifié sous le bac à sable exact
 * du service.
 *
 * ── DEUX SENS SUR UNE SEULE SOCKET ─────────────────────────────────────────
 * Les commandes bot → cron ouvrent une connexion courte (une requête, une
 * réponse, fermeture). Les poussées cron → bot (`tweets.signal`, `task.done`)
 * passent par une connexion PERSISTANTE que le bot ouvre avec `subscribe` : le
 * cron n'a donc jamais à se connecter au bot, et il n'existe pas de seconde
 * socket à créer dans un dossier que le bot pourrait écrire.
 *
 * Fonctions exportées, pas de classe : le piège `tsyringe` + `import type`
 * (qui casse `Reflect.metadata("design:paramtypes")`) ne s'applique donc pas ici.
 */
import type { Socket } from "bun";

/** Chemin de la socket quand `RG_CRON_SOCKET` n'est pas posé — celui du service. */
export const CHEMIN_SOCKET_CRON_DEFAUT = "/var/lib/rg/cron.sock";

/**
 * Chemin de la socket. Doit rester identique côté cron (`lib/ipc-unix.ts`).
 *
 * Résolu à CHAQUE APPEL, et non figé à l'import. La différence n'est pas
 * théorique : `bun test` exécute tous les fichiers de tests dans un SEUL
 * processus, donc le premier module qui chargeait celui-ci gelait le chemin
 * pour tous les autres. Un test qui pose `RG_CRON_SOCKET` vers une socket
 * temporaire avant d'importer voyait alors `/var/lib/rg/cron.sock` — le chemin
 * de production — parce qu'un test précédent (une commande `/staff`, par
 * exemple) avait déjà déclenché l'import. Le coût d'une lecture d'environnement
 * par connexion est nul devant celui d'un test qui ment.
 */
export function cheminSocketCron(): string {
  return Bun.env.RG_CRON_SOCKET ?? CHEMIN_SOCKET_CRON_DEFAUT;
}

/** Requête JSON, une par ligne. `cmd` est le verbe. */
export interface RequeteIpc {
  cmd: string;
  [clef: string]: unknown;
}

/** Réponse du cron. `success` est toujours présent. */
export interface ReponseIpc {
  success: boolean;
  error?: string;
  code?: string;
  [clef: string]: unknown;
}

/** Poussée spontanée du cron vers le bot abonné. */
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

/**
 * Envoie un verbe au cron et attend UNE réponse.
 *
 * Connexion courte volontaire : une commande Discord ne doit pas dépendre de la
 * santé d'une connexion ouverte depuis des heures. Le coût d'un `connect()` sur
 * une socket UNIX est négligeable devant le tour de réseau Discord.
 */
export async function appelerCron<T extends ReponseIpc = ReponseIpc>(
  requete: RequeteIpc,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const delai = options.timeoutMs ?? DELAI_DEFAUT_MS;

  return await new Promise<T>((resoudre, rejeter) => {
    let tampon = "";
    let termine = false;
    let socket: Socket<undefined> | null = null;

    const minuteur = setTimeout(() => {
      finir(() => rejeter(new CronInjoignableError(`Aucune réponse du cron en ${delai} ms.`)));
    }, delai);

    function finir(action: () => void): void {
      if (termine) {
        return;
      }
      termine = true;
      clearTimeout(minuteur);
      try {
        socket?.end();
      } catch {
        /* socket déjà fermée */
      }
      action();
    }

    Bun.connect<undefined>({
      unix: cheminSocketCron(),
      socket: {
        open(ouverte) {
          socket = ouverte;
          ouverte.write(`${JSON.stringify(requete)}\n`);
        },
        data(_ouverte, donnees) {
          tampon += donnees.toString();
          const coupure = tampon.indexOf("\n");
          if (coupure < 0) {
            return;
          }
          const ligne = tampon.slice(0, coupure);
          try {
            finir(() => resoudre(JSON.parse(ligne) as T));
          } catch (err) {
            finir(() =>
              rejeter(
                new CronInjoignableError(
                  `Réponse illisible du cron : ${err instanceof Error ? err.message : String(err)}`,
                ),
              ),
            );
          }
        },
        error(_ouverte, err) {
          finir(() => rejeter(new CronInjoignableError(err.message)));
        },
        close() {
          finir(() => rejeter(new CronInjoignableError("Le cron a fermé la connexion sans répondre.")));
        },
      },
    }).catch((err: unknown) => {
      finir(() =>
        rejeter(
          new CronInjoignableError(
            `Socket ${cheminSocketCron()} injoignable — rg-cron.service n'expose le pont qu'après un redémarrage (${
              err instanceof Error ? err.message : String(err)
            }).`,
          ),
        ),
      );
    });
  });
}

/** Vrai si le pont répond. Sert aux commandes pour distinguer « refusé » de « absent ». */
export async function cronDisponible(): Promise<boolean> {
  try {
    const reponse = await appelerCron({ cmd: "health" }, { timeoutMs: 2_000 });
    return reponse.success === true;
  } catch {
    return false;
  }
}

// ─── Abonnement aux poussées du cron ────────────────────────────────────────

let socketAbonnement: Socket<undefined> | null = null;
let abonnementActif = false;
let tentatives = 0;
let minuteurReconnexion: ReturnType<typeof setTimeout> | null = null;

/**
 * Ouvre (et maintient) la connexion d'abonnement.
 *
 * L'abonnement est une OPTIMISATION, jamais la source de vérité : si la socket
 * n'existe pas encore — c'est le cas tant que `rg-cron.service` n'a pas été
 * redémarré avec le pont — le bot se contente de réessayer, et son filet de
 * rattrapage périodique fait tout le travail. C'est le même motif que la veille
 * des messages Discord côté cron : passerelle pour la réactivité, rattrapage
 * régulier pour la garantie.
 *
 * @returns une fonction qui coupe l'abonnement.
 */
export function abonnerCron(surEvenement: (evenement: EvenementIpc) => void): () => void {
  abonnementActif = true;
  tentatives = 0;
  connecter();

  function planifierReconnexion(): void {
    if (!abonnementActif || minuteurReconnexion) {
      return;
    }
    // 2 s, 4 s, 8 s… plafonné à 2 min : une socket absente ne doit pas faire
    // tourner le processus en boucle serrée pendant des heures.
    const attente = Math.min(120_000, 2_000 * 2 ** Math.min(tentatives, 6));
    tentatives += 1;
    minuteurReconnexion = setTimeout(() => {
      minuteurReconnexion = null;
      connecter();
    }, attente);
  }

  function connecter(): void {
    if (!abonnementActif) {
      return;
    }
    let tampon = "";
    Bun.connect<undefined>({
      unix: cheminSocketCron(),
      socket: {
        open(ouverte) {
          socketAbonnement = ouverte;
          tentatives = 0;
          ouverte.write(`${JSON.stringify({ cmd: "subscribe" })}\n`);
          console.info("[cron-ipc] abonné au pont", cheminSocketCron());
        },
        data(_ouverte, donnees) {
          tampon += donnees.toString();
          let coupure = tampon.indexOf("\n");
          while (coupure >= 0) {
            const ligne = tampon.slice(0, coupure).trim();
            tampon = tampon.slice(coupure + 1);
            coupure = tampon.indexOf("\n");
            if (ligne.length === 0) {
              continue;
            }
            try {
              const charge = JSON.parse(ligne) as Partial<EvenementIpc>;
              if (typeof charge.event === "string") {
                surEvenement(charge as EvenementIpc);
              }
            } catch (err) {
              console.warn("[cron-ipc] ligne illisible :", err);
            }
          }
        },
        error(_ouverte, err) {
          console.warn("[cron-ipc] abonnement en erreur :", err.message);
        },
        close() {
          socketAbonnement = null;
          planifierReconnexion();
        },
      },
    }).catch(() => {
      // Silencieux : tant que le cron n'a pas redémarré avec le pont, la
      // socket n'existe pas. En journaliser l'absence toutes les 2 s
      // noierait le journal sans rien apprendre.
      planifierReconnexion();
    });
  }

  return () => {
    abonnementActif = false;
    if (minuteurReconnexion) {
      clearTimeout(minuteurReconnexion);
      minuteurReconnexion = null;
    }
    try {
      socketAbonnement?.end();
    } catch {
      /* socket déjà fermée */
    }
    socketAbonnement = null;
  };
}

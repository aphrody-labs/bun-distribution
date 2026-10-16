import "server-only";

import {
  PROFILS_BOT,
  TOUS_LES_PROFILS_BOT,
  type CommandeBot,
  type EtatBot,
  type EtatBotAgrege,
  type NomProfilBot,
  type ProfilBotPublic,
} from "@rosegriffon/types/bot";

/**
 * Client des serveurs d'administration des deux bots Discord.
 *
 * ── POURQUOI PASSER PAR LE PROCESSUS ET PAS PAR LA BASE ────────────────────
 * Tout ce que ce module va chercher n'est écrit NULLE PART : la passerelle
 * est-elle ouverte, quelles commandes ont réellement été enregistrées, sur
 * quels serveurs, avec quelles options, quels salons et quels rôles existent.
 * C'est l'état d'un processus, pas une donnée. Le lire ailleurs qu'auprès du
 * processus reviendrait à recopier une liste — et une liste recopiée diverge
 * (c'est exactement ce qui est arrivé au catalogue des tâches cron).
 *
 * ── UN BOT INJOIGNABLE N'EST PAS UNE ERREUR DE PAGE ────────────────────────
 * Les deux profils tournent dans deux services systemd distincts. L'un peut
 * être arrêté pendant que l'autre sert : le tableau de bord doit AFFICHER cet
 * état, pas tomber en 500. Toutes les fonctions d'agrégation rendent donc un
 * `EtatBotAgrege` porteur de son erreur plutôt que de lever.
 */

const DELAI_MS = 3_000;

/** Jeton partagé avec les deux services (`BOT_ADMIN_TOKEN` de leur unité). */
function jeton(): string | null {
  const brut = (process.env.BOT_ADMIN_TOKEN ?? "").trim();
  return brut === "" ? null : brut;
}

/**
 * Base d'un profil en boucle locale.
 *
 * Surchargeable par `BOT_ADMIN_URL_RG` / `BOT_ADMIN_URL_AZALEE` : un poste de
 * développement n'a pas la même topologie que le VPS, et on ne veut pas d'un
 * port en dur qui n'existe que sur une machine.
 */
function base(profil: ProfilBotPublic): string {
  const variable = `BOT_ADMIN_URL_${profil.nom.toUpperCase()}`;
  const surcharge = (process.env[variable] ?? "").trim();
  return (surcharge === "" ? `http://127.0.0.1:${profil.portAdmin}` : surcharge).replace(/\/+$/, "");
}

export class BotInjoignableError extends Error {
  constructor(
    readonly profil: NomProfilBot,
    message: string,
    readonly statut?: number,
  ) {
    super(message);
    this.name = "BotInjoignableError";
  }
}

/**
 * Un appel au serveur d'administration d'un profil.
 *
 * Une seule tentative et un délai court : c'est un tableau de bord, pas une
 * tâche de fond — mieux vaut afficher « injoignable » en trois secondes que la
 * vérité en trente.
 */
export async function appelerBot<T>(profil: NomProfilBot, chemin: string, init: RequestInit = {}): Promise<T> {
  const secret = jeton();
  if (!secret) {
    throw new BotInjoignableError(
      profil,
      "BOT_ADMIN_TOKEN absent côté site : le serveur d'administration des bots ne peut pas être interrogé.",
    );
  }
  const description = PROFILS_BOT[profil];
  const url = `${base(description)}${chemin.startsWith("/") ? chemin : `/${chemin}`}`;

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: { ...init.headers, authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (erreur) {
    const raison =
      erreur instanceof Error
        ? erreur.name === "TimeoutError"
          ? `aucune réponse en ${DELAI_MS} ms`
          : erreur.message
        : String(erreur);
    throw new BotInjoignableError(
      profil,
      `${description.titre} est injoignable (unité \`${description.unite}\`) — ${raison}`,
    );
  }

  if (!reponse.ok) {
    throw new BotInjoignableError(
      profil,
      `${description.titre} a répondu ${reponse.status} (unité \`${description.unite}\`)`,
      reponse.status,
    );
  }
  return (await reponse.json()) as T;
}

/** État d'un profil, erreur comprise — ne lève jamais. */
export async function etatDuProfil(profil: NomProfilBot): Promise<EtatBotAgrege> {
  const description = PROFILS_BOT[profil];
  const debut = Date.now();
  try {
    const etat = await appelerBot<EtatBot>(profil, "/etat");
    return {
      profil: description,
      joignable: true,
      etat,
      erreur: null,
      latenceSondeMs: Date.now() - debut,
    };
  } catch (erreur) {
    return {
      profil: description,
      joignable: false,
      etat: null,
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
      latenceSondeMs: Date.now() - debut,
    };
  }
}

/** État des deux profils, sondés en parallèle. */
export async function etatDesBots(): Promise<EtatBotAgrege[]> {
  return await Promise.all(TOUS_LES_PROFILS_BOT.map(p => etatDuProfil(p.nom)));
}

/**
 * Catalogue des commandes des deux profils, fusionné.
 *
 * Les deux listes sont DISJOINTES par construction (`apps/bot/src/lib/profil.ts`
 * charge des modules distincts) : un chemin qui apparaîtrait deux fois signale
 * une régression de ce partage, et le tableau de bord doit le montrer plutôt
 * que de le masquer par une déduplication silencieuse.
 */
export async function commandesDesBots(): Promise<{
  commandes: CommandeBot[];
  indisponibles: { profil: ProfilBotPublic; erreur: string }[];
}> {
  const commandes: CommandeBot[] = [];
  const indisponibles: { profil: ProfilBotPublic; erreur: string }[] = [];

  await Promise.all(
    TOUS_LES_PROFILS_BOT.map(async description => {
      try {
        const charge = await appelerBot<{ commandes: CommandeBot[] }>(description.nom, "/commandes");
        commandes.push(...charge.commandes);
      } catch (erreur) {
        indisponibles.push({
          profil: description,
          erreur: erreur instanceof Error ? erreur.message : String(erreur),
        });
      }
    }),
  );

  commandes.sort((a, b) => a.chemin.localeCompare(b.chemin, "fr"));
  return { commandes, indisponibles };
}

export interface SalonGuilde {
  id: string;
  nom: string;
  categorie: boolean;
  parent: string | null;
  position: number;
}

export interface RoleGuilde {
  id: string;
  nom: string;
  couleurHex: string;
  position: number;
  gereParIntegration: boolean;
  membres: number;
}

/**
 * Salons et rôles d'une guilde, demandés au premier profil qui la connaît.
 *
 * Le profil `rg` est interrogé en premier parce qu'il a l'intent `GuildMembers`
 * et remplit donc `role.members` ; le profil `azalee` sert de repli quand le
 * premier est arrêté. Sans ce repli, une maintenance du bot principal rendrait
 * le formulaire de réglages inutilisable — il faudrait retaper des flocons à la
 * main, ce qui est précisément la manœuvre qui pose un rôle au mauvais endroit.
 */
export async function annuaireGuilde(guildId: string): Promise<{
  salons: SalonGuilde[];
  roles: RoleGuilde[];
  source: NomProfilBot | null;
  erreur: string | null;
}> {
  let derniere: string | null = null;
  for (const description of TOUS_LES_PROFILS_BOT) {
    try {
      const [salons, roles] = await Promise.all([
        appelerBot<{ salons: SalonGuilde[] }>(description.nom, `/guildes/${guildId}/salons`),
        appelerBot<{ roles: RoleGuilde[] }>(description.nom, `/guildes/${guildId}/roles`),
      ]);
      return {
        salons: salons.salons,
        roles: roles.roles,
        source: description.nom,
        erreur: null,
      };
    } catch (erreur) {
      derniere = erreur instanceof Error ? erreur.message : String(erreur);
    }
  }
  return { salons: [], roles: [], source: null, erreur: derniere };
}

/**
 * Dit aux deux bots d'oublier leur cache de réglages pour cette guilde.
 *
 * Sans ce coup de fil, le staff enregistre, teste, ne voit rien, et
 * re-enregistre — pendant les soixante secondes du cache. On appelle les DEUX
 * profils : ils partagent la table, donc ils partagent le cache périmé.
 *
 * Ne lève jamais : un bot arrêté n'a pas de cache à vider, et l'écriture en
 * base, elle, a réussi. Rend la liste des profils prévenus, pour que
 * l'interface puisse dire « le bot Azalée était arrêté » plutôt que de mentir.
 */
export async function invaliderReglagesBots(guildId: string): Promise<NomProfilBot[]> {
  const prevenus: NomProfilBot[] = [];
  await Promise.all(
    TOUS_LES_PROFILS_BOT.map(async description => {
      try {
        await appelerBot(description.nom, `/reglages/${guildId}/invalider`, { method: "POST" });
        prevenus.push(description.nom);
      } catch {
        // Un bot arrêté n'a pas de cache à vider.
      }
    }),
  );
  return prevenus;
}

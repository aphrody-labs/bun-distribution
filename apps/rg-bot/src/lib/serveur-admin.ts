/**
 * Serveur d'administration du bot — la seule fenêtre du site sur l'exécution.
 *
 * ── CE QUE LA BASE NE SAIT PAS ─────────────────────────────────────────────
 * Le site sait déjà lire et écrire les RÉGLAGES : ils vivent dans
 * `bot_reglages_guilde`, une table Postgres qu'il atteint directement. Ce
 * serveur n'existe pas pour ça. Il existe pour tout ce qui n'est écrit nulle
 * part et ne vit que dans le processus :
 *
 *   - la passerelle est-elle ouverte, et depuis combien de temps ;
 *   - QUELLES commandes sont réellement enregistrées, avec leurs options — la
 *     seule vérité est l'arbre construit par les décorateurs au chargement, pas
 *     une liste recopiée dans le site ;
 *   - sur quelles guildes elles ont atterri, et surtout lesquelles manquent :
 *     un bot en ligne mais absent d'un serveur est indiscernable d'un bot en
 *     panne pour qui le regarde depuis Discord ;
 *   - les salons et les rôles de la guilde, pour que le formulaire de réglages
 *     propose des noms au lieu d'exiger des flocons copiés à la main.
 *
 * Et il permet l'inverse : quand le site écrit un réglage, il vient DIRE au bot
 * d'oublier son cache. Sans ce coup de fil, le staff clique « enregistrer »,
 * teste, ne voit rien, et re-clique — pendant les soixante secondes du cache.
 *
 * ── TROIS RÈGLES, TROIS RAISONS ────────────────────────────────────────────
 *  1. **AUCUN SECRET, AUCUN SERVEUR.** Sans `BOT_ADMIN_TOKEN`, le serveur ne
 *     démarre pas du tout. Un jeton par défaut est ce qui a transformé le
 *     service d'annonces en tribune ouverte (cf. `packages/cron/src/index.ts`) ;
 *     on ne recommence pas.
 *  2. **BOUCLE LOCALE.** Le seul appelant légitime est le site, sur ce VPS.
 *     Écouter sur `*` exposerait l'inventaire des salons et des rôles à tout ce
 *     qui atteint la machine — le pare-feu tenait, il n'a pas à être la seule
 *     barrière.
 *  3. **LECTURE, PLUS UNE SEULE ÉCRITURE.** La seule route non idempotente
 *     vide un cache. Ce serveur n'envoie aucun message, ne pose aucun rôle, ne
 *     bannit personne : ces actes passent par les slash commands, qui portent
 *     leur garde et leur journal d'audit. Un port HTTP en boucle locale ne doit
 *     jamais être un raccourci vers la modération.
 */
import type { Client } from "discordx";
import { MetadataStorage } from "discordx";
import { ChannelType, type Guild } from "discord.js";

import {
  PROFILS_BOT,
  type CommandeBot,
  type EtatBot,
  type GuildeBot,
  type OptionCommandeBot,
  type SanteBot,
} from "@rosegriffon/types/bot";

import { invalidate } from "./cache";
import { GUILD_IDS, PROFIL } from "./config";

/** Racines dont toutes les commandes sont réservées à l'exploitation. */
const RACINES_RESERVEES = new Set(["administration", "staff", "gestion", "moderation"]);

/**
 * Libellés des types d'option Discord.
 *
 * `ApplicationCommandOptionType` est un enum numérique : le renvoyer brut
 * obligerait le site à embarquer `discord.js` pour afficher « salon ». On
 * traduit ici, une fois.
 */
const TYPES_OPTION: Readonly<Record<number, string>> = Object.freeze({
  1: "sous-commande",
  2: "groupe",
  3: "texte",
  4: "entier",
  5: "booléen",
  6: "membre",
  7: "salon",
  8: "rôle",
  9: "mentionnable",
  10: "nombre",
  11: "fichier",
});

/** Une option telle que discordx la porte, réduite à ce qu'on affiche. */
type OptionBrute = { name: string; description: string; type: number; required: boolean };

function decrireOptions(options: readonly OptionBrute[]): OptionCommandeBot[] {
  return (
    options
      // Les sous-commandes et les groupes sont des NŒUDS de l'arbre, pas des
      // paramètres : les compter comme options ferait dire à l'interface que
      // `/administration` prend vingt-trois arguments.
      .filter(option => option.type !== 1 && option.type !== 2)
      .map(option => ({
        nom: option.name,
        description: option.description,
        type: TYPES_OPTION[option.type] ?? `type ${option.type}`,
        requise: option.required,
      }))
  );
}

/**
 * L'arbre des commandes tel que discordx l'a construit.
 *
 * `applicationCommandSlashesFlat` rend la forme APLATIE : une entrée par
 * chemin réellement tapable (`administration reglages voir`), avec son groupe
 * et son sous-groupe résolus. C'est exactement ce qu'un membre voit dans
 * Discord, et c'est la seule liste qui ne peut pas mentir — elle vient des
 * décorateurs exécutés à l'import, donc du profil chargé.
 */
export function catalogueCommandes(): CommandeBot[] {
  const plates = MetadataStorage.instance.applicationCommandSlashesFlat;
  return plates
    .map((commande): CommandeBot => {
      const racine = commande.group ?? commande.name;
      const groupe = commande.group ? (commande.subgroup ?? null) : null;
      const sousCommande = commande.group ? commande.name : null;
      const chemin = [racine, groupe, sousCommande].filter(Boolean).join(" ");
      return {
        chemin,
        racine,
        groupe,
        sousCommande,
        description: commande.description,
        options: decrireOptions(commande.options as unknown as readonly OptionBrute[]),
        profil: PROFIL.nom,
        source: nomDeClasse(commande),
        reservee: RACINES_RESERVEES.has(racine),
      };
    })
    .toSorted((a, b) => a.chemin.localeCompare(b.chemin, "fr"));
}

/**
 * Classe qui porte la commande — c'est le nom de fichier, à peu de choses près.
 *
 * discordx range la classe décorée dans `discord.from` ; elle peut manquer si
 * l'arbre n'a pas encore été construit. On ne devine rien dans ce cas : `null`
 * est une réponse, un nom inventé ne l'est pas.
 */
function nomDeClasse(commande: unknown): string | null {
  const depuis = (commande as { discord?: { from?: { name?: string } } }).discord?.from?.name;
  return typeof depuis === "string" && depuis.length > 0 ? depuis : null;
}

function decrireGuilde(guild: Guild): GuildeBot {
  return {
    id: guild.id,
    nom: guild.name,
    membres: guild.memberCount,
    servie: GUILD_IDS.includes(guild.id),
    icone: guild.iconURL({ size: 128 }),
  };
}

/** L'état d'exécution, mesuré à l'instant de l'appel. */
export function etatDuBot(client: Client): EtatBot {
  const guildes = [...client.guilds.cache.values()].map(decrireGuilde);
  const rejointes = new Set(guildes.map(g => g.id));
  return {
    profil: PROFIL.nom,
    titre: PROFIL.titre,
    etiquette: client.user?.tag ?? null,
    identifiantApplication: client.application?.id ?? client.user?.id ?? null,
    uptimeSecondes: Math.round(process.uptime()),
    latenceMs: Math.round(client.ws.ping),
    guildes,
    guildesAbsentes: GUILD_IDS.filter(id => !rejointes.has(id)),
    nombreCommandes: MetadataStorage.instance.applicationCommandSlashesFlat.length,
    modulesCharges: PROFIL.modules.length,
    memoireOctets: process.memoryUsage().rss,
    mesureLe: new Date().toISOString(),
  };
}

/** Salons textuels et catégories d'une guilde, pour peupler un formulaire. */
function salonsDe(guild: Guild) {
  return [...guild.channels.cache.values()]
    .filter(
      salon =>
        salon.type === ChannelType.GuildText ||
        salon.type === ChannelType.GuildAnnouncement ||
        salon.type === ChannelType.GuildForum ||
        salon.type === ChannelType.GuildCategory,
    )
    .map(salon => ({
      id: salon.id,
      nom: salon.name,
      categorie: salon.type === ChannelType.GuildCategory,
      parent: "parentId" in salon ? (salon.parentId ?? null) : null,
      position: "position" in salon ? salon.position : 0,
    }))
    .toSorted((a, b) => a.position - b.position || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Rôles d'une guilde, du plus haut au plus bas.
 *
 * `@everyone` est retiré : le proposer dans un sélecteur de « rôle staff » ou
 * de « rôle d'arrivée » n'a aucun sens, et le poser par erreur donnerait la
 * prise en charge des tickets à tout le serveur.
 */
function rolesDe(guild: Guild) {
  return [...guild.roles.cache.values()]
    .filter(role => role.id !== guild.id)
    .map(role => ({
      id: role.id,
      nom: role.name,
      couleurHex: role.hexColor,
      position: role.position,
      gereParIntegration: role.managed,
      membres: role.members.size,
    }))
    .toSorted((a, b) => b.position - a.position);
}

export interface ServeurAdmin {
  readonly port: number;
  stop(): void;
}

/**
 * Démarre le serveur, ou rend `null` quand il n'a pas de quoi se protéger.
 *
 * Le port vient du profil (`PROFILS_BOT`) : les deux services tournent sur la
 * même machine, un port partagé ferait échouer le démarrage du second sans que
 * personne ne comprenne pourquoi le tableau de bord montre deux fois le même
 * bot. `BOT_ADMIN_PORT` reste possible pour un poste de développement.
 */
export function demarrerServeurAdmin(client: Client): ServeurAdmin | null {
  const jeton = (Bun.env.BOT_ADMIN_TOKEN ?? "").trim();
  if (jeton === "") {
    console.warn(
      "⚠ [serveur-admin] BOT_ADMIN_TOKEN absent : le serveur d'administration ne démarre pas. " +
        "Pose la variable pour que le site puisse lire l'état du bot — sans jeton, on n'ouvre pas de port.",
    );
    return null;
  }

  const portDemande = Number(Bun.env.BOT_ADMIN_PORT);
  const port = Number.isInteger(portDemande) && portDemande > 0 ? portDemande : PROFILS_BOT[PROFIL.nom].portAdmin;

  const serveur = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(requete) {
      const url = new URL(requete.url);
      const chemin = url.pathname.replace(/\/+$/, "") || "/";

      // La sonde reste ouverte : elle ne rend qu'un booléen et une durée, et
      // elle doit répondre même quand le jeton du site a expiré — sinon un
      // tableau de bord affiche « bot injoignable » pour un problème de
      // configuration côté site.
      if (chemin === "/sante") {
        const sante: SanteBot = {
          ok: true,
          profil: PROFIL.nom,
          pret: client.isReady(),
          uptimeSecondes: Math.round(process.uptime()),
        };
        return Response.json(sante);
      }

      const entete = requete.headers.get("authorization") ?? "";
      const fourni = entete.startsWith("Bearer ") ? entete.slice(7).trim() : "";
      if (!comparerConstant(fourni, jeton)) {
        return Response.json({ erreur: "Non autorisé" }, { status: 401 });
      }

      if (chemin === "/etat" && requete.method === "GET") {
        return Response.json(etatDuBot(client));
      }

      if (chemin === "/commandes" && requete.method === "GET") {
        return Response.json({ profil: PROFIL.nom, commandes: catalogueCommandes() });
      }

      const salons = chemin.match(/^\/guildes\/(\d{15,25})\/salons$/);
      if (salons && requete.method === "GET") {
        const guild = client.guilds.cache.get(salons[1]!);
        if (!guild) {
          return Response.json({ erreur: "Guilde inconnue de ce profil" }, { status: 404 });
        }
        return Response.json({ salons: salonsDe(guild) });
      }

      const roles = chemin.match(/^\/guildes\/(\d{15,25})\/roles$/);
      if (roles && requete.method === "GET") {
        const guild = client.guilds.cache.get(roles[1]!);
        if (!guild) {
          return Response.json({ erreur: "Guilde inconnue de ce profil" }, { status: 404 });
        }
        return Response.json({ roles: rolesDe(guild) });
      }

      const invalider = chemin.match(/^\/reglages\/(\d{15,25})\/invalider$/);
      if (invalider && requete.method === "POST") {
        // Même clé que `services/communaute.ts` — elle est écrite là-bas et
        // lue ici, donc elle est reproduite plutôt qu'importée : importer le
        // service tirerait la connexion Postgres dans un module qui n'en a
        // pas besoin. Un test verrouille l'égalité des deux chaînes.
        invalidate(`communaute:reglages:${invalider[1]}`);
        return Response.json({ ok: true, guildId: invalider[1] });
      }

      return Response.json({ erreur: "Non trouvé" }, { status: 404 });
    },
  });

  console.log(`🔧 Serveur d'administration du profil « ${PROFIL.nom} » à l'écoute sur 127.0.0.1:${port}`);

  return {
    port,
    stop: () => {
      void serveur.stop(true);
    },
  };
}

/**
 * Comparaison à temps constant de deux jetons.
 *
 * `a === b` sur des chaînes s'arrête au premier caractère différent : le temps
 * de réponse laisse alors deviner le préfixe correct, un caractère à la fois.
 * Le port est en boucle locale, mais un jeton qui se devine reste un jeton qui
 * se devine — et le coût de le faire proprement est de quatre lignes.
 */
function comparerConstant(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let ecart = 0;
  for (let i = 0; i < a.length; i++) {
    ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return ecart === 0;
}

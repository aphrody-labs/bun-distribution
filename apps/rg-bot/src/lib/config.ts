// Fail-fast à l'initialisation du processus.
// Fallback DISCORD_GUILD_ID : Bun n'expand pas `GUILD_ID=$DISCORD_GUILD_ID`
// dans .env (passe la string littérale). On lit les 2 et on filtre les valeurs
// qui ressemblent à une référence shell non résolue ($VAR).
import { resolveGuildId } from "@rosegriffon/types/discord";

import {
  couleurDeMarque,
  guildesDuProfil,
  jetonDuProfil,
  profilActif,
  salonAnnonceDuProfil,
  urlBaseDuProfil,
  type EnvLisible,
  type Profil,
} from "./profil";

const ENV = Bun.env as EnvLisible;

/**
 * Profil du processus — `rg` par défaut, `azalee` pour le second service.
 *
 * Ce module est importé par une centaine de fichiers : c'est donc lui, et lui
 * seul, qui traduit le profil en constantes. Aucune commande n'a à savoir sous
 * quelle identité elle tourne — elle prend `RG_COLOR` / `RG_FOOTER` /
 * `RG_BASE_URL` comme avant, et l'embed porte les bonnes couleurs.
 *
 * Voir `lib/profil.ts` pour le registre lui-même.
 */
export const PROFIL: Profil = profilActif(ENV);

/**
 * Guilde PRINCIPALE, au sens « celle dont les membres sont synchronisés ».
 *
 * Elle reste résolue depuis l'environnement, sans regarder le profil : la
 * synchronisation écrit dans `discord_members`, une table qui ne décrit que la
 * communauté Rose Griffon. Le bot Azalée ne synchronise rien (il ne charge ni
 * `/administration synchroniser` ni les événements de membres), donc lui donner
 * une autre guilde principale n'aurait aucun effet — sauf le jour où quelqu'un
 * poserait `BOT_SYNC_MEMBRES=1` sur le mauvais service et déverserait les
 * membres d'Azalée dans la table de Rose Griffon.
 */
export const GUILD_ID = resolveGuildId(ENV);

/**
 * Guildes sur lesquelles les slash commands sont enregistrées.
 *
 * `GUILD_ID` reste la guilde PRINCIPALE et ne change pas de sens : c'est elle
 * seule que la synchronisation des membres regarde (les membres d'Azalée n'ont
 * rien à faire dans `discord_members`). Cette liste-ci ne sert qu'à savoir où
 * les commandes doivent apparaître.
 *
 * Les commandes d'administration peuvent y figurer sans risque : leur garde
 * (`lib/rbac.ts` → `requireRgAdmin`) résout le profil RG en base via la table
 * `account` de Better Auth et vérifie son rôle. Elle ne dépend d'aucun rôle
 * Discord, donc elle protège identiquement sur un serveur comme sur l'autre.
 *
 * Depuis les profils, la liste dépend du bot lancé : le profil `rg` garde la
 * résolution historique par l'environnement (les deux serveurs), le profil
 * `azalee` ne rend qu'Azalée.
 */
export const GUILD_IDS: readonly string[] = guildesDuProfil(PROFIL, ENV);

export const SYNC_INTERVAL_MS = Number(Bun.env.SYNC_INTERVAL_MS ?? 30 * 60 * 1000);

/**
 * Partage des responsabilités avec `rg-cron.service`.
 *
 * Les deux démons ouvrent une passerelle Discord avec LE MÊME jeton, donc les
 * deux reçoivent tous les événements du serveur. Pour éviter les doublons
 * visibles par les membres et les doubles écritures en base, la répartition
 * est la suivante :
 *
 *   - `rg-cron` garde la synchronisation (membres, rôles, avatars du staff
 *     toutes les 30 min et sur `guildMemberAdd`/`Update`/`userUpdate`), la
 *     télémétrie (présences, salons vocaux), la veille des messages et le
 *     serveur HTTP d'annonces (`POST :3006/announce`).
 *   - `rg-bot` garde ce que le cron ne fait PAS : les interactions, c'est-à-dire
 *     l'enregistrement et l'exécution des slash commands.
 *
 * Ce drapeau ne sert qu'à rendre le partage réversible : le passer à `1`
 * redonne au bot la synchronisation automatique, à n'activer que si le cron
 * cesse de l'assurer (sinon chaque membre est écrit deux fois).
 */
export const BOT_SYNC_MEMBRES = Bun.env.BOT_SYNC_MEMBRES === "1";

export const REDIS_URL = Bun.env.REDIS_URL ?? "redis://127.0.0.1:6379/1";

export function requireEnv(key: string): string {
  const v = Bun.env[key];
  if (!v) {
    throw new Error(`[config] ${key} is required (see .env.example)`);
  }
  return v;
}

/**
 * Jeton du bot — celui du PROFIL, pas un jeton unique.
 *
 * Le profil `rg` lit `DISCORD_BOT_TOKEN` puis, à défaut, `DISCORD_TOKEN` :
 * exactement l'ordre d'avant. Le profil `azalee` lit
 * `AZALEE_DISCORD_BOT_TOKEN` et rien d'autre — hériter du jeton de Rose Griffon
 * ferait tourner deux processus sous la MÊME identité Discord, qui répondraient
 * tous les deux à chaque interaction.
 *
 * Toujours résolu à l'import, toujours fail-fast : un jeton manquant doit tuer
 * le service au démarrage, pas au premier message.
 */
export const DISCORD_TOKEN = jetonDuProfil(PROFIL, ENV);

/**
 * Marque appliquée aux embeds.
 *
 * Les trois noms `RG_*` sont importés dans une centaine de fichiers : ils ne
 * changent pas de nom, seulement de source. C'est ce qui fait qu'un embed du
 * bot Azalée sort en orange Azalée avec le bon pied de page sans qu'aucune
 * commande n'ait à connaître le profil.
 */
export const RG_BRAND_HEX: `#${string}` = PROFIL.marque.couleurHex;
export const RG_COLOR = couleurDeMarque(RG_BRAND_HEX);
export const RG_FOOTER = PROFIL.marque.piedDePage;
export const RG_BASE_URL = urlBaseDuProfil(PROFIL, ENV);

/**
 * Salon d'annonce des nouveaux posts X, ou `null` si le profil n'en a pas.
 *
 * Remplace la lecture directe de `DISCORD_NEWS_CHANNEL_ID` : pour `rg` elle
 * rend la même valeur qu'avant, pour `azalee` elle rend le salon du registre.
 */
export const SALON_ANNONCE_POSTS = salonAnnonceDuProfil(PROFIL, ENV);

/**
 * Canal logique du curseur d'annonce (`tweet_notification_curseurs.canal`).
 *
 * Un curseur par profil, jamais partagé : celui qui publie est celui qui
 * avance sa propre mémoire.
 */
export const CURSEUR_ANNONCE_POSTS = PROFIL.annoncePosts?.curseur ?? null;

/**
 * Le profil tel que `services/tweetsNotifier.ts` l'attend
 * (`ProfilAnnonceur` : `{ nom?, annoncePosts? }` avec `AnnoncePosts =
 * { salon, curseur }`).
 *
 * C'est CETTE valeur que `src/index.ts` passe à `demarrerNotifieurTweets`, pas
 * `PROFIL` : le registre décrit un salon NON RÉSOLU (`salonId` + la variable
 * d'env qui l'emporte), le notifieur veut un salon déjà résolu. Les deux formes
 * ne sont pas interchangeables, et le type le dit.
 *
 * Deux points qui ne sont pas des détails :
 *
 *  - `annoncePosts` reste NON NUL pour `rg` même quand le salon est vide.
 *    `null` voudrait dire « ce profil n'annonce pas » et le notifieur ne
 *    démarrerait pas ; or le salon de Rose Griffon vient d'abord du réglage
 *    partagé `settings['tweets.notification'].salon`, que seul le notifieur sait
 *    lire. Salon vide = « demande au réglage », pas « n'annonce pas ».
 *  - le curseur vient du registre, jamais de l'environnement : c'est une clé
 *    primaire, pas un paramètre.
 */
export const PROFIL_ANNONCEUR: {
  readonly nom: string;
  readonly annoncePosts: {
    readonly salon: string;
    readonly curseur: string;
    readonly roleMention: string | null;
    readonly salonValidation: string | null;
    readonly comptes: readonly string[] | null;
  } | null;
} = {
  nom: PROFIL.nom,
  annoncePosts: PROFIL.annoncePosts
    ? {
        salon: SALON_ANNONCE_POSTS ?? "",
        curseur: PROFIL.annoncePosts.curseur,
        roleMention: PROFIL.annoncePosts.roleMention,
        salonValidation: PROFIL.annoncePosts.salonValidation,
        comptes: PROFIL.annoncePosts.comptes,
      }
    : null,
};

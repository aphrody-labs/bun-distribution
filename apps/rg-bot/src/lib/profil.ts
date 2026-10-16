/**
 * Registre des PROFILS du bot — un seul programme, deux identités Discord.
 *
 * ── LE PROBLÈME QU'ON REFUSE ───────────────────────────────────────────────
 * Le serveur Azalée a besoin d'un bot à lui : sa propre identité, ses propres
 * commandes, ses propres annonces. La solution évidente — copier `apps/bot`
 * dans `apps/bot-azalee` — est exactement celle qui condamne le projet : à
 * partir du deuxième dossier, chaque correctif doit être appliqué deux fois,
 * et ne l'est jamais. Un an plus tard on a deux bots qui se ressemblent sans
 * se comporter pareil, et plus personne ne sait lequel fait autorité.
 *
 * Ici : UN programme, UNE base de code, DEUX profils. Le profil est une donnée,
 * pas un fork. Il se choisit au lancement par `RG_PROFIL_BOT` (`rg` par défaut,
 * `azalee` pour le second service systemd), et il décide de tout ce qui doit
 * différer entre les deux bots :
 *
 *   - le JETON à lire (donc l'identité Discord affichée) ;
 *   - les GUILDES où les commandes sont enregistrées ;
 *   - les MODULES de commandes chargés (`src/index.ts` fait les imports) ;
 *   - la MARQUE des embeds (couleur, pied de page, URL de base) ;
 *   - le salon d'ANNONCE des nouveaux posts X et le nom de son CURSEUR.
 *
 * Tout le reste — `lib/`, `services/`, la base, le cache, les gardes — est
 * strictement commun. Un correctif appliqué à `/azalee technique` profite aux
 * deux bots le jour même, sans rien recopier.
 *
 * ── CE MODULE EST PUR ──────────────────────────────────────────────────────
 * Aucune connexion, aucun appel réseau, aucun accès disque, aucun effet de bord
 * à l'import. Il ne fait que décrire et résoudre. C'est ce qui permet de le
 * couvrir intégralement par `bun:test` (`profil.test.ts`) sans jeton ni base :
 * les seules entrées sont l'environnement passé en paramètre et ces tables.
 *
 * ── LE REGISTRE EST LA SEULE SOURCE DES IDENTIFIANTS ───────────────────────
 * Aucun identifiant de guilde ni de salon ne doit être écrit en dur ailleurs
 * dans `apps/bot`. Les guildes viennent de `@rosegriffon/types/discord`
 * (partagées avec le site et le cron), le salon d'annonce d'Azalée vient d'ici.
 */
import { GatewayIntentBits } from "discord.js";

import { ACHILLEA_GUILD_ID, AZALEE_GUILD_ID, RG_GUILD_ID, resolveGuildIds } from "@rosegriffon/types/discord";

/**
 * Vue lisible de l'environnement.
 *
 * Toutes les fonctions de ce module la prennent en paramètre plutôt que de lire
 * `Bun.env` elles-mêmes : c'est ce qui rend le registre testable (un objet
 * littéral suffit) et ce qui interdit qu'un import déclenche une lecture
 * d'environnement en douce.
 */
export type EnvLisible = Record<string, string | undefined>;

/** Les deux profils possibles. Toute valeur hors de cette liste est une erreur. */
export const NOMS_PROFILS = ["rg", "azalee"] as const;

export type NomProfil = (typeof NOMS_PROFILS)[number];

/** Variable d'environnement qui choisit le profil du processus. */
export const VARIABLE_PROFIL = "RG_PROFIL_BOT";

/**
 * Profil retenu quand `RG_PROFIL_BOT` est absent.
 *
 * `rg` — le comportement historique. Un service qui tourne aujourd'hui sans
 * cette variable ne change donc strictement rien à son démarrage.
 */
export const PROFIL_PAR_DEFAUT: NomProfil = "rg";

/** Identité visuelle appliquée aux embeds du profil. */
export interface MarqueProfil {
  /** Couleur d'accent, en hexadécimal CSS. Seule source de couleur du bot. */
  couleurHex: `#${string}`;
  /** Pied de page des embeds — le domaine que le bot représente. */
  piedDePage: string;
  /** Racine des liens publics construits par `rgUrl()`. */
  urlBase: string;
  /**
   * Variable d'env qui peut remplacer `urlBase` (recette, préversion).
   *
   * Elle est PROPRE À CHAQUE PROFIL, et ce n'est pas un détail : les deux
   * services lisent le même `.env` racine. Si les deux profils écoutaient
   * `WEBSITE_URL`, la ligne `Environment=WEBSITE_URL=https://rosegriffon.fr`
   * de `infra/systemd/rg-bot.service` ferait pointer les liens du bot Azalée
   * vers le site principal.
   */
  variableUrlBase: string;
}

/** Publication automatique des nouveaux posts X dans un salon. */
export interface AnnoncePostsProfil {
  /**
   * Salon de destination figé par le registre, `""` s'il n'est pas figé.
   *
   * Rose Griffon annonce depuis toujours dans le salon désigné par
   * `DISCORD_NEWS_CHANNEL_ID` ; on ne le fige pas ici pour ne pas changer un
   * comportement en production. Azalée, elle, n'a pas de variable existante :
   * son salon est figé (il est public et vérifiable, ce n'est pas un secret).
   */
  salonId: string;
  /** Variable d'env qui l'emporte sur `salonId` quand elle est posée. */
  variableSalon: string;
  /**
   * Canal logique du curseur, clé primaire de
   * `public.tweet_notification_curseurs` (colonne `canal`, `text` NOT NULL,
   * PK — vérifié en psql le 13/8/2026 ; une seule ligne existe : `discord`).
   *
   * Deux profils = deux curseurs. Les partager ferait avancer le curseur
   * commun au premier qui publie, et l'autre serveur ne verrait jamais le
   * post : le curseur EST la mémoire de « ce qui a déjà été annoncé ».
   */
  curseur: string;
  /**
   * Rôle mentionné après l'annonce, `null` si aucun.
   *
   * Relevé dans le salon `1349528692086276148` : `<@&1359506615765827744>`,
   * posté en spoiler dans un message à part.
   */
  roleMention: string | null;
  /**
   * Salon où DEMANDER avant de publier, `null` pour publier directement.
   *
   * ── POURQUOI UNE VALIDATION HUMAINE ────────────────────────────────────
   * Le compte suivi ne publie pas que des annonces : il retweete, il répond,
   * il commente. Les deux formes les plus bruyantes sont filtrées
   * automatiquement (`estRetweet`, `estReponse`), mais aucun filtre écrit à
   * l'avance ne dira jamais si un post donné MÉRITE de notifier deux mille
   * personnes. Un humain le sait en une seconde ; c'est donc lui qui décide.
   *
   * Quand ce salon est posé, le drain n'annonce plus rien de lui-même : il
   * dépose une carte de validation, et l'annonce ne part qu'au clic. Le
   * curseur, lui, avance quand même — sans quoi le même post serait proposé
   * toutes les cinq minutes jusqu'à ce que quelqu'un tranche.
   */
  salonValidation: string | null;
  /**
   * Comptes X annoncés par CE profil, `null` pour suivre le réglage partagé.
   *
   * ── POURQUOI UNE LISTE PAR PROFIL ──────────────────────────────────────
   * `settings['tweets.notification'].comptes` est UNE ligne pour les deux
   * bots : elle porte aujourd'hui huit comptes (Level5, les comptes officiels
   * Inazuma, Rose Griffon, Azalée). C'est la bonne liste pour une veille
   * thématique — ce n'est pas la bonne pour un salon d'annonce de MARQUE.
   *
   * Le salon d'annonce d'Azalée ne parle que d'Azalée : y voir arriver un post
   * de `@rose_griffon` ou de `@Level5Hub` est une erreur d'adressage, pas un
   * choix éditorial. (Constaté le 13/8/2026 : la première carte de validation
   * proposée portait un post de `@rose_griffon`.)
   *
   * La liste vit dans le REGISTRE et non en base : c'est l'identité du bot,
   * pas un réglage d'exploitation. Un profil qui annoncerait soudain un autre
   * compte doit être une décision lue dans le code, pas un UPDATE oublié.
   */
  comptes: readonly string[] | null;
}

export interface Profil {
  nom: NomProfil;
  /** Nom lisible, tel qu'il apparaît dans les journaux et les messages d'erreur. */
  titre: string;
  /**
   * `botId` de discordx (`ClientOptions.botId`, défaut `"bot"` —
   * `dist/index.js:259`).
   *
   * Il ne sert à rien tant qu'un processus ne pilote qu'un client, et c'est
   * voulu : le jour où l'on voudra les deux bots dans UN processus, il suffira
   * de décorer les commandes avec `@Bot(...)`. Sans décorateur, une commande
   * est acceptée par tous les bots (`isBotAllowed` rend `true` quand la liste
   * est vide, `dist/index.js:659`) — poser cet identifiant aujourd'hui ne
   * retire donc aucune commande à personne.
   */
  identifiantBot: string;
  /** Variable d'env portant le jeton du bot. */
  variableJeton: string;
  /**
   * Variables acceptées à défaut de `variableJeton`, dans l'ordre.
   *
   * Uniquement pour ne casser aucun déploiement existant : `DISCORD_TOKEN`
   * était le nom historique côté Rose Griffon.
   */
  variablesJetonSecours: readonly string[];
  /** Guildes où enregistrer les commandes (défaut, avant lecture de l'env). */
  guildes: readonly string[];
  /**
   * Où les slash commands sont publiées.
   *
   * `"guildes"` — l'enregistrement vise la liste ci-dessus, et seulement elle.
   * La publication est immédiate, mais tout serveur absent de la liste voit un
   * bot en ligne et muet : il faut modifier le code puis redéployer pour
   * l'accueillir.
   *
   * `"globale"` — les commandes appartiennent à l'application, donc à tous les
   * serveurs qui l'invitent, présents comme futurs. C'est le mode d'un bot
   * public. Discord met quelques minutes à propager une modification globale
   * (contre l'instant pour une guilde), ce qui est le prix à payer pour ne plus
   * avoir à déclarer chaque serveur.
   *
   * Un profil global ne doit PAS conserver de commandes de guilde : Discord les
   * additionne, et le membre voit chaque commande en double.
   */
  porteeCommandes: "globale" | "guildes";
  /**
   * Intents de la passerelle — ILS NE SONT PAS LES MÊMES POUR LES DEUX BOTS.
   *
   * `GuildMembers` est un intent PRIVILÉGIÉ : il doit être coché dans le portail
   * développeur de CHAQUE application, sinon Discord ferme la connexion à
   * l'ouverture avec « Used disallowed intents » — et le bot ne démarre pas du
   * tout. Mesuré sur l'application Azalée le 13/8/2026 : `[Guilds]` ouvre la
   * passerelle (`𝓐𝔃𝓪𝓵𝓮́𝓮 🌸#9761`), `[Guilds, GuildMembers]` la fait refuser.
   *
   * Ce n'est pas une limitation subie : le profil Azalée n'en a pas besoin. Ses
   * commandes lisent la base et les APIs internes ; c'est le profil Rose Griffon
   * qui résout des membres (`/membre discord`, `/administration synchroniser`,
   * `guild.members.fetch()`) et qui écoute `guildMemberAdd`.
   */
  intents: readonly GatewayIntentBits[];
  /**
   * Modules à importer pour leurs décorateurs, chemins relatifs à
   * `apps/bot/src`. Depuis `src/index.ts` : `await import(\`./${chemin}\`)`.
   */
  modules: readonly string[];
  marque: MarqueProfil;
  annoncePosts: AnnoncePostsProfil | null;
}

/**
 * Commandes du profil Azalée.
 *
 * Deux familles, et une seule raison : ce sont les surfaces qui parlent du JEU
 * et de son exploitation, pas de la communauté Rose Griffon.
 *
 *   - les données de jeu et les fichiers extraits (`/azalee`, `/cpk`, `/cdn`)
 *     ainsi que l'archive des posts X (`/x`) ;
 *   - toute la racine `/staff`, c'est-à-dire la CONSULTATION d'exploitation.
 *     Elle est protégée par `requireRgAdmin` (rôle résolu en base via la table
 *     `account` de Better Auth), donc elle protège identiquement quel que soit
 *     le serveur : aucun rôle Discord n'entre dans la décision.
 *
 * `staff/racine.ts` en tête par convention de lecture ; l'ordre est en réalité
 * indifférent, chaque fichier de groupe important déjà la racine pour effet de
 * bord (cf. l'en-tête de `commands/staff/racine.ts`).
 *
 * N'y figurent pas `staff/garde.ts`, `staff/format.ts` ni `staff/deploiement.ts`
 * : ce sont des modules d'appui sans décorateur, importés par les fichiers de
 * commandes eux-mêmes.
 */
const MODULES_AZALEE = [
  // `/article` n'est PAS ici : il lit les articles des DEUX sites, pas seulement
  // ceux du jeu, et son pendant d'écriture (`/gestion article`) vit déjà chez le
  // bot Rose Griffon. Le laisser au profil Azalée séparait la lecture de
  // l'écriture entre deux identités Discord, ce qui n'a aucun sens pour le
  // staff qui utilise les deux dans la même minute. Cf. `docs/bot-commandes.md`.
  "commands/azalee-jeu.ts",
  "commands/cpk.ts",
  "commands/cdn.ts",
  "commands/x.ts",
  // Les boutons de la carte de validation d'annonce. Ce module ne déclare
  // aucune commande — seulement un `@ButtonComponent` —, mais discordx doit
  // l'importer pour que ses boutons répondent.
  "commands/validation-annonce.ts",
] as const;

/**
 * Commandes du profil Rose Griffon — tout le reste.
 *
 * La communauté (`/agenda`, `/article`, `/boutique`, `/campagne`, `/equipe`,
 * `/membre`, `/patreon`, `/sondage`) et la racine `/administration`, celle qui
 * ÉCRIT vraiment. `administration/valeurs.ts` est un module d'appui sans
 * décorateur : il n'a rien à faire ici.
 */
const MODULES_RG = [
  // Passerelle vers le bot Achillea : il tient sa propre base et sa propre API, et
  // c'est le profil Rose Griffon qui l'interroge — le bot Azalée, lui, ne parle que
  // du wiki.
  "commands/achillea.ts",
  "commands/administration/racine.ts",
  "commands/administration/racine-gestion.ts",
  "commands/administration/racine-moderation.ts",
  "commands/administration/article.ts",
  "commands/administration/cron.ts",
  "commands/administration/equipe.ts",
  "commands/administration/evenement.ts",
  "commands/administration/moderation.ts",
  "commands/administration/multicomptes.ts",
  "commands/administration/reglages.ts",
  "commands/administration/role.ts",
  "commands/administration/salon.ts",
  "commands/administration/sondage.ts",
  "commands/administration/ticket.ts",
  "commands/administration/niveaux.ts",
  "commands/administration/roles.ts",
  "commands/administration/accueil.ts",
  "commands/administration/historique.ts",
  "commands/administration/journal.ts",
  "commands/administration/automod.ts",
  "commands/administration/suggestion.ts",
  "commands/administration/stream.ts",
  "commands/administration/synchroniser.ts",
  "commands/administration/utilisateur.ts",
  "commands/administration/veille.ts",
  "commands/agenda.ts",
  // Lecture publique des articles des deux sites. Son pendant d'écriture est
  // `commands/administration/article.ts`, juste au-dessus.
  "commands/article.ts",
  "commands/staff/racine.ts",
  "commands/staff/cron.ts",
  "commands/staff/discord.ts",
  "commands/staff/services.ts",
  "commands/staff/stats.ts",
  "commands/staff/veille.ts",
  "commands/staff/web.ts",
  "commands/boutique.ts",
  "commands/campagne.ts",
  "commands/equipe.ts",
  "commands/membre.ts",
  "commands/patreon.ts",
  "commands/sondage.ts",
  "commands/suggestion.ts",
  "commands/profil.ts",
  "commands/kizuna.ts",
  "commands/collection.ts",
  "commands/ticket.ts",
] as const;

/**
 * Salon d'annonce des posts du bot Azalée : « 🌸〡𝓐𝔃𝓪𝓵𝓮́𝓮 ».
 *
 * ⚠ IL EST SUR LE SERVEUR ROSE GRIFFON (`1072991720268111892`), pas sur le
 * serveur Azalée. Le flocon suggérait le contraire — il a été créé le 12/3/2025
 * à 23:45:13 UTC, sept minutes après la guilde Azalée — mais l'API tranche et
 * elle seule : `GET /guilds/1072991720268111892/channels` le liste bien parmi
 * les 159 salons de Rose Griffon (relevé le 13/8/2026, salon textuel, type 0).
 * Une date de création voisine ne prouve rien de l'appartenance : ce soir-là,
 * le serveur Azalée ET son salon d'annonce côté Rose Griffon ont été ouverts
 * dans la foulée.
 *
 * Conséquence directe : les deux bots vivent sur le MÊME serveur. C'est ce qui
 * rend la disjonction de `MODULES_RG` et `MODULES_AZALEE` obligatoire et non
 * cosmétique — deux `/azalee` dans la même liste d'un même serveur, le membre
 * n'a aucun moyen de savoir laquelle il déclenche.
 */
const SALON_ANNONCE_AZALEE = "1349528692086276148";

/**
 * Salon où le bot Azalée DEMANDE avant d'annoncer (`🌿📰〡général-azalée`).
 *
 * Les DEUX salons vivent sur la même guilde, `1072991720268111892` (Rose
 * Griffon) — vérifié le 13/8/2026 par `GET /channels/{id}` : le salon d'annonce
 * `1349528692086276148` est `🌸〡𝓐𝔃𝓪𝓵𝓮́𝓮`, HTTP 200, `guild_id` identique.
 *
 * ⚠ Ne pas confondre avec l'avertissement de démarrage « Guilde(s)
 * configurée(s) mais non rejointe(s) : 1349526851672080414 » : cette guilde-là
 * est une AUTRE entrée du registre, sans rapport avec l'annonce. La déduire du
 * journal mènerait à croire la publication impossible alors qu'elle fonctionne.
 */
const SALON_VALIDATION_AZALEE = "1220382147811082340";

export const PROFILS: Readonly<Record<NomProfil, Profil>> = Object.freeze({
  rg: Object.freeze({
    nom: "rg",
    titre: "Rose Griffon",
    identifiantBot: "rg",
    variableJeton: "DISCORD_BOT_TOKEN",
    variablesJetonSecours: ["DISCORD_TOKEN"],
    // Les deux serveurs : le bot Rose Griffon est déjà présent sur Azalée et
    // y sert ses commandes de communauté. Le second bot s'y AJOUTE, il ne le
    // remplace pas.
    guildes: [RG_GUILD_ID, AZALEE_GUILD_ID],
    // Ce bot-ci reste par guilde : il porte l'administration de la communauté
    // Rose Griffon (synchronisation des membres, niveaux, accueil), qui n'a
    // aucun sens ailleurs. Le publier globalement l'offrirait à des serveurs
    // dont il ne connaît ni les membres ni les rôles.
    porteeCommandes: "guildes",
    // `GuildMessages` s'ajoute pour le système de niveaux : il livre l'événement
    // `messageCreate`, donc l'AUTEUR, le SALON et l'HORODATAGE d'un message.
    // Il ne livre PAS son contenu — ça, c'est `MessageContent`, un intent
    // privilégié que ces applications n'ont pas et ne demanderont pas. On compte
    // les messages sans jamais les lire, et ce n'est pas une promesse : c'est ce
    // que Discord nous envoie.
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
    modules: MODULES_RG,
    marque: {
      couleurHex: "#a14b3f" as const,
      piedDePage: "rosegriffon.fr",
      urlBase: "https://rosegriffon.fr",
      variableUrlBase: "WEBSITE_URL",
    },
    // Le bot Rose Griffon N'ANNONCE RIEN. Décision explicite du 13/8/2026 :
    // l'annonce des posts X appartient au bot Azalée et à lui seul.
    //
    // Elle est prise ICI, dans le registre, et non en désactivant le réglage
    // partagé `settings['tweets.notification'].actif` : ce réglage est UNE
    // ligne pour les deux profils, donc le couper pour Rose Griffon couperait
    // aussi Azalée. `null` veut dire « ce profil n'annonce pas » — le
    // notifieur ne démarre pas du tout, aucun minuteur, aucun curseur.
    annoncePosts: null,
  }),
  azalee: Object.freeze({
    nom: "azalee",
    titre: "Azalée",
    identifiantBot: "azalee",
    variableJeton: "AZALEE_DISCORD_BOT_TOKEN",
    variablesJetonSecours: [],
    // Conservée pour le NETTOYAGE seulement : ce profil publie désormais ses
    // commandes globalement (voir `porteeCommandes`), et cette liste sert à
    // savoir où effacer les anciennes commandes de guilde, qui feraient
    // doublon. Aucun enregistrement ne la vise plus.
    guildes: [RG_GUILD_ID, AZALEE_GUILD_ID, ACHILLEA_GUILD_ID],
    // Bot PUBLIC (`bot_public: true` sur l'application 1537394034769657867) :
    // n'importe quel serveur peut l'inviter, et le 14/8/2026 Achillea l'a fait.
    // Avec un enregistrement par guilde, ce serveur voyait un bot en ligne et
    // sans aucune commande — la liste ci-dessus ne le contenait pas, et
    // l'ajouter à la main aurait fallu recommencer au serveur suivant.
    // Ce que sert ce profil (fiches du wiki, données de jeu) ne dépend
    // d'aucune configuration propre à un serveur : c'est exactement le cas
    // d'usage des commandes globales.
    porteeCommandes: "globale",
    // `Guilds` SEUL : l'intent privilégié `GuildMembers` n'est pas accordé à
    // cette application (vérifié — « Used disallowed intents »), et aucune
    // commande de ce profil ne résout un membre.
    intents: [GatewayIntentBits.Guilds],
    modules: MODULES_AZALEE,
    marque: {
      // Orange Azalée de la charte (cf. `CLAUDE.md`, palette Rose Griffon).
      couleurHex: "#F89C5A" as const,
      piedDePage: "azalee.rosegriffon.fr",
      urlBase: "https://azalee.rosegriffon.fr",
      variableUrlBase: "AZALEE_WEBSITE_URL",
    },
    annoncePosts: {
      salonId: SALON_ANNONCE_AZALEE,
      variableSalon: "AZALEE_DISCORD_NEWS_CHANNEL_ID",
      curseur: "azalee",
      roleMention: "1359506615765827744",
      // `🌿📰〡général-azalée`, sur le serveur Rose Griffon. Rien ne part dans
      // le salon d'annonce sans qu'un humain ait cliqué ici.
      salonValidation: SALON_VALIDATION_AZALEE,
      // UNIQUEMENT les posts d'Azalée. Le salon d'annonce porte la marque
      // Azalée : les sept autres comptes du réglage partagé (Level5, comptes
      // officiels Inazuma, Rose Griffon) n'ont rien à y faire.
      comptes: ["Azalee_IE"],
    },
  }),
});

/** Vrai si la chaîne est un nom de profil connu. */
export function estNomProfil(valeur: string): valeur is NomProfil {
  return (NOMS_PROFILS as readonly string[]).includes(valeur);
}

/**
 * Nom du profil demandé par l'environnement.
 *
 * Absent ou vide → `rg`, le comportement historique.
 *
 * Valeur inconnue → on LÈVE. Se rabattre silencieusement sur `rg` serait le
 * pire des deux mondes : une faute de frappe dans l'unité systemd du bot Azalée
 * (`RG_PROFIL_BOT=azalée`, `azale`, `Azalee ` avec une espace) démarrerait un
 * SECOND bot Rose Griffon, avec le jeton du premier, qui traiterait chaque
 * interaction en double. Mieux vaut un service qui refuse de démarrer en
 * disant pourquoi.
 */
export function profilDemande(env: EnvLisible): NomProfil {
  const brut = (env[VARIABLE_PROFIL] ?? "").trim();
  if (brut === "") {
    return PROFIL_PAR_DEFAUT;
  }
  const normalise = brut.toLowerCase();
  if (!estNomProfil(normalise)) {
    throw new Error(
      `[profil] ${VARIABLE_PROFIL}="${brut}" n'est pas un profil connu. ` +
        `Valeurs acceptées : ${NOMS_PROFILS.join(", ")}. ` +
        `Laisse la variable absente pour le bot Rose Griffon.`,
    );
  }
  return normalise;
}

/** Le profil du processus courant. */
export function profilActif(env: EnvLisible = Bun.env as EnvLisible): Profil {
  return PROFILS[profilDemande(env)];
}

/**
 * Guildes où enregistrer les commandes du profil.
 *
 * Le profil `rg` continue de passer par `resolveGuildIds()` : cette fonction
 * honore `GUILD_ID` / `DISCORD_GUILD_ID` / `DISCORD_EXTRA_GUILD_IDS` et filtre
 * les `$VAR` non substitués par Bun. Rien ne change pour lui.
 *
 * Le profil `azalee` ignore ces variables et ne rend qu'Azalée : elles sont
 * posées dans `apps/bot/.env` et dans `.env.local` pour le bot Rose Griffon,
 * et les hériter ferait enregistrer les commandes du bot Azalée sur le serveur
 * principal — exactement le doublon qu'on veut éviter.
 */
export function guildesDuProfil(profil: Profil, env: EnvLisible): readonly string[] {
  if (profil.nom === "rg") {
    return resolveGuildIds(env);
  }
  return profil.guildes;
}

/**
 * Salon d'annonce des posts X, ou `null` si le profil n'annonce rien / si son
 * salon n'est ni figé ni posé en environnement.
 *
 * L'environnement l'emporte sur le registre : déplacer une annonce de salon ne
 * doit pas demander un déploiement.
 */
export function salonAnnonceDuProfil(profil: Profil, env: EnvLisible): string | null {
  const annonce = profil.annoncePosts;
  if (!annonce) {
    return null;
  }
  const depuisEnv = (env[annonce.variableSalon] ?? "").trim();
  if (/^\d{15,25}$/.test(depuisEnv)) {
    return depuisEnv;
  }
  const fige = annonce.salonId.trim();
  return fige === "" ? null : fige;
}

/** Racine des liens publics du profil. */
export function urlBaseDuProfil(profil: Profil, env: EnvLisible): string {
  const depuisEnv = (env[profil.marque.variableUrlBase] ?? "").trim();
  return depuisEnv === "" || depuisEnv.startsWith("$") ? profil.marque.urlBase : depuisEnv;
}

/** Couleur d'embed (entier 24 bits) à partir de l'hexadécimal de la marque. */
export function couleurDeMarque(couleurHex: string): number {
  const chiffres = couleurHex.startsWith("#") ? couleurHex.slice(1) : couleurHex;
  if (!/^[0-9a-fA-F]{6}$/.test(chiffres)) {
    throw new Error(`[profil] couleur de marque invalide : "${couleurHex}" (attendu #RRGGBB).`);
  }
  return Number.parseInt(chiffres, 16);
}

/**
 * Jeton Discord du profil — et un message ACTIONNABLE quand il manque.
 *
 * Un jeton absent ne doit jamais ressortir en `undefined` propagé jusqu'à
 * `client.login()`, qui répond « An invalid token was provided » : ce message ne
 * dit ni quelle variable poser, ni où, ni pour quelle application Discord.
 *
 * Deux valeurs présentes mais inutilisables sont refusées explicitement, parce
 * qu'elles ont déjà été observées dans ce dépôt :
 *   - un secret SCELLÉ (`eyJ2Ijo…`, cf. `CLAUDE.md`) écrit à la place du
 *     plaintext par un ancien outil de chiffrement ;
 *   - une référence shell non substituée (`$AUTRE_VARIABLE`), Bun ne faisant pas
 *     l'expansion dans `.env`.
 */
export function jetonDuProfil(profil: Profil, env: EnvLisible = Bun.env as EnvLisible): string {
  const candidates = [profil.variableJeton, ...profil.variablesJetonSecours];
  for (const variable of candidates) {
    const valeur = (env[variable] ?? "").trim();
    if (valeur === "") {
      continue;
    }
    if (valeur.startsWith("eyJ2Ijo")) {
      throw new Error(
        `[profil] ${variable} contient un secret SCELLÉ (« eyJ2Ijo… ») au lieu du jeton en clair. ` +
          `Rétablis la vraie valeur dans .env — le bot ne peut pas déchiffrer ce blob.`,
      );
    }
    if (valeur.startsWith("$")) {
      throw new Error(
        `[profil] ${variable}="${valeur}" est une référence shell non substituée : Bun ne fait pas ` +
          `l'expansion des $VAR dans .env. Écris la valeur littérale.`,
      );
    }
    return valeur;
  }

  throw new Error(messageJetonAbsent(profil));
}

/**
 * Message d'un jeton absent. Extrait pour être testé mot pour mot : c'est la
 * seule chose que verra la personne qui installe le second bot.
 */
export function messageJetonAbsent(profil: Profil): string {
  if (profil.nom === "azalee") {
    return (
      `[profil] Jeton Discord absent pour le profil « azalee » (${profil.titre}). ` +
      `Pose ${profil.variableJeton} dans .env : c'est le jeton de l'application Discord Azalée ` +
      `(Developer Portal → ton application Azalée → Bot → Reset Token), et surtout PAS celui du bot ` +
      `Rose Griffon (DISCORD_BOT_TOKEN). Deux processus connectés au même jeton, c'est la même ` +
      `identité en double : chaque interaction serait traitée deux fois.`
    );
  }
  return (
    `[profil] Jeton Discord absent pour le profil « ${profil.nom} » (${profil.titre}). ` +
    `Pose ${profil.variableJeton} dans .env (jeton de l'application Discord ${profil.titre}).`
  );
}

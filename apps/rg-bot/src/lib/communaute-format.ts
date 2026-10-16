/**
 * Noyau pur des commandes de communauté : `/article`, `/agenda`, `/membre`,
 * `/equipe`.
 *
 * Rien ici ne touche ni au réseau, ni à la base, ni à Discord — uniquement du
 * formatage, de la normalisation et du tri. C'est ce qui rend l'unité testable
 * (`communaute-format.test.ts`) alors que les quatre commandes qui s'en servent
 * dépendent, elles, d'un service vivant.
 *
 * ── CE QUE CE FICHIER CORRIGE ──────────────────────────────────────────────
 * Quatre paires de commandes faisaient double emploi, et chacune portait une
 * erreur mesurée le 13/8/2026 :
 *
 *  1. `/chronique` lisait la table `chronicles` : **0 ligne**. La commande ne
 *     pouvait rien afficher. Les articles du site vivent dans `articles`, avec
 *     `app = 'website'` — la même table que `/azalee latest` interrogeait avec
 *     `app = 'azalee'`. Une seule table, deux filtres : d'où `/article` et son
 *     option `site`, et d'où `URL_PUBLIQUE_ARTICLE` qui sait que le même slug
 *     se sert sur `/chroniques/<slug>` côté site et `/news/<slug>` côté wiki
 *     (les deux vérifiés 200).
 *
 *  2. `/event` lisait la table `events` : **0 ligne** elle aussi. La source
 *     réelle des événements est la route `/api/calendar-events` du site, qui
 *     part de `events` et retombe sur Google Agenda quand la table est vide —
 *     c'est ce que voit le public sur `rosegriffon.fr/evenements`. Cette route
 *     répond 5 événements, **tous passés**. Un « prochains événements » muet
 *     n'est pas une réponse : `choisirEvenements` bascule explicitement sur les
 *     derniers passés et le dit, au lieu de laisser croire à une panne.
 *
 *  3. `/member` n'affichait qu'un `roles_count`. Les 93 rôles du serveur sont
 *     en base (`discord_roles`), donc on rend les vrais noms, ordonnés par
 *     position décroissante comme dans Discord.
 *
 *  4. `/profil` lisait `profiles`, table qui contient `email`, `full_name`,
 *     `address_line1`, `address_line2`, `city`, `postal_code`, `country`,
 *     `patreon_id`. VOIR PLUS BAS.
 *
 * ── LIGNE ROUGE VIE PRIVÉE ─────────────────────────────────────────────────
 * `assainirProfil` retire les colonnes personnelles de tout objet profil avant
 * qu'il n'atteigne un embed. C'est une seconde barrière, pas la première : les
 * requêtes des commandes énumèrent déjà leurs colonnes une par une. On garde
 * les deux, parce qu'un `SELECT *` ajouté un jour par distraction ne doit pas
 * suffire à publier une adresse postale dans un salon.
 */

// ─── Articles ──────────────────────────────────────────────────────────────

/** Valeurs réellement présentes dans `articles.app`. */
export type AppArticle = "website" | "azalee";

export interface DescriptionSiteArticle {
  /** Valeur de `articles.app`. */
  readonly app: AppArticle;
  /** Valeur de l'option Discord `site`. */
  readonly choix: string;
  /** Libellé affiché. */
  readonly libelle: string;
  /** Origine publique, sans barre oblique finale. */
  readonly base: string;
  /** Segment de chemin qui précède le slug. */
  readonly segment: string;
}

/**
 * Les deux surfaces publiques d'une seule et même table.
 *
 * Le segment diffère par accident d'histoire : le site a gardé `/chroniques`
 * du temps où la table `chronicles` servait, le wiki publie sous `/news`.
 * Les deux ont été vérifiés en HTTP 200 sur un slug réel.
 */
export const SITES_ARTICLE: Readonly<Record<AppArticle, DescriptionSiteArticle>> = Object.freeze({
  website: Object.freeze({
    app: "website",
    choix: "rosegriffon",
    libelle: "rosegriffon.fr",
    base: "https://rosegriffon.fr",
    segment: "chroniques",
  }),
  azalee: Object.freeze({
    app: "azalee",
    choix: "azalee",
    libelle: "Azalée",
    base: "https://azalee.rosegriffon.fr",
    segment: "news",
  }),
});

export const APPS_ARTICLE: readonly AppArticle[] = Object.freeze(["website", "azalee"]);

/** Site d'un article, avec repli sur le site principal si `app` est inconnu. */
export function siteArticle(app: string | null | undefined): DescriptionSiteArticle {
  return app === "azalee" ? SITES_ARTICLE.azalee : SITES_ARTICLE.website;
}

/** URL publique d'un article. */
export function urlArticle(app: string | null | undefined, slug: string): string {
  const site = siteArticle(app);
  return `${site.base}/${site.segment}/${slug}`;
}

/**
 * Traduit l'option `site` en liste d'`app` à interroger.
 *
 * Absente ou inconnue, l'option vaut « les deux » : c'est le comportement le
 * plus utile pour un membre qui cherche un article sans savoir lequel des deux
 * sites l'héberge.
 */
export function appsDemandees(choix: string | null | undefined): AppArticle[] {
  if (choix === SITES_ARTICLE.azalee.choix) return ["azalee"];
  if (choix === SITES_ARTICLE.website.choix) return ["website"];
  return [...APPS_ARTICLE];
}

/** Libellé de la portée choisie, pour le sous-titre d'un embed. */
export function libellePortee(apps: readonly AppArticle[]): string {
  if (apps.length === 1) return SITES_ARTICLE[apps[0] as AppArticle].libelle;
  return APPS_ARTICLE.map(a => SITES_ARTICLE[a].libelle).join(" + ");
}

/**
 * Réduit un fragment HTML à du texte lisible.
 *
 * `articles.content` est du HTML ; l'`excerpt` est parfois nul (mesuré sur les
 * lignes publiées). Sans ce nettoyage, un embed de repli affichait les balises.
 * Les entités traitées sont celles qu'un éditeur WYSIWYG produit réellement.
 */
export function nettoyerHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replaceAll(/<br\s*\/?>/gi, " ")
    .replaceAll(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll(/&#39;|&apos;/g, "'")
    .replaceAll("&hellip;", "…")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export interface LigneArticle {
  title: string;
  slug: string;
  excerpt: string | null;
  content?: string | null;
  category: string | null;
  app: string | null;
  published_at: string | Date | null;
  view_count?: number | null;
}

/** Chapô d'un article : l'`excerpt` s'il existe, sinon le début du contenu. */
export function resumeArticle(article: LigneArticle, max = 180): string {
  const brut = article.excerpt?.trim() || nettoyerHtml(article.content);
  if (brut.length === 0) return "";
  return brut.length > max ? `${brut.slice(0, max - 1).trimEnd()}…` : brut;
}

// ─── Dates ─────────────────────────────────────────────────────────────────

/** Fuseau de référence de l'association. Explicite pour rester testable. */
export const FUSEAU = "Europe/Paris";

export function versDate(valeur: Date | string | number | null | undefined): Date | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** « 02 juin 2026 ». */
export function dateCourte(valeur: Date | string | null | undefined): string {
  const date = versDate(valeur);
  if (!date) return "date inconnue";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: FUSEAU,
  });
}

/** « 02 juin 2026 à 16:49 ». */
export function dateHeure(valeur: Date | string | null | undefined): string {
  const date = versDate(valeur);
  if (!date) return "date inconnue";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSEAU,
  });
}

/**
 * Horodatage Discord `<t:…:R>` (« il y a 3 mois »), calculé par le client.
 *
 * Préférable à une date figée dans un embed : chaque membre le lit dans SON
 * fuseau, et il reste juste quand le message est relu des semaines plus tard.
 */
export function horodatageRelatif(valeur: Date | string | null | undefined): string | null {
  const date = versDate(valeur);
  if (!date) return null;
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

// ─── Agenda : streams ──────────────────────────────────────────────────────

export const JOURS_FR: readonly string[] = Object.freeze([
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
]);

export function libelleJour(jour: number): string {
  return JOURS_FR[jour] ?? "Jour inconnu";
}

/** `21:00:00` → `21:00`. Une heure Postgres arrive avec ses secondes. */
export function heureCourte(valeur: string | null | undefined): string | null {
  if (!valeur) return null;
  const trouve = /^(\d{1,2}):(\d{2})/.exec(valeur.trim());
  if (!trouve) return null;
  return `${trouve[1]!.padStart(2, "0")}:${trouve[2]}`;
}

/**
 * Plage horaire d'un stream.
 *
 * `end_time` est NULL sur les 7 lignes actives : afficher « 21:00 → — » comme
 * le faisait `/planning` laissait croire à une donnée manquante alors que
 * l'heure de fin n'est simplement jamais renseignée. On n'affiche que ce qui
 * existe.
 */
export function plageHoraire(debut: string | null | undefined, fin: string | null | undefined): string {
  const d = heureCourte(debut);
  const f = heureCourte(fin);
  if (d && f) return `${d} → ${f}`;
  if (d) return `à partir de ${d}`;
  if (f) return `jusqu'à ${f}`;
  return "horaire à confirmer";
}

export interface LigneStream {
  day_of_week: number;
  streamer_name: string;
  start_time: string | null;
  end_time: string | null;
  category: string | null;
  notes: string | null;
}

export function ligneStream(row: LigneStream): string {
  const morceaux = [`**${row.streamer_name}**`, plageHoraire(row.start_time, row.end_time)];
  if (row.category) morceaux.push(`*${row.category}*`);
  const ligne = `• ${morceaux.join(" · ")}`;
  return row.notes ? `${ligne}\n  ${row.notes}` : ligne;
}

export interface SectionJour {
  jour: number;
  libelle: string;
  lignes: LigneStream[];
}

/**
 * Regroupe le planning par jour, à partir de LUNDI.
 *
 * `day_of_week` suit la convention Postgres (0 = dimanche). Trier brut mettait
 * donc dimanche en tête d'une semaine française. On décale de 6 modulo 7 pour
 * l'ordre d'affichage, sans toucher aux valeurs stockées.
 */
export function grouperParJour(rows: readonly LigneStream[]): SectionJour[] {
  const paquets = new Map<number, LigneStream[]>();
  for (const row of rows) {
    const bac = paquets.get(row.day_of_week);
    if (bac) bac.push(row);
    else paquets.set(row.day_of_week, [row]);
  }
  return [...paquets.entries()]
    .map(([jour, lignes]) => ({
      jour,
      libelle: libelleJour(jour),
      lignes: lignes.toSorted((a, b) =>
        (heureCourte(a.start_time) ?? "99:99").localeCompare(heureCourte(b.start_time) ?? "99:99"),
      ),
    }))
    .toSorted((a, b) => ((a.jour + 6) % 7) - ((b.jour + 6) % 7));
}

// ─── Agenda : événements ───────────────────────────────────────────────────

/** Forme rendue par `/api/calendar-events` du site (Google Agenda ou table `events`). */
export interface EvenementCalendrier {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null;
}

export interface EvenementNormalise {
  id: string | null;
  titre: string;
  description: string | null;
  lieu: string | null;
  debut: Date;
  /** Fin telle que fournie. Pour une journée entière, elle est EXCLUSIVE. */
  fin: Date | null;
  journeeEntiere: boolean;
}

const JOUR_MS = 24 * 60 * 60 * 1000;

/**
 * Normalise une entrée d'agenda, ou renvoie `null` si elle n'a pas de début
 * exploitable — une carte sans date n'apprend rien à personne.
 *
 * ⚠ Google Agenda rend une fin EXCLUSIVE sur les événements « journée
 * entière » : Japan Expo est stocké 2025-07-03 → 2025-07-07 pour quatre jours
 * du 3 au 6. On conserve la valeur brute et on retranche le jour au moment de
 * l'affichage (`formaterPlageEvenement`), pas ici : la fin exclusive reste la
 * bonne borne pour décider si l'événement est terminé.
 */
export function normaliserEvenement(ev: EvenementCalendrier): EvenementNormalise | null {
  const journeeEntiere = Boolean(ev.start?.date && !ev.start?.dateTime);
  const debut = versDate(ev.start?.dateTime ?? ev.start?.date ?? null);
  if (!debut) return null;
  return {
    id: ev.id ?? null,
    titre: ev.summary?.trim() || "Événement Rose Griffon",
    description: ev.description?.trim() || null,
    lieu: ev.location?.trim() || null,
    debut,
    fin: versDate(ev.end?.dateTime ?? ev.end?.date ?? null),
    journeeEntiere,
  };
}

/** Instant à partir duquel l'événement appartient au passé. */
export function finEffective(ev: EvenementNormalise): Date {
  if (ev.fin) return ev.fin;
  return ev.journeeEntiere ? new Date(ev.debut.getTime() + JOUR_MS) : ev.debut;
}

export function estAVenir(ev: EvenementNormalise, maintenant: Date): boolean {
  return finEffective(ev).getTime() >= maintenant.getTime();
}

/** « du 03 juillet 2025 au 06 juillet 2025 », « le 26 octobre 2025 à 13:00 »… */
export function formaterPlageEvenement(ev: EvenementNormalise): string {
  if (ev.journeeEntiere) {
    const dernier = ev.fin ? new Date(ev.fin.getTime() - JOUR_MS) : ev.debut;
    const meme = dateCourte(dernier) === dateCourte(ev.debut);
    return meme ? `le ${dateCourte(ev.debut)}` : `du ${dateCourte(ev.debut)} au ${dateCourte(dernier)}`;
  }
  const debut = dateHeure(ev.debut);
  if (!ev.fin) return `le ${debut}`;
  const memeJour = dateCourte(ev.fin) === dateCourte(ev.debut);
  const fin = ev.fin.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSEAU,
  });
  return memeJour ? `le ${debut} → ${fin}` : `du ${debut} au ${dateHeure(ev.fin)}`;
}

export type PeriodeAgenda = "a-venir" | "passes" | "tous";

export interface SelectionEvenements {
  /** Période effectivement rendue — pas forcément celle demandée. */
  periode: PeriodeAgenda;
  evenements: EvenementNormalise[];
  /** Vrai quand « à venir » était vide et qu'on est retombé sur le passé. */
  repli: boolean;
  /** Nombre total d'événements connus, toutes périodes confondues. */
  total: number;
}

/**
 * Choisit et ordonne les événements à afficher.
 *
 * Les cinq événements de l'agenda sont tous antérieurs au 13/8/2026 : une
 * commande « prochains événements » qui se contente d'un « aucun événement à
 * venir » ne distingue pas un agenda vide d'un service en panne. On bascule
 * donc sur les plus récents passés, et l'appelant l'annonce grâce à `repli`.
 */
export function choisirEvenements(
  tous: readonly EvenementNormalise[],
  periode: PeriodeAgenda,
  limite: number,
  maintenant: Date,
): SelectionEvenements {
  const max = Math.max(1, limite);
  const aVenir = tous.filter(e => estAVenir(e, maintenant)).toSorted((a, b) => a.debut.getTime() - b.debut.getTime());
  const passes = tous.filter(e => !estAVenir(e, maintenant)).toSorted((a, b) => b.debut.getTime() - a.debut.getTime());

  if (periode === "passes") {
    return {
      periode: "passes",
      evenements: passes.slice(0, max),
      repli: false,
      total: tous.length,
    };
  }
  if (periode === "tous") {
    const ordonnes = tous.toSorted((a, b) => b.debut.getTime() - a.debut.getTime());
    return {
      periode: "tous",
      evenements: ordonnes.slice(0, max),
      repli: false,
      total: tous.length,
    };
  }
  if (aVenir.length > 0) {
    return {
      periode: "a-venir",
      evenements: aVenir.slice(0, max),
      repli: false,
      total: tous.length,
    };
  }
  return { periode: "passes", evenements: passes.slice(0, max), repli: true, total: tous.length };
}

// ─── Membres ───────────────────────────────────────────────────────────────

/**
 * Colonnes de `profiles` qui ne sortent JAMAIS du serveur, quel que soit le
 * demandeur, administrateur compris.
 *
 * Ce sont exactement les colonnes fermées côté REST le 11/8/2026. La liste n'est
 * pas recopiée de mémoire : elle est le COMPLÉMENT des droits réellement posés
 * en base, relevés le 13/8/2026 —
 *
 *   select column_name from information_schema.column_privileges
 *    where table_name='profiles' and grantee='anon' and privilege_type='SELECT';
 *   → avatar_url badges banner_url bio discord_id id role twitter_handle
 *     updated_at username website
 *
 * — c'est-à-dire tout ce que `PUBLIC_PROFILE_COLUMNS` (`@rosegriffon/db`) laisse
 * lire. `full_name` et `patreon_id` sont fermés au même titre que l'e-mail et
 * l'adresse postale : le « nom complet » est nommément cité par la migration
 * comme donnée personnelle. Les répéter ici garde la même frontière quand la
 * lecture passe par la connexion Postgres directe du bot, qui, elle, contourne
 * les droits par colonne.
 *
 * `phone` n'existe pas (encore) dans la table : la clé est listée pour que
 * l'ajout d'une colonne de téléphone soit filtré dès le premier jour.
 */
export const CLES_PII_PROFIL: readonly string[] = Object.freeze([
  "email",
  "full_name",
  "address_line1",
  "address_line2",
  "city",
  "postal_code",
  "country",
  "patreon_id",
  "phone",
]);

/** Retire toute clé personnelle d'un objet profil. Barrière de dernier recours. */
export function assainirProfil<T extends Record<string, unknown>>(profil: T): Partial<T> {
  const propre: Record<string, unknown> = {};
  for (const [clef, valeur] of Object.entries(profil)) {
    if (!CLES_PII_PROFIL.includes(clef)) propre[clef] = valeur;
  }
  return propre as Partial<T>;
}

export interface RoleDiscord {
  role_id: string;
  name: string;
  position: number;
}

/**
 * Traduit les identifiants de rôles d'un membre en noms, du plus haut au plus
 * bas — l'ordre qu'affiche Discord. Les identifiants sans correspondance sont
 * ignorés plutôt que rendus bruts : un nombre à 19 chiffres n'informe personne.
 */
export function resoudreRoles(
  identifiants: readonly string[] | null | undefined,
  index: ReadonlyMap<string, RoleDiscord>,
): RoleDiscord[] {
  if (!identifiants || identifiants.length === 0) return [];
  const trouves: RoleDiscord[] = [];
  for (const id of identifiants) {
    const role = index.get(id);
    if (role) trouves.push(role);
  }
  return trouves.toSorted((a, b) => b.position - a.position);
}

/** Construit l'index des rôles à partir des lignes de `discord_roles`. */
export function indexerRoles(roles: readonly RoleDiscord[]): Map<string, RoleDiscord> {
  return new Map(roles.map(r => [r.role_id, r]));
}

/**
 * Liste de rôles bornée à `max` noms, avec un « +N » explicite.
 *
 * Un membre du staff porte 34 rôles : les concaténer dépassait les 1 024
 * caractères d'un champ d'embed, et Discord rejette alors le message ENTIER,
 * pas seulement le champ.
 */
export function listerRoles(roles: readonly RoleDiscord[], max = 12): string {
  if (roles.length === 0) return "aucun";
  const visibles = roles.slice(0, max).map(r => r.name);
  const reste = roles.length - visibles.length;
  return reste > 0 ? `${visibles.join(", ")} … +${reste}` : visibles.join(", ");
}

export interface LigneMembreDiscord {
  discord_id: string;
  username: string;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  roles: string[] | null;
  joined_at: string | Date | null;
  premium_since: string | Date | null;
  left_at: string | Date | null;
}

/** Nom le plus parlant d'un membre : surnom de serveur, sinon nom affiché, sinon pseudo. */
export function nomAffiche(membre: {
  nickname?: string | null;
  display_name?: string | null;
  username?: string | null;
}): string {
  return membre.nickname?.trim() || membre.display_name?.trim() || membre.username?.trim() || "Membre inconnu";
}

/** Ancienneté en jours pleins, ou `null` si la date d'arrivée manque. */
export function ancienneteJours(arrivee: string | Date | null | undefined, maintenant: Date): number | null {
  const date = versDate(arrivee);
  if (!date) return null;
  return Math.max(0, Math.floor((maintenant.getTime() - date.getTime()) / JOUR_MS));
}

/** « 3 ans et 2 mois », « 5 mois », « 12 jours ». */
export function libelleAnciennete(jours: number | null): string {
  if (jours === null) return "inconnue";
  if (jours < 31) return `${jours} jour${jours > 1 ? "s" : ""}`;
  const mois = Math.floor(jours / 30.44);
  if (mois < 12) return `${mois} mois`;
  const ans = Math.floor(mois / 12);
  const reste = mois % 12;
  const partAns = `${ans} an${ans > 1 ? "s" : ""}`;
  return reste > 0 ? `${partAns} et ${reste} mois` : partAns;
}

/** Ligne compacte d'un membre, pour `/membre recherche`. */
export function ligneMembreDiscord(row: LigneMembreDiscord, avecProfil: boolean): string {
  const morceaux = [`**${nomAffiche(row)}**`, `\`${row.username}\``];
  const nb = row.roles?.length ?? 0;
  morceaux.push(`${nb} rôle${nb > 1 ? "s" : ""}`);
  if (row.left_at) morceaux.push("a quitté le serveur");
  if (avecProfil) morceaux.push("compte lié");
  return `• ${morceaux.join(" · ")}`;
}

/**
 * Prépare un terme de recherche pour un `ILIKE`.
 *
 * `%` et `_` sont des jokers SQL : sans échappement, `/membre recherche %`
 * renvoyait la totalité des 2 075 membres. Le paramètre reste lié (pas
 * d'interpolation) — c'est le SENS du motif qu'on borne ici, pas son innocuité.
 */
export function motifRecherche(terme: string): string {
  const propre = terme.trim().replaceAll(/[\\%_]/g, c => `\\${c}`);
  return `%${propre}%`;
}

/** Une recherche trop courte ratisse tout : on exige deux caractères utiles. */
export function rechercheExploitable(terme: string | null | undefined): boolean {
  return (terme ?? "").trim().length >= 2;
}

// ─── Équipes ───────────────────────────────────────────────────────────────

export interface DescriptionEquipe {
  readonly id: string;
  readonly libelle: string;
}

/**
 * Les dix équipes de `team_members`, avec les libellés de la colonne
 * `team_name` (et non des intitulés réinventés dans le bot : `/staff` affichait
 * « Association » là où la base dit « Membres de l'Association »).
 */
export const EQUIPES: readonly DescriptionEquipe[] = Object.freeze([
  Object.freeze({ id: "bureauteam", libelle: "Bureau de l'Association" }),
  Object.freeze({ id: "assoteam", libelle: "Membres de l'Association" }),
  Object.freeze({ id: "azaleeteam", libelle: "Équipe Azalée" }),
  Object.freeze({ id: "achilleateam", libelle: "Équipe Achilléa" }),
  Object.freeze({ id: "loreteam", libelle: "Équipe Lore" }),
  Object.freeze({ id: "dessinateurteam", libelle: "Équipe Dessinateur" }),
  Object.freeze({ id: "productionteam", libelle: "Équipe Production" }),
  Object.freeze({ id: "socialteam", libelle: "Équipe Réseaux" }),
  Object.freeze({ id: "mediationteam", libelle: "Cellule de Médiation" }),
  Object.freeze({ id: "collabteam", libelle: "Partenaires & Collaborateurs" }),
]);

export const EQUIPE_PAR_DEFAUT = "bureauteam";

export function libelleEquipe(id: string): string {
  return EQUIPES.find(e => e.id === id)?.libelle ?? "Équipe Rose Griffon";
}

/**
 * Sous-titre de la carte d'équipe.
 *
 * `renderTeamGrid` n'affiche que 24 membres ; l'ancienne `/staff` ne le disait
 * que hors filtre, si bien qu'« Équipe Achilléa » (28 actifs) semblait n'en
 * compter que 24 dès qu'un rôle était saisi.
 */
export function sousTitreEquipe(total: number, affiches: number, role?: string | null): string {
  const morceaux: string[] = [];
  if (role?.trim()) morceaux.push(`Filtré : ${role.trim()}`);
  morceaux.push(
    total > affiches ? `${total} membres — ${affiches} affichés` : `${total} membre${total > 1 ? "s" : ""}`,
  );
  return morceaux.join(" · ");
}

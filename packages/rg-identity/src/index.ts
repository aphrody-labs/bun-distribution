/**
 * Compte unique Rose Griffon — identité native et connexions liées.
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────
 * Aujourd'hui, un compte Rose Griffon ne peut PAS exister sans un tiers.
 * `apps/website/src/lib/auth.ts` déclare Discord, Twitch et Google en
 * fournisseurs, et aucune authentification native : pour entrer, il faut un
 * compte chez quelqu'un d'autre. Si Discord suspend un compte, change ses
 * conditions ou refuse un consentement, le membre perd l'accès au site de
 * l'association — et au wiki, et à l'e-sport.
 *
 * Achilléa aggrave le tableau : il porte sa PROPRE session Discord, distincte
 * de celle de Rose Griffon. Le même membre a donc deux identités sur le même
 * site, et la barre Achilléa doit afficher son propre contrôle de compte parce
 * que celui du chrome global ne parle pas de lui.
 *
 * ── CE QUE CE MODULE DÉCRIT ─────────────────────────────────────────────────
 * Un compte, plusieurs connexions. L'adresse e-mail est l'identité NATIVE :
 * elle appartient à Rose Griffon, elle suffit à se connecter, et aucune
 * plateforme ne peut la révoquer. Tout le reste — Discord, Patreon, Twitch,
 * Google, Steam, Achilléa — vient s'y rattacher. Certaines liaisons ouvrent
 * aussi une session, d'autres apportent seulement une capacité (statut de
 * mécène, progression de jeu), mais aucune n'est nécessaire au compte natif.
 *
 * ── L'INVARIANT QUI MANQUAIT ────────────────────────────────────────────────
 * Un système multi-connexion sans garde-fou laisse l'utilisateur se verrouiller
 * dehors : il délie sa dernière connexion et son compte devient inaccessible.
 * `peutDelier()` refuse ce cas. C'est la seule règle de ce module qui empêche
 * une perte réelle, et c'est pour elle qu'il existe.
 *
 * ── MODULE PUR ──────────────────────────────────────────────────────────────
 * Aucune E/S, aucune dépendance. Il décrit et il décide ; la persistance est
 * ailleurs.
 */

/** Connexions rattachables à un compte. */
export const CONNEXIONS = ["email", "discord", "patreon", "twitch", "google", "steam", "achillea"] as const;

export type Connexion = (typeof CONNEXIONS)[number];

/** Fournisseurs extérieurs auxquels Rose Griffon peut être relié. */
export type FournisseurTiers = Exclude<Connexion, "email" | "achillea">;

/** Profil public, indépendant des pseudonymes propres aux fournisseurs. */
export interface ProfilUtilisateur {
  nomAffiche: string;
  avatarUrl?: string;
  biographie?: string;
}

export interface DescriptionConnexion {
  id: Connexion;
  nom: string;
  /**
   * Permet-elle, à elle seule, de se connecter ?
   *
   * C'est la distinction qui compte. Discord, Twitch, Google et Patreon sont
   * des entrées OAuth actuellement exposées par le site. Steam et Achilléa ne
   * font qu'enrichir le profil et ne doivent jamais compter comme accès.
   */
  authentifiante: boolean;
  /**
   * Native à Rose Griffon ?
   *
   * Une seule l'est : l'adresse e-mail. Elle ne dépend d'aucune plateforme et
   * ne peut donc pas être révoquée par un tiers.
   */
  native: boolean;
  /** Ce que la connexion apporte, en une phrase. Affiché sur la page compte. */
  apporte: string;
}

export const DESCRIPTIONS = Object.freeze({
  achillea: {
    apporte: "Clans, mode classé, tournois et licence compétitive.",
    authentifiante: false,
    id: "achillea",
    native: false,
    nom: "Achilléa",
  },
  discord: {
    apporte: "Rôles du serveur, notifications et identité de la communauté.",
    authentifiante: true,
    id: "discord",
    native: false,
    nom: "Discord",
  },
  email: {
    apporte: "Se connecter sans dépendre d'aucune plateforme extérieure.",
    authentifiante: true,
    id: "email",
    native: true,
    nom: "Adresse e-mail",
  },
  google: {
    apporte: "Connexion rapide.",
    authentifiante: true,
    id: "google",
    native: false,
    nom: "Google",
  },
  patreon: {
    apporte: "Statut de mécène, avantages et réduction boutique.",
    authentifiante: true,
    id: "patreon",
    native: false,
    nom: "Patreon",
  },
  steam: {
    apporte: "Progression et succès d'Inazuma Eleven: Victory Road.",
    authentifiante: false,
    id: "steam",
    native: false,
    nom: "Steam",
  },
  twitch: {
    apporte: "Abonnement à la chaîne et statut de streameur.",
    authentifiante: true,
    id: "twitch",
    native: false,
    nom: "Twitch",
  },
} satisfies Record<Connexion, DescriptionConnexion>);

interface BaseConnexionLiee {
  /** Libellé affichable (pseudo ou adresse). */
  libelle?: string;
  lieeLe?: Date;
  /**
   * Une liaison révoquée ou expirée ne constitue pas une méthode d'accès.
   * L'absence de cette propriété signifie que la liaison est valide, ce qui
   * permet de représenter simplement les comptes OAuth déjà persistés.
   */
  valide?: boolean;
}

/** Identité native Rose Griffon. Elle n'ouvre un accès qu'une fois vérifiée. */
export interface ConnexionEmail extends BaseConnexionLiee {
  type: "email";
  adresse: string;
  verifiee: boolean;
  motDePasseConfigure: boolean;
}

/** Liaison à un fournisseur extérieur. */
export interface ConnexionFournisseurTiers extends BaseConnexionLiee {
  type: FournisseurTiers;
  identifiant: string;
}

/** Liaison au profil compétitif interne Achilléa. */
export interface ConnexionAchillea extends BaseConnexionLiee {
  type: "achillea";
  identifiant: string;
}

/** Une connexion rattachée à un compte Rose Griffon. */
export type ConnexionLiee = ConnexionEmail | ConnexionFournisseurTiers | ConnexionAchillea;

/** Compte unique partagé par le portail, le wiki et Achilléa. */
export interface Compte {
  id: string;
  profil: ProfilUtilisateur;
  connexions: readonly ConnexionLiee[];
  creeLe?: Date;
  misAJourLe?: Date;
}

function connexionEstValide(connexion: ConnexionLiee): boolean {
  return connexion.valide !== false;
}

/** Une liaison permet-elle réellement d'ouvrir une session ? */
export function connexionEstAuthentifiante(connexion: ConnexionLiee): boolean {
  if (!connexionEstValide(connexion) || !DESCRIPTIONS[connexion.type].authentifiante) {
    return false;
  }

  if (connexion.type === "email") {
    return connexion.verifiee && connexion.motDePasseConfigure;
  }

  return true;
}

/** Les connexions du compte qui permettent, à elles seules, de se connecter. */
export function connexionsAuthentifiantes(liees: readonly ConnexionLiee[]): ConnexionLiee[] {
  return liees.filter(connexionEstAuthentifiante);
}

/** Le compte a-t-il une identité native, indépendante de toute plateforme ? */
export function aIdentiteNative(liees: readonly ConnexionLiee[]): boolean {
  return liees.some(c => c.type === "email" && connexionEstAuthentifiante(c) && DESCRIPTIONS[c.type].native);
}

export type ResultatDeliaison =
  { autorise: true } | { autorise: false; raison: "connexion_non_liee" | "derniere_methode_acces" };

/**
 * Peut-on délier cette connexion sans verrouiller l'utilisateur dehors ?
 *
 * Refuse la dernière connexion authentifiante. Sans cette règle, un membre qui
 * ne s'est jamais donné de mot de passe et qui délie Discord perd l'accès à son
 * propre compte — à ses commandes, à sa licence, à son clan — sans aucun moyen
 * de revenir. C'est une perte irréversible produite par un clic.
 *
 * Délier une connexion NON authentifiante (Steam, Achilléa) est
 * toujours permis : elle n'ouvre aucune porte, elle ne fait qu'apporter une
 * capacité.
 */
export function peutDelier(compte: Compte, connexionADelier: Connexion): ResultatDeliaison {
  const liees = compte.connexions;
  const cible = connexionADelier;
  if (!liees.some(c => c.type === cible)) {
    return { autorise: false, raison: "connexion_non_liee" };
  }

  if (!DESCRIPTIONS[cible].authentifiante) return { autorise: true };

  const restantes = connexionsAuthentifiantes(liees.filter(c => c.type !== cible));
  if (restantes.length === 0) {
    return { autorise: false, raison: "derniere_methode_acces" };
  }

  return { autorise: true };
}

/** Message affichable pour un refus. */
export function messageRefus(raison: Extract<ResultatDeliaison, { autorise: false }>["raison"]): string {
  if (raison === "connexion_non_liee") {
    return "Cette connexion n'est pas rattachée à ton compte.";
  }
  return "C'est ta seule façon de te connecter. Ajoute une adresse e-mail ou une autre connexion avant de la retirer.";
}

export interface EtatCompte {
  liees: ConnexionLiee[];
  /** Connexions proposables, dans l'ordre d'affichage. */
  disponibles: DescriptionConnexion[];
  /** Le compte survivrait-il à la perte de toutes les plateformes tierces ? */
  autonome: boolean;
  /**
   * Avertissement à afficher, ou `null`.
   *
   * Un compte sans identité native fonctionne parfaitement — jusqu'au jour où
   * la plateforme tierce change d'avis. Le dire au bon moment coûte une
   * phrase ; le découvrir après coup coûte le compte.
   */
  avertissement: string | null;
}

/** Décrit l'état des connexions d'un compte, pour la page « Compte ». */
export function etatCompte(liees: readonly ConnexionLiee[]): EtatCompte {
  const dejaLiees = new Set(liees.map(c => c.type));
  const autonome = aIdentiteNative(liees);

  return {
    autonome,
    avertissement: autonome
      ? null
      : "Ton compte dépend entièrement d'une plateforme extérieure. Ajoute une adresse e-mail pour pouvoir te connecter même si tu perds cet accès.",
    disponibles: CONNEXIONS.filter(id => !dejaLiees.has(id)).map(id => DESCRIPTIONS[id]),
    liees: [...liees],
  };
}

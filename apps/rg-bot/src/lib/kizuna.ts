/**
 * Jetons Kizuna — l'économie de la communauté, en vocabulaire d'Inazuma.
 *
 * ── LA MONNAIE EST CELLE DU JEU, PAS UNE INVENTION ─────────────────────────
 * Le **Jeton Kizuna** n'est pas un habillage : c'est la monnaie d'Inazuma
 * Eleven Victory Road, avec son nom exact dans les trois localisations du jeu
 * (texte `0xD63615BE`, catégorie `menu`) —
 *
 *   fr « Jeton Kizuna »   en « Bond Token »   ja « キズナトークン »
 *
 * C'est ce qu'on échange à la **Boutique Kizuna** (« Échangez les tokens que
 * vous avez gagnés contre divers objets ! », « Pas assez de tokens. »). Un
 * joueur du jeu n'a donc rien à apprendre : il connaît déjà l'unité, l'endroit
 * où elle se dépense, et l'idée qu'elle mesure des LIENS.
 *
 * Et cette idée décide de ce qui RAPPORTE. Une monnaie ordinaire s'accumule en
 * jouant beaucoup ; un jeton de lien se gagne en étant là et en donnant.
 *
 * D'où les trois seules sources, et l'absence délibérée d'une quatrième :
 *
 *   1. `quotidien` — la présence. Une fois par jour civil, avec une série qui
 *      récompense la régularité et non le volume.
 *   2. `montee-niveau` — les jalons. Une montée de niveau rapporte
 *      proportionnellement au niveau atteint (`experience.jetonsDeMontee`).
 *   3. `don` — la générosité. Le seul moyen d'en faire circuler beaucoup.
 *
 * Il n'y a AUCUN gain par message. C'était le choix évident, et c'est celui qui
 * transforme un salon en champ de mines à messages d'un mot : l'XP suffit à
 * mesurer l'activité, et elle est déjà bornée par un délai anti-spam.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucune E/S, aucun `discord.js`. Les dates entrent en paramètre. Ce qui touche
 * la base vit dans `services/communaute.ts`.
 */
import { entierLisible } from "./ui/nombres";

// ─── Vocabulaire du journal ─────────────────────────────────────────────────

/**
 * Causes possibles d'un mouvement. Fermé volontairement : chaque ligne du
 * journal doit pouvoir s'expliquer à qui conteste son solde, et un motif libre
 * finit toujours par contenir « divers ».
 */
export const MOTIFS = [
  "quotidien",
  "montee-niveau",
  "don-envoye",
  "don-recu",
  "achat",
  "remboursement",
  "ajustement",
  "evenement",
] as const;

export type Motif = (typeof MOTIFS)[number];

const LIBELLES_MOTIF: Readonly<Record<Motif, string>> = Object.freeze({
  achat: "Achat dans la collection",
  ajustement: "Ajustement du staff",
  "don-envoye": "Don offert",
  "don-recu": "Don reçu",
  evenement: "Récompense d'événement",
  "montee-niveau": "Montée de niveau",
  quotidien: "Passage quotidien",
  remboursement: "Remboursement",
});

export function estMotif(valeur: unknown): valeur is Motif {
  return typeof valeur === "string" && (MOTIFS as readonly string[]).includes(valeur);
}

/** Libellé lisible d'un motif ; le motif brut si un jour la base en porte un autre. */
export function libelleMotif(motif: string): string {
  return estMotif(motif) ? LIBELLES_MOTIF[motif] : motif;
}

// ─── Affichage ──────────────────────────────────────────────────────────────

/** Nom de l'unité, accordé. Une seule orthographe dans tout le bot. */
export function libelleUnite(montant: number): string {
  return Math.abs(montant) <= 1 ? "jeton Kizuna" : "jetons Kizuna";
}

/** `1 250 jetons Kizuna` — la forme complète, groupée à la française. */
export function formaterJetons(montant: number | null | undefined): string {
  const valeur = typeof montant === "number" && Number.isFinite(montant) ? Math.trunc(montant) : 0;
  return `${entierLisible(valeur)} ${libelleUnite(valeur)}`;
}

/** `+40` / `-15` — la forme des lignes de journal, signe toujours visible. */
export function formaterDelta(delta: number): string {
  const valeur = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return `${valeur > 0 ? "+" : valeur < 0 ? "−" : ""}${entierLisible(Math.abs(valeur))}`;
}

// ─── Passage quotidien ──────────────────────────────────────────────────────

export const QUOTIDIEN = Object.freeze({
  /** Gain de base, série remise à zéro. */
  base: 25,
  /** Ajout par jour consécutif au-delà du premier. */
  parJour: 5,
  /** Plafond de la prime de série — atteint au 11ᵉ jour. */
  primeMaximale: 50,
} as const);

/**
 * Gain d'un passage quotidien pour une série donnée (1 = premier jour).
 *
 * La prime plafonne, et c'est ce qui empêche la série de devenir la seule chose
 * qui compte : au bout de onze jours, revenir tous les jours rapporte trois fois
 * le premier jour, pas trente fois.
 */
export function recompenseQuotidienne(serie: number): number {
  const jours = Number.isFinite(serie) ? Math.max(1, Math.floor(serie)) : 1;
  const prime = Math.min(QUOTIDIEN.primeMaximale, (jours - 1) * QUOTIDIEN.parJour);
  return QUOTIDIEN.base + prime;
}

/** Le jour civil UTC d'un instant, en `AAAA-MM-JJ`. */
export function jourCivil(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Nombre de jours civils entre deux dates `AAAA-MM-JJ`. */
function ecartEnJours(depuis: string, jusqua: string): number {
  const a = Date.parse(`${depuis}T00:00:00.000Z`);
  const b = Date.parse(`${jusqua}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((b - a) / 86_400_000);
}

export interface EtatQuotidien {
  /** Le passage est-il réclamable maintenant ? */
  reclamable: boolean;
  /** Série qui résultera de la réclamation (inchangée si non réclamable). */
  serie: number;
  /** Points que rapporterait la réclamation, `0` si non réclamable. */
  gain: number;
  /** Vrai quand la série a été rompue par une absence de plus d'un jour. */
  serieRompue: boolean;
  /** Instant du prochain passage possible — minuit UTC du lendemain. */
  prochain: Date;
}

/**
 * Où en est le passage quotidien d'un membre.
 *
 * ── POURQUOI DES JOURS CIVILS, ET PAS DES TRANCHES DE 24 H ─────────────────
 * Avec un délai de 24 h, réclamer à 20 h le lundi interdit de réclamer avant
 * 20 h le mardi : la fenêtre GLISSE, et une série honnête se rompt parce qu'on
 * s'est connecté une heure trop tôt. Le jour civil ne glisse pas — « une fois
 * par jour » veut dire ce qu'il dit.
 *
 * Le fuseau est UTC, celui du processus et de Postgres. Pour la France, la
 * bascule tombe à 1 h ou 2 h du matin : après la fin d'une soirée, jamais au
 * milieu.
 */
export function etatQuotidien(
  dernierJour: string | Date | null | undefined,
  serieActuelle: number,
  maintenant: Date = new Date(),
): EtatQuotidien {
  const aujourdhui = jourCivil(maintenant);
  const demain = new Date(Date.parse(`${aujourdhui}T00:00:00.000Z`) + 86_400_000);
  const serie = Number.isFinite(serieActuelle) ? Math.max(0, Math.floor(serieActuelle)) : 0;

  const precedent =
    dernierJour instanceof Date
      ? jourCivil(dernierJour)
      : typeof dernierJour === "string" && dernierJour.length >= 10
        ? dernierJour.slice(0, 10)
        : null;

  if (precedent === null) {
    return {
      gain: recompenseQuotidienne(1),
      prochain: demain,
      reclamable: true,
      serie: 1,
      serieRompue: false,
    };
  }

  const ecart = ecartEnJours(precedent, aujourdhui);
  if (ecart <= 0) {
    // Déjà passé aujourd'hui. (Un écart négatif veut dire que la base porte une
    // date future : on ne récompense pas, et on ne casse pas la série non plus.)
    return {
      gain: 0,
      prochain: demain,
      reclamable: false,
      serie,
      serieRompue: false,
    };
  }

  const enSerie = ecart === 1;
  const serieSuivante = enSerie ? serie + 1 : 1;
  return {
    gain: recompenseQuotidienne(serieSuivante),
    prochain: demain,
    reclamable: true,
    serie: serieSuivante,
    serieRompue: !enSerie && serie > 1,
  };
}

// ─── Dons ───────────────────────────────────────────────────────────────────

export const DON = Object.freeze({
  minimum: 1,
  /** Plafond d'un don unique. */
  maximum: 5_000,
  /** Plafond de ce qu'un membre peut donner dans une même journée civile. */
  plafondJournalier: 10_000,
} as const);

export interface DemandeDon {
  expediteurId: string;
  destinataireId: string;
  montant: unknown;
  /** Solde de l'expéditeur au moment de la demande. */
  solde: number;
  /** Total déjà donné aujourd'hui par l'expéditeur. */
  dejaDonne?: number;
  /** Le destinataire est-il un bot ? */
  destinataireEstBot?: boolean;
}

export type ResultatDon = { ok: true; montant: number } | { ok: false; erreur: string };

/**
 * Valide un don avant qu'il ne touche la base.
 *
 * Rend UNE erreur et non une liste : contrairement à la création d'un sondage,
 * les refus sont ici mutuellement exclusifs (on ne peut pas à la fois se donner
 * à soi-même et manquer de jetons), et le premier est toujours le bon.
 */
export function validerDon(demande: DemandeDon): ResultatDon {
  if (demande.expediteurId === demande.destinataireId) {
    return {
      erreur: "On ne se fait pas de cadeau à soi-même. Choisis quelqu'un d'autre.",
      ok: false,
    };
  }
  if (demande.destinataireEstBot === true) {
    return {
      erreur: "Les bots n'ont pas d'amis à ce point : choisis un membre.",
      ok: false,
    };
  }

  const brut =
    typeof demande.montant === "number"
      ? demande.montant
      : typeof demande.montant === "string"
        ? Number(demande.montant.replaceAll(/[\s_]/g, ""))
        : Number.NaN;
  if (!Number.isFinite(brut) || Math.floor(brut) !== brut) {
    return { erreur: "Le montant doit être un nombre entier de jetons.", ok: false };
  }
  const montant = Math.trunc(brut);

  if (montant < DON.minimum) {
    return { erreur: `Le don minimum est de ${DON.minimum} point.`, ok: false };
  }
  if (montant > DON.maximum) {
    return {
      erreur: `Le don maximum est de ${formaterJetons(DON.maximum)} en une fois.`,
      ok: false,
    };
  }

  const solde = Number.isFinite(demande.solde) ? Math.max(0, Math.trunc(demande.solde)) : 0;
  if (montant > solde) {
    return {
      erreur: `Tu n'as que ${formaterJetons(solde)} : il t'en manque ${entierLisible(montant - solde)}.`,
      ok: false,
    };
  }

  const dejaDonne = Number.isFinite(demande.dejaDonne) ? Math.max(0, Math.trunc(demande.dejaDonne as number)) : 0;
  if (dejaDonne + montant > DON.plafondJournalier) {
    const reste = Math.max(0, DON.plafondJournalier - dejaDonne);
    return {
      erreur: `Plafond journalier atteint : ${formaterJetons(DON.plafondJournalier)} par jour et par membre. ${
        reste > 0 ? `Il te reste ${formaterJetons(reste)} à donner aujourd'hui.` : "Réessaie demain."
      }`,
      ok: false,
    };
  }

  return { montant, ok: true };
}

// ─── Dépenses ───────────────────────────────────────────────────────────────

export type ResultatDepense = { ok: true; soldeApres: number } | { ok: false; erreur: string; manque: number };

/**
 * Peut-on payer ce prix ? Le message dit COMBIEN il manque : « solde
 * insuffisant » oblige à faire la soustraction soi-même.
 */
export function verifierDepense(solde: number, prix: number): ResultatDepense {
  const disponible = Number.isFinite(solde) ? Math.max(0, Math.trunc(solde)) : 0;
  const cout = Number.isFinite(prix) ? Math.max(0, Math.trunc(prix)) : 0;
  if (cout > disponible) {
    return {
      erreur: `Il te manque ${formaterJetons(cout - disponible)} — tu en as ${entierLisible(disponible)}.`,
      manque: cout - disponible,
      ok: false,
    };
  }
  return { ok: true, soldeApres: disponible - cout };
}

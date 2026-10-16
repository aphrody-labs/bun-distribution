// Source: apps/shenron/site/src/lib/contributions-shared.ts at 8172f535ce (preserved Git history).
/**
 * Contributions communautaires — constantes **client-safe** (aucun import
 * Drizzle / server-only) : partagées par le bouton public « Proposer une
 * correction », la route d'API et l'écran de modération.
 *
 * Ce qui est ouvert à la proposition est délibérément étroit : du **texte
 * éditorial**, jamais une image, une clé étrangère, un ordre d'affichage ni un
 * drapeau de visibilité. Un contributeur corrige une phrase ou complète un
 * article ; il ne rebranche pas une fiche sur une autre ni ne masque quoi que
 * ce soit. Élargir cette liste, c'est élargir la surface de dégât d'une
 * proposition acceptée trop vite — le faire colonne par colonne, jamais en bloc.
 */

/** Colonnes proposables, avec leur libellé humain et ce qu'on en attend. */
export const CONTRIBUTABLE_COLUMNS: Record<string, { label: string; hint: string; long: boolean }> = {
  article: {
    label: "Article",
    hint: "Le texte long de la fiche, en markdown. Les titres `## …` deviennent les onglets de la fiche.",
    long: true,
  },
  description: {
    label: "Description",
    hint: "Le résumé court affiché en tête de fiche.",
    long: true,
  },
  synopsis: { label: "Synopsis", hint: "Le résumé de l'épisode ou du film.", long: true },
  body: {
    label: "Contenu de la section",
    hint: "Le corps de la section, en markdown.",
    long: true,
  },
  summary: { label: "Résumé", hint: "Le résumé de cette version du personnage.", long: true },
  note: { label: "Note", hint: "La note attachée à cette apparition.", long: true },
  biography: {
    label: "Biographie",
    hint: "La biographie du comédien ou de la comédienne, sourcée.",
    long: true,
  },
  rulesSummary: {
    label: "Règles",
    hint: "Les règles du tournoi, telles que le manga les énonce.",
    long: true,
  },
  climaxSummary: {
    label: "Dénouement",
    hint: "Le dénouement du combat, avec la planche ou l'épisode.",
    long: true,
  },
  rules: {
    label: "Règles",
    hint: "Les règles d'invocation et de vœux du dragon.",
    long: true,
  },
  nameJa: {
    label: "Nom japonais",
    hint: "La graphie japonaise, telle qu'elle est imprimée dans le databook.",
    long: false,
  },
  nameRomaji: {
    label: "Nom en rōmaji",
    hint: "La transcription latine du nom japonais.",
    long: false,
  },
  titleJa: { label: "Titre japonais", hint: "Le titre japonais imprimé.", long: false },
  titleRomaji: {
    label: "Titre en rōmaji",
    hint: "La transcription latine du titre.",
    long: false,
  },
};

/** Une colonne est-elle ouverte aux propositions de la communauté ? */
export function isContributableColumn(col: string): boolean {
  return col in CONTRIBUTABLE_COLUMNS;
}

/** Bornes de saisie — alignées sur celles de `depose-wiki.ts`. */
export const CONTRIBUTION_MAX = 40_000;
export const CONTRIBUTION_COMMENT_MAX = 1_000;
export const CONTRIBUTION_SOURCES_MAX = 500;

/**
 * Tournures qui annoncent une affirmation non sourcée. Le wiki se rédige sur le
 * manga et les databooks : « probablement » n'y a pas sa place, et le dire au
 * moment de la saisie coûte moins cher que de le refuser après coup.
 * Miroir exact du garde-fou de `scripts/depose-wiki.ts`.
 */
export const TOURNURES_NON_SOURCEES =
  /\b(probablement|sans doute|vraisemblablement|on suppose|il semblerait|peut-être que)\b/i;

export type ContributionStatusKey = "pending" | "accepted" | "rejected" | "superseded" | "withdrawn";

export const CONTRIBUTION_STATUS_LABELS: Record<ContributionStatusKey, string> = {
  pending: "En attente",
  accepted: "Acceptée",
  rejected: "Refusée",
  superseded: "Obsolète",
  withdrawn: "Retirée",
};

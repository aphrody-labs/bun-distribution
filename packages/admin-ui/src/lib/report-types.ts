// Source: apps/shenron/site/src/lib/report-types.ts at 8172f535ce (preserved Git history).
/**
 * Constantes **client-safe** des signalements utilisateurs (« Signaler une
 * erreur ») : catégories et statuts partagés entre le bouton public, l'API et le
 * back-office admin. Aucune dépendance server-only.
 */

export const REPORT_CATEGORIES = [
  { key: "bug", label: "Bug / dysfonctionnement" },
  { key: "contenu", label: "Erreur de contenu (info fausse)" },
  { key: "lien", label: "Lien / média cassé" },
  { key: "suggestion", label: "Suggestion / amélioration" },
  { key: "autre", label: "Autre" },
] as const;

export function reportCategoryLabel(key: string): string {
  return REPORT_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

export const REPORT_STATUSES = [
  { key: "open", label: "Ouvert", tone: "orange" },
  { key: "in_progress", label: "En cours", tone: "blue" },
  { key: "resolved", label: "Résolu", tone: "green" },
  { key: "closed", label: "Fermé", tone: "muted" },
] as const;

export function reportStatusLabel(key: string): string {
  return REPORT_STATUSES.find(s => s.key === key)?.label ?? key;
}

/** Longueur max du message (bornée aussi côté serveur). */
export const REPORT_MESSAGE_MAX = 2000;

/** Forme d'un signalement renvoyée par l'API admin (dates en ISO string). */
export interface ReportRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  discordId: string | null;
  username: string | null;
  path: string;
  pageTitle: string | null;
  category: string;
  message: string;
  userAgent: string | null;
  status: string;
  adminNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

// Source: packages/shenron/db/src/constants.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Zero-dependency constants shared by the site, the bot, the API and the MCP
 * contract. Runtime class: `pure` — this module imports nothing.
 */

/**
 * Agent key scopes (write API of the site). Re-exported by `./schema` so the
 * historical `AGENT_SCOPES` import path keeps working.
 */
export const AGENT_SCOPES = [
  /** Lecture du catalogue, du fil et des commentaires. */
  "read",
  /** Déposer une proposition de correction wiki (file de modération). */
  "contribute",
  /** Créer/modifier des articles — toujours en brouillon. */
  "write:articles",
  /** Publier un article (mise en ligne immédiate ou programmée). */
  "publish:articles",
  /** Écrire un commentaire signé du nom de l'agent. */
  "comment",
  /** Accepter/refuser des contributions, masquer des commentaires. */
  "moderate",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** RAG training feedback statuses (= apps/shenron/bot/src/api/ia-cockpit.ts). */
export const FEEDBACK_STATUSES = ["pending", "gold_added", "rejected", "reviewed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Admin goal priorities (= apps/shenron/bot/src/api/ia-cockpit.ts). */
export const GOAL_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
export type GoalPriority = (typeof GOAL_PRIORITIES)[number];

export type WikiCategoryName =
  | "characters"
  | "planets"
  | "races"
  | "techniques"
  | "transformations"
  | "sagas"
  | "arcs"
  | "episodes"
  | "movies"
  | "games"
  | "tools"
  | "battles"
  | "items"
  | "dragons"
  | "wishes"
  | "locations"
  | "tournaments"
  | "voice_actors"
  | "soundtracks"
  | "power_levels"
  | "timeline_events";

/**
 * Public wiki categories in Shenron's canonical editorial/API order. The
 * Aphrody MCP mirrors the names for routing, but does not own these labels.
 */
export const WIKI_CATEGORIES: readonly {
  readonly name: WikiCategoryName;
  readonly label: string;
}[] = [
  { name: "characters", label: "Personnages" },
  { name: "planets", label: "Planètes" },
  { name: "races", label: "Races" },
  { name: "techniques", label: "Techniques" },
  { name: "transformations", label: "Transformations" },
  { name: "sagas", label: "Sagas" },
  { name: "arcs", label: "Arcs" },
  { name: "episodes", label: "Épisodes" },
  { name: "movies", label: "Films" },
  { name: "games", label: "Jeux" },
  { name: "tools", label: "Outils" },
  { name: "battles", label: "Combats" },
  { name: "items", label: "Objets" },
  { name: "dragons", label: "Dragons" },
  { name: "wishes", label: "Vœux" },
  { name: "locations", label: "Lieux" },
  { name: "tournaments", label: "Tournois" },
  { name: "voice_actors", label: "Comédiens de doublage" },
  { name: "soundtracks", label: "Bandes originales" },
  { name: "power_levels", label: "Niveaux de puissance" },
  { name: "timeline_events", label: "Événements chronologiques" },
] as const;

/** Type guard over {@link WIKI_CATEGORIES}. */
export function isWikiCategoryName(value: unknown): value is WikiCategoryName {
  return typeof value === "string" && WIKI_CATEGORIES.some(c => c.name === value);
}

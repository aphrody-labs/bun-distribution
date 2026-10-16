/**
 * @rosegriffon/achillea-types — Contrat d'API d'Achilléa (DTO + enums).
 *
 * SOURCE UNIQUE des shapes ET des enums échangés entre le bot (API), le web,
 * et toute future cible (Next.js, app mobile, client de jeu Rust).
 *
 * Règles du paquet :
 * - zéro dépendance runtime, zéro import Node/Bun/DOM ;
 * - uniquement `interface` / `type` / `enum` — aucune logique, aucun libellé
 *   d'affichage (ceux-ci vivent dans `@rosegriffon/achillea-core/labels`) ;
 * - toute forme déclarée ici doit être traduisible telle quelle en `serde`
 *   (Rust), `Codable` (Swift) ou `kotlinx.serialization` (Kotlin).
 *
 * Importer par domaine (`@rosegriffon/achillea-types/domain/user`) ou tout
 * depuis la racine.
 */

// ── Enums ───────────────────────────────────────────────────────────────────
export * from "./enums/index";

// ── Domaines ────────────────────────────────────────────────────────────────
export * from "./domain/admin";
export * from "./domain/api";
export * from "./domain/auth";
export * from "./domain/brackets";
export * from "./domain/cast";
export * from "./domain/clan";
export * from "./domain/clan-ops";
export * from "./domain/common";
export * from "./domain/event";
export * from "./domain/league";
export * from "./domain/license";
export * from "./domain/lobby";
export * from "./domain/notification";
export * from "./domain/organization";
export * from "./domain/player-note";
export * from "./domain/ranked";
export * from "./domain/sanction";
export * from "./domain/suggestion";
export * from "./domain/tournament";
export * from "./domain/tournament-ops";
export * from "./domain/user";
export * from "./domain/wallet";

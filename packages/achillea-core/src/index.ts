/**
 * @rosegriffon/achillea-core — Logique métier portable d'Achilléa.
 *
 * Multi-runtime : navigateur, edge (Deno/Web), Node, Bun. Aucune dépendance
 * Discord / MikroORM / DI / Node-only — uniquement des standards Web
 * (Web Crypto, `Intl`, `URL`, `TextEncoder`) + `@rosegriffon/achillea-types`,
 * `@casl/ability`, `@sindresorhus/transliterate`.
 *
 * C'est la couche qui rend Achilléa portable : tout ce qui décide (Elo,
 * classement, sanctions, licences, votes, brackets, droits, pagination,
 * libellés) vit ici et pas dans un composant. Un front n'a plus qu'à appeler
 * et afficher — qu'il soit Angular, Next.js + shadcn, React Native ou un HUD
 * de jeu.
 *
 * Importer par domaine via les sous-chemins (`@rosegriffon/achillea-core/elo`)
 * ou tout depuis la racine.
 */

// ── Compétition ─────────────────────────────────────────────────────────────
export * from "./elo";
export * from "./ranking";
export * from "./ranked";
export * from "./league";
export * from "./participants";
export * from "./tournaments";
export * from "./brackets";
export * from "./stats";

// ── Communauté ──────────────────────────────────────────────────────────────
export * from "./clans";
export * from "./casts";
export * from "./sanctions";
export * from "./licenses";
export * from "./votes";
export * from "./wallet";

// ── Transverse ──────────────────────────────────────────────────────────────
export * from "./access";
export * from "./auth";
export * from "./enums";
export * from "./format";
export * from "./http";
export * from "./identity";
export * from "./labels";
export * from "./names";
export * from "./numbers";
export * from "./oauth";
export * from "./pagination";
export * from "./presentation";
export * from "./reference";
export * from "./rulesets";
export * from "./validation";

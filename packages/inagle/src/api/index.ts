/**
 * @file api/index.ts
 * @description Consolidated high-level Universal Game Data API for Inagle and Azalée.
 */

export { createInagleService, type InagleServiceConfig } from "../service.js";
export {
  createGlobalSearch,
  type GlobalSearchAPI,
  type GlobalSearchResult,
  type SearchableType,
  type SearchConfig,
} from "../search/index.js";
export * from "../characters/comparison-engine.js";
export { initRomaji, toRomaji, toRomajiTitleCase, toKana } from "../utils/romaji.js";
export * as Wiki from "../wiki/index.js";

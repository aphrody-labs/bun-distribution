/**
 * Core utilities module
 *
 * Contains low-level tools for working with IEVR game data:
 * - parser: CFG.BIN file parsing
 * - search: Full-text search utilities
 * - SQL projections: durable game-data access through PostgreSQL
 * - hash: Hash computation and lookup utilities
 * - images: Image path resolution and indexing
 * - openapi: OpenAPI 3.1.0 spec generator from Zod schemas
 * - paths: Data file paths configuration
 * - config-parser: Raw cfg.bin.json parser
 * - data-loader: Central data loading with caching
 * - types: Complete TypeScript type definitions
 */

export { loadJsonAsync as loadJsonFileAsync, measureTime } from "./async-loader.js";
export {
  configuredDataSource,
  localMirrorPath,
  selectDataSource,
  type InagleDataSource,
  type InagleDataSourceOption,
} from "./data-source.js";
// Native game files remain accessible independently of the selected SQL projection adapter.
export { configureGameVfs, gameDataDirectory, gameVfs, gameVfsPaths } from "./vfs-data.js";
export {
  CONFIG_SCHEMA_VERSION,
  type CharaBaseData,
  type CharaParamData,
  type ConfigDocument,
  type ConfigFile,
  type ConfigNode,
  type ConfigVariable,
  type ConfigVariableType,
  type RawConfigFile,
  type VersionedConfigDocument,
  extractVariables,
  getNodesByName,
  isVersionedConfigDocument,
  parseCharaBaseNode,
  parseCharaParamNode,
  parseFloatVar,
  parseIntVar,
  parseListVar,
  parseStringVar,
} from "./config-parser.js";
export {
  clearCache,
  findConfigFileAsync,
  fromHex,
  getAvailableLocales,
  LOCALES,
  loadCharaBase,
  loadCharaParam,
  loadCharaText,
  loadCharaTextRoma,
  loadConfig,
  loadJSON,
  sanitizeText,
  toHex,
} from "./data-loader.js";
// Error handling
export {
  InagleError,
  InagleErrorCode,
  type InagleErrorCodeType,
  type InagleErrorDetails,
  inagleLogger,
  isInagleError,
  wrapError,
} from "./errors.js";
export * from "./hash.js";

export * from "./images.js";
export * from "./openapi.js";
export * from "./parser.js";
// New architecture - explicit exports to avoid conflicts
export { DATA_ROOT, type DataFile, type DataPath, FILES, PATHS } from "./paths.js";
export * from "./search.js";

// Types with aliased names to avoid conflicts
export {
  type Basara as GameBasara,
  type BasaraBuild as GameBasaraBuild,
  type Character,
  type Character as GameCharacter,
  type CharacterStats as GameCharacterStats,
  type CharaParamRaw,
  type DataManifest,
  ElementId,
  ElementNames,
  type HeroVariants as GameHeroVariants,
  type Item as GameItem,
  type LocalizedNames as GameLocalizedNames,
  type MultiLevelStats,
  PositionId,
  PositionNames,
  RarityId,
  RarityNames,
  type RomanizedName,
  type Skill as GameSkill,
  type Team as GameTeam,
} from "./types.js";

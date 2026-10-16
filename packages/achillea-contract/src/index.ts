/**
 * @rosegriffon/achillea-contract — Export du contrat Achilléa hors TypeScript.
 *
 * Lit les sources de `@rosegriffon/achillea-types` et produit :
 * - `achillea.schema.json` — JSON Schema 2020-12, pivot vers tout générateur ;
 * - `achillea.rs` — structs/enums serde, pour un client de jeu Rust ;
 * - `Achillea.swift` — `Codable`, pour une app iOS ;
 * - `Achillea.kt` — `kotlinx.serialization`, pour une app Android.
 *
 * C'est ce qui fait du contrat une vraie frontière : le jour où l'on quitte
 * TypeScript, on ne réécrit pas les 159 formes du domaine à la main.
 */

export { extractContract, ContractExtractionError } from "./extract";
export type { ExtractOptions } from "./extract";

export { emitJsonSchema, resolveFields } from "./emit-json-schema";
export type { JsonSchemaDocument } from "./emit-json-schema";

export { emitRust } from "./emit-rust";
export { emitSwift } from "./emit-swift";
export { emitKotlin } from "./emit-kotlin";

export * from "./ir";
export * from "./naming";
export { CONTRACT_TARGETS, generateContract } from "./generate";
export type { ContractTarget, GenerateResult } from "./generate";

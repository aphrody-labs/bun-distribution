/**
 * Orchestration : extraction puis émission de toutes les cibles.
 *
 * Volontairement séparé de la CLI pour être testable sans toucher au disque.
 */

import { emitJsonSchema } from "./emit-json-schema";
import { emitKotlin } from "./emit-kotlin";
import { emitRust } from "./emit-rust";
import { emitSwift } from "./emit-swift";
import { extractContract, type ExtractOptions } from "./extract";
import type { IrContract } from "./ir";

export interface ContractTarget {
  /** Nom de fichier produit dans `generated/`. */
  file: string;
  language: string;
  render: (contract: IrContract) => string;
}

export const CONTRACT_TARGETS: readonly ContractTarget[] = [
  {
    file: "achillea.schema.json",
    language: "JSON Schema 2020-12",
    render: contract => `${JSON.stringify(emitJsonSchema(contract), null, "\t")}\n`,
  },
  { file: "achillea.rs", language: "Rust (serde)", render: emitRust },
  { file: "Achillea.swift", language: "Swift (Codable)", render: emitSwift },
  { file: "Achillea.kt", language: "Kotlin (kotlinx.serialization)", render: emitKotlin },
];

export interface GenerateResult {
  contract: IrContract;
  files: Array<{ file: string; language: string; content: string }>;
}

export function generateContract(options: ExtractOptions): GenerateResult {
  const contract = extractContract(options);
  return {
    contract,
    files: CONTRACT_TARGETS.map(target => ({
      file: target.file,
      language: target.language,
      content: target.render(contract),
    })),
  };
}

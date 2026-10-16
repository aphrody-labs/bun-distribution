// SPDX-License-Identifier: Apache-2.0
/**
 * transforms/fields.ts — transform DÉDIÉ champs : TextField / Select / NativeSelect.
 *
 * Conforme à 00-CONVENTIONS.md §3 (TextField/Select variant-dépendants) et §4
 * (controlled : onChange(e,val) -> e.target.value) :
 *   TextField variant="filled"|absent -> MdFilledTextField
 *   TextField variant="outlined"       -> MdOutlinedTextField
 *   Select    filled/outlined          -> MdFilledSelect / MdOutlinedSelect
 * Inclut MenuItem -> MdMenuItem pour le contenu des Select (cf. §3).
 * Pose un MIGRATION-TODO quand onChange a une signature (e, value).
 *
 * Usage :
 *   bun scripts/codemod.ts fields <fichiers...>
 */
import { runEngine, type FileInfo, type Options } from "../lib/engine";

export default function transformer(
  file: FileInfo,
  api?: unknown,
  options: Options = {},
): string {
  return runEngine(file, api, {
    ...options,
    only: new Set(["TextField", "Select", "NativeSelect", "MenuItem"]),
  });
}

export const parser = "tsx";

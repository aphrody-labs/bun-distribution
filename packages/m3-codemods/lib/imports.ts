// SPDX-License-Identifier: Apache-2.0
/**
 * lib/imports.ts — réécriture des déclarations d'import sur le modèle de `lib/tsx-scan.ts`.
 */
import type { Edits } from "./edits";
import type { ImportDecl, ImportSpec, ScanResult } from "./tsx-scan";

/** Garde les spécificateurs acceptés ; supprime la déclaration quand il n'en reste aucun. */
export function filterSpecifiers(
  edits: Edits,
  decl: ImportDecl,
  keep: (spec: ImportSpec) => boolean,
): void {
  const kept = decl.specifiers.filter(keep);
  if (kept.length === decl.specifiers.length) return;
  if (kept.length === 0) {
    const src = edits.src;
    let end = decl.end;
    const eol = /^[ \t]*\r?\n/.exec(src.slice(end));
    if (eol) end += eol[0].length;
    edits.replace(decl.start, end, "");
    return;
  }
  const head = kept.filter((s) => s.kind !== "named").map((s) => s.text);
  const named = kept.filter((s) => s.kind === "named").map((s) => s.text);
  const clause = [
    ...head,
    ...(named.length > 0 ? [`{ ${named.join(", ")} }`] : []),
  ].join(", ");
  const q = decl.quote;
  edits.replace(
    decl.start,
    decl.end,
    `import ${decl.typeOnly ? "type " : ""}${clause} from ${q}${decl.source}${q};`,
  );
}

/** Import d'effet de bord de `md-icon`, avec sa justification oxlint. */
export const MD_ICON_SIDE_EFFECT = "@aphrody/material-web/icon/icon.js";
export const MD_ICON_IMPORT =
  "// oxlint-disable-next-line import/no-unassigned-import -- Registers md-icon used by the migrated JSX.\n" +
  `import "${MD_ICON_SIDE_EFFECT}";\n`;

/**
 * Insère des déclarations en tête de programme, APRÈS le prologue de directives (`"use client"`
 * doit rester en tête pour rester une directive). `blocks` sont des statements complets terminés
 * par `\n` ; un bloc multi-ligne est séparé du suivant par une ligne vide.
 */
export function insertImports(
  edits: Edits,
  scan: ScanResult,
  blocks: string[],
): void {
  if (blocks.length === 0) return;
  let text = "";
  blocks.forEach((block, i) => {
    text += block;
    const last = i === blocks.length - 1;
    if (block.trimEnd().includes("\n") && (!last || scan.directivesEnd > 0))
      text += "\n";
  });
  if (scan.directivesEnd === 0) edits.insert(0, text);
  else edits.insert(scan.directivesEnd, `\n${text.replace(/\n$/, "")}`);
}

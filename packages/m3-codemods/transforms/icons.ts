// SPDX-License-Identifier: Apache-2.0
/**
 * transforms/icons.ts — codemod DÉDIÉ aux icônes : @mui/icons-material -> md-icon.
 *
 * Transforme :
 *   import CloseIcon from '@mui/icons-material/Close';
 *   import { Delete, EmojiEvents } from '@mui/icons-material';
 *   ...
 *   <CloseIcon fontSize="small" />   ->   <md-icon>close</md-icon>
 *   <Delete />                       ->   <md-icon>delete</md-icon>
 *
 * Stratégie (cf. lib/icon-names.ts) :
 *   - glyphe Material Symbols valide -> <md-icon>glyph</md-icon> + import d'effet
 *     de bord '@aphrody/material-web/icon/icon.js'.
 *   - logo de marque (GitHub, X…) absent de Material Symbols -> ÉLÉMENT INCHANGÉ
 *     + MIGRATION-TODO (garder l'icône en SVG / set de marque dédié).
 *   - conversion non validée -> élément inchangé + MIGRATION-TODO (avec le snake
 *     case deviné pour aider).
 *
 * Idempotent. Les props MUI de l'icône (fontSize, color, sx…) sont retirées avec
 * un TODO si non triviales (fontSize -> --md-icon-size, color -> currentColor).
 *
 * Usage :
 *   bun scripts/codemod.ts icons 'src/**\/*.tsx'
 * (à lancer APRÈS l'orchestrateur, ou seul pour ne migrer que les icônes.)
 */
import { assertTsx, Edits } from "../lib/edits";
import type { FileInfo, Options } from "../lib/engine";
import { resolveMuiIcon } from "../lib/icon-names";
import {
  filterSpecifiers,
  insertImports,
  MD_ICON_IMPORT,
  MD_ICON_SIDE_EFFECT,
} from "../lib/imports";
import { JsxChildren, jsxName, MigrationTodos } from "../lib/jsx-helpers";
import { scanTsx, type ImportDecl } from "../lib/tsx-scan";

const MUI_ICONS_PKG = "@mui/icons-material";

export const parser = "tsx";

export default function transformer(file: FileInfo, _api?: unknown, _options?: Options): string {
  const src = file.source;
  assertTsx(src, file.path ?? "source");
  const scan = scanTsx(src);

  // 1) Collecte : localName JSX -> nom d'icône MUI canonique.
  const bindings = new Map<string, string>();
  const importsToClean: ImportDecl[] = [];

  for (const decl of scan.imports) {
    if (decl.source === MUI_ICONS_PKG) {
      // import { Close, Delete as Trash } from '@mui/icons-material'
      for (const spec of decl.specifiers) {
        if (spec.kind === "named") bindings.set(spec.local, spec.imported);
      }
      importsToClean.push(decl);
    } else if (decl.source.startsWith(MUI_ICONS_PKG + "/")) {
      // import CloseIcon from '@mui/icons-material/Close'
      const iconName = decl.source.slice(MUI_ICONS_PKG.length + 1).split("/")[0]!;
      for (const spec of decl.specifiers) {
        if (spec.kind === "default") bindings.set(spec.local, iconName);
      }
      importsToClean.push(decl);
    }
  }

  if (bindings.size === 0) return src;

  const edits = new Edits(src);
  const todos = new MigrationTodos();

  // 2) Réécriture des usages JSX.
  let needSideEffect = false;
  const usedLocals = new Set<string>();
  const keptLocals = new Set<string>(); // brand/unknown -> on garde l'import

  for (const node of scan.nodes) {
    const local = jsxName(node);
    if (!local) continue;
    const muiName = bindings.get(local);
    if (!muiName) continue;

    usedLocals.add(local);
    const res = resolveMuiIcon(muiName);

    if (res.kind === "symbol" && res.glyph) {
      // <md-icon>glyph</md-icon> : l'élément entier est remplacé (attributs et enfants compris).
      edits.replace(node.start, node.end, `<md-icon>${res.glyph}</md-icon>`);
      needSideEffect = true;
      if (node.attrs.length > 0) {
        todos.add(
          node,
          `icone ${muiName}: props MUI (fontSize/color/sx) retirees -> piloter via --md-icon-size / --md-icon-fill / currentColor.`,
        );
      }
    } else if (res.kind === "brand") {
      keptLocals.add(local);
      todos.add(
        node,
        `icone ${muiName}: logo de marque absent de Material Symbols -> garder en SVG (set de marque dedie). Slug suggere: ${res.guess}.`,
      );
    } else {
      keptLocals.add(local);
      todos.add(
        node,
        `icone ${muiName}: nom Material Symbols non valide (devine: "${res.guess}") -> verifier sur fonts.google.com/icons puis <md-icon>nom</md-icon>.`,
      );
    }
  }

  const children = new JsxChildren();
  todos.flush(edits, children);
  children.flush(edits);

  // 3) Nettoyage des imports : retirer les specifiers d'icônes effectivement
  //    converties (symbol) ; conserver ceux gardés (brand/unknown) ou inutilisés.
  for (const decl of importsToClean) {
    filterSpecifiers(
      edits,
      decl,
      (spec) => !usedLocals.has(spec.local) || keptLocals.has(spec.local),
    );
  }

  // 4) Import d'effet de bord md-icon (après le prologue de directives).
  const alreadyImported = scan.imports.some((d) => d.source === MD_ICON_SIDE_EFFECT);
  if (needSideEffect && !alreadyImported) insertImports(edits, scan, [MD_ICON_IMPORT]);

  return edits.render();
}

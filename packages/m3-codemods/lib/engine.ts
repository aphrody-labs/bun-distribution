// SPDX-License-Identifier: Apache-2.0
/**
 * lib/engine.ts — moteur de transformation partagé.
 *
 * Conforme à 00-CONVENTIONS.md §2/§3/§4. Implémente, en un seul passage :
 *  1. collecte des local-names MUI importés (nommés, default, alias) depuis
 *     `@mui/material` et `@mui/material/<Composant>`.
 *  2. réécriture des éléments JSX -> wrappers `@aphrody/m3-react` (variant-aware
 *     pour Button/TextField/Select).
 *  3. réécriture des props (startIcon/endIcon -> slots, onChange (e,val), sx,
 *     props sans équivalent) avec marqueurs MIGRATION-TODO.
 *  4. réécriture/insertion des imports vers `@aphrody/m3-react`.
 *
 * Le source est lu par `lib/tsx-scan.ts` (validé par `Bun.Transpiler`) et modifié par éditions de
 * texte positionnées : tout ce qui n'est pas transformé reste octet pour octet.
 *
 * Les transforms de `transforms/` ne font que paramétrer ce moteur (quels
 * composants traiter) pour rester focalisés (Button, champs, imports, orchestrateur).
 * Leur signature `(file, api, options)` reste celle d'un transform jscodeshift.
 */
import { assertTsx, Edits } from "./edits";
import { filterSpecifiers, insertImports, MD_ICON_IMPORT } from "./imports";
import {
  attrStringValue,
  findAttr,
  jsxName,
  JsxChildren,
  MigrationTodos,
  onChangeUsesSecondArg,
  removeAttr,
  renameElement,
  slotAttr,
} from "./jsx-helpers";
import {
  GAP_COMPONENTS,
  LAYOUT_COMPONENTS,
  M3_PKG,
  MUI_PKGS,
  PROP_DROP_WITH_TODO,
  RENAME_CHILDREN,
  SIMPLE_COMPONENTS,
  SLOTTED_CHILDREN,
  VARIANT_COMPONENTS,
} from "./mapping";
import { scanTsx, type ImportDecl, type JsxNode } from "./tsx-scan";

/** Fichier passé à un transform (forme jscodeshift). */
export interface FileInfo {
  path?: string;
  source: string;
}

export type Options = Record<string, unknown>;

export interface EngineOptions {
  /** Limite le traitement à ce sous-ensemble de composants MUI (par leur nom MUI). */
  only?: Set<string>;
}

/** Info sur un import MUI repéré : localName (tel qu'utilisé) -> composant MUI canonique. */
type MuiBindings = Map<string, string>;

/** true si la source d'import est MUI (package racine ou sous-chemin). */
function isMuiSource(src: string): { mui: boolean; subComponent?: string } {
  for (const pkg of MUI_PKGS) {
    if (src === pkg) return { mui: true };
    if (src.startsWith(pkg + "/")) {
      const rest = src.slice(pkg.length + 1);
      // @mui/material/Button -> "Button" ; @mui/material/styles -> ignore
      const seg = rest.split("/")[0]!;
      if (/^[A-Z]/.test(seg)) return { mui: true, subComponent: seg };
    }
  }
  return { mui: false };
}

/** Résout le wrapper cible pour un composant MUI donné + son élément JSX. */
function resolveWrapper(
  src: string,
  muiComp: string,
  node: JsxNode,
): {
  kind: "wrapper" | "layout" | "gap" | "unknown";
  name?: string;
  note?: string;
} {
  const vm = VARIANT_COMPONENTS[muiComp];
  if (vm) {
    const a = findAttr(node, vm.prop);
    const variant = a ? attrStringValue(src, a) : null;
    const name = (variant && vm.byValue[variant]) || vm.default;
    return { kind: "wrapper", name };
  }
  if (SIMPLE_COMPONENTS[muiComp])
    return { kind: "wrapper", name: SIMPLE_COMPONENTS[muiComp] };
  if (RENAME_CHILDREN[muiComp])
    return { kind: "wrapper", name: RENAME_CHILDREN[muiComp] };
  const layout = LAYOUT_COMPONENTS[muiComp];
  if (layout) {
    return layout.startsWith("Md")
      ? { kind: "wrapper", name: layout }
      : { kind: "layout", name: layout };
  }
  const slotted = SLOTTED_CHILDREN[muiComp];
  if (slotted)
    return { kind: "layout", name: slotted.replaceWith, note: muiComp };
  if (GAP_COMPONENTS[muiComp])
    return { kind: "gap", note: GAP_COMPONENTS[muiComp] };
  return { kind: "unknown" };
}

/** État d'une passe du moteur. */
interface Pass {
  src: string;
  edits: Edits;
  todos: MigrationTodos;
  /** Expressions d'icône (positions dans le source) posées en `<md-icon slot="icon">` en tête des enfants. */
  addedIcons: Map<JsxNode, { start: number; end: number }[]>;
}

/**
 * Traite les props d'un élément JSX selon §4 : retire les props consommées et ajoute en tête des
 * enfants les `<md-icon slot="icon">` de startIcon/endIcon.
 */
function transformProps(pass: Pass, node: JsxNode): void {
  const { src, edits, todos } = pass;

  // startIcon / endIcon -> <md-icon slot="icon"> (§4 Icônes). md-button n'a qu'un slot "icon".
  for (const prop of ["startIcon", "endIcon"] as const) {
    const a = findAttr(node, prop);
    if (!a) continue;
    const v = a.value;
    removeAttr(edits, node, prop);
    if (v && v.kind === "expr" && !v.empty) {
      const added = pass.addedIcons.get(node) ?? [];
      // Chaque icône passe en tête (la dernière traitée devient la première).
      added.unshift({ start: v.exprStart, end: v.exprEnd });
      pass.addedIcons.set(node, added);
    }
    if (prop === "endIcon") {
      todos.add(
        node,
        'endIcon -> md-button n-a qu-un slot "icon" : repositionner manuellement (slot trailing).',
      );
    }
  }

  // onChange (e, value) -> e.target.value (§4 controlled). On pose un TODO si 2e arg.
  const onChange = findAttr(node, "onChange");
  if (onChange && onChangeUsesSecondArg(src, onChange)) {
    todos.add(
      node,
      "onChange(e, value) MUI -> material-web emet (input/change) natifs : lire e.target.value (le 2e parametre disparait).",
    );
  }

  // sx + props sans equivalent -> retirer + TODO (§4 sx/className).
  for (const prop of PROP_DROP_WITH_TODO) {
    if (!findAttr(node, prop)) continue;
    if (prop === "sx") {
      todos.add(
        node,
        "prop `sx` retiree : convertir en classes Tailwind (host/layout) + tokens --md-sys-* (le shadow DOM n-est pas atteignable par Tailwind, cf. §6).",
      );
    } else {
      todos.add(
        node,
        `prop \`${prop}\` retiree : pas d-equivalent direct md (gerer via tokens/density/theme).`,
      );
    }
    removeAttr(edits, node, prop);
  }
}

/** `<md-icon slot="icon">{…}</md-icon>` par expression, avec les transformations faites à l'intérieur. */
function iconChildren(
  pass: Pass,
  icons: { start: number; end: number }[],
): string {
  return icons
    .map(
      (r) =>
        `<md-icon slot="icon">{${pass.edits.render(r.start, r.end)}}</md-icon>`,
    )
    .join("");
}

/** L'élément a un enfant direct `<md-icon>` (ajouté ou déjà présent) : import d'effet de bord requis. */
function hasMdIconChild(pass: Pass, node: JsxNode): boolean {
  if ((pass.addedIcons.get(node)?.length ?? 0) > 0) return true;
  return node.children.some(
    (c) => c.kind === "element" && jsxName(c) === "md-icon",
  );
}

/** Point d'entree du moteur, appele par chaque transform. */
export function runEngine(
  file: FileInfo,
  _api: unknown,
  options: Options & EngineOptions,
): string {
  const src = file.source;
  assertTsx(src, file.path ?? "source");
  const scan = scanTsx(src);
  const only = options.only;

  // 1) Collecte des bindings MUI (nommes, default, alias).
  //    On NE supprime PAS encore les imports : seuls les composants
  //    EFFECTIVEMENT migrés (pas les gaps qui restent en JSX) verront leur
  //    specifier retiré en fin de passe -> évite les références orphelines.
  const bindings: MuiBindings = new Map();
  const muiImports: ImportDecl[] = [];

  for (const decl of scan.imports) {
    const { mui, subComponent } = isMuiSource(decl.source);
    if (!mui) continue;
    let touched = false;
    for (const spec of decl.specifiers) {
      if (spec.kind === "named") {
        // import { Button as B } from '@mui/material'
        if (!only || only.has(spec.imported)) {
          bindings.set(spec.local, spec.imported);
          touched = true;
        }
      } else if (spec.kind === "default" && subComponent) {
        // import Button from '@mui/material/Button'
        if (!only || only.has(subComponent)) {
          bindings.set(spec.local, subComponent);
          touched = true;
        }
      }
    }
    if (touched) muiImports.push(decl);
  }

  if (bindings.size === 0) return src; // rien à faire

  const pass: Pass = {
    src,
    edits: new Edits(src),
    todos: new MigrationTodos(),
    addedIcons: new Map(),
  };
  const { edits, todos } = pass;

  // local-names réellement migrés (à retirer des imports MUI en fin de passe).
  const migratedLocals = new Set<string>();
  const migratedNodes: JsxNode[] = [];

  // 2) Réécriture des éléments JSX.
  const neededImports = new Set<string>(); // wrappers @aphrody/m3-react à importer
  let needMdIconImport = false;

  for (const node of scan.nodes) {
    const name = jsxName(node);
    if (!name) continue;
    const muiComp = bindings.get(name);
    if (!muiComp) continue;

    const resolved = resolveWrapper(src, muiComp, node);

    if (resolved.kind === "gap" || resolved.kind === "unknown") {
      // gap/unknown : on NE transforme PAS et on GARDE l'import MUI (le JSX
      // reste référencé). Marqueur pour traitement manuel.
      if (resolved.kind === "gap") {
        todos.add(
          node,
          `${muiComp} : ${resolved.note}. Aucune transformation auto (cf. 05-gap-analysis.md).`,
        );
      }
      continue;
    }

    migratedLocals.add(name);
    migratedNodes.push(node);

    // variant-comp : retirer la prop variant (consommee par le wrapper).
    const vm = VARIANT_COMPONENTS[muiComp];
    if (vm) removeAttr(edits, node, vm.prop);

    // props communes (icons, onChange, sx...)
    transformProps(pass, node);

    renameElement(edits, node, resolved.name!);
    if (resolved.kind === "layout") {
      // composant layout MUI -> <div> (ou <div slot> pour slotted children)
      const slotRule = SLOTTED_CHILDREN[muiComp];
      if (slotRule) {
        edits.insert(node.nameEnd, ` ${slotAttr(slotRule.slot)}`);
        todos.add(
          node,
          `${muiComp} -> <div slot="${slotRule.slot}"> dans <${slotRule.parent}> : verifier l-imbrication (slot direct).`,
        );
      } else {
        todos.add(
          node,
          `${muiComp} (layout) -> <div> : reporter spacing/direction/grid sur des utilitaires Tailwind (cf. §6).`,
        );
      }
    } else {
      neededImports.add(resolved.name!);
    }
    if (hasMdIconChild(pass, node)) needMdIconImport = true;
  }

  // 2bis) Icônes slottées en tête des enfants, marqueurs MIGRATION-TODO, après la traversée.
  const children = new JsxChildren();
  for (const node of migratedNodes) children.touch(node);
  for (const [node, icons] of pass.addedIcons)
    children.prepend(node, () => iconChildren(pass, icons));
  todos.flush(edits, children);
  children.flush(edits);

  // 3) Nettoyage des imports MUI : retire SEULEMENT les specifiers migrés.
  //    Si un import n'a plus aucun specifier, on supprime la déclaration ;
  //    sinon on la conserve (ex : gap component encore référencé).
  for (const decl of muiImports)
    filterSpecifiers(edits, decl, (spec) => !migratedLocals.has(spec.local));

  // 4) Insertion de l'import @aphrody/m3-react (après le prologue de directives).
  const blocks: string[] = [];
  // md-icon est utilisé en custom-element brut : import d'effet de bord.
  if (needMdIconImport) blocks.push(MD_ICON_IMPORT);
  if (neededImports.size > 0) {
    // oxlint-disable-next-line unicorn/no-array-sort -- Sort a fresh copy while retaining the codemod's ES2022 API contract.
    const specs = [...neededImports].sort();
    blocks.push(`import { ${specs.join(", ")} } from "${M3_PKG}";\n`);
  }
  insertImports(edits, scan, blocks);

  return edits.render();
}

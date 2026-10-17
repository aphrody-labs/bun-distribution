// SPDX-License-Identifier: Apache-2.0
/**
 * lib/jsx-helpers.ts — utilitaires JSX partagés par les transforms (sur le modèle de `lib/tsx-scan.ts`).
 *
 * Conforme à 00-CONVENTIONS.md §4 (props/events/slots). Aucune dépendance runtime.
 */
import type { Edits } from "./edits";
import type { JsxAttr, JsxNode } from "./tsx-scan";

export { jsxName } from "./tsx-scan";

/** Valeur chaîne littérale d'un attribut JSX (`variant="outlined"` ou `variant={"outlined"}`). */
export function attrStringValue(src: string, attr: JsxAttr): string | null {
  const v = attr.value;
  if (!v) return null; // attribut booléen (ex: disabled)
  if (v.kind === "string") return v.text;
  if (v.kind === "expr") {
    const m = /^\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1\s*$/.exec(src.slice(v.exprStart, v.exprEnd));
    if (m) return m[2]!.replace(/\\(.)/g, "$1");
  }
  return null;
}

/** Premier attribut JSX (non spread) de ce nom. */
export function findAttr(node: JsxNode, name: string): JsxAttr | null {
  return node.attrs.find(a => !a.spread && a.name === name) ?? null;
}

/** Retire tous les attributs de ce nom (espaces qui les précèdent compris). Retourne true si retiré. */
export function removeAttr(edits: Edits, node: JsxNode, name: string): boolean {
  let removed = false;
  node.attrs.forEach((attr, index) => {
    if (attr.spread || attr.name !== name) return;
    const from = index === 0 ? node.nameEnd : node.attrs[index - 1]!.end;
    edits.replace(from, attr.end, "");
    removed = true;
  });
  return removed;
}

/** Renomme l'élément JSX (balises ouvrante et fermante). */
export function renameElement(edits: Edits, node: JsxNode, newName: string): void {
  edits.replace(node.nameStart, node.nameEnd, newName);
  if (node.closeNameStart >= 0) edits.replace(node.closeNameStart, node.closeNameEnd, newName);
}

/**
 * `onChange={(e, value) => …}` ou `function (e, value) {…}` : le handler lit un 2e paramètre
 * (material-web émet des événements natifs, la valeur se lit sur `e.target.value`, cf. §4).
 */
export function onChangeUsesSecondArg(src: string, attr: JsxAttr): boolean {
  const v = attr.value;
  if (!v || v.kind !== "expr") return false;
  let text = src.slice(v.exprStart, v.exprEnd).trim();
  text = text.replace(/^async\s+/, "");
  let params: string | null = null;
  if (/^function\b/.test(text)) {
    const open = text.indexOf("(");
    if (open !== -1) params = balanced(text, open);
  } else if (text.startsWith("(")) {
    const inner = balanced(text, 0);
    if (inner !== null && /^\s*(?::[^=]*)?=>/.test(text.slice(inner.length + 2))) params = inner;
  }
  if (params === null) return false;
  return splitTopLevel(params).filter(p => p.trim()).length >= 2;
}

/** Contenu entre la parenthèse ouvrante à `open` et sa fermante, ou null. */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const close = text.indexOf(c, i + 1);
      if (close === -1) return null;
      i = close;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || (c === ">" && text[i - 1] !== "=")) depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/**
 * Marqueurs MIGRATION-TODO pour le non-automatisable.
 *
 * Un commentaire brut entre enfants JSX est invalide : un élément enfant direct d'un élément ou
 * d'un fragment reçoit un sibling `{/* MIGRATION-TODO … *\/}` juste avant lui ; ailleurs (racine
 * d'un `return`, opérande, valeur d'attribut) le marqueur est un commentaire de tête `/* … *\/`.
 * Idempotent : un même message n'est posé qu'une fois par élément, et pas s'il le précède déjà
 * (seconde passe sur un fichier déjà migré).
 */
export class MigrationTodos {
  private readonly byNode = new Map<JsxNode, string[]>();

  add(node: JsxNode, message: string): void {
    const text = ` MIGRATION-TODO: ${message} `;
    const list = this.byNode.get(node) ?? [];
    if (!list.includes(text)) list.push(text);
    this.byNode.set(node, list);
  }

  /** Enregistre les insertions ; à appeler une fois toutes les transformations collectées. */
  flush(edits: Edits, children: JsxChildren): void {
    for (const [node, all] of this.byNode) {
      const present = markersBefore(edits.src, node);
      const texts = all.filter(t => !present.has(t));
      if (texts.length === 0) continue;
      if (node.parent) children.insertBefore(node, texts.map(t => `{/*${t}*/}`).join(""));
      else {
        // Parenthèses (ou accolades pour une valeur d'attribut) : le saut de ligne après le
        // commentaire ne doit pas couper un `return` par insertion automatique de `;`.
        const [open, close] = node.attrValue ? ["{", "}"] : ["(", ")"];
        edits.insert(node.start, open + texts.map(t => `/*${t}*/\n`).join(""));
        edits.insert(node.end, close);
      }
    }
    this.byNode.clear();
  }
}

/**
 * Textes des commentaires qui précèdent immédiatement `node` : conteneurs `{/* … *\/}` des enfants
 * frères qui le précèdent, ou commentaires de tête (parenthèse ou accolade ouvrante comprise).
 */
function markersBefore(src: string, node: JsxNode): Set<string> {
  const found = new Set<string>();
  let i = node.start;
  for (;;) {
    while (i > 0 && /[\s({]/.test(src[i - 1]!)) {
      if (src[i - 1] === "{" && !node.parent) break;
      i--;
    }
    if (src.slice(i - 2, i) === "*/") {
      const open = src.lastIndexOf("/*", i - 2);
      if (open === -1) break;
      found.add(src.slice(open + 2, i - 2));
      i = open;
      continue;
    }
    if (node.parent && src[i - 1] === "}") {
      // `{/* … */}` : on repart avant l'accolade fermante.
      const end = i - 1;
      if (src.slice(end - 2, end) !== "*/") break;
      i = end;
      continue;
    }
    break;
  }
  return found;
}

/**
 * Enfants JSX insérés (marqueurs, `<md-icon>` slottés). Un élément dont la liste d'enfants change
 * est réimprimé : enfants concaténés, et les blancs de texte qui contiennent un saut de ligne
 * (sans effet en JSX) retirés, comme le fait recast ; les espaces significatifs restent.
 */
export class JsxChildren {
  private readonly prefix = new Map<JsxNode, (() => string)[]>();
  private readonly before = new Map<JsxNode, string>();
  private readonly parents = new Set<JsxNode>();

  /** Ajoute du JSX en tête des enfants de `node`. */
  prepend(node: JsxNode, text: () => string): void {
    const list = this.prefix.get(node) ?? [];
    list.push(text);
    this.prefix.set(node, list);
    this.parents.add(node);
  }

  /** Réimprime les enfants de `node` sans rien ajouter (élément renommé, réimprimé par recast). */
  touch(node: JsxNode): void {
    this.parents.add(node);
  }

  /** Ajoute du JSX juste avant `child`, enfant direct d'un élément ou d'un fragment. */
  insertBefore(child: JsxNode, text: string): void {
    this.before.set(child, (this.before.get(child) ?? "") + text);
    this.parents.add(child.parent!);
  }

  flush(edits: Edits): void {
    for (const parent of this.parents) {
      // Un élément auto-fermant n'a pas d'enfants à imprimer (recast perd aussi ces ajouts).
      if (parent.selfClosing || parent.closeStart < 0) continue;
      edits.replace(parent.openEnd, parent.closeStart, () => {
        let out = (this.prefix.get(parent) ?? []).map(f => f()).join("");
        for (const child of parent.children) {
          if (child.kind === "text") {
            out += jsxText(edits.src.slice(child.start, child.end));
            continue;
          }
          if (child.kind !== "expr") out += this.before.get(child) ?? "";
          out += edits.render(child.start, child.end);
        }
        return out;
      });
    }
  }
}

/** Texte JSX sans ses blancs de bord qui contiennent un saut de ligne. */
function jsxText(text: string): string {
  if (!/\S/.test(text)) return /\n/.test(text) ? "\n" : text;
  return text.replace(/^\s*\n\s*/, "").replace(/\s*\n\s*$/, "");
}

/** `slot="…"` */
export function slotAttr(slot: string): string {
  return `slot="${slot}"`;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * lib/tsx-scan.ts — lecture TSX pour les codemods : déclarations d'import de premier niveau,
 * prologue de directives et arbre des éléments JSX avec leurs positions.
 *
 * Ce n'est pas un parseur complet : il saute chaînes, gabarits, commentaires et regex, et ne
 * reconnaît `<` comme JSX qu'en position d'expression. La validité du source est vérifiée à part
 * par `Bun.Transpiler` (cf. `lib/edits.ts`). Les transformations sont des éditions de texte sur
 * ces positions : le reste du fichier est conservé octet pour octet.
 */

export interface JsxAttr {
  spread: boolean;
  /** Nom brut (`variant`, `aria-label`, `xlink:href`) ; absent pour un spread. */
  name?: string;
  start: number;
  end: number;
  value?: JsxAttrValue;
}

export type JsxAttrValue =
  | { kind: "string"; start: number; end: number; text: string }
  | {
      kind: "expr";
      start: number;
      end: number;
      exprStart: number;
      exprEnd: number;
      empty: boolean;
    }
  | { kind: "element"; start: number; end: number };

export type JsxChild =
  | { kind: "text"; start: number; end: number }
  | { kind: "expr"; start: number; end: number }
  | JsxNode;

export interface JsxNode {
  kind: "element" | "fragment";
  start: number;
  end: number;
  /** Nom brut de la balise ouvrante (`Button`, `Foo.Bar`, `md-icon`) ; "" pour un fragment. */
  rawName: string;
  nameStart: number;
  nameEnd: number;
  attrs: JsxAttr[];
  selfClosing: boolean;
  /** Index juste après le `>` (ou `/>`) de la balise ouvrante. */
  openEnd: number;
  /** `<` de la balise fermante ; -1 si auto-fermant ou non fermé. */
  closeStart: number;
  closeNameStart: number;
  closeNameEnd: number;
  children: JsxChild[];
  /** Parent JSX quand l'élément est un enfant direct d'un élément ou d'un fragment. */
  parent: JsxNode | null;
  /** Valeur directe d'un attribut (`title=<b>x</b>`), sans conteneur `{}`. */
  attrValue?: boolean;
}

export interface ImportSpec {
  kind: "default" | "named" | "namespace";
  /** Nom importé (`Button` pour `Button as B`) ; `default`/`*` pour les autres formes. */
  imported: string;
  local: string;
  /** Texte brut du spécificateur (`type Foo`, `Button as B`). */
  text: string;
}

export interface ImportDecl {
  start: number;
  /** Fin du statement, `;` compris. */
  end: number;
  source: string;
  typeOnly: boolean;
  quote: string;
  specifiers: ImportSpec[];
}

export interface ScanResult {
  imports: ImportDecl[];
  /** Fin (exclusive) du dernier statement de directive (`"use client";`), 0 s'il n'y en a pas. */
  directivesEnd: number;
  /** Éléments et fragments JSX, en ordre de document (parcours préfixe). */
  nodes: JsxNode[];
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;
const OP_CHARS = "=+-*%&|^!~>?:";
const JSX_KEYWORDS = new Set([
  "return",
  "yield",
  "await",
  "default",
  "else",
  "case",
  "do",
  "in",
  "of",
  "typeof",
  "void",
  "delete",
  "throw",
]);
const REGEX_KEYWORDS = new Set([...JSX_KEYWORDS, "instanceof", "new"]);

type Prev =
  | { t: "start" }
  | { t: "punct"; v: string }
  | { t: "word"; v: string }
  | { t: "close"; v: string }
  | { t: "value" };

class Scanner {
  readonly nodes: JsxNode[] = [];
  readonly imports: ImportDecl[] = [];

  constructor(readonly src: string) {}

  /** Index after a `//` or `/* *\/` comment at `i`, or `i` when there is none. */
  comment(i: number): number {
    const s = this.src;
    if (s[i] !== "/") return i;
    if (s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      return nl === -1 ? s.length : nl;
    }
    if (s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      return end === -1 ? s.length : end + 2;
    }
    return i;
  }

  /** Skip whitespace and comments. */
  trivia(i: number): number {
    const s = this.src;
    for (;;) {
      while (i < s.length && /\s/.test(s[i]!)) i++;
      const c = this.comment(i);
      if (c === i) return i;
      i = c;
    }
  }

  string(i: number): number {
    const s = this.src;
    const q = s[i];
    let j = i + 1;
    while (j < s.length && s[j] !== q) {
      if (s[j] === "\\") j++;
      else if (s[j] === "\n") break;
      j++;
    }
    return j + 1;
  }

  template(i: number): number {
    const s = this.src;
    let j = i + 1;
    while (j < s.length) {
      const c = s[j];
      if (c === "\\") j += 2;
      else if (c === "`") return j + 1;
      else if (c === "$" && s[j + 1] === "{") j = this.code(j + 2, true) + 1;
      else j++;
    }
    return s.length;
  }

  regex(i: number): number {
    const s = this.src;
    let j = i + 1;
    let cls = false;
    while (j < s.length && s[j] !== "\n") {
      const c = s[j];
      if (c === "\\") j++;
      else if (c === "[") cls = true;
      else if (c === "]") cls = false;
      else if (c === "/" && !cls) break;
      j++;
    }
    j++;
    while (j < s.length && ID_PART.test(s[j]!)) j++;
    return j;
  }

  /**
   * Scan code from `i`. With `untilBrace`, stop at the `}` that closes the enclosing `{` and return
   * its index; otherwise scan to the end of the source.
   */
  code(i: number, untilBrace: boolean, topLevel = false): number {
    const s = this.src;
    let depth = 0;
    let prev: Prev = { t: "start" };
    while (i < s.length) {
      const c = s[i]!;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) {
        i = this.comment(i);
        continue;
      }
      if (c === '"' || c === "'") {
        i = this.string(i);
        prev = { t: "value" };
        continue;
      }
      if (c === "`") {
        i = this.template(i);
        prev = { t: "value" };
        continue;
      }
      if (c === "/") {
        if (regexAllowed(prev)) {
          i = this.regex(i);
          prev = { t: "value" };
        } else {
          i += s[i + 1] === "=" ? 2 : 1;
          prev = { t: "punct", v: "/" };
        }
        continue;
      }
      if (ID_START.test(c)) {
        let j = i + 1;
        while (j < s.length && ID_PART.test(s[j]!)) j++;
        const word = s.slice(i, j);
        if (topLevel && depth === 0 && word === "import" && statementStart(prev)) {
          const decl = parseImport(s, i);
          if (decl) {
            this.imports.push(decl);
            i = decl.end;
            prev = { t: "punct", v: ";" };
            continue;
          }
        }
        i = j;
        prev = { t: "word", v: word };
        continue;
      }
      if (/\d/.test(c) || (c === "." && /\d/.test(s[i + 1] ?? ""))) {
        let j = i + 1;
        while (j < s.length && /[\w.]/.test(s[j]!)) j++;
        i = j;
        prev = { t: "value" };
        continue;
      }
      if (c === "{") {
        depth++;
        i++;
        prev = { t: "punct", v: "{" };
        continue;
      }
      if (c === "}") {
        if (depth === 0 && untilBrace) return i;
        depth--;
        i++;
        prev = { t: "close", v: "}" };
        continue;
      }
      if (c === ")" || c === "]") {
        i++;
        prev = { t: "close", v: c };
        continue;
      }
      if (c === "<") {
        if (jsxAllowed(prev) && this.looksLikeJsx(i)) {
          i = this.jsx(i, null);
          prev = { t: "value" };
          continue;
        }
        i += s[i + 1] === "<" || s[i + 1] === "=" ? 2 : 1;
        prev = { t: "punct", v: "<" };
        continue;
      }
      if (OP_CHARS.includes(c)) {
        let j = i + 1;
        while (j < s.length && OP_CHARS.includes(s[j]!)) j++;
        prev = { t: "punct", v: s.slice(i, j) };
        i = j;
        continue;
      }
      prev = { t: "punct", v: c };
      i++;
    }
    return i;
  }

  /** `<` at `i` starts a JSX element or fragment (not a TS generic like `<T,>` or `<T extends U>`). */
  looksLikeJsx(i: number): boolean {
    const s = this.src;
    const n = s[i + 1] ?? "";
    if (n === ">") return true;
    if (!ID_START.test(n)) return false;
    let j = i + 2;
    while (j < s.length && /[\w$\-.:]/.test(s[j]!)) j++;
    const k = this.trivia(j);
    if (s[k] === ",") return false;
    if (/^extends\s/.test(s.slice(k, k + 8))) return false;
    return true;
  }

  /** Parse the JSX element or fragment at `i`; return the index after it. */
  jsx(i: number, parent: JsxNode | null): number {
    const s = this.src;
    const node: JsxNode = {
      kind: s[i + 1] === ">" ? "fragment" : "element",
      start: i,
      end: i,
      rawName: "",
      nameStart: i + 1,
      nameEnd: i + 1,
      attrs: [],
      selfClosing: false,
      openEnd: i + 1,
      closeStart: -1,
      closeNameStart: -1,
      closeNameEnd: -1,
      children: [],
      parent,
    };
    this.nodes.push(node);
    let j = i + 1;
    if (node.kind === "element") {
      j = this.trivia(j);
      node.nameStart = j;
      while (j < s.length && /[\w$\-.:]/.test(s[j]!)) j++;
      node.nameEnd = j;
      node.rawName = s.slice(node.nameStart, j);
      // Attributes.
      for (;;) {
        j = this.trivia(j);
        if (j >= s.length) {
          node.end = j;
          return j;
        }
        if (s[j] === "/" && s[j + 1] === ">") {
          node.selfClosing = true;
          node.openEnd = node.end = j + 2;
          return node.end;
        }
        if (s[j] === ">") {
          j++;
          break;
        }
        if (s[j] === "{") {
          const close = this.code(j + 1, true);
          node.attrs.push({ spread: true, start: j, end: close + 1 });
          j = close + 1;
          continue;
        }
        const start = j;
        while (j < s.length && /[\w$\-:]/.test(s[j]!)) j++;
        if (j === start) {
          // Unexpected character: give up on this tag.
          node.end = j + 1;
          return j + 1;
        }
        const attr: JsxAttr = {
          spread: false,
          name: s.slice(start, j),
          start,
          end: j,
        };
        const k = this.trivia(j);
        if (s[k] === "=") {
          const v = this.trivia(k + 1);
          if (s[v] === '"' || s[v] === "'") {
            const close = s.indexOf(s[v]!, v + 1);
            const end = close === -1 ? s.length : close + 1;
            attr.value = {
              kind: "string",
              start: v,
              end,
              text: s.slice(v + 1, end - 1),
            };
            j = end;
          } else if (s[v] === "{") {
            const close = this.code(v + 1, true);
            const inner = this.trivia(v + 1);
            attr.value = {
              kind: "expr",
              start: v,
              end: close + 1,
              exprStart: v + 1,
              exprEnd: close,
              empty: inner >= close,
            };
            j = close + 1;
          } else if (s[v] === "<") {
            const index = this.nodes.length;
            const end = this.jsx(v, null);
            this.nodes[index]!.attrValue = true;
            attr.value = { kind: "element", start: v, end };
            j = end;
          } else {
            j = v;
          }
          attr.end = j;
        }
        node.attrs.push(attr);
      }
    } else {
      j = i + 2;
    }
    node.openEnd = j;
    // Children.
    for (;;) {
      if (j >= s.length) {
        node.end = j;
        return j;
      }
      if (s[j] === "<" && s[this.trivia(j + 1)] === "/") {
        node.closeStart = j;
        let k = this.trivia(this.trivia(j + 1) + 1);
        node.closeNameStart = k;
        while (k < s.length && /[\w$\-.:]/.test(s[k]!)) k++;
        node.closeNameEnd = k;
        k = this.trivia(k);
        node.end = s[k] === ">" ? k + 1 : k;
        return node.end;
      }
      if (s[j] === "<") {
        const index = this.nodes.length;
        j = this.jsx(j, node);
        node.children.push(this.nodes[index]!);
        continue;
      }
      if (s[j] === "{") {
        const close = this.code(j + 1, true);
        node.children.push({ kind: "expr", start: j, end: close + 1 });
        j = close + 1;
        continue;
      }
      const start = j;
      while (j < s.length && s[j] !== "<" && s[j] !== "{") j++;
      node.children.push({ kind: "text", start, end: j });
    }
  }
}

function statementStart(prev: Prev): boolean {
  return prev.t === "start" || (prev.t === "punct" && prev.v === ";") || (prev.t === "close" && prev.v === "}");
}

function jsxAllowed(prev: Prev): boolean {
  switch (prev.t) {
    case "start":
      return true;
    case "word":
      return JSX_KEYWORDS.has(prev.v);
    case "close":
      return prev.v === "}";
    case "value":
      return false;
    case "punct":
      return prev.v === "=>" || !prev.v.endsWith(">");
  }
}

function regexAllowed(prev: Prev): boolean {
  switch (prev.t) {
    case "start":
      return true;
    case "word":
      return REGEX_KEYWORDS.has(prev.v);
    case "close":
    case "value":
      return false;
    case "punct":
      return true;
  }
}

const IMPORT_FROM = /^import\s+(type\s+)?([\s\S]*?)\s*\bfrom\s*(["'])([^"'\n]*)\3/;
const IMPORT_BARE = /^import\s*(["'])([^"'\n]*)\1/;

/** Parse the import declaration at `i` (`import` keyword), or null for `import(` / `import.meta`. */
function parseImport(s: string, i: number): ImportDecl | null {
  const after = s[i + 6] ?? "";
  if (after === "(" || after === ".") return null;
  const rest = s.slice(i, i + 4000);
  let m = IMPORT_BARE.exec(rest);
  let decl: ImportDecl;
  if (m) {
    decl = {
      start: i,
      end: i + m[0].length,
      source: m[2]!,
      typeOnly: false,
      quote: m[1]!,
      specifiers: [],
    };
  } else {
    m = IMPORT_FROM.exec(rest);
    if (!m) return null;
    decl = {
      start: i,
      end: i + m[0].length,
      source: m[4]!,
      typeOnly: Boolean(m[1]),
      quote: m[3]!,
      specifiers: parseClause(m[2]!),
    };
  }
  // Optional `;` on the same statement.
  let j = decl.end;
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  if (s[j] === ";") decl.end = j + 1;
  return decl;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function parseClause(clause: string): ImportSpec[] {
  const specs: ImportSpec[] = [];
  const text = stripComments(clause).trim();
  const brace = text.indexOf("{");
  const head = (brace === -1 ? text : text.slice(0, brace)).replace(/,\s*$/, "").trim();
  for (const part of head.split(",").map(p => p.trim())) {
    if (!part) continue;
    const ns = /^\*\s*as\s+([\w$]+)$/.exec(part);
    if (ns)
      specs.push({
        kind: "namespace",
        imported: "*",
        local: ns[1]!,
        text: part,
      });
    else
      specs.push({
        kind: "default",
        imported: "default",
        local: part,
        text: part,
      });
  }
  if (brace !== -1) {
    const body = text.slice(brace + 1, text.lastIndexOf("}"));
    for (const part of body.split(",").map(p => p.trim().replace(/\s+/g, " "))) {
      if (!part) continue;
      const m = /^(?:type )?(?:([\w$]+)|(["'])(.*)\2)(?: as ([\w$]+))?$/.exec(part);
      if (!m) continue;
      const imported = m[1] ?? m[3]!;
      specs.push({
        kind: "named",
        imported,
        local: m[4] ?? imported,
        text: part,
      });
    }
  }
  return specs;
}

/** End of the directive prologue (`"use client";` …) at the head of the program. */
function directives(scanner: Scanner): number {
  const s = scanner.src;
  let end = 0;
  let i = scanner.trivia(0);
  while (s[i] === '"' || s[i] === "'") {
    const close = scanner.string(i);
    let j = close;
    while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
    if (s[j] === ";") {
      end = j + 1;
    } else {
      const k = scanner.trivia(close);
      // A directive ends the statement: `;`, a line break (ASI) or the end of the source.
      if (k < s.length && !/\n/.test(s.slice(close, k))) break;
      end = close;
    }
    i = scanner.trivia(end);
  }
  return end;
}

export function scanTsx(src: string): ScanResult {
  const scanner = new Scanner(src);
  scanner.code(0, false, true);
  return {
    imports: scanner.imports,
    directivesEnd: directives(scanner),
    nodes: scanner.nodes,
  };
}

/** Name of a JSX element when it is a plain identifier (`Button`, `md-icon`), else null. */
export function jsxName(node: JsxNode): string | null {
  return node.kind === "element" && /^[A-Za-z_$][\w$-]*$/.test(node.rawName) ? node.rawName : null;
}

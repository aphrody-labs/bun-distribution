// SPDX-License-Identifier: Apache-2.0
/**
 * Bun-native Project Fluent (FTL 1.0 syntax): a parser and a resolver with plurals, numbers and
 * dates through Intl. The Rust side reads the same `.ftl` files with `fluent-bundle`, so the
 * catalogs are the one source for the native shell, the engine runtime and play.
 *
 * Supported: messages, terms, attributes, comments, multiline patterns with common-indent
 * stripping, string/number literals, variables, message/term references (with attributes and
 * term arguments), select expressions (numeric keys, CLDR plural categories, string keys) and
 * the NUMBER and DATETIME built-ins. Bidi isolation is off on both sides (Bevy text has no FSI).
 */

export type FluentValue = string | number | Date | FluentNumber | FluentDateTime;
export type FluentArgs = Record<string, FluentValue | null | undefined>;

export class FluentNumber {
  constructor(
    readonly value: number,
    readonly options: Intl.NumberFormatOptions & {
      type?: Intl.PluralRuleType;
    } = {},
  ) {}
}

export class FluentDateTime {
  constructor(
    readonly value: Date,
    readonly options: Intl.DateTimeFormatOptions = {},
  ) {}
}

type Expression =
  | { type: "str"; value: string }
  | { type: "num"; value: number; precision: number }
  | { type: "var"; name: string }
  | {
      type: "term";
      name: string;
      attr: string | null;
      named: Record<string, Literal>;
    }
  | { type: "mesg"; name: string; attr: string | null }
  | {
      type: "func";
      name: string;
      positional: Expression[];
      named: Record<string, Literal>;
    }
  | { type: "select"; selector: Expression; variants: Variant[]; star: number };
type Literal = { type: "str"; value: string } | { type: "num"; value: number; precision: number };
type Element = string | Expression;
export type Pattern = string | Element[];
interface Variant {
  key: Literal | { type: "name"; value: string };
  value: Pattern;
}

export interface FluentMessage {
  id: string;
  value: Pattern | null;
  attributes: Record<string, Pattern>;
}

export interface FluentParseError {
  line: number;
  message: string;
}

/** A parsed `.ftl` resource: messages, terms (ids start with `-`) and the junk it skipped. */
export class FluentResource {
  readonly entries = new Map<string, FluentMessage>();
  readonly errors: FluentParseError[] = [];

  constructor(source: string) {
    new Parser(source.replace(/\r\n?/g, "\n"), this).parse();
  }

  /** Message ids (no terms), in source order. */
  messageIds(): string[] {
    return [...this.entries.keys()].filter(id => !id.startsWith("-"));
  }
}

const IDENT = /[a-zA-Z][a-zA-Z0-9_-]*/y;
const ENTRY_START = /^-?[a-zA-Z][a-zA-Z0-9_-]*[ \t]*=/;

class Parser {
  private i = 0;
  constructor(
    private readonly s: string,
    private readonly out: FluentResource,
  ) {}

  private line(at = this.i): number {
    let n = 1;
    for (let k = 0; k < at; k++) if (this.s.charCodeAt(k) === 10) n++;
    return n;
  }

  private fail(message: string): never {
    throw Object.assign(new Error(message), { at: this.i });
  }

  parse(): void {
    const s = this.s;
    while (this.i < s.length) {
      const eol = s.indexOf("\n", this.i);
      const lineEnd = eol < 0 ? s.length : eol;
      const text = s.slice(this.i, lineEnd);
      if (text.trim() === "" || text.startsWith("#")) {
        this.i = lineEnd + 1;
        continue;
      }
      const start = this.i;
      if (ENTRY_START.test(text)) {
        try {
          this.entry();
          continue;
        } catch (error) {
          this.out.errors.push({
            line: this.line(start),
            message: (error as Error).message,
          });
        }
      } else {
        this.out.errors.push({
          line: this.line(start),
          message: `junk: ${text.slice(0, 40)}`,
        });
      }
      // Skip to the next line that can start an entry or a comment.
      this.i = lineEnd + 1;
      while (this.i < s.length) {
        const c = s[this.i];
        if (c && /[a-zA-Z#-]/.test(c)) break;
        const next = s.indexOf("\n", this.i);
        this.i = next < 0 ? s.length : next + 1;
      }
    }
  }

  private ident(): string {
    IDENT.lastIndex = this.i;
    const m = IDENT.exec(this.s);
    if (!m) this.fail("expected an identifier");
    this.i += m[0].length;
    return m[0];
  }

  private inlineBlank(): void {
    while (this.s[this.i] === " " || this.s[this.i] === "\t") this.i++;
  }

  private blank(): void {
    while (/[ \t\n]/.test(this.s[this.i] ?? "")) this.i++;
  }

  private expect(c: string): void {
    if (this.s[this.i] !== c) this.fail(`expected "${c}"`);
    this.i++;
  }

  private entry(): void {
    const term = this.s[this.i] === "-";
    if (term) this.i++;
    const id = (term ? "-" : "") + this.ident();
    this.inlineBlank();
    this.expect("=");
    const value = this.pattern();
    const attributes: Record<string, Pattern> = {};
    for (;;) {
      const save = this.i;
      // An attribute: newline, indentation, `.name =`.
      if (this.s[this.i] !== "\n") break;
      this.i++;
      while (this.s[this.i] === "\n") this.i++;
      const indented = this.s[this.i] === " " || this.s[this.i] === "\t";
      this.inlineBlank();
      if (!indented || this.s[this.i] !== ".") {
        this.i = save;
        break;
      }
      this.i++;
      const name = this.ident();
      this.inlineBlank();
      this.expect("=");
      const attr = this.pattern();
      if (attr === null) this.fail(`attribute .${name} has no value`);
      attributes[name] = attr;
    }
    if (value === null && Object.keys(attributes).length === 0) this.fail(`${id} has no value`);
    if (term && value === null) this.fail(`term ${id} has no value`);
    this.out.entries.set(id, { id, value, attributes });
    // Consume the rest of the line.
    const eol = this.s.indexOf("\n", this.i);
    this.i = eol < 0 ? this.s.length : eol + 1;
  }

  /** Is the line starting at `at` (after its newline) a continuation of the current pattern? */
  private continuation(at: number): { indent: number; start: number } | null {
    let k = at;
    // Blank lines may sit inside a pattern when an indented line follows.
    for (;;) {
      let j = k;
      while (this.s[j] === " ") j++;
      if (this.s[j] === "\n") {
        k = j + 1;
        continue;
      }
      if (j === k || j >= this.s.length) return null;
      const c = this.s[j];
      if (c === "." || c === "[" || c === "*" || c === "}") {
        // `[`, `*` and `.` start variants/attributes; a placeable may still start with `{`.
        return null;
      }
      return { indent: j - k, start: j };
    }
  }

  /** Parses a pattern after `=` or a variant key; returns null when empty. */
  private pattern(): Pattern | null {
    type Piece = Element | { indent: number };
    const pieces: Piece[] = [];
    this.inlineBlank();
    let text = "";
    const flush = () => {
      if (text) pieces.push(text);
      text = "";
    };
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) break;
      if (c === "\n") {
        const next = this.continuation(this.i + 1);
        if (!next) break;
        flush();
        pieces.push({ indent: next.indent });
        this.i = next.start;
        continue;
      }
      if (c === "{") {
        flush();
        pieces.push(this.placeable());
        continue;
      }
      if (c === "}") this.fail('unbalanced "}"');
      text += c;
      this.i++;
    }
    flush();
    // Common indent of the block lines, then join.
    const indents = pieces.filter((p): p is { indent: number } => typeof p === "object" && "indent" in p);
    const common = indents.length ? Math.min(...indents.map(p => p.indent)) : 0;
    const out: Element[] = [];
    let first = true;
    for (const p of pieces) {
      let piece: Element;
      if (typeof p === "object" && "indent" in p) {
        piece = (first ? "" : "\n") + " ".repeat(p.indent - common);
      } else piece = p;
      first = false;
      const last = out[out.length - 1];
      if (typeof piece === "string" && typeof last === "string") out[out.length - 1] = last + piece;
      else if (piece !== "") out.push(piece);
    }
    if (typeof out[0] === "string") out[0] = out[0].replace(/^[ \t]+/, "");
    const tail = out[out.length - 1];
    if (typeof tail === "string") {
      const trimmed = tail.replace(/[ \t\n]+$/, "");
      if (trimmed) out[out.length - 1] = trimmed;
      else out.pop();
    }
    if (out.length === 0) return null;
    if (out.length === 1 && typeof out[0] === "string") return out[0];
    return out;
  }

  private placeable(): Expression {
    this.expect("{");
    this.blank();
    const expression = this.inlineExpression();
    this.blank();
    if (this.s.startsWith("->", this.i)) {
      this.i += 2;
      const variants: Variant[] = [];
      let star = -1;
      this.inlineBlank();
      for (;;) {
        this.blank();
        let isDefault = false;
        if (this.s[this.i] === "*") {
          isDefault = true;
          this.i++;
        }
        if (this.s[this.i] !== "[") break;
        this.i++;
        this.blank();
        const key = this.variantKey();
        this.blank();
        this.expect("]");
        const value = this.pattern() ?? "";
        if (isDefault) star = variants.length;
        variants.push({ key, value });
      }
      if (variants.length === 0) this.fail("select expression without variants");
      if (star < 0) this.fail("select expression without a default (*) variant");
      this.blank();
      this.expect("}");
      return { type: "select", selector: expression, variants, star };
    }
    this.expect("}");
    return expression;
  }

  private variantKey(): Variant["key"] {
    const c = this.s[this.i] ?? "";
    if (/[-0-9]/.test(c)) return this.number();
    return { type: "name", value: this.ident() };
  }

  private number(): Literal {
    const m = /-?[0-9]+(?:\.([0-9]+))?/y;
    m.lastIndex = this.i;
    const r = m.exec(this.s);
    if (!r) this.fail("expected a number");
    this.i += r[0].length;
    return { type: "num", value: Number(r[0]), precision: r[1]?.length ?? 0 };
  }

  private stringLiteral(): Literal {
    this.expect('"');
    let value = "";
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined || c === "\n") this.fail("unterminated string literal");
      if (c === '"') break;
      if (c === "\\") {
        const e = this.s[this.i++];
        if (e === "\\" || e === '"') value += e;
        else if (e === "u" || e === "U") {
          const len = e === "u" ? 4 : 6;
          const hex = this.s.slice(this.i, this.i + len);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) this.fail("bad unicode escape");
          value += String.fromCodePoint(parseInt(hex, 16));
          this.i += len;
        } else this.fail(`unknown escape \\${e}`);
      } else value += c;
    }
    return { type: "str", value };
  }

  private callArgs(): {
    positional: Expression[];
    named: Record<string, Literal>;
  } {
    this.expect("(");
    const positional: Expression[] = [];
    const named: Record<string, Literal> = {};
    for (;;) {
      this.blank();
      if (this.s[this.i] === ")") {
        this.i++;
        break;
      }
      const save = this.i;
      IDENT.lastIndex = this.i;
      const m = IDENT.exec(this.s);
      let isNamed = false;
      if (m) {
        this.i += m[0].length;
        this.blank();
        if (this.s[this.i] === ":") {
          this.i++;
          this.blank();
          named[m[0]] = this.s[this.i] === '"' ? this.stringLiteral() : this.number();
          isNamed = true;
        } else this.i = save;
      }
      if (!isNamed) positional.push(this.inlineExpression());
      this.blank();
      if (this.s[this.i] === ",") this.i++;
      else if (this.s[this.i] !== ")") this.fail('expected "," or ")"');
    }
    return { positional, named };
  }

  private attrSuffix(): string | null {
    if (this.s[this.i] !== ".") return null;
    this.i++;
    return this.ident();
  }

  private inlineExpression(): Expression {
    const c = this.s[this.i] ?? "";
    if (c === '"') return this.stringLiteral();
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(this.s[this.i + 1] ?? ""))) return this.number();
    if (c === "$") {
      this.i++;
      return { type: "var", name: this.ident() };
    }
    if (c === "{") return this.placeable();
    if (c === "-") {
      this.i++;
      const name = this.ident();
      const attr = this.attrSuffix();
      let named: Record<string, Literal> = {};
      this.inlineBlank();
      if (this.s[this.i] === "(") named = this.callArgs().named;
      return { type: "term", name, attr, named };
    }
    const name = this.ident();
    if (this.s[this.i] === "(") {
      if (!/^[A-Z][A-Z0-9_-]*$/.test(name)) this.fail(`function names are upper case: ${name}`);
      const { positional, named } = this.callArgs();
      return { type: "func", name, positional, named };
    }
    return { type: "mesg", name, attr: this.attrSuffix() };
  }
}

export type FluentFunction = (positional: FluentValue[], named: Record<string, string | number>) => FluentValue;

export interface FormatError {
  id: string;
  message: string;
}

const MAX_DEPTH = 32;

/** A locale's resources plus the formatters for it; the Fluent `FluentBundle` analogue. */
export class FluentBundle {
  readonly locale: string;
  private readonly entries = new Map<string, FluentMessage>();
  private readonly functions: Record<string, FluentFunction>;
  private readonly plural = new Map<string, Intl.PluralRules>();

  constructor(locale: string, options: { functions?: Record<string, FluentFunction> } = {}) {
    this.locale = locale;
    this.functions = {
      NUMBER: (pos, named) => {
        const v = pos[0];
        const n = v instanceof FluentNumber ? v.value : Number(v);
        const base = v instanceof FluentNumber ? v.options : {};
        return new FluentNumber(n, {
          ...base,
          ...(named as Intl.NumberFormatOptions),
        });
      },
      DATETIME: (pos, named) => {
        const v = pos[0];
        const d = v instanceof FluentDateTime ? v.value : v instanceof Date ? v : new Date(String(v));
        const base = v instanceof FluentDateTime ? v.options : {};
        return new FluentDateTime(d, {
          ...base,
          ...(named as Intl.DateTimeFormatOptions),
        });
      },
      ...options.functions,
    };
  }

  /** Adds a resource; later resources override earlier ids (user and plugin overrides). */
  addResource(resource: FluentResource): void {
    for (const [id, entry] of resource.entries) this.entries.set(id, entry);
  }

  hasMessage(id: string): boolean {
    return !id.startsWith("-") && this.entries.has(id);
  }

  getMessage(id: string): FluentMessage | undefined {
    return id.startsWith("-") ? undefined : this.entries.get(id);
  }

  messageIds(): string[] {
    return [...this.entries.keys()].filter(id => !id.startsWith("-"));
  }

  /** Formats `id` (or `id.attr`); returns null when the message or attribute is missing. */
  format(path: string, args: FluentArgs = {}, errors: FormatError[] = []): string | null {
    const [id, attr] = path.split(".", 2) as [string, string | undefined];
    const message = this.getMessage(id);
    if (!message) return null;
    const pattern = attr ? message.attributes[attr] : message.value;
    if (pattern == null) return null;
    return this.pattern(pattern, { args, errors, id: path, depth: 0 });
  }

  private pattern(p: Pattern, scope: Scope): string {
    if (typeof p === "string") return p;
    if (scope.depth > MAX_DEPTH) {
      scope.errors.push({ id: scope.id, message: "reference depth exceeded" });
      return "{???}";
    }
    let out = "";
    for (const el of p)
      out += typeof el === "string" ? el : this.display(this.expr(el, { ...scope, depth: scope.depth + 1 }));
    return out;
  }

  private display(v: FluentValue): string {
    if (typeof v === "string") return v;
    if (typeof v === "number") return new Intl.NumberFormat(this.locale).format(v);
    if (v instanceof Date) return new Intl.DateTimeFormat(this.locale).format(v);
    if (v instanceof FluentNumber) {
      const { type: _type, ...opts } = v.options;
      return new Intl.NumberFormat(this.locale, opts).format(v.value);
    }
    return new Intl.DateTimeFormat(this.locale, v.options).format(v.value);
  }

  private literal(l: Literal): FluentValue {
    return l.type === "str" ? l.value : new FluentNumber(l.value, { minimumFractionDigits: l.precision });
  }

  private expr(e: Expression, scope: Scope): FluentValue {
    switch (e.type) {
      case "str":
        return e.value;
      case "num":
        return new FluentNumber(e.value, {
          minimumFractionDigits: e.precision,
        });
      case "var": {
        const v = scope.args[e.name];
        if (v == null) {
          scope.errors.push({
            id: scope.id,
            message: `unknown variable $${e.name}`,
          });
          return `{$${e.name}}`;
        }
        return v;
      }
      case "mesg": {
        const m = this.entries.get(e.name);
        const p = m && (e.attr ? m.attributes[e.attr] : m.value);
        if (p == null) {
          scope.errors.push({
            id: scope.id,
            message: `unknown message ${e.name}${e.attr ? `.${e.attr}` : ""}`,
          });
          return `{${e.name}}`;
        }
        return this.pattern(p, scope);
      }
      case "term": {
        const t = this.entries.get(`-${e.name}`);
        const p = t && (e.attr ? t.attributes[e.attr] : t.value);
        if (p == null) {
          scope.errors.push({
            id: scope.id,
            message: `unknown term -${e.name}`,
          });
          return `{-${e.name}}`;
        }
        const args: FluentArgs = {};
        for (const [k, l] of Object.entries(e.named)) args[k] = this.literal(l);
        return this.pattern(p, { ...scope, args });
      }
      case "func": {
        const fn = this.functions[e.name];
        if (!fn) {
          scope.errors.push({
            id: scope.id,
            message: `unknown function ${e.name}`,
          });
          return `{${e.name}()}`;
        }
        const named: Record<string, string | number> = {};
        for (const [k, l] of Object.entries(e.named)) named[k] = l.value;
        return fn(
          e.positional.map(p => this.expr(p, scope)),
          named,
        );
      }
      case "select": {
        const sel = this.expr(e.selector, scope);
        const pick = this.match(sel, e.variants) ?? e.star;
        const variant = e.variants[pick] as Variant;
        return this.pattern(variant.value, scope);
      }
    }
  }

  private match(sel: FluentValue, variants: Variant[]): number | null {
    let n: number | null = null;
    let type: Intl.PluralRuleType = "cardinal";
    if (typeof sel === "number") n = sel;
    else if (sel instanceof FluentNumber) {
      n = sel.value;
      type = sel.options.type ?? "cardinal";
    }
    if (n !== null) {
      const exact = variants.findIndex(v => v.key.type === "num" && v.key.value === n);
      if (exact >= 0) return exact;
      let rules = this.plural.get(type);
      if (!rules) this.plural.set(type, (rules = new Intl.PluralRules(this.locale, { type })));
      const category = rules.select(n);
      const i = variants.findIndex(v => v.key.type === "name" && v.key.value === category);
      return i >= 0 ? i : null;
    }
    if (typeof sel === "string") {
      const i = variants.findIndex(v => v.key.type !== "num" && String(v.key.value) === sel);
      return i >= 0 ? i : null;
    }
    return null;
  }
}

interface Scope {
  args: FluentArgs;
  errors: FormatError[];
  id: string;
  depth: number;
}

/** Variables referenced by a message pattern (for catalog checks across locales). */
export function patternVariables(p: Pattern | null): Set<string> {
  const out = new Set<string>();
  const walk = (e: Element): void => {
    if (typeof e === "string") return;
    if (e.type === "var") out.add(e.name);
    else if (e.type === "func") e.positional.forEach(walk);
    else if (e.type === "select") {
      walk(e.selector);
      for (const v of e.variants) if (typeof v.value !== "string") v.value.forEach(walk);
    }
  };
  if (p && typeof p !== "string") p.forEach(walk);
  return out;
}

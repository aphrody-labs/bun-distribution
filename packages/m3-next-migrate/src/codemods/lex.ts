// SPDX-License-Identifier: Apache-2.0
// A small JavaScript and TypeScript scanner for codemods: where strings, template literals and comments are, and
// where braces, brackets and parentheses close. Not a parser: enough to edit object literals, call sites and JSX
// attributes without matching inside strings or comments.

export interface Span {
  start: number;
  /** Exclusive. */
  end: number;
}

/** Spans of comments, strings and template literals (a template is one span, nested `${}` included). */
export function skippedSpans(src: string): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      spans.push({ start: i, end: end === -1 ? src.length : end });
      i = end === -1 ? src.length : end;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      spans.push({ start: i, end: end === -1 ? src.length : end + 2 });
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      spans.push({ start: i, end: j + 1 });
      i = j + 1;
    } else if (c === "`") {
      const end = templateEnd(src, i);
      spans.push({ start: i, end });
      i = end;
    } else {
      i += 1;
    }
  }
  return spans;
}

/** End (exclusive) of the template literal that starts at `start`, skipping nested templates in `${}`. */
function templateEnd(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") i += 2;
    else if (c === "`") return i + 1;
    else if (c === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const d = src[i]!;
        if (d === "`") i = templateEnd(src, i);
        else if (d === '"' || d === "'") {
          let j = i + 1;
          while (j < src.length && src[j] !== d) j += src[j] === "\\" ? 2 : 1;
          i = j + 1;
        } else {
          if (d === "{") depth += 1;
          if (d === "}") depth -= 1;
          i += 1;
        }
      }
    } else i += 1;
  }
  return src.length;
}

/** `true` when `index` is inside a comment, string or template. */
export function inSkipped(spans: readonly Span[], index: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const span = spans[mid]!;
    if (index < span.start) hi = mid - 1;
    else if (index >= span.end) lo = mid + 1;
    else return true;
  }
  return false;
}

const PAIRS: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

/** Index of the bracket that closes the one at `open`, outside strings and comments; -1 when unbalanced. */
export function matching(
  src: string,
  open: number,
  spans: readonly Span[] = skippedSpans(src),
): number {
  const opener = src[open]!;
  const closer = PAIRS[opener];
  if (closer === undefined) throw new Error(`matching: ${opener} is not a bracket`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (inSkipped(spans, i)) continue;
    const c = src[i];
    if (c === opener) depth += 1;
    else if (c === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface Property {
  key: string;
  /** The whole `key: value` text (or shorthand), without the trailing comma. */
  start: number;
  end: number;
  /** The value text. */
  value: string;
  valueStart: number;
  valueEnd: number;
}

/**
 * The top-level properties of the object literal whose `{` is at `open`. Keys are identifiers or quoted strings;
 * spreads and computed keys are skipped.
 */
export function properties(
  src: string,
  open: number,
  spans: readonly Span[] = skippedSpans(src),
): Property[] {
  const close = matching(src, open, spans);
  if (close === -1) return [];
  const props: Property[] = [];
  let i = open + 1;
  while (i < close) {
    while (i < close && /[\s,;]/.test(src[i]!)) i += 1;
    if (i >= close) break;
    // Skip comments between properties.
    const comment = spans.find((s) => s.start === i);
    if (comment && (src.startsWith("//", i) || src.startsWith("/*", i))) {
      i = comment.end;
      continue;
    }
    const start = i;
    let key: string | undefined;
    const quoted = /^(["'])((?:\\.|(?!\1).)*)\1\s*:/.exec(src.slice(i, i + 200));
    const ident = /^([A-Za-z_$][\w$]*|\d+(?:\.\d+)?)\s*(:|,|\}|$)/.exec(src.slice(i, i + 200));
    let valueStart = i;
    if (quoted) {
      key = quoted[2];
      valueStart = i + quoted[0].length;
    } else if (ident && ident[2] === ":") {
      key = ident[1];
      valueStart = i + ident[0].length;
    } else if (ident) {
      // Shorthand property `{ a, b }`.
      key = ident[1];
      valueStart = i;
    }
    // The value runs to the next top-level comma or the closing brace.
    let j = key !== undefined && (quoted || (ident && ident[2] === ":")) ? valueStart : i;
    let depth = 0;
    for (; j < close; j += 1) {
      if (inSkipped(spans, j)) continue;
      const c = src[j]!;
      if (c === "{" || c === "[" || c === "(") depth += 1;
      else if (c === "}" || c === "]" || c === ")") depth -= 1;
      else if ((c === "," || c === ";") && depth === 0) break;
    }
    let end = j;
    while (end > start && /\s/.test(src[end - 1]!)) end -= 1;
    if (key !== undefined) {
      let vs = valueStart;
      while (/\s/.test(src[vs] ?? "") && vs < end) vs += 1;
      props.push({ key, start, end, value: src.slice(vs, end), valueStart: vs, valueEnd: end });
    }
    i = j + 1;
  }
  return props;
}

/** Position of the `{` that starts the object literal assigned to `key:` at the top level of `src` (first match). */
export function objectValueOpen(src: string, key: string, from = 0, to = src.length): number {
  const spans = skippedSpans(src);
  const re = new RegExp(`(?:^|[\\s,{])(?:${key}|["']${key}["'])\\s*:\\s*\\{`, "g");
  re.lastIndex = from;
  for (let m = re.exec(src); m !== null && m.index < to; m = re.exec(src)) {
    const brace = m.index + m[0].length - 1;
    if (!inSkipped(spans, brace)) return brace;
  }
  return -1;
}

/** Remove `[start, end)` plus the comma and one line break that go with it. */
export function removeRange(src: string, start: number, end: number): string {
  let from = start;
  let to = end;
  // Trailing comma, then the rest of the line when only whitespace follows.
  if (src[to] === ",") to += 1;
  const lineEnd = /^[ \t]*\n/.exec(src.slice(to));
  const lineStart = src.lastIndexOf("\n", from - 1) + 1;
  if (lineEnd && /^[ \t]*$/.test(src.slice(lineStart, from))) {
    from = lineStart;
    to += lineEnd[0].length;
  } else {
    // Inline: a comma left dangling before the closing bracket goes too (`{ a: 1, b: 2 }` minus `b`).
    let a = from;
    while (a > 0 && /[ \t]/.test(src[a - 1]!)) a -= 1;
    const next = src.slice(to).trimStart()[0];
    if (src[a - 1] === "," && (next === "}" || next === "]")) from = a - 1;
  }
  return src.slice(0, from) + src.slice(to);
}

/** Apply non-overlapping `[start, end) -> text` edits to `src`, last first so positions stay valid. */
export function applyEdits(
  src: string,
  edits: readonly { start: number; end: number; text: string }[],
): string {
  let out = src;
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy; ES2022 has no toSorted
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end))
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

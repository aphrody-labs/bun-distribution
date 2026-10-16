// SPDX-License-Identifier: Apache-2.0
// JSX tags and attributes for codemods: names, attribute lists with their raw values, closing tags.
import {
  inSkipped,
  matching,
  skippedSpans,
  type Span,
} from "@aphrody/next-bun/codemods/lex";

export interface Attr {
  name: string;
  /** Raw value text with its quotes or braces (`"outlined"`, `{x}`); undefined for a bare attribute. */
  value?: string;
  start: number;
  end: number;
  /** `{...spread}` */
  spread?: boolean;
}

export interface Tag {
  name: string;
  /** `<` of the opening tag. */
  start: number;
  nameStart: number;
  nameEnd: number;
  /** Index just after the opening tag's `>`. */
  end: number;
  /** Where the attribute list ends: the `>` or the `/` of `/>`. */
  attrsEnd: number;
  selfClosing: boolean;
  attrs: Attr[];
}

/** Opening tags of the given element names (`Button`, `Typography`), skipping strings and comments. */
export function findTags(
  src: string,
  names: readonly string[],
  spans: readonly Span[] = skippedSpans(src),
): Tag[] {
  const tags: Tag[] = [];
  const re = new RegExp(
    `<(${names.map((n) => n.replace(/[$]/g, "\\$")).join("|")})(?=[\\s/>])`,
    "g",
  );
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    if (inSkipped(spans, m.index)) continue;
    const nameStart = m.index + 1;
    const nameEnd = nameStart + m[1]!.length;
    const attrs: Attr[] = [];
    let i = nameEnd;
    let selfClosing = false;
    let attrsEnd = -1;
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i]!)) i += 1;
      const c = src[i];
      if (c === ">") {
        attrsEnd = i;
        i += 1;
        break;
      }
      if (c === "/" && src[i + 1] === ">") {
        selfClosing = true;
        attrsEnd = i;
        i += 2;
        break;
      }
      if (c === "{") {
        const close = matching(src, i, spans);
        if (close === -1) break;
        attrs.push({
          name: src.slice(i + 1, close).trim(),
          start: i,
          end: close + 1,
          spread: true,
        });
        i = close + 1;
        continue;
      }
      const nm = /^[A-Za-z_$][\w$:.-]*/.exec(src.slice(i));
      if (!nm) break;
      const start = i;
      i += nm[0].length;
      let j = i;
      while (j < src.length && /\s/.test(src[j]!)) j += 1;
      if (src[j] === "=") {
        j += 1;
        while (j < src.length && /\s/.test(src[j]!)) j += 1;
        const q = src[j];
        let end: number;
        if (q === '"' || q === "'") end = src.indexOf(q, j + 1) + 1;
        else if (q === "{") end = matching(src, j, spans) + 1;
        else end = j;
        if (end <= j) break;
        attrs.push({ name: nm[0], value: src.slice(j, end), start, end });
        i = end;
      } else attrs.push({ name: nm[0], start, end: i });
    }
    if (attrsEnd === -1) continue;
    tags.push({
      name: m[1]!,
      start: m.index,
      nameStart,
      nameEnd,
      end: i,
      attrsEnd,
      selfClosing,
      attrs,
    });
  }
  return tags;
}

/** Start index of the `</Name>` that closes the element opened by `tag`, or -1 (self-closing, or unbalanced). */
export function closingTag(src: string, tag: Tag): number {
  if (tag.selfClosing) return -1;
  const re = new RegExp(`<(/?)${tag.name}(?=[\\s/>])`, "g");
  re.lastIndex = tag.end;
  const spans = skippedSpans(src);
  let depth = 1;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    if (inSkipped(spans, m.index)) continue;
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) return m.index;
    } else {
      const open = findTags(src.slice(m.index, m.index + 400), [tag.name])[0];
      if (!open?.selfClosing) depth += 1;
    }
  }
  return -1;
}

/** The string value of an attribute (`"x"` or `{"x"}`), or undefined for expressions. */
export function stringValue(attr: Attr | undefined): string | undefined {
  if (attr?.value === undefined) return undefined;
  const m = /^(?:\{\s*)?(["'])((?:\\.|(?!\1).)*)\1(?:\s*\})?$/.exec(attr.value);
  return m?.[2];
}

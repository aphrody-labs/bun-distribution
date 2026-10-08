// SPDX-License-Identifier: Apache-2.0
// Next 15/16 async request APIs: `cookies()`, `headers()` and `draftMode()` return promises, `params` and
// `searchParams` are promises, and `revalidateTag` takes a cache-life profile. The codemod awaits the calls, makes
// the enclosing top-level function async and rewrites the props types; shapes it cannot rewrite become warnings.
import { type CodemodResult, unchanged } from "./types";
import { applyEdits, inSkipped, matching, properties, skippedSpans, type Span } from "./lex";

interface FnSpan {
  /** Where `async` goes: the `function` keyword, or the arrow's parameters. */
  headerStart: number;
  isAsync: boolean;
  /** `function` declaration, or an arrow assigned at module level: safe to make async. */
  convertible: boolean;
  /** Parameter list, inside the parentheses. */
  paramsStart: number;
  paramsEnd: number;
  bodyStart: number;
  bodyEnd: number;
  block: boolean;
}

const isIdent = (c: string | undefined): boolean => c !== undefined && /[\w$]/.test(c);

/** Brace depth of `index`, outside strings and comments. */
function depthAt(src: string, index: number, spans: readonly Span[]): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (inSkipped(spans, i)) continue;
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") depth -= 1;
  }
  return depth;
}

/** The nearest `(` before `close`, found by walking back over balanced brackets. */
function openBefore(src: string, close: number, spans: readonly Span[]): number {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (inSkipped(spans, i)) continue;
    const c = src[i];
    if (c === ")" || c === "]" || c === "}") depth += 1;
    else if (c === "(" || c === "[" || c === "{") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `{` that opens a function body after `from`, skipping a return type annotation. */
function bodyOpen(src: string, from: number, spans: readonly Span[]): number {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i += 1;
  if (src[i] === ":") {
    // Return type: skip `{ ... }` type literals and generics until the body brace.
    let angle = 0;
    i += 1;
    while (i < src.length) {
      if (inSkipped(spans, i)) {
        i += 1;
        continue;
      }
      const c = src[i]!;
      if (c === "<") angle += 1;
      else if (c === ">" && src[i - 1] !== "=") angle -= 1;
      else if (
        c === "{" &&
        angle === 0 &&
        /[:\s|&]\s*$/.test(src.slice(Math.max(0, i - 3), i)) &&
        /:\s*$/.test(src.slice(0, i))
      ) {
        i = matching(src, i, spans) + 1;
        continue;
      } else if (c === "{" && angle === 0) return i;
      else if (c === ";" && angle === 0) return -1;
      i += 1;
    }
    return -1;
  }
  return src[i] === "{" ? i : -1;
}

export function functionSpans(src: string, spans: readonly Span[] = skippedSpans(src)): FnSpan[] {
  const out: FnSpan[] = [];
  const fnRe = /\bfunction\b\s*\*?\s*[A-Za-z_$]?[\w$]*\s*(?:<[^>(]*>)?\s*\(/g;
  for (let m = fnRe.exec(src); m !== null; m = fnRe.exec(src)) {
    if (inSkipped(spans, m.index)) continue;
    const open = m.index + m[0].length - 1;
    const close = matching(src, open, spans);
    if (close === -1) continue;
    const body = bodyOpen(src, close + 1, spans);
    if (body === -1) continue;
    const before = src.slice(0, m.index);
    const asyncMatch = /\basync\s+$/.exec(before);
    out.push({
      headerStart: asyncMatch ? asyncMatch.index : m.index,
      isAsync: asyncMatch !== null,
      convertible: depthAt(src, m.index, spans) === 0,
      paramsStart: open + 1,
      paramsEnd: close,
      bodyStart: body,
      bodyEnd: matching(src, body, spans) + 1,
      block: true,
    });
  }
  const arrowRe = /=>/g;
  for (let m = arrowRe.exec(src); m !== null; m = arrowRe.exec(src)) {
    if (inSkipped(spans, m.index)) continue;
    let p = m.index - 1;
    while (p >= 0 && /\s/.test(src[p]!)) p -= 1;
    let paramsStart: number;
    let paramsEnd: number;
    let headerStart: number;
    if (src[p] === ")") {
      const open = openBefore(src, p, spans);
      if (open === -1) continue;
      paramsStart = open + 1;
      paramsEnd = p;
      headerStart = open;
    } else if (isIdent(src[p])) {
      let q = p;
      while (q >= 0 && isIdent(src[q])) q -= 1;
      paramsStart = q + 1;
      paramsEnd = p + 1;
      headerStart = q + 1;
    } else continue;
    const asyncMatch = /\basync\s+$/.exec(src.slice(0, headerStart));
    let bs = m.index + 2;
    while (bs < src.length && /\s/.test(src[bs]!)) bs += 1;
    const block = src[bs] === "{";
    let end: number;
    if (block) end = matching(src, bs, spans) + 1;
    else {
      let depth = 0;
      end = bs;
      for (; end < src.length; end += 1) {
        if (inSkipped(spans, end)) continue;
        const c = src[end]!;
        if (c === "(" || c === "[" || c === "{") depth += 1;
        else if (c === ")" || c === "]" || c === "}") {
          if (depth === 0) break;
          depth -= 1;
        } else if ((c === ";" || c === ",") && depth === 0) break;
      }
    }
    // `const f = () =>` or `export const f = async () =>` at module level.
    const assigned = /(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=\s*(?:async\s+)?$/.test(
      src.slice(0, headerStart),
    );
    out.push({
      headerStart: asyncMatch ? asyncMatch.index : headerStart,
      isAsync: asyncMatch !== null,
      convertible: assigned && depthAt(src, m.index, spans) === 0,
      paramsStart,
      paramsEnd,
      bodyStart: bs,
      bodyEnd: end,
      block,
    });
  }
  return out;
}

/** The innermost function that contains `index` in its body. */
function enclosing(fns: readonly FnSpan[], index: number): FnSpan | undefined {
  let best: FnSpan | undefined;
  for (const fn of fns) {
    if (
      index >= fn.bodyStart &&
      index < fn.bodyEnd &&
      (best === undefined || fn.bodyStart > best.bodyStart)
    )
      best = fn;
  }
  return best;
}

const REQUEST_APIS = new Set(["cookies", "headers", "draftMode"]);

function importedRequestApis(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']next\/headers["']/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim();
      if (REQUEST_APIS.has(name)) names.push(name);
    }
  }
  return names;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Await `cookies()`, `headers()` and `draftMode()`; make the enclosing top-level function async. */
export function awaitRequestApis(source: string): CodemodResult {
  const names = importedRequestApis(source);
  if (names.length === 0) return unchanged(source);
  const spans = skippedSpans(source);
  const fns = functionSpans(source, spans);
  const edits: Edit[] = [];
  const asyncAt = new Set<number>();
  const changes: string[] = [];
  const warnings: string[] = [];
  const re = new RegExp(`\\b(${names.join("|")})\\s*\\(\\s*\\)`, "g");
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    if (inSkipped(spans, m.index)) continue;
    if (isIdent(source[m.index - 1]) || source[m.index - 1] === ".") continue;
    if (/\bawait\s+$/.test(source.slice(0, m.index))) continue;
    if (
      /\bimport\b[^;]*$/.test(source.slice(Math.max(0, m.index - 200), m.index)) &&
      /from/.test(source.slice(m.index, m.index + 20))
    )
      continue;
    const fn = enclosing(fns, m.index);
    if (!fn) {
      warnings.push(`${m[1]}() at module level cannot be awaited: move it into a function`);
      continue;
    }
    if (!fn.isAsync) {
      if (!fn.convertible) {
        warnings.push(
          `${m[1]}() is inside a nested callback: make that callback async and await it by hand`,
        );
        continue;
      }
      if (!asyncAt.has(fn.headerStart)) {
        asyncAt.add(fn.headerStart);
        edits.push({ start: fn.headerStart, end: fn.headerStart, text: "async " });
      }
    }
    const end = m.index + m[0].length;
    const member = /^\s*(\.|\?\.|\[)/.test(source.slice(end));
    edits.push({ start: m.index, end, text: member ? `(await ${m[0]})` : `await ${m[0]}` });
    changes.push(`awaited ${m[1]}()`);
  }
  if (edits.length === 0) return { code: source, changes, warnings };
  return { code: applyEdits(source, edits), changes: [...new Set(changes)], warnings };
}

/** `revalidateTag(tag)` takes a cache-life profile in Next 16: add `"max"`, the stale-while-revalidate behaviour of 15. */
export function revalidateTagProfile(source: string): CodemodResult {
  if (!/\brevalidateTag\b/.test(source)) return unchanged(source);
  const spans = skippedSpans(source);
  const edits: Edit[] = [];
  const re = /\brevalidateTag\s*\(/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    if (
      inSkipped(spans, m.index) ||
      /import[^;]*$/.test(source.slice(Math.max(0, m.index - 80), m.index))
    )
      continue;
    const open = m.index + m[0].length - 1;
    const close = matching(source, open, spans);
    if (close === -1) continue;
    const args = source.slice(open + 1, close);
    // One argument only: no top-level comma.
    let depth = 0;
    let commas = 0;
    for (let i = open + 1; i < close; i += 1) {
      if (inSkipped(spans, i)) continue;
      const c = source[i]!;
      if ("([{".includes(c)) depth += 1;
      else if (")]}".includes(c)) depth -= 1;
      else if (c === "," && depth === 0 && source.slice(i + 1, close).trim() !== "") commas += 1;
    }
    if (args.trim() !== "" && commas === 0)
      edits.push({ start: close, end: close, text: ', "max"' });
  }
  if (edits.length === 0) return unchanged(source);
  return {
    code: applyEdits(source, edits),
    changes: [`revalidateTag(tag) -> revalidateTag(tag, "max") (${edits.length})`],
    warnings: [
      'revalidateTag now needs a cache-life profile: "max" keeps the Next 15 stale-while-revalidate behaviour; use updateTag in Server Actions for read-your-writes',
    ],
  };
}

export const isRouteFile = (path: string): boolean =>
  /(^|\/)app\/(?:.*\/)?(?:page|layout|route|default|template|opengraph-image|twitter-image|icon|apple-icon|sitemap)\.(?:tsx?|jsx?)$/.test(
    path,
  );

/** Wrap the type of `key` inside an object type literal as `Promise<...>`. Returns the new literal, or undefined. */
function promiseWrapMember(typeLiteral: string, key: string): string | undefined {
  const open = typeLiteral.indexOf("{");
  const member = properties(typeLiteral, open).find((p) => p.key === key || p.key === `${key}?`);
  if (!member) return undefined;
  if (/^Promise\s*</.test(member.value)) return typeLiteral;
  return (
    typeLiteral.slice(0, member.valueStart) +
    `Promise<${member.value}>` +
    typeLiteral.slice(member.valueEnd)
  );
}

/** `params` and `searchParams` are promises: rewrite the props type, the destructuring and the uses. */
export function awaitRouteProps(source: string, path: string): CodemodResult {
  if (!isRouteFile(path) || !/\b(params|searchParams)\b/.test(source)) return unchanged(source);
  const spans = skippedSpans(source);
  const fns = functionSpans(source, spans);
  const edits: Edit[] = [];
  const changes: string[] = [];
  const warnings: string[] = [];
  const handled = new Set<number>();

  for (const fn of fns) {
    if (handled.has(fn.paramsStart) || !fn.block) continue;
    const paramText = source.slice(fn.paramsStart, fn.paramsEnd);
    if (!/\b(params|searchParams)\b/.test(paramText)) continue;
    // Only exported route functions and generateMetadata-style helpers.
    const header = source.slice(Math.max(0, fn.headerStart - 40), fn.headerStart);
    if (
      !/\bexport\s+(?:default\s+)?$/.test(header) &&
      !/\bexport\s+(?:const|function)\b/.test(
        source.slice(Math.max(0, fn.headerStart - 60), fn.paramsStart),
      )
    )
      continue;
    handled.add(fn.paramsStart);

    // Split the parameter list at top-level commas: `(request, { params }: { params: T })`.
    const parts: { text: string; start: number }[] = [];
    {
      let depth = 0;
      let from = 0;
      for (let i = 0; i <= paramText.length; i += 1) {
        const c = paramText[i];
        if (c !== undefined && "([{<".includes(c)) depth += 1;
        else if (c !== undefined && ")]}>".includes(c) && !(c === ">" && paramText[i - 1] === "="))
          depth -= 1;
        if ((c === "," && depth === 0) || i === paramText.length) {
          if (paramText.slice(from, i).trim() !== "")
            parts.push({ text: paramText.slice(from, i), start: fn.paramsStart + from });
          from = i + 1;
        }
      }
    }

    const bodyStatements: string[] = [];
    let touched = false;
    for (const part of parts) {
      const lead = part.text.length - part.text.trimStart().length;
      let pattern: string;
      let rest: string;
      if (part.text[lead] === "{") {
        const close = matching(part.text, lead);
        if (close === -1) continue;
        pattern = part.text.slice(lead, close + 1);
        rest = part.text.slice(close + 1);
      } else {
        const id = /^[A-Za-z_$][\w$]*/.exec(part.text.slice(lead));
        if (!id) continue;
        pattern = id[0];
        rest = part.text.slice(lead + pattern.length);
      }
      const typeMatch = /^\s*:\s*([\s\S]+?)\s*$/.exec(rest);
      const type = typeMatch?.[1];
      if (!/\b(params|searchParams)\b/.test(pattern + (type ?? ""))) continue;
      const patternStart = part.start + lead;
      const keys = ["params", "searchParams"].filter((k) =>
        new RegExp(`\\b${k}\\b`).test(pattern + (type ?? "")),
      );

      // 1. The type annotation: params: T -> params: Promise<T>.
      if (type !== undefined && type.trim().startsWith("{")) {
        let newType = type;
        for (const key of keys) newType = promiseWrapMember(newType, key) ?? newType;
        if (newType !== type) {
          const typeStart = part.start + lead + pattern.length + rest.indexOf(type);
          edits.push({ start: typeStart, end: typeStart + type.length, text: newType });
          touched = true;
        }
      } else if (type !== undefined) {
        warnings.push(
          `${path}: the props type \`${type.trim()}\` is a named type: make its params and searchParams Promises by hand`,
        );
      }

      // 2. The pattern: nested destructuring of params moves into the body.
      if (pattern.startsWith("{")) {
        let newPattern = pattern;
        for (const key of keys) {
          const nested = new RegExp(`\\b${key}\\s*:\\s*(\\{[^}]*\\})`).exec(newPattern);
          if (nested) {
            bodyStatements.push(`const ${nested[1]} = await ${key};`);
            newPattern = newPattern.replace(nested[0], key);
            touched = true;
          }
        }
        if (newPattern !== pattern)
          edits.push({ start: patternStart, end: patternStart + pattern.length, text: newPattern });
        // Direct uses of the destructured names: params.id -> (await params).id.
        for (const key of keys) {
          if (!new RegExp(`\\b${key}\\b`).test(newPattern)) continue;
          const body = source.slice(fn.bodyStart, fn.bodyEnd);
          const use = new RegExp(`(?<![\\w$.])${key}(?=\\s*(?:\\.|\\?\\.|\\[))`, "g");
          for (let u = use.exec(body); u !== null; u = use.exec(body)) {
            const at = fn.bodyStart + u.index;
            if (inSkipped(spans, at)) continue;
            edits.push({ start: at, end: at + key.length, text: `(await ${key})` });
            touched = true;
          }
          const assigned = new RegExp(`=\\s*${key}\\s*;`, "g");
          for (let u = assigned.exec(body); u !== null; u = assigned.exec(body)) {
            const at = fn.bodyStart + u.index;
            if (inSkipped(spans, at)) continue;
            edits.push({ start: at, end: at + u[0].length, text: `= await ${key};` });
            touched = true;
          }
        }
      } else {
        // `props.params.id` -> `(await props.params).id`
        const body = source.slice(fn.bodyStart, fn.bodyEnd);
        for (const key of keys) {
          const use = new RegExp(`\\b${pattern}\\.${key}(?=\\s*(?:\\.|\\?\\.|\\[))`, "g");
          for (let u = use.exec(body); u !== null; u = use.exec(body)) {
            const at = fn.bodyStart + u.index;
            if (inSkipped(spans, at)) continue;
            edits.push({ start: at, end: at + u[0].length, text: `(await ${pattern}.${key})` });
            touched = true;
          }
          const assigned = new RegExp(`=\\s*${pattern}\\.${key}\\s*;`, "g");
          for (let u = assigned.exec(body); u !== null; u = assigned.exec(body)) {
            const at = fn.bodyStart + u.index;
            if (inSkipped(spans, at)) continue;
            edits.push({ start: at, end: at + u[0].length, text: `= await ${pattern}.${key};` });
            touched = true;
          }
        }
      }
    }
    if (!touched) continue;
    if (bodyStatements.length > 0) {
      const indent =
        /\n([ \t]+)\S/.exec(source.slice(fn.bodyStart + 1, fn.bodyStart + 200))?.[1] ?? "  ";
      edits.push({
        start: fn.bodyStart + 1,
        end: fn.bodyStart + 1,
        text: `\n${bodyStatements.map((s) => `${indent}${s}`).join("\n")}`,
      });
    }
    if (!fn.isAsync) {
      if (fn.convertible)
        edits.push({ start: fn.headerStart, end: fn.headerStart, text: "async " });
      else
        warnings.push(
          `${path}: a function that reads params is not async and not top level: make it async by hand`,
        );
    }
    changes.push("params and searchParams are awaited");
  }
  if (edits.length === 0) return { code: source, changes: [], warnings };
  return { code: applyEdits(source, edits), changes: [...new Set(changes)], warnings };
}

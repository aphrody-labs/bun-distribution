// SPDX-License-Identifier: Apache-2.0
// Middleware `config.matcher` patterns.

/** A `config.matcher` entry (path-to-regexp subset: `:name`, `:name*`, `:name+`, `:name?`, `(regex)`). */
export function matcherToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    const param = /^\/?:([A-Za-z_]\w*)([*+?])?/.exec(pattern.slice(i));
    if (param && (c === ":" || c === "/")) {
      const slash = c === "/";
      const mod = param[2];
      const one = "[^/]+";
      if (mod === "*") source += slash ? "(?:/.*)?" : ".*";
      else if (mod === "+") source += slash ? "/.+" : ".+";
      else if (mod === "?") source += slash ? `(?:/${one})?` : `(?:${one})?`;
      else source += (slash ? "/" : "") + one;
      i += param[0].length - 1;
    } else if (c === "(") {
      let depth = 0;
      let end = i;
      for (; end < pattern.length; end++) {
        if (pattern[end] === "\\") end++;
        else if (pattern[end] === "(") depth++;
        else if (pattern[end] === ")" && --depth === 0) break;
      }
      source += `(?:${pattern.slice(i + 1, end)})`;
      i = end;
    } else source += /[.+*?^${}|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${source}/?$`);
}

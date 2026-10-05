// SPDX-License-Identifier: Apache-2.0
// next.config.{js,mjs,cjs,ts} from Next 14/15 to 16: experimental flags that became stable move to the top level,
// `experimental.turbo` becomes `turbopack`, `eslint` and `images.domains` go, the middleware flags are renamed.
import { type CodemodResult, unchanged } from "./types";
import { inSkipped, matching, objectValueOpen, properties, removeRange, skippedSpans } from "./lex";

/** `experimental.<key>` -> top-level `<value>` in Next 16. */
export const EXPERIMENTAL_MOVES: Record<string, string> = {
  dynamicIO: "cacheComponents",
  ppr: "cacheComponents",
  turbo: "turbopack",
  typedRoutes: "typedRoutes",
  reactCompiler: "reactCompiler",
  serverComponentsExternalPackages: "serverExternalPackages",
  bundlePagesExternals: "bundlePagesRouterDependencies",
  skipMiddlewareUrlNormalize: "skipProxyUrlNormalize",
};

/** Keys that are simply gone in Next 16 (the behaviour is on, or the feature was removed). */
const REMOVED_EXPERIMENTAL = new Set([
  "instrumentationHook",
  "appDocumentPreloading",
  "newNextLinkBehavior",
]);

const lineStart = (src: string, index: number): number => src.lastIndexOf("\n", index - 1) + 1;
const indentOf = (src: string, index: number): string =>
  /^[ \t]*/.exec(src.slice(lineStart(src, index)))![0];

/** The `{` of the object literal that directly contains the position `index` (the nearest unmatched one). */
function enclosingOpen(src: string, index: number): number {
  const spans = skippedSpans(src);
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (inSkipped(spans, i)) continue;
    const c = src[i];
    if (c === "}" || c === "]" || c === ")") depth += 1;
    else if (c === "{" || c === "[" || c === "(") {
      if (depth === 0) return c === "{" ? i : -1;
      depth -= 1;
    }
  }
  return -1;
}

/** Insert `key: value,` as a new property right before the property starting at `before`. */
function insertBefore(src: string, before: number, key: string, value: string): string {
  const ls = lineStart(src, before);
  if (/^[ \t]*$/.test(src.slice(ls, before))) {
    const indent = indentOf(src, before);
    return `${src.slice(0, ls)}${indent}${key}: ${value},\n${src.slice(ls)}`;
  }
  return `${src.slice(0, before)}${key}: ${value}, ${src.slice(before)}`;
}

const hasTopLevelKey = (src: string, container: number, key: string): boolean =>
  properties(src, container).some((p) => p.key === key);

export function nextConfigTo16(source: string): CodemodResult {
  let code = source;
  const changes: string[] = [];
  const warnings: string[] = [];

  // experimental.* that moved or went away.
  for (let guard = 0; guard < 50; guard += 1) {
    const open = objectValueOpen(code, "experimental");
    if (open === -1) break;
    const hit = properties(code, open).find(
      (p) => p.key in EXPERIMENTAL_MOVES || REMOVED_EXPERIMENTAL.has(p.key),
    );
    if (!hit) break;
    const experimentalKey = code.lastIndexOf("experimental", open);
    const container = enclosingOpen(code, experimentalKey);
    const target = EXPERIMENTAL_MOVES[hit.key];
    let value = hit.value;
    code = removeRange(code, hit.start, hit.end);
    if (target === undefined) {
      changes.push(`removed experimental.${hit.key} (stable in Next 16)`);
    } else if (hit.key === "ppr" && /^(false|0)$/.test(value)) {
      changes.push("removed experimental.ppr: false");
    } else if (container !== -1 && hasTopLevelKey(code, container, target)) {
      warnings.push(
        `experimental.${hit.key} was dropped: \`${target}\` is already set at the top level`,
      );
    } else {
      if (hit.key === "ppr") {
        warnings.push(
          'experimental.ppr became `cacheComponents: true`; per-route `export const experimental_ppr` is gone: wrap dynamic parts in <Suspense> and use "use cache"',
        );
        value = "true";
      }
      code = insertBefore(code, experimentalKey, target, value);
      changes.push(`moved experimental.${hit.key} to ${target}`);
    }
    // An experimental block left empty goes too.
    const reopen = objectValueOpen(code, "experimental");
    if (reopen !== -1 && properties(code, reopen).length === 0) {
      const keyAt = code.lastIndexOf("experimental", reopen);
      const close = matching(code, reopen);
      code = removeRange(code, keyAt, close + 1);
      changes.push("removed the empty experimental block");
    }
  }

  // Top-level renames.
  const renames: [RegExp, string, string][] = [
    [
      /(^|[\s,{])skipMiddlewareUrlNormalize(\s*:)/m,
      "$1skipProxyUrlNormalize$2",
      "skipMiddlewareUrlNormalize -> skipProxyUrlNormalize",
    ],
  ];
  for (const [re, to, label] of renames) {
    if (re.test(code)) {
      code = code.replace(re, to);
      changes.push(label);
    }
  }

  // `eslint: { ... }`: next lint and the config key are gone in Next 16.
  const eslintOpen = objectValueOpen(code, "eslint");
  if (eslintOpen !== -1) {
    const keyAt = code.lastIndexOf("eslint", eslintOpen);
    code = removeRange(code, keyAt, matching(code, eslintOpen) + 1);
    changes.push(
      "removed the eslint key (Next 16 has no `next lint`; run eslint or oxlint directly)",
    );
  }

  // images.domains -> images.remotePatterns.
  const imagesOpen = objectValueOpen(code, "images");
  if (imagesOpen !== -1) {
    const props = properties(code, imagesOpen);
    const domains = props.find((p) => p.key === "domains");
    if (domains) {
      const hosts = [...domains.value.matchAll(/(["'`])([^"'`]+)\1/g)].map((m) => m[2]!);
      if (props.some((p) => p.key === "remotePatterns")) {
        warnings.push(
          "images.domains is deprecated and images.remotePatterns exists: merge the domains by hand",
        );
      } else if (hosts.length > 0 && domains.value.startsWith("[")) {
        const indent = indentOf(code, domains.start);
        const entries = hosts.map((h) => `{ protocol: "https", hostname: ${JSON.stringify(h)} }`);
        const text = `remotePatterns: [\n${entries.map((e) => `${indent}  ${e},`).join("\n")}\n${indent}]`;
        code = code.slice(0, domains.start) + text + code.slice(domains.end);
        changes.push(
          `images.domains -> images.remotePatterns (${hosts.length} host${hosts.length === 1 ? "" : "s"}, https)`,
        );
      } else {
        warnings.push("images.domains is deprecated: convert it to images.remotePatterns by hand");
      }
    }
  }

  for (const key of ["serverRuntimeConfig", "publicRuntimeConfig"]) {
    if (objectValueOpen(code, key) !== -1)
      warnings.push(
        `${key} is removed in Next 16: read process.env on the server and NEXT_PUBLIC_* in the browser`,
      );
  }

  return code === source && warnings.length === 0 ? unchanged(source) : { code, changes, warnings };
}

// SPDX-License-Identifier: Apache-2.0
// What the file server writes into the HTML it serves, with `HTMLRewriter` (streamed, no re-parse): a per-request CSP
// nonce on every `<script>`, and the M3 theme of the request. The theme follows `@aphrody/m3-next`: the `m3-theme`
// cookie (`light`, `dark` or `system`), the `.dark`/`.light` class and `color-scheme` on `<html>`, the pre-paint
// script for `system`, and `theme-color` metas from the scheme surface of the seed.
import { loadOptional } from "./server-optional.ts";

type M3Next = typeof import("@aphrody/m3-next");
export type M3ThemeMode = "light" | "dark" | "system";

export interface M3ThemeOptions {
  /** Cookie holding the preference (default `m3-theme`, the one `@aphrody/m3-next` writes). */
  cookie?: string;
  /** Mode when the cookie is absent or invalid (default `system`). */
  defaultMode?: M3ThemeMode;
  /** Source colour of the `theme-color` metas (default the M3 baseline); `false` omits them. */
  seed?: string | false;
}

export interface M3ResolvedTheme {
  mode: M3ThemeMode;
  /** Cookie to set when the request had no valid one. */
  setCookie?: string;
  colorScheme: string;
  /** Pre-paint script: resolves `system` and keeps classes in sync with the cookie. */
  script: string;
  themeColors?: { light: string; dark: string };
}

/** A fresh CSP nonce (128 random bits, base64). */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64",
  );
}

/** `csp` with `'nonce-…'` allowed in `script-src` (added from `default-src` when the policy has no `script-src`). */
export function cspWithNonce(csp: string, nonce: string): string {
  const source = `'nonce-${nonce}'`;
  const directives = csp
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);
  const index = directives.findIndex((directive) =>
    /^script-src(\s|$)/i.test(directive),
  );
  if (index >= 0) directives[index] = `${directives[index]} ${source}`;
  else {
    const fallback = directives.find((directive) =>
      /^default-src(\s|$)/i.test(directive),
    );
    directives.push(
      `script-src${fallback ? fallback.slice("default-src".length) : " 'self'"} ${source}`,
    );
  }
  return directives.join("; ");
}

const themeColors = new Map<string, { light: string; dark: string }>();

/** The theme of a request, from its cookie (`Bun.CookieMap`), with the helpers of `@aphrody/m3-next`. */
export async function resolveTheme(
  cookies: Bun.CookieMap,
  options: M3ThemeOptions = {},
): Promise<M3ResolvedTheme> {
  const next = await loadOptional<M3Next>("@aphrody/m3-next", "theme");
  const name = next.validateThemeCookieName(
    options.cookie ?? next.M3_THEME_COOKIE,
  );
  const current = cookies.get(name);
  const mode = next.parseThemeMode(current, options.defaultMode ?? "system");
  const seed =
    options.seed === false
      ? undefined
      : (options.seed ?? next.M3_BASELINE_SEED);
  let colors = seed === undefined ? undefined : themeColors.get(seed);
  if (seed !== undefined && !colors) {
    colors = next.m3ThemeColors({ seed });
    themeColors.set(seed, colors);
  }
  return {
    mode,
    ...(current === mode ? {} : { setCookie: next.themeCookie(mode, name) }),
    colorScheme: next.colorSchemeFor(mode),
    script: next.colorSchemeScript(name),
    ...(colors ? { themeColors: colors } : {}),
  };
}

export interface HtmlInjection {
  nonce?: string;
  theme?: M3ResolvedTheme;
}

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

/** `response` (HTML) rewritten with the nonce and the theme; headers are kept. */
export function injectHtml(
  response: Response,
  { nonce, theme }: HtmlInjection,
): Response {
  const rewriter = new HTMLRewriter();
  if (nonce)
    rewriter.on("script", {
      element(element) {
        if (!element.hasAttribute("nonce"))
          element.setAttribute("nonce", nonce);
      },
    });
  if (theme) {
    rewriter.on("html", {
      element(element) {
        element.setAttribute("data-m3-theme", theme.mode);
        if (theme.mode !== "system") {
          const classes = (element.getAttribute("class") ?? "")
            .split(/\s+/)
            .filter((name) => name && name !== "dark" && name !== "light");
          element.setAttribute("class", [...classes, theme.mode].join(" "));
        }
        const style = (element.getAttribute("style") ?? "")
          .replace(/color-scheme\s*:[^;]*;?/g, "")
          .trim();
        element.setAttribute(
          "style",
          `${style}${style && !style.endsWith(";") ? ";" : ""}color-scheme:${theme.colorScheme}`,
        );
      },
    });
    rewriter.on("head", {
      element(element) {
        const attribute = nonce ? ` nonce="${escapeAttribute(nonce)}"` : "";
        element.prepend(`<script${attribute}>${theme.script}</script>`, {
          html: true,
        });
        const colors = theme.themeColors;
        if (!colors) return;
        const metas =
          theme.mode === "system"
            ? [
                `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${colors.light}">`,
                `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${colors.dark}">`,
              ]
            : [`<meta name="theme-color" content="${colors[theme.mode]}">`];
        element.append(metas.join(""), { html: true });
      },
    });
  }
  return rewriter.transform(response);
}

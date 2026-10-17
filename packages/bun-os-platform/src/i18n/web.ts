// SPDX-License-Identifier: Apache-2.0
/**
 * Browser localizer: the server negotiates (`?lang=`, the `bun-os-locale` cookie, then
 * Accept-Language) and returns the catalogs of the chain for the requested domains from
 * `GET /api/platform/i18n?domains=common,play[&lang=fr]`.
 */
import { type CatalogSources, type LocaleInfo, Localizer } from "./localizer";

export { Localizer } from "./localizer";
export type { FluentArgs } from "./fluent";

export interface WebCatalog {
  locale: string;
  chain: string[];
  direction: "ltr" | "rtl";
  source: string;
  locales: LocaleInfo[];
  sources: CatalogSources;
}

export async function loadWebLocalizer(
  domains: string[],
  options: { lang?: string; base?: string } = {},
): Promise<{ catalog: WebCatalog; l10n: Localizer }> {
  const query = new URLSearchParams({ domains: domains.join(",") });
  if (options.lang) query.set("lang", options.lang);
  const catalog = (await (
    await fetch(`${options.base ?? ""}/api/platform/i18n?${query}`)
  ).json()) as WebCatalog;
  document.documentElement.lang = catalog.locale;
  document.documentElement.dir = catalog.direction;
  return { catalog, l10n: new Localizer(catalog.chain, catalog.sources) };
}

/** Persists the choice for the server (cookie) and reloads the catalogs. */
export function setWebLocale(tag: string | null): void {
  document.cookie = tag
    ? `bun-os-locale=${encodeURIComponent(tag)}; Path=/; Max-Age=31536000; SameSite=Lax`
    : "bun-os-locale=; Path=/; Max-Age=0; SameSite=Lax";
}

/** Fills `[data-i18n]` text and `[data-i18n-attr="attr:id,attr:id"]` attributes. */
export function localizeDom(
  l10n: Localizer,
  root: ParentNode = document,
): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]"))
    el.textContent = l10n.t(el.dataset.i18n as string);
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-attr]"))
    for (const pair of (el.dataset.i18nAttr as string).split(",")) {
      const [attr, id] = pair.split(":");
      if (attr && id) el.setAttribute(attr.trim(), l10n.t(id.trim()));
    }
}

// SPDX-License-Identifier: Apache-2.0
/**
 * User-visible strings of play.aphrody.app, by Fluent message id. The catalogs are the platform
 * layer's (`packages/bun-os-platform/locales/<locale>/{common,play}.ftl`, docs/bun-os/PLATFORM.md):
 * the server negotiates `?lang=`, the `bun-os-locale` cookie, then Accept-Language, and sends the
 * fallback chain's sources; plurals, numbers and dates go through Intl. Add a string by adding
 * its id to `locales/en/play.ftl` and every other locale (`bun-os-platform check` enforces it).
 */
import {
  loadWebLocalizer,
  setWebLocale,
} from "../../../../packages/bun-os-platform/src/i18n/web";

const { catalog, l10n } = await loadWebLocalizer(["common", "play"], {
  lang: new URLSearchParams(location.search).get("lang") ?? undefined,
});

/** A Fluent message id of the `common` or `play` catalogs. */
export type MessageId = string;

/** The message `id` with its placeables filled (numbers select plurals). Returns plain text. */
export function t(
  id: MessageId,
  args: Record<string, string | number> = {},
): string {
  return l10n.t(id, args);
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** `t` escaped for HTML templates. Arguments are escaped too. */
export function th(
  id: MessageId,
  args: Record<string, string | number> = {},
): string {
  return escape(t(id, args));
}

/** The negotiated UI locale (BCP 47), for Intl formatters. */
export const locale = catalog.locale;
/** Shipped locales with their autonyms, for a language picker. */
export const locales = catalog.locales;
export { l10n };

/** Switches the UI language (persisted in a cookie the server reads) and reloads. */
export function setLocale(tag: string | null): void {
  setWebLocale(tag);
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  location.replace(url);
}

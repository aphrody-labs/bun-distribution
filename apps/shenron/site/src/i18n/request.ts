/**
 * next-intl request configuration — server side.
 *
 * The site has no locale in its URLs: the choice lives in the `NEXT_LOCALE`
 * cookie, and the root layout must stay cacheable (no cookie read there, see
 * CLAUDE.md). So this config is resolved lazily, only when a server component
 * calls `getTranslations()` / `getLocale()` / `getFormatter()`, and reading the
 * cookie makes THAT route dynamic. Rule: static public pages use the client
 * hooks (`useTranslations`, `useLangue`) ; dynamic routes (admin, canon,
 * dashboard) may use the server helpers.
 */
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { COOKIE_LOCALE_NAME, getDictionary, negotiateLocale, normalizeLocale } from "@/lib/i18n";

export default getRequestConfig(async () => {
	const jar = await cookies();
	const fromCookie = jar.get(COOKIE_LOCALE_NAME)?.value;
	const locale = fromCookie
		? normalizeLocale(fromCookie)
		: negotiateLocale((await headers()).get("accept-language"));
	return {
		locale,
		messages: getDictionary(locale),
		timeZone: "Europe/Paris",
		// French is the reference: a key missing elsewhere shows the French text
		// rather than the raw key. The type system already flags the gap.
		getMessageFallback: ({ namespace, key }) => messageFr(namespace, key),
	};
});

/** The French message at `namespace.key`, or the key itself when even French lacks it. */
function messageFr(namespace: string | undefined, key: string): string {
	const path = [...(namespace ? namespace.split(".") : []), ...key.split(".")];
	let node: unknown = getDictionary("fr");
	for (const segment of path) {
		if (!node || typeof node !== "object" || !(segment in node)) return key;
		node = (node as Record<string, unknown>)[segment];
	}
	return typeof node === "string" ? node : key;
}

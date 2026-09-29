"use client";

/**
 * `<T>` — one interface string, in the reader's language, inside a page that
 * stays in the CDN cache.
 *
 * The constraint that shapes this file: the root layout must not read cookies
 * (CLAUDE.md), so the server cannot know which language to render, and the HTML
 * it caches is always the reference one — French. A server component therefore
 * cannot translate anything by itself.
 *
 * `<T>` is the way out. It is a leaf client component: the server renders the
 * French text into the cached HTML, and at hydration the same node re-reads the
 * dictionary through the language context and swaps to Japanese or English
 * without a reload and without a second HTML variant.
 *
 * When to use what:
 *  - text inside a server component → `<T k="wiki.toriyama.title" />`
 *  - a string needed as a prop (`aria-label`, `placeholder`, `alt`) → the
 *    element must live in a client component; use `useT()` there
 *  - a client component with many strings → `useTranslations()` from next-intl,
 *    which reads the very same messages
 *  - `metadata` (title, description) → stays in the reference language: it is
 *    produced once, server-side, for the cached document and for indexing
 *
 * The key is the dotted path of `messages/fr.json` (`nav.wiki`,
 * `categories.films.label`). An unknown key renders nothing and is reported
 * once in the console, because a raw `wiki.toriyama.title` printed on a page is
 * worse than a missing line.
 */
import { useLangue } from "@/lib/i18n/client";
import type { Dictionary } from "@/lib/i18n";

/** Walks `nav.wiki` through the dictionary. Returns null rather than a half-path. */
export function lookup(dico: Dictionary, key: string): string | null {
	let node: unknown = dico;
	for (const segment of key.split(".")) {
		if (!node || typeof node !== "object" || !(segment in node)) return null;
		node = (node as Record<string, unknown>)[segment];
	}
	return typeof node === "string" ? node : null;
}

const manquantes = new Set<string>();

/** Fills `{name}` placeholders — the ICU subset the interface actually uses. */
function interpolate(text: string, values?: Record<string, string | number>): string {
	if (!values) return text;
	return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in values ? String(values[name]) : whole
	);
}

/**
 * Reads interface strings where a hook is possible (props, `aria-label`,
 * computed labels). Same dictionary, same switch, no provider to add.
 */
export function useT(): (key: string, values?: Record<string, string | number>) => string {
	const { dico } = useLangue();
	return (key, values) => {
		const found = lookup(dico, key);
		if (found === null) {
			if (!manquantes.has(key)) {
				manquantes.add(key);
				console.warn(`[i18n] clé absente : ${key}`);
			}
			return "";
		}
		return interpolate(found, values);
	};
}

export function T({
	k,
	values,
}: {
	/** Dotted path in `messages/*.json`, e.g. `categories.films.label`. */
	k: string;
	values?: Record<string, string | number>;
}) {
	const t = useT();
	return <>{t(k, values)}</>;
}

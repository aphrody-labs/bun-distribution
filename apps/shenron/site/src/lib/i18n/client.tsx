"use client";

/**
 * La langue de l'interface, côté client — et uniquement côté client.
 *
 * Le choix vit dans le cookie `NEXT_LOCALE`, mais le lire côté serveur rendrait
 * **toute** la page dynamique : le layout racine doit rester cacheable (cf.
 * CLAUDE.md). La locale est donc appliquée après l'hydratation, sur les libellés
 * d'interface, et l'attribut `lang` du document suit.
 *
 * Ce que ce contexte traduit : la navigation, le menu mobile, la recherche, les
 * actions de compte. Ce qu'il ne traduit **pas** : les fiches du wiki, les
 * articles et les transcriptions — ils sont rédigés en français en base, et
 * prétendre le contraire avec une traduction automatique irait contre la
 * doctrine du site. Le sélecteur le dit en toutes lettres.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import {
	COOKIE_LOCALE_NAME,
	DEFAULT_LOCALE,
	getDictionary,
	normalizeLocale,
	type Dictionary,
	type SupportedLocale,
} from "@/lib/i18n";

interface ContexteLangue {
	locale: SupportedLocale;
	dico: Dictionary;
	changerLangue: (code: SupportedLocale) => void;
}

const Contexte = createContext<ContexteLangue>({
	locale: DEFAULT_LOCALE,
	dico: getDictionary(DEFAULT_LOCALE),
	changerLangue: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
	// Le serveur rend toujours le français : c'est la langue du document par
	// défaut, et c'est ce que le CDN met en cache. La bascule se fait juste après.
	const [locale, setLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);

	useEffect(() => {
		const trouve = document.cookie.match(
			new RegExp(`(?:^|; )${COOKIE_LOCALE_NAME}=([^;]*)`)
		)?.[1];
		// Le cookie est écrit par le navigateur, donc par n'importe qui sur le
		// domaine : un « % » isolé ou une paire d'octets invalide fait lever
		// `decodeURIComponent`, et l'exception remonterait depuis l'effet du
		// fournisseur qui enveloppe TOUT le site. On garde alors la valeur brute,
		// que `normalizeLocale` ramène au français si elle ne désigne aucune langue.
		if (trouve) {
			let brut = trouve;
			try {
				brut = decodeURIComponent(trouve);
			} catch {
				/* valeur illégale : on garde la chaîne telle quelle */
			}
			setLocale(normalizeLocale(brut));
		}
	}, []);

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	const changerLangue = useCallback((code: SupportedLocale) => {
		document.cookie = `${COOKIE_LOCALE_NAME}=${code}; path=/; max-age=31536000; SameSite=Lax`;
		setLocale(code);
	}, []);

	const valeur = useMemo<ContexteLangue>(
		() => ({ locale, dico: getDictionary(locale), changerLangue }),
		[locale, changerLangue]
	);

	// next-intl hooks (`useTranslations`, `useFormatter`) read the same locale and
	// the same messages as `useLangue`: one switch, two APIs, zero divergence.
	return (
		<Contexte.Provider value={valeur}>
			<NextIntlClientProvider locale={locale} messages={valeur.dico} timeZone="Europe/Paris">
				{children}
			</NextIntlClientProvider>
		</Contexte.Provider>
	);
}

export const useLangue = () => useContext(Contexte);

/**
 * Le pont entre les routes du site et les clés du dictionnaire.
 *
 * On indexe par `href` et non par clé de registre : la nav desktop
 * (`wiki-launch`) et le menu mobile (`site-menu`) sont deux registres distincts
 * qui ne partagent que les destinations. Une entrée absente d'ici reste
 * affichée telle quelle, en français — jamais vide.
 */
const RUBRIQUES: Record<string, keyof Dictionary["categories"]> = {
	"/wiki/episodes": "episodes",
	"/wiki/films": "films",
	"/wiki/manga": "manga",
	"/wiki/jeux": "jeux",
	"/wiki/chronologie": "chronologie",
	"/wiki/personnages": "personnages",
	"/wiki/sagas": "sagas",
	"/wiki/arcs": "arcs",
	"/wiki/transformations": "transformations",
	"/wiki/techniques": "techniques",
	"/wiki/cosmologie": "cosmologie",
	"/wiki/races": "races",
	"/wiki/databooks": "databooks",
	"/wiki/canon": "canon",
	"/wiki/tools": "tools",
	"/wiki/contribuer": "contribuer",
	"/wiki/modifications": "modifications",
	"/news": "actualites",
	"/actualites": "actualites",
	"/jeux": "minijeux",
	"/shop": "boutique",
	"/classements": "classements",
	"/tierlists": "tierlists",
	"/profil": "profil",
	"/stats": "stats",
	"/ask": "assistant",
	"/wiki/hasard": "hasard",
	"/commands": "commandes",
};

/** Le libellé d'une destination dans la langue courante, sinon celui du registre. */
export function useRubrique() {
	const { dico } = useLangue();
	return useCallback(
		(href: string, defauts: { label: string; note?: string }) => {
			const cle = RUBRIQUES[href.split("#")[0]!];
			const entree = cle ? dico.categories[cle] : undefined;
			return {
				label: entree?.label ?? defauts.label,
				note: entree?.blurb ?? defauts.note,
			};
		},
		[dico]
	);
}

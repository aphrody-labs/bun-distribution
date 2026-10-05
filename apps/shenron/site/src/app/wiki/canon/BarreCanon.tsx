"use client";

/**
 * La barre. C'est tout ce que la page montre tant qu'aucune question n'est
 * posée.
 *
 * Un `<form method="get">` et rien d'autre : la navigation est faite par le
 * navigateur, le résultat est rendu côté serveur, la page reste partageable par
 * son URL (`/wiki/canon?q=…`) et lisible sans JavaScript.
 *
 * La question courante arrive en **prop** depuis le serveur, qui l'a déjà lue
 * dans `searchParams`. La version précédente la relisait au client avec
 * `useSearchParams()` : elle redemandait donc au navigateur ce que la page
 * savait déjà, et imposait en échange une frontière `<Suspense>` autour de la
 * barre (sans quoi Next refuse le rendu). `defaultValue` n'étant lu qu'au
 * premier rendu, le crochet n'apportait rien de plus.
 *
 * Le composant reste « client » pour une seule raison : `autoFocus`, que
 * `react-dom/server` n'écrit jamais dans le HTML — sans hydratation, le champ
 * ne prendrait pas le focus à l'arrivée sur la page vide. L'exemple affiché
 * vient de la doctrine éditée dans /admin/ia?tab=canon.
 */
import { useT } from "@/components/T";

export function BarreCanon({
	q,
	placeholder,
	describedBy,
}: {
	/** La question déjà posée, telle que le serveur l'a lue dans l'URL. */
	q: string;
	placeholder?: string;
	/** `id` de la consigne qui décrit ce que la barre promet, quand elle existe. */
	describedBy?: string;
}) {
	const t = useT();
	return (
		<form
			action="/wiki/canon"
			method="get"
			role="search"
			aria-label={t("home.canon.formLabel")}
			className="relative"
		>
			<label htmlFor="canon-q" className="sr-only">
				{t("wiki.canon.askLabel")}
			</label>
			<input
				id="canon-q"
				name="q"
				type="search"
				defaultValue={q}
				autoComplete="off"
				
				enterKeyHint="search"
				aria-describedby={describedBy}
				placeholder={placeholder || t("wiki.canon.placeholder")}
				className="w-full rounded-full border border-white/15 bg-white/[0.04] py-4 pl-6 pr-32 text-[16px] text-white placeholder:text-white/45 outline-none transition-colors focus:border-dbz-orange/60 focus:bg-white/[0.06]"
			/>
			<button
				type="submit"
				className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-dbz-orange px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-black transition-opacity hover:opacity-90"
			>
				{t("home.canon.submit")}
			</button>
		</form>
	);
}

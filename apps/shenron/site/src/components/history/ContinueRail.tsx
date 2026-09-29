"use client";

/**
 * Rail « Reprendre » — les dernières fiches ouvertes, tirées de l'historique local.
 *
 * Rend `null` tant qu'il n'y a rien : un nouveau visiteur ne doit pas voir un
 * bloc vide. Le premier rendu est donc TOUJOURS `null` côté serveur ET au
 * montage client, puis l'état arrive après l'effet — c'est ce qui évite une
 * divergence d'hydratation (le serveur n'a aucun accès à `localStorage`).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Croix } from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import { forgetHistory, readHistory, HISTORY_EVENT, type HistoryEntry } from "@/lib/history";
import { useT } from "@/components/T";

/** Le type d'entrée, nommé par le dictionnaire : c'est une étiquette d'interface. */
const KIND_KEY: Record<HistoryEntry["kind"], string> = {
	episode: "history.kind.episode",
	movie: "history.kind.movie",
	chapter: "history.kind.chapter",
	databook: "history.kind.databook",
};

export function ContinueRail({
	limit = 12,
	kinds,
	titleKey = "history.resume",
	titleValues,
	className = "",
}: {
	limit?: number;
	/** Restreint le rail à certains types (ex. `["chapter"]` sur /wiki/manga). */
	kinds?: ReadonlyArray<HistoryEntry["kind"]>;
	/** Clé de dictionnaire du titre du rail (`history.resume*`). */
	titleKey?: string;
	titleValues?: Record<string, string | number>;
	className?: string;
}) {
	const t = useT();
	const titre = t(titleKey, titleValues);
	const [items, setItems] = useState<HistoryEntry[] | null>(null);

	// Les appelants passent un littéral (`kinds={["episode"]}`) : sa référence
	// change à chaque rendu du parent. On dépend donc de son CONTENU, sinon
	// l'effet réinstalle l'écouteur d'historique et relit `localStorage` à
	// chaque rendu.
	//
	// Le « | » de tête sépare deux cas que la simple jointure confondait :
	// « aucun filtre » (`kinds` absent ⇒ tout l'historique) et « filtre vide »
	// (`kinds={[]}` ⇒ rien). Sans lui, les deux donnaient la même chaîne creuse
	// et une liste de types vide affichait l'historique ENTIER.
	const cleKinds = kinds ? `|${kinds.join(",")}` : "";

	useEffect(() => {
		const autorises = cleKinds ? new Set(cleKinds.slice(1).split(",").filter(Boolean)) : null;
		const load = () => {
			const all = readHistory();
			setItems((autorises ? all.filter((e) => autorises.has(e.kind)) : all).slice(0, limit));
		};
		load();
		window.addEventListener(HISTORY_EVENT, load);
		return () => window.removeEventListener(HISTORY_EVENT, load);
	}, [limit, cleKinds]);

	if (!items || items.length === 0) return null;

	return (
		<section className={`mb-9 lg:mb-12 ${className}`} aria-label={titre}>
			<h2 className="mb-3 flex items-baseline gap-2 font-display text-[19px] font-bold text-white">
				<span className="inline-block h-4 w-1 rounded-full bg-dbz-orange" aria-hidden />
				{titre}
				<span className="text-[13px] font-normal text-white/50">{items.length}</span>
			</h2>
			<ul className="flex snap-x gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{/* `group` posé AUSSI sur le <li> : le bouton « oublier » est un FRÈRE
				    du lien, donc le `group` du <a> — qui sert au zoom de la vignette —
				    ne l'atteignait jamais. Le bouton restait invisible tout en
				    interceptant les clics dans le coin de la carte. */}
				{items.map((e) => (
					<li key={`${e.kind}:${e.id}`} className="group relative shrink-0 snap-start">
						<Link
							href={e.href}
							className="group block w-[240px] overflow-hidden rounded-lg border border-white/[0.08] bg-dbz-card transition-colors hover:border-dbz-orange/50"
						>
							<div className="relative aspect-video overflow-hidden bg-black/40">
								{e.image ? (
									<img
										src={assetUrl(e.image)}
										alt=""
										loading="lazy"
										className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
									/>
								) : (
									<div className="grid h-full w-full place-items-center text-white/50">
										{t(KIND_KEY[e.kind])}
									</div>
								)}
							</div>
							<div className="p-2.5">
								<p className="truncate text-[13px] font-semibold text-white">{e.title}</p>
								<p className="mt-0.5 truncate text-[11px] text-white/50">
									{e.caption ?? t(KIND_KEY[e.kind])}
								</p>
							</div>
						</Link>
						<button
							type="button"
							onClick={() => forgetHistory(e.kind, e.id)}
							aria-label={t("history.forget", { titre: e.title })}
							// Visible par défaut : sur écran tactile il n'y a pas de survol.
							// Au-delà de `md`, il s'efface et revient au survol ou au focus.
							className="cible-44 absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white/70 transition-opacity hover:text-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
						>
							<Croix className="h-3.5 w-3.5" aria-hidden />
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

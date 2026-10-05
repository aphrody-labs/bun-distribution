"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { assetUrl } from "@/lib/assets";
import { publicDatabookImage } from "@/lib/databook-media";
import type { ToriyamaSourceGroup } from "@/lib/toriyama-shared";

export type SortOrder = "date-desc" | "date-asc" | "count-desc" | "title-asc";
export type DecadeFilter = "all" | "80s" | "90s" | "2000s" | "2010s";

interface InterviewsExplorerProps {
	groups: ToriyamaSourceGroup[];
	ragResults?: Array<{ title: string; url: string; snippet: string }>;
}

export function InterviewsExplorer({ groups, ragResults = [] }: InterviewsExplorerProps) {
	const [query, setQuery] = useState("");
	const [sortOrder, setSortOrder] = useState<SortOrder>("date-desc");
	const [decadeFilter, setDecadeFilter] = useState<DecadeFilter>("all");
	const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

	// Filtrage et recherche
	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();

		return groups.filter((group) => {
			// Filtre par décennie
			if (decadeFilter !== "all") {
				const year = group.year;
				if (!year) return false;
				if (decadeFilter === "80s" && (year < 1980 || year > 1989)) return false;
				if (decadeFilter === "90s" && (year < 1990 || year > 1999)) return false;
				if (decadeFilter === "2000s" && (year < 2000 || year > 2009)) return false;
				if (decadeFilter === "2010s" && year < 2010) return false;
			}

			// Recherche textuelle multi-champs
			if (!q) return true;
			const inDoc = group.document.toLowerCase().includes(q);
			const inYear = group.year ? String(group.year).includes(q) : false;
			const inWords = group.words.some(
				(word) =>
					(word.subject && word.subject.toLowerCase().includes(q)) ||
					(word.textFr && word.textFr.toLowerCase().includes(q)) ||
					(word.text && word.text.toLowerCase().includes(q)) ||
					(word.source && word.source.toLowerCase().includes(q))
			);

			return inDoc || inYear || inWords;
		});
	}, [groups, query, decadeFilter]);

	// Tri
	const sorted = useMemo(() => {
		const list = [...filtered];
		switch (sortOrder) {
			case "date-desc":
				return list.toSorted(
					(a, b) => (b.year ?? 0) - (a.year ?? 0) || a.document.localeCompare(b.document, "fr")
				);
			case "date-asc":
				return list.toSorted(
					(a, b) =>
						(a.year ?? 9999) - (b.year ?? 9999) || a.document.localeCompare(b.document, "fr")
				);
			case "count-desc":
				return list.toSorted(
					(a, b) => b.words.length - a.words.length || (b.year ?? 0) - (a.year ?? 0)
				);
			case "title-asc":
				return list.toSorted((a, b) => a.document.localeCompare(b.document, "fr"));
			default:
				return list;
		}
	}, [filtered, sortOrder]);

	// Bascule d'ouverture par document
	const toggleGroup = (key: string) => {
		setOpenGroups((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const expandAll = () => setOpenGroups(new Set(sorted.map((g) => g.documentKey)));
	const collapseAll = () => setOpenGroups(new Set());

	const totalCitationsInView = useMemo(
		() => sorted.reduce((sum, g) => sum + g.words.length, 0),
		[sorted]
	);
	const openGroupsInView = useMemo(
		() => sorted.filter((group) => openGroups.has(group.documentKey)).length,
		[sorted, openGroups]
	);

	return (
		<div className="space-y-6">
			{ragResults.length > 0 && (
				<aside className="rounded-xl border border-violet-300/20 bg-violet-300/5 p-4 text-sm text-white/70" aria-label="Preuves RAG canon">
					<p className="font-semibold text-violet-200">Preuves RAG reliées au corpus canon</p>
					<p className="mt-1 text-xs text-white/55">Ces résultats servent à retrouver les documents ; la citation éditoriale reste celle de l’ouvrage primaire.</p>
					<ul className="mt-3 space-y-1">
						{ragResults.slice(0, 5).map((result) => (
							<li key={`${result.url}-${result.title}`}>
								<Link className="text-violet-200 underline-offset-4 hover:underline" href={result.url.startsWith("/") ? result.url : `/wiki/interviews#rag-${encodeURIComponent(result.title)}`}>
									{result.title}
								</Link>
							</li>
						))}
					</ul>
				</aside>
			)}
			{/* Barre d'outils interactive : Recherche, Tri, Filtre par décennie */}
			<div className="rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-md space-y-4">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					{/* Champ de recherche */}
					<div className="relative min-w-0 flex-1">
						<label htmlFor="interview-search" className="sr-only">
							Rechercher une interview ou un mot-clé
						</label>
						<input
							id="interview-search"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Rechercher une interview, un sujet (ex: Vegeta, Super Saiyan, Beerus)..."
							className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pl-10 text-sm text-white placeholder-white/40 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
						/>
						<svg
							className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
						{query && (
							<button
								type="button"
								onClick={() => setQuery("")}
								className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white"
							>
								Effacer
							</button>
						)}
					</div>

					{/* Sélecteur de tri */}
					<div className="flex items-center gap-2">
						<label
							htmlFor="interview-sort"
							className="text-xs font-semibold uppercase tracking-wider text-white/50 shrink-0"
						>
							Tri :
						</label>
						<select
							id="interview-sort"
							value={sortOrder}
							onChange={(e) => setSortOrder(e.target.value as SortOrder)}
							className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-white outline-none transition focus:border-orange-500"
						>
							<option value="date-desc" className="bg-neutral-900 text-white">
								📅 Plus récents d'abord
							</option>
							<option value="date-asc" className="bg-neutral-900 text-white">
								⏳ Plus anciens d'abord
							</option>
							<option value="count-desc" className="bg-neutral-900 text-white">
								💬 Plus de citations
							</option>
							<option value="title-asc" className="bg-neutral-900 text-white">
								🔤 Titre (A-Z)
							</option>
						</select>
					</div>
				</div>

				{/* Ligne des filtres par décennie & actions Tout déplier / Tout replier */}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
					<div
						className="flex flex-wrap items-center gap-1.5"
						role="group"
						aria-label="Filtrer par époque"
					>
						<span className="mr-1 text-xs font-medium text-white/40">Époque :</span>
						{[
							{ id: "all", label: "Toutes" },
							{ id: "80s", label: "Années 80 (1980-89)" },
							{ id: "90s", label: "Années 90 (1990-99)" },
							{ id: "2000s", label: "Années 2000" },
							{ id: "2010s", label: "Années 2010+" },
						].map((pill) => (
							<button
								key={pill.id}
								type="button"
								onClick={() => setDecadeFilter(pill.id as DecadeFilter)}
								aria-pressed={decadeFilter === pill.id}
								className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
									decadeFilter === pill.id
										? "bg-dbz-orange text-black shadow-md shadow-orange-950/40"
										: "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
								}`}
							>
								{pill.label}
							</button>
						))}
					</div>

					{/* Boutons Tout déplier / replier */}
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={expandAll}
							className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
						>
							Tout déplier ↓
						</button>
						<button
							type="button"
							onClick={collapseAll}
							className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
						>
							Tout replier ↑
						</button>
					</div>
				</div>

				{/* Résumé des résultats */}
				<div className="text-xs text-white/50 flex items-center justify-between" aria-live="polite">
					<span>
						<strong>{sorted.length}</strong> document{sorted.length > 1 ? "s" : ""} affiché
						{sorted.length > 1 ? "s" : ""} · <strong>{totalCitationsInView}</strong> citation
						{totalCitationsInView > 1 ? "s" : ""}
					</span>
					{openGroupsInView > 0 && (
						<span className="text-dbz-orange/90 font-medium">
							{openGroupsInView} document{openGroupsInView > 1 ? "s" : ""} déplié
							{openGroupsInView > 1 ? "s" : ""}
						</span>
					)}
				</div>
			</div>

			{/* Liste des interviews en accordéon cliquable */}
			{sorted.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center text-sm text-white/55">
					Aucun document d'interview ne correspond à vos critères de recherche.
				</div>
			) : (
				<section className="space-y-3" aria-label="Documents d'interviews et prises de parole">
					{sorted.map((group) => {
						const cover = publicDatabookImage(group.cover);
						const href = group.databookId
							? `/wiki/databooks/${group.databookId}`
							: "/wiki/toriyama";
						const isOpen = openGroups.has(group.documentKey);

						return (
							<article
								key={group.documentKey}
								id={`doc-${group.documentKey}`}
								className="dbz-panel overflow-hidden transition-all duration-200 hover:border-white/20"
							>
								{/* En-tête dépliable cliquable avec la flèche */}
								<button
									type="button"
									onClick={() => toggleGroup(group.documentKey)}
									aria-expanded={isOpen}
									className="w-full text-left flex items-stretch transition-colors hover:bg-white/[0.02]"
								>
									{/* Miniature de couverture */}
									{cover ? (
										<div className="relative w-20 sm:w-28 shrink-0 self-stretch bg-black/40">
											<img
												src={assetUrl(cover)}
												alt=""
												className="h-full w-full object-cover"
												loading="lazy"
											/>
										</div>
									) : (
										<div className="w-16 sm:w-20 shrink-0 self-stretch bg-gradient-to-br from-dbz-orange/20 to-black/80 flex items-center justify-center text-dbz-orange/40 font-bold text-xs">
											DOC
										</div>
									)}

									{/* Détails du document */}
									<div className="flex-1 p-3.5 sm:p-4 min-w-0 flex flex-col justify-center">
										<div className="flex flex-wrap items-center gap-2">
											<span className="inline-block rounded-md bg-dbz-orange/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-dbz-orange border border-dbz-orange/30">
												{group.year ?? "Date à documenter"}
											</span>
											<span className="text-xs text-white/50">
												{group.words.length} citation{group.words.length > 1 ? "s" : ""}
											</span>
										</div>
										<h2 className="mt-1 font-display text-base sm:text-lg font-bold text-white truncate">
											{group.document}
										</h2>
									</div>

									{/* Flèche / Chevron indicateur */}
									<div className="flex items-center px-4 sm:px-6 text-white/60 hover:text-white shrink-0">
										<div
											className={`flex items-center justify-center h-8 w-8 rounded-full border border-white/10 bg-white/5 transition-transform duration-200 ${isOpen ? "rotate-180 bg-dbz-orange/20 text-dbz-orange border-dbz-orange/40" : ""}`}
										>
											<svg
												className="h-4 w-4"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2.5}
													d="M19 9l-7 7-7-7"
												/>
											</svg>
										</div>
									</div>
								</button>

								{/* Contenu dépliable des citations */}
								{isOpen && (
									<div className="border-t border-white/10 bg-black/30 p-4 sm:p-6 animate-in fade-in duration-200">
										{group.words.length > 0 ? (
											<ul className="space-y-4">
												{group.words.map((word) => (
													<li
														key={word.id}
														className="rounded-xl border border-white/5 bg-white/[0.02] p-4 border-l-4 border-l-dbz-orange shadow-inner"
													>
														{word.subject && (
															<h3 className="font-semibold text-white text-sm sm:text-base flex items-center gap-2">
																<span className="inline-block h-1.5 w-1.5 rounded-full bg-dbz-orange" />
																{word.subject}
															</h3>
														)}
														<p className="mt-2 whitespace-pre-line text-xs sm:text-sm leading-relaxed text-white/85">
															{word.textFr ?? word.text}
														</p>
														<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2 text-[11px] text-white/50">
															<span>{word.source}</span>
															{word.lang === "ja" && word.textFr && (
																<span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
																	Version originale japonaise traduite
																</span>
															)}
														</div>
													</li>
												))}
											</ul>
										) : (
											<p className="text-sm text-white/55 italic">
												Document répertorié ; sa transcription n'est pas encore disponible.
											</p>
										)}

										<div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
											<Link
												href={href}
												className="inline-flex items-center gap-1.5 text-xs font-bold text-dbz-orange hover:text-white transition"
											>
												Voir le document source d'origine →
											</Link>
											<button
												type="button"
												onClick={() => toggleGroup(group.documentKey)}
												className="text-xs text-white/50 hover:text-white transition"
											>
												Replier ↑
											</button>
										</div>
									</div>
								)}
							</article>
						);
					})}
				</section>
			)}
		</div>
	);
}

"use client";

/**
 * Grille des databooks & interviews.
 *
 * Filtres **unifiés** (même style de boutons) — un seul plan de catégories :
 *   Tout · Databook · Interview · Art Book · Saikyō Jump · V-Jump · …
 *
 * Un seul filtre actif à la fois + tri date + recherche.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pagination } from "@/components/ui/Pagination";
import { Bibliotheque, DragonRadar, Livre, Micro, Palette, Tendance } from "@/components/icones";
import { ViewTransition } from "@/components/ViewTransition";
import { WikiImg } from "@/components/wiki/WikiImg";
import {
	DATABOOK_CATEGORIES,
	resolveDatabookCategory,
	type DatabookCategory,
} from "@/lib/databook-categories";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import type { AccessSnapshot } from "@/lib/wiki-launch";
import { toMillis } from "@/lib/epoch";

export interface DatabookItem {
	id: number;
	kind: string;
	/** Catégorie unifiée (Databook, Interview, Art Book, V-Jump…). Null → « Autre ». */
	category: string | null;
	title: string;
	titleJa: string | null;
	author: string | null;
	publishedAt: number | null;
	/** Chemin d'asset brut (résolu via WikiImg / assetUrl), pas une URL absolue. */
	cover: string | null;
	/** Nombre de pages réellement renseignées (image ou transcription). */
	pageCount: number;
	/** Une description éditoriale existe, même sans planche. */
	hasDescription: boolean;
}

type ContentFilter = "all" | "disponibles" | "a-completer";

type FilterTab =
	| { key: "all"; label: string; mode: "all"; icon: null }
	| {
			key: DatabookCategory;
			label: string;
			mode: "category";
			icon: typeof Livre | typeof Micro | typeof Palette | typeof Bibliotheque | null;
	  };

const CATEGORY_ICONS: Partial<
	Record<DatabookCategory, typeof Livre | typeof Micro | typeof Palette | typeof Bibliotheque>
> = {
	Databook: Livre,
	"Art Book": Palette,
	"Saikyō Jump": Bibliotheque,
};

const FILTER_TABS: FilterTab[] = [
	{ key: "all", label: "Tout", mode: "all", icon: null },
	...DATABOOK_CATEGORIES.filter((c) => c !== "Interview").map((c): FilterTab => ({
		key: c,
		label: c,
		mode: "category",
		icon: CATEGORY_ICONS[c] ?? null,
	})),
];

/**
 * Match filtre catégorie + legacy kind.
 * Si `category` est déjà une valeur canonique (≠ Autre), elle prime.
 * Sinon on retombe sur `kind` (données avant unification).
 */
function matchesCategory(d: DatabookItem, cat: DatabookCategory): boolean {
	const resolved = resolveDatabookCategory(d.category);
	if (resolved === cat) return true;
	// Legacy : category vide/Autre + kind type précis
	if (resolved !== "Autre") return false;
	const kind = (d.kind ?? "").toLowerCase();
	if (cat === "Interview" && kind === "interview") return true;
	if (cat === "Art Book" && (kind === "artbook" || kind === "art_book")) return true;
	if (cat === "Saikyō Jump" && (kind === "guidebook" || kind === "guide_book")) return true;
	return false;
}

function formatDate(v: number | null): string {
	if (!v) return "—";
	const ms = toMillis(v);
	try {
		return new Date(ms).toLocaleDateString("fr-FR", { year: "numeric", month: "long" });
	} catch {
		return "—";
	}
}

function norm(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

const tabBtn =
	// `min-h-11` (44 px) : les onglets mesuraient 34 px de haut sur mobile, sous
	// la cible tactile recommandée. `shrink-0` + `snap-start` servent au rail
	// défilant qui remplace le retour à la ligne sur petit écran.
	"inline-flex shrink-0 snap-start items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors min-h-11 sm:min-h-0 sm:py-1.5";
const tabActive = "border-dbz-orange bg-dbz-orange/10 text-white";
const tabIdle = "border-dbz-border text-white/60 hover:border-dbz-orange/40 hover:text-white";

export function DatabookGrid({
	items,
	access,
}: {
	items: DatabookItem[];
	/** Instantané de la configuration de lancement, résolu côté serveur. */
	access?: AccessSnapshot | null;
}) {
	const [filter, setFilter] = useState<string>("all");
	const [q, setQ] = useState("");
	const [order, setOrder] = useState<"desc" | "asc">("desc");
	const [contentFilter, setContentFilter] = useState<ContentFilter>("all");

	useEffect(() => {
		try {
			const value = new URLSearchParams(window.location.search).get("etat");
			if (value === "disponibles" || value === "a-completer") setContentFilter(value);
		} catch {
			// URL indisponible : l'état par défaut reste « Tout ».
		}
	}, []);

	const changeContentFilter = (value: ContentFilter) => {
		setContentFilter(value);
		try {
			const url = new URL(window.location.href);
			if (value === "all") url.searchParams.delete("etat");
			else url.searchParams.set("etat", value);
			window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
		} catch {
			// L'état local reste utilisable dans un environnement sans historique.
		}
	};

	const activeTab = FILTER_TABS.find((t) => t.key === filter) ?? FILTER_TABS[0]!;

	const filtered = useMemo(() => {
		const needle = norm(q);
		return items
			.filter((d) => {
				const hasContent = d.pageCount > 0 || d.hasDescription;
				if (contentFilter === "disponibles" && !hasContent) return false;
				if (contentFilter === "a-completer" && hasContent) return false;
				if (activeTab.mode === "all") return true;
				return matchesCategory(d, activeTab.key as DatabookCategory);
			})
			.filter((d) => {
				if (!needle) return true;
				const hay = norm(
					`${d.title} ${d.titleJa ?? ""} ${d.author ?? ""} ${resolveDatabookCategory(d.category)}`
				);
				return hay.includes(needle);
			})
			.slice()
			.toSorted((a, b) => {
				const av = a.publishedAt ?? 0;
				const bv = b.publishedAt ?? 0;
				return order === "desc" ? bv - av : av - bv;
			});
	}, [items, activeTab, contentFilter, q, order]);

	// Pagination : les 318 ouvrages étaient rendus d'un coup, couverture
	// comprise — 726 Ko de HTML pour une grille dont on voit vingt cases.
	const PAR_PAGE = 40;
	const [page, setPage] = useState(1);
	// Changer l'état de complétude modifie aussi le jeu filtré : rester sur la
	// page 4 après avoir choisi « À compléter » pouvait afficher une page vide
	// alors que des fiches existaient sur la première page.
	useEffect(() => setPage(1), [filter, contentFilter, q, order]);
	const pages = Math.max(1, Math.ceil(filtered.length / PAR_PAGE));
	const pageSure = Math.min(page, pages);
	const visibles = useMemo(
		() => filtered.slice((pageSure - 1) * PAR_PAGE, pageSure * PAR_PAGE),
		[filtered, pageSure]
	);

	return (
		<div className="space-y-6">
			{/* Arborescence des Archives Imprimées Dragon Ball */}
			<nav aria-label="Sections des publications imprimées" className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/40 p-2 backdrop-blur-md">
				<Link
					href="/wiki/manga"
					className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
				>
					<span className="text-sm">📖</span> Manga Canonique (42 Tomes)
				</Link>
				<div
					aria-current="page"
					className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3.5 py-2 text-xs font-bold text-orange-300 shadow-sm"
				>
					<span className="text-sm">📚</span> Databooks & Guides
				</div>
				<Link
					href="/wiki/romans"
					className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
				>
					<span className="text-sm">📑</span> Romans & Light Novels
				</Link>
				<Link
					href="/wiki/interviews"
					className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
				>
					<span className="text-sm">🎙️</span> Interviews Toriyama
				</Link>
			</nav>

			{/* Une seule rangée de filtres, tous au même plan (même taille / style). */}
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
				{/* Rail défilant sur mobile : les 11 catégories occupaient 4 lignes
				    (≈ 160 px) avant même la première couverture. Elles tiennent
				    maintenant sur une ligne que l'on fait glisser, et reprennent le
				    retour à la ligne dès `sm`. */}
				<div
					className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
					role="group"
					aria-label="Filtrer par catégorie"
				>
					{FILTER_TABS.map((t) => {
						const Icon = t.icon;
						const active = filter === t.key;
						return (
							<button
								key={t.key}
								type="button"
								onClick={() => setFilter(t.key)}
								aria-pressed={active}
								className={`${tabBtn} ${active ? tabActive : tabIdle}`}
							>
								{Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
								{t.label}
							</button>
						);
					})}
				</div>
				<div
					className="flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-3 sm:border-t-0 sm:pt-0"
					role="group"
					aria-label="Filtrer par état du contenu"
				>
					<span className="mr-1 font-scouter text-[10px] uppercase tracking-wider text-white/40">
						Contenu
					</span>
					{(
						[
							["all", "Tout"],
							["disponibles", "Présent"],
							["a-completer", "À compléter"],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							onClick={() => changeContentFilter(value)}
							aria-pressed={contentFilter === value}
							className={`${tabBtn} ${contentFilter === value ? tabActive : tabIdle}`}
						>
							{label}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2 sm:contents">
					<button
						type="button"
						onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
						className={`${tabBtn} ${tabIdle}`}
						title="Inverser le tri par date"
					>
						<Tendance size={14} className="shrink-0" />
						{order === "desc" ? "Plus récent" : "Plus ancien"}
					</button>
					<div className="relative min-w-0 flex-1 sm:ml-auto sm:w-72 sm:flex-none">
						<DragonRadar className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
						<input
							type="search"
							enterKeyHint="search"
							className="min-h-11 w-full rounded-lg border border-dbz-border bg-dbz-bg px-3 py-2 pl-8 text-base text-white focus:border-dbz-orange focus:outline-none sm:min-h-0 sm:py-1.5 sm:text-sm"
							placeholder="Rechercher un guide…"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							aria-label="Rechercher un databook ou une interview"
						/>
					</div>
				</div>
				<p
					aria-live="polite"
					className="shrink-0 text-[11px] tabular-nums uppercase tracking-wider text-dbz-orange/80 sm:ml-1"
				>
					{filtered.length} / {items.length}
				</p>
			</div>

			{filtered.length === 0 ? (
				<p className="py-12 text-center text-sm italic text-white/50">
					{q.trim() ? `Aucun résultat pour « ${q.trim()} ».` : "Aucun résultat pour ce filtre."}
				</p>
			) : (
				<div className="reveal-grid grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
					{visibles.map((d) => {
						const cat = resolveDatabookCategory(d.category);
						const Icon = CATEGORY_ICONS[cat] ?? Livre;
						return (
							<ClientGatedWrap
								access={access}
								key={d.id}
								href={`/wiki/databooks/${d.id}`}
								transitionTypes={["nav-forward"]}
								aria-label={`${cat} : ${d.title}`}
								className="group block cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange focus-visible:ring-offset-2 focus-visible:ring-offset-dbz-bg"
							>
								{/* Légende SOUS la couverture, comme les affiches de films et
								    les tomes du manga (`components/stream/PosterCard`). Le
								    titre était auparavant posé sur le scan, ce qui obligeait à
								    noircir la moitié basse de chaque jaquette pour rester
								    lisible : la grille entière paraissait éteinte alors que les
								    couvertures de V-Jump sont très colorées. */}
								<div className="ki-card relative aspect-[2/3] overflow-hidden rounded-lg bg-dbz-card shadow-lg ring-1 ring-white/[0.06] transition-all duration-300 group-hover:ring-dbz-orange/60 group-hover:shadow-dbz-orange/20">
									{d.cover ? (
										<ViewTransition name={`databook-img-${d.id}`} share="morph">
											<WikiImg
												src={d.cover}
												alt={d.title}
												sizes="(min-width: 1024px) 240px, (min-width: 640px) 30vw, 45vw"
												className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
												loading="lazy"
											/>
										</ViewTransition>
									) : (
										// Un ouvrage sans scan affichait une icône `text-white/20`
										// sur fond noir : indiscernable d'une tuile cassée. On
										// nomme l'absence au lieu de la laisser deviner.
										<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-dbz-card to-black text-white/35">
											<div aria-hidden className="absolute inset-0 halftone opacity-[0.08]" />
											<Icon className="relative h-9 w-9" />
											<span className="relative px-2 text-center text-[10px] font-bold uppercase tracking-widest">
												Sans couverture
											</span>
										</div>
									)}
									<span aria-hidden className="ki-card__glow" />
									{/* Un seul badge : la catégorie unifiée */}
									<span className="absolute left-1.5 top-1.5 z-30 max-w-[85%] truncate rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-dbz-orange backdrop-blur">
										{cat}
									</span>
									<span
										className={`absolute bottom-1.5 left-1.5 z-30 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider backdrop-blur ${
											d.pageCount > 0
												? "bg-emerald-400/85 text-black"
												: d.hasDescription
													? "bg-dbz-orange/85 text-black"
													: "bg-black/80 text-white/80"
										}`}
									>
										{d.pageCount > 0
											? `${d.pageCount} page${d.pageCount > 1 ? "s" : ""}`
											: d.hasDescription
												? "Fiche"
												: "À compléter"}
									</span>
								</div>
								<div className="mt-2 px-0.5">
									<p className="line-clamp-2 font-display text-[13px] font-semibold leading-snug text-white/90 transition-colors group-hover:text-dbz-orange">
										{d.title}
									</p>
									{d.titleJa && (
										<p
											lang="ja"
											className="mt-0.5 truncate font-jp text-[11px] tracking-wider text-dbz-yellow/70"
										>
											{d.titleJa}
										</p>
									)}
									<p className="mt-0.5 truncate text-[11px] text-white/55">
										{formatDate(d.publishedAt)}
										{d.author ? ` · ${d.author}` : ""}
									</p>
								</div>
							</ClientGatedWrap>
						);
					})}
				</div>
			)}

			<Pagination
				page={pageSure}
				parPage={PAR_PAGE}
				total={filtered.length}
				onPageChange={setPage}
				unite="ouvrages"
				className="pt-6"
			/>
		</div>
	);
}

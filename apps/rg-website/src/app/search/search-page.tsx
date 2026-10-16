import { BookOpen, Newspaper, Search, Swords } from "lucide-react";
import Link from "next/link";

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@rosegriffon/ui";
import {
	DOMAINES_RECHERCHE,
	LIBELLES_TYPES_RECHERCHE,
	type DomaineRecherche,
	type ResultatRecherche,
} from "@rosegriffon/search";

const DOMAINES = {
	association: {
		icon: Newspaper,
		label: "Association",
		lien: "/news",
		lienLabel: "Toutes les actualités",
	},
	wiki: {
		icon: BookOpen,
		label: "Wiki Azalée",
		lien: "/wiki",
		lienLabel: "Explorer le wiki",
	},
	esport: {
		icon: Swords,
		label: "E-Sport Achilléa",
		lien: "/achillea",
		lienLabel: "Espace E-Sport",
	},
} as const satisfies Record<
	DomaineRecherche,
	{ icon: typeof Search; label: string; lien: string; lienLabel: string }
>;

function estOnglet(value: string): value is DomaineRecherche {
	return DOMAINES_RECHERCHE.some((domaine) => domaine === value);
}

export async function SearchPageContent({
	searchParams,
	search,
}: {
	searchParams: Promise<{ q?: string; tab?: string }>;
	search: (query: string) => Promise<ResultatRecherche[]>;
}) {
	const params = await searchParams;
	const query = params.q?.trim() ?? "";
	const activeTab = params.tab && estOnglet(params.tab) ? params.tab : "all";
	let resultats: ResultatRecherche[] = [];
	let indisponible = false;

	if (query.length >= 2) {
		try {
			resultats = await search(query);
		} catch (erreur) {
			console.error("Erreur page recherche unifiée:", erreur);
			indisponible = true;
		}
	}

	const groupes = DOMAINES_RECHERCHE.map((domaine) => ({
		domaine,
		resultats: resultats.filter((resultat) => resultat.domaine === domaine),
	}));
	const groupesAffiches = groupes.filter(
		({ domaine }) => activeTab === "all" || activeTab === domaine
	);

	return (
		<div className="container mx-auto max-w-6xl space-y-8 px-4 py-8">
			<div className="space-y-4">
				<div className="space-y-1">
					<h1 className="font-expressive-title text-3xl font-black tracking-tight">
						Recherche unifiée
					</h1>
					<p className="text-on-surface-variant">
						Explorez les articles de l’association, le wiki Azalée et l’E-Sport Achilléa.
					</p>
				</div>
				<search><form action="/search" method="get" className="flex max-w-2xl gap-2">
					<Input
						name="q"
						aria-label="Recherche unifiée"
						defaultValue={query}
						placeholder="Rechercher un article, personnage, clan, tournoi…"
						className="h-12 min-w-0 flex-1 text-base"
					/>
					<Button type="submit" className="h-12 px-6 text-base font-bold">
						Rechercher
					</Button>
				</form></search>
			</div>

			{query.length === 1 && <p>Saisissez au moins deux caractères pour lancer la recherche.</p>}
			{indisponible && (
				<p role="alert" className="rounded-xl border border-destructive p-4 text-base">
					La recherche est temporairement indisponible. Réessayez plus tard.
				</p>
			)}

			{query.length >= 2 && !indisponible && (
				<div className="space-y-6">
					<nav
						aria-label="Filtrer les résultats"
						className="flex gap-2 overflow-x-auto border-b pb-3"
					>
						{[
							{ id: "all", label: "Tous", count: resultats.length },
							...groupes.map(({ domaine, resultats: items }) => ({
								id: domaine,
								label: DOMAINES[domaine].label,
								count: items.length,
							})),
						].map(({ id, label, count }) => (
							<Link
								key={id}
								href={`/search?q=${encodeURIComponent(query)}&tab=${id}`}
								aria-current={activeTab === id ? "page" : undefined}
								className="hover:bg-surface-container-high aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground shrink-0 rounded-full px-4 py-2 text-base"
							>
								{label} ({count})
							</Link>
						))}
					</nav>

					{groupesAffiches.every(({ resultats: items }) => items.length === 0) && (
						<output  className="rounded-xl border p-6 text-center text-base">
							Aucun résultat trouvé pour « {query} » dans cet onglet.
						</output>
					)}

					{groupesAffiches
						.filter(({ resultats: items }) => items.length > 0)
						.map(({ domaine, resultats: items }) => {
							const config = DOMAINES[domaine];
							const Icon = config.icon;
							return (
								<section key={domaine} className="space-y-3" aria-label={config.label}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<h2 className="flex items-center gap-2 text-xl font-bold">
											<Icon className="size-5" aria-hidden="true" />
											{config.label} ({items.length})
										</h2>
										<Link
											href={config.lien}
											className="text-primary text-base underline-offset-2 hover:underline"
										>
											{config.lienLabel} →
										</Link>
									</div>
									<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
										{items.map((item) => (
											<Link key={`${item.type}-${item.id}`} href={item.href} className="group">
												<Card className="group-hover:border-primary h-full transition-colors">
													<CardHeader>
														<CardTitle className="group-hover:text-primary text-base">
															{item.titre}
														</CardTitle>
													</CardHeader>
													<CardContent className="text-on-surface-variant space-y-1 text-sm">
														<p>{LIBELLES_TYPES_RECHERCHE[item.type]}</p>
														{item.detail && <p>{item.detail}</p>}
													</CardContent>
												</Card>
											</Link>
										))}
									</div>
								</section>
							);
						})}
				</div>
			)}
		</div>
	);
}

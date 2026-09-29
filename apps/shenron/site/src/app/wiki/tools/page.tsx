import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SectionUnavailable } from "@/components/wiki/SectionUnavailable";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Outils & Modding Dragon Ball",
	description:
		"Outils communautaires Dragon Ball : modding, shaders, API publiques et utilitaires de recherche.",
	alternates: { canonical: "/wiki/tools" },
};

export default async function ToolsPage() {
	const data = await dbUniverse.tools();
	const tools = data?.tools ?? [];
	if (tools.length === 0) return <SectionUnavailable title="Outils & Modding" />;

	const categories = {
		modding: "Modding & Reverse Engineering",
		shader: "Shaders & Graphismes",
		api: "APIs & Données",
		utility: "Utilitaires & Divers",
	} as const;

	/**
	 * Le libellé court repris en pied de carte.
	 *
	 * La carte affichait la clé BRUTE de la catégorie — « api », « modding » —
	 * juste sous un titre de rubrique qui disait déjà la même chose en français.
	 */
	const CATEGORY_SHORT: Record<string, string> = {
		modding: "Modding",
		shader: "Shader",
		api: "API",
		utility: "Utilitaire",
	};

	/**
	 * « N/A » est une valeur du moissonnage, pas un langage.
	 *
	 * GitHub ne renvoie pas de langage dominant pour un dépôt de documents ; la
	 * ligne l'a stocké littéralement. Afficher « Auteur : X · N/A » donne une
	 * information fausse là où il n'y en a simplement aucune.
	 */
	const langue = (valeur: string | null) =>
		valeur && valeur.trim() && valeur.trim().toUpperCase() !== "N/A" ? valeur.trim() : null;

	/**
	 * L'état d'entretien du dépôt, dit au lecteur.
	 *
	 * La page présentait à l'identique un outil poussé la semaine dernière et un
	 * moissonneur figé depuis 2013. Pour qui vient chercher un outil qui marche,
	 * c'est l'information la plus utile de la carte — et la seule qu'elle taisait.
	 * Seuil à trois ans : en deçà, un dépôt d'outillage de modding qui ne bouge
	 * pas n'est pas mort pour autant.
	 */
	const TROIS_ANS_MS = 3 * 365 * 24 * 3600 * 1000;
	const etat = (tool: { archived: boolean; pushed_at: number | null }) => {
		if (tool.archived) return { texte: "Archivé", titre: "Dépôt archivé en lecture seule sur GitHub" };
		if (tool.pushed_at && Date.now() - tool.pushed_at > TROIS_ANS_MS) {
			const annee = new Date(tool.pushed_at).getFullYear();
			return { texte: `Dormant depuis ${annee}`, titre: `Dernière modification en ${annee}` };
		}
		return null;
	};

	return (
		<div>
			<PageHero
				eyebrow="Communauté"
				title="Outils & Modding"
				image={await pageHero("tools")}
				imageAlt="Outils communautaires Dragon Ball"
			/>

			<div className="wiki-container space-y-16">
				<Breadcrumbs items={[{ label: "Outils & Modding" }]} />
				{Object.entries(categories).map(([key, label]) => {
					const catTools = tools.filter((t) => t.category === key);
					if (catTools.length === 0) return null;

					return (
						<section key={key} className="reveal-up">
							<div className="flex items-center gap-6 mb-10">
								<h2 className="font-saiyan text-3xl text-white uppercase tracking-widest">
									{label}
								</h2>
								<span className="scouter-text shrink-0 text-sm text-dbz-orange/70">
									{catTools.length}
								</span>
								<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
								{catTools.map((tool) => (
									<a
										key={tool.id}
										href={tool.url}
										target="_blank"
										rel="noopener noreferrer"
										className="dbz-panel p-6 hover:border-dbz-orange transition-all group flex flex-col justify-between"
									>
										<div>
											<div className="mb-4 flex items-start justify-between gap-3">
												{/* `min-w-0` + `break-words` : un nom de dépôt sans espace
												    (« DragonBallXenoverse2-ModTools ») imposait sa largeur à
												    la carte, et le badge d'étoiles sortait de l'écran à
												    320 px. `shrink-0` sur le badge pour qu'il ne se fasse
												    pas écraser en retour. */}
												<h3 className="min-w-0 break-words text-xl font-bold text-white transition-colors group-hover:text-dbz-orange">
													{tool.name.split("/")[1] || tool.name}
												</h3>
												<span className="scouter-text shrink-0 text-xs text-dbz-orange">
													⭐ {tool.stars}
												</span>
											</div>
											<p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-3">
												Auteur : {tool.author}
												{langue(tool.language) ? ` · ${langue(tool.language)}` : ""}
											</p>
											{etat(tool) && (
												<p
													title={etat(tool)?.titre}
													className="mb-3 inline-block rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300/90"
												>
													{etat(tool)?.texte}
												</p>
											)}
											<p className="text-gray-400 text-sm font-sans leading-relaxed line-clamp-3">
												{tool.description}
											</p>
										</div>
										<div className="mt-6 pt-4 border-t border-white/5 flex justify-between items-center">
											<span className="text-[9px] font-bold text-dbz-orange/60 uppercase tracking-widest">
												{CATEGORY_SHORT[tool.category ?? ""] ?? tool.category}
											</span>
											<span className="text-dbz-orange group-hover:translate-x-1 transition-transform">
												VOIR SUR GITHUB →
											</span>
										</div>
									</a>
								))}
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
}

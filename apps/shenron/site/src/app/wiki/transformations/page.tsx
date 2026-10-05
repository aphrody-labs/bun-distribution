import { ContributeRail } from "@/components/kit";
// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { getShenronCharacterCards } from "@/lib/shenron";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { WikiCategoryNav } from "@/components/wiki/WikiCategoryNav";
import { WikiImg } from "@/components/wiki/WikiImg";
import { formatTransformationSlug } from "@/lib/wiki-slugs";
import { ogMeta } from "@/lib/og";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Transformations Dragon Ball",
	description:
		"Toutes les transformations de l'univers Dragon Ball : Super Saiyan, Super Saiyan God, Ultra Instinct, formes finales et leurs guerriers.",
	...ogMeta({
		title: "Transformations Dragon Ball — DBFR",
		description:
			"Toutes les transformations de l'univers Dragon Ball : Super Saiyan, Super Saiyan God, Ultra Instinct, formes finales et leurs guerriers.",
		canonical: "/wiki/transformations",
		type: "website",
	}),
};

// Normalise un nom de transformation pour le regroupement (sans accents/casse).
function norm(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.trim();
}

type Member = { id: number; slug: string; name: string; image: string | null };
type Group = {
	name: string;
	image: string | null;
	ki: string | null;
	members: Member[];
	/**
	 * Identifiant et slug de la transformation qui porte un article, s'il y en a une.
	 * La carte mène alors à SA fiche plutôt qu'à celle du premier personnage —
	 * 23 articles rédigés n'étaient lisibles nulle part.
	 */
	ficheId: number | null;
	ficheSlug: string | null;
};

import { TransformationTreesView } from "@/components/wiki/TransformationTreesView";

export default async function TransformationsPage() {
	const [data, characters] = await Promise.all([
		dbUniverse.transformations(),
		getShenronCharacterCards(),
	]);
	const transformations = data?.transformations ?? [];
	const charById = new Map(characters.map((c) => [c.id, c]));

	// Regroupe par nom de transformation (une carte = un TYPE de transformation,
	// pas une par personnage → évite « Super Saiyan » répété 30 fois).
	const groups = new Map<string, Group>();
	for (const t of transformations) {
		const key = norm(t.name);
		if (!key) continue;
		const char = charById.get(t.character_id);
		let g = groups.get(key);
		if (!g) {
			g = { name: t.name, image: t.image, ki: t.ki, members: [], ficheId: null, ficheSlug: null };
			groups.set(key, g);
		}
		if (!g.image && t.image) g.image = t.image;
		if (!g.ki && t.ki) g.ki = t.ki;
		// Le seuil est le même que celui de `generateStaticParams` de la fiche :
		// pointer une page qui n'a pas été générée donnerait un 404.
		if (!g.ficheId && t.a_article) {
			g.ficheId = t.id;
			g.ficheSlug = formatTransformationSlug(t);
		}
		if (char && !g.members.some((m) => m.id === char.id))
			g.members.push({ id: char.id, slug: char.slug, name: char.name, image: char.image });
	}

	const list = [...groups.values()].toSorted(
		(a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name)
	);

	return (
		<div className="reveal-up min-h-screen">
			<PageHero
				eyebrow="Encyclopédie"
				title="Transformations"
				lead={`${list.length} transformations répertoriées — Super Saiyan, formes divines, Ultra Instinct… et les guerriers qui les maîtrisent.`}
				image={await pageHero("transformations")}
				imageAlt="Transformations Dragon Ball"
			/>

			<div className="wiki-container">
				<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
					<Breadcrumbs items={[{ label: "Transformations" }]} />
					<WikiDrawer />
				</div>
				<WikiCategoryNav active="transformations" className="mb-8" />

				{/* Vue Arbres Évolutifs & Lignées */}
				<div className="mb-12">
					<TransformationTreesView />
				</div>

				<div className="border-t border-white/10 pt-8 mb-6">
					<h3 className="font-saiyan text-2xl text-white">
						TOUTES LES FORMES &amp; TYPES DE TRANSFORMATIONS
					</h3>
					<p className="text-xs text-white/60 mt-1">
						Revue complète des {list.length} fiches de transformations cataloguées et de leurs guerriers associés.
					</p>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
					{list.map((g, idx) => {
						// Image de la transformation, et RIEN d'autre.
						//
						// Ce repli allait chercher le portrait du premier personnage
						// concerné. Tant que les 81 formes portaient une image il ne se
						// déclenchait jamais ; le retrait des sept fan-arts l'a réveillé,
						// et il aurait affiché Gogeta en forme de base sous le titre
						// « Gogeta SSJ ». Une illustration qui montre la mauvaise forme a
						// l'air juste — c'est exactement ce qui la rend pire qu'une case
						// vide. La vignette de repli (l'éclair) dit qu'il manque une
						// illustration ; elle ne prétend rien.
						const img = g.image ?? null;
						const href = g.ficheSlug
							? `/wiki/transformations/${g.ficheSlug}`
							: g.ficheId
								? `/wiki/transformations/${g.ficheId}`
								: g.members[0]
									? `/wiki/personnages/${g.members[0].slug}`
									: "/wiki/personnages";
						const avatars = g.members.filter((m) => m.image).slice(0, 4);
						return (
							<Link
								key={g.name}
								href={href}
								className="group relative overflow-hidden rounded-xl border border-amber-500/20 bg-zinc-950/40 transition-all duration-500 hover:scale-[1.02] hover:border-dbz-orange/70 hover:shadow-[0_0_30px_rgba(255,178,0,0.12)] flex flex-col reveal-up"
								style={{ animationDelay: `${0.05 + idx * 0.03}s` }}
							>
								<div className="relative aspect-[4/3] bg-dbz-bg overflow-hidden">
									<div className="absolute inset-0 halftone opacity-10 z-10 pointer-events-none" />
									<WikiImg
										src={img}
										alt={g.name}
										loading="lazy"
										className="absolute inset-0 w-full h-full object-cover object-top opacity-100 group-hover:scale-110 transition-all duration-700"
										placeholderClassName="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-700 font-saiyan text-3xl"
									/>
									<div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent z-20 pointer-events-none" />
									{g.ki && (
										<span className="absolute top-2 right-2 z-30 scouter-text text-[9px] text-dbz-orange bg-black/60 px-1.5 py-0.5 rounded">
											KI {g.ki}
										</span>
									)}
								</div>

								<div className="relative z-10 p-4 flex flex-col gap-3 flex-1">
									<h2 className="font-saiyan text-lg text-white uppercase tracking-wider leading-tight group-hover:text-dbz-orange transition-colors">
										{g.name}
									</h2>
									<div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
										{avatars.length > 0 ? (
											<div className="flex items-center gap-2.5">
												<div className="flex -space-x-3">
													{avatars.map((m) => (
														<div
															key={m.id}
															className="relative w-7 h-7 rounded-full border border-zinc-900 overflow-hidden bg-zinc-800"
															title={m.name}
														>
															<WikiImg
																src={m.image}
																alt={m.name}
																loading="lazy"
																className="w-full h-full object-cover object-top"
																placeholderClassName="w-full h-full bg-zinc-800"
															/>
														</div>
													))}
												</div>
												<span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">
													{g.members.length} guerrier{g.members.length > 1 ? "s" : ""}
												</span>
											</div>
										) : (
											<span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">
												{g.members.length} guerrier{g.members.length > 1 ? "s" : ""}
											</span>
										)}
										<span className="text-dbz-orange opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
											→
										</span>
									</div>
								</div>
							</Link>
						);
					})}
				</div>
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.transformation" />
			</div>
		</div>
	);
}

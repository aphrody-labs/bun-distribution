import { ContributeRail, DomainBar } from "@/components/kit";
import { getShenronRaces, getShenronCharacterCards } from "@/lib/shenron";
import { slugDeRace } from "@/lib/races-alias";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { assetUrl } from "@/lib/db-universe";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Races Dragon Ball",
	description:
		"Les races de l'univers Dragon Ball : Saiyans, Nameks, Humains, Cyborgs, Démons du Froid et bien plus.",
	alternates: { canonical: "/wiki/races" },
};

/**
 * `glow` porte DÉJÀ la variante `hover:` dans sa chaîne. Le gabarit écrivait
 * `hover:${theme.glow}` : la classe complète n'apparaissait alors nulle part
 * littéralement dans le source, donc Tailwind (qui scanne le fichier) ne
 * générait jamais la règle — le halo au survol ne s'est jamais affiché. Toute
 * classe composée à l'exécution doit être écrite en entier ici.
 */
const defaultTheme = {
	glow: "hover:shadow-[0_0_30px_rgba(245,158,11,0.1)]",
	border: "border-amber-500/20",
	hoverBorder: "group-hover:border-amber-400/80",
	text: "text-amber-400",
	bgGrad: "from-amber-500/5 to-transparent",
	badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const colorThemes: Record<string, typeof defaultTheme> = {
	saiyan: {
		glow: "hover:shadow-[0_0_30px_rgba(255,178,0,0.15)]",
		border: "border-dbz-orange/30",
		hoverBorder: "group-hover:border-dbz-orange/80",
		text: "text-dbz-orange",
		bgGrad: "from-dbz-orange/5 to-transparent",
		badge: "bg-dbz-orange/10 text-dbz-orange border-dbz-orange/20",
	},
	human: {
		glow: "hover:shadow-[0_0_30px_rgba(250,250,250,0.1)]",
		border: "border-zinc-500/20",
		hoverBorder: "group-hover:border-zinc-400/80",
		text: "text-zinc-300",
		bgGrad: "from-zinc-500/5 to-transparent",
		badge: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
	},
	namekian: {
		glow: "hover:shadow-[0_0_30px_rgba(16,185,129,0.15)]",
		border: "border-emerald-500/30",
		hoverBorder: "group-hover:border-emerald-400/80",
		text: "text-emerald-400",
		bgGrad: "from-emerald-500/5 to-transparent",
		badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
	},
	"frieza-race": {
		glow: "hover:shadow-[0_0_30px_rgba(168,85,247,0.15)]",
		border: "border-purple-500/30",
		hoverBorder: "group-hover:border-purple-400/80",
		text: "text-purple-400",
		bgGrad: "from-purple-500/5 to-transparent",
		badge: "bg-purple-500/10 text-purple-400 border-purple-500/20",
	},
	android: {
		glow: "hover:shadow-[0_0_30px_rgba(6,182,212,0.15)]",
		border: "border-cyan-500/30",
		hoverBorder: "group-hover:border-cyan-400/80",
		text: "text-cyan-400",
		bgGrad: "from-cyan-500/5 to-transparent",
		badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
	},
	majin: {
		glow: "hover:shadow-[0_0_30px_rgba(244,63,94,0.15)]",
		border: "border-pink-500/30",
		hoverBorder: "group-hover:border-pink-400/80",
		text: "text-pink-400",
		bgGrad: "from-pink-500/5 to-transparent",
		badge: "bg-pink-500/10 text-pink-400 border-pink-500/20",
	},
	"god-of-destruction": {
		glow: "hover:shadow-[0_0_30px_rgba(139,92,246,0.15)]",
		border: "border-violet-600/30",
		hoverBorder: "group-hover:border-violet-500/80",
		text: "text-violet-400",
		bgGrad: "from-violet-600/5 to-transparent",
		badge: "bg-violet-600/10 text-violet-400 border-violet-600/20",
	},
	angel: {
		glow: "hover:shadow-[0_0_30px_rgba(125,211,252,0.15)]",
		border: "border-sky-300/30",
		hoverBorder: "group-hover:border-sky-200/80",
		text: "text-sky-300",
		bgGrad: "from-sky-300/5 to-transparent",
		badge: "bg-sky-300/10 text-sky-300 border-sky-300/20",
	},
	kaioshin: {
		glow: "hover:shadow-[0_0_30px_rgba(129,140,248,0.15)]",
		border: "border-indigo-400/30",
		hoverBorder: "group-hover:border-indigo-300/80",
		text: "text-indigo-300",
		bgGrad: "from-indigo-400/5 to-transparent",
		badge: "bg-indigo-400/10 text-indigo-300 border-indigo-400/20",
	},
	demon: {
		glow: "hover:shadow-[0_0_30px_rgba(239,68,68,0.15)]",
		border: "border-red-600/30",
		hoverBorder: "group-hover:border-red-500/80",
		text: "text-red-500",
		bgGrad: "from-red-600/5 to-transparent",
		badge: "bg-red-600/10 text-red-500 border-red-600/20",
	},
};

export default async function RacesPage() {
	const [races, characters] = await Promise.all([getShenronRaces(), getShenronCharacterCards()]);
	const heroImage = await pageHero("races");

	// Rattachement par `slugDeRace` et non par égalité de chaîne : la colonne
	// `race` des personnages est un texte libre issu de plusieurs imports
	// (`Terrien`, `Human`, `Namek`, `Android`…) qui ne reprend jamais le nom
	// canonique de la race. Comparer les deux à l'identique laissait 13 des 18
	// races sur « Aucun membre répertorié » alors que la base en peuple 13.
	//
	// Un seul passage sur les personnages, ici : le rattachement se faisait dans
	// la boucle de rendu, donc `slugDeRace` était appelé une fois par couple
	// (race, personnage) — 18 × ~1 300 appels, tous refaits à chaque rendu de la
	// page, pour un regroupement que l'on peut construire en une passe.
	const parRace = new Map<string, typeof characters>();
	for (const c of characters) {
		const slug = slugDeRace(c.race, c.name);
		if (!slug) continue;
		const liste = parRace.get(slug);
		if (liste) liste.push(c);
		else parRace.set(slug, [c]);
	}

	return (
		<div className="reveal-up min-h-screen">
			<PageHero
				eyebrow="Encyclopédie"
				title="Races & Peuples"
				lead={`${races.length} races répertoriées dans l'univers Dragon Ball. Découvrez leurs planètes d'origine, leurs particularités et leurs principaux représentants.`}
				image={heroImage}
				imageAlt="Races Dragon Ball"
			/>

			<div className="wiki-container space-y-8">
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Races & peuples" }]} />
					<WikiDrawer />
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
					{races.map((race, idx) => {
						const theme = colorThemes[race.slug] || defaultTheme;

						const raceChars = parRace.get(race.slug) ?? [];
						const charAvatars = raceChars.filter((c) => !!c.image).slice(0, 4);

						return (
							<Link
								key={race.id}
								href={`/wiki/races/${race.slug}`}
								className={`group relative overflow-hidden rounded-xl border bg-zinc-950/40 p-8 transition-all duration-500 hover:scale-[1.02] ${theme.border} ${theme.hoverBorder} ${theme.glow} flex flex-col justify-between h-[320px] reveal-up`}
								style={{ animationDelay: `${0.1 + idx * 0.05}s` }}
							>
								{heroImage && <div className="pointer-events-none absolute inset-0 opacity-10"><img src={heroImage} alt="" loading="lazy" className="h-full w-full object-cover" /></div>}
								{/* Glowing background gradient */}
								<div
									className={`absolute inset-0 bg-gradient-to-br ${theme.bgGrad} opacity-40 transition-opacity group-hover:opacity-60 pointer-events-none`}
								/>

								{/* Watermark Japanese Characters */}
								{race.nameJa && (
									<div className="absolute right-[-20px] bottom-[-20px] font-jp text-[130px] font-bold text-white/[0.02] group-hover:text-white/[0.04] transition-colors duration-500 select-none pointer-events-none z-0">
										{race.nameJa}
									</div>
								)}

								<div className="relative z-10 space-y-4">
									<header className="flex justify-between items-start">
										<div>
											<h2
												className={`text-3xl font-saiyan tracking-widest leading-none ${theme.text} mb-2`}
											>
												{race.name}
											</h2>
											{race.nameJa && (
												<p className="font-jp text-xs text-white/50 tracking-wider">
													{race.nameJa}
												</p>
											)}
										</div>
										<span
											className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${theme.badge}`}
										>
											{raceChars.length} Guerrier{raceChars.length > 1 ? "s" : ""}
										</span>
									</header>

									{race.description && (
										<p className="text-gray-400 line-clamp-4 font-sans leading-relaxed text-sm">
											{race.description}
										</p>
									)}
								</div>

								{/* Representatives / Card Footer */}
								<div className="relative z-10 flex items-center justify-between mt-auto pt-6 border-t border-white/5">
									{charAvatars.length > 0 ? (
										<div className="flex items-center gap-3">
											<div className="flex -space-x-3">
												{charAvatars.map((c) => (
													<div
														key={c.id}
														className="relative w-8 h-8 rounded-full border border-zinc-900 overflow-hidden bg-zinc-800"
														title={c.name}
													>
														<img
															src={assetUrl(c.image)}
															alt={c.name}
															width={32}
															height={32}
															loading="lazy"
															decoding="async"
															className="w-full h-full object-cover object-top"
														/>
													</div>
												))}
												{raceChars.length > 4 && (
													<div className="w-8 h-8 rounded-full border border-zinc-900 bg-zinc-900 flex items-center justify-center text-[10px] font-bold text-white">
														+{raceChars.length - 4}
													</div>
												)}
											</div>
											<span className="text-[10px] font-bold text-white/50 group-hover:text-white/60 transition-colors uppercase tracking-widest font-sans">
												Membres
											</span>
										</div>
									) : (
										<span className="text-[10px] font-bold text-white/50 uppercase tracking-widest font-sans">
											Aucun membre répertorié
										</span>
									)}
									<span
										className={`text-xl ${theme.text} translate-x-[-5px] opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300`}
									>
										→
									</span>
								</div>
							</Link>
						);
					})}
				</div>
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.race" />
			</div>
		</div>
	);
}

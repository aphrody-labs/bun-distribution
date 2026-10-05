"use client";

import { useMemo, useState } from "react";

import { ClientGatedWrap } from "@/components/GatedClientLink";
import { Sparkles, Flame, Zap, Shield, Swords, Layers, ChevronDown, ChevronUp } from "lucide-react";
import type { TechniqueCard } from "./TechniqueGrid";

interface TechniqueFamily {
	id: string;
	name: string;
	school: string;
	description: string;
	icon: any;
	color: string;
	badge: string;
	filterRegex: RegExp;
}

const FAMILIES: TechniqueFamily[] = [
	{
		id: "kamehameha",
		name: "Lignée & Variantes du Kaméhaméha",
		school: "École Tortue (Kamé Sennin)",
		description:
			"L'attaque emblématique de l'univers Dragon Ball. Créée par Maître Roshi après 50 ans de méditation, perfectionnée par Son Goku, Gohan, Krillin, Yamcha et déclinée en plus de 30 variantes dévastatrices.",
		icon: Zap,
		color: "from-blue-950/40 via-cyan-950/20 to-black border-cyan-500/30 text-cyan-300",
		badge: "32+ Variantes Répertoriées",
		filterRegex: /kamehameha|kaméhaméha/i,
	},
	{
		id: "saiyan_royal",
		name: "Arbre d'Attaque Royal Saiyan (Vegeta)",
		school: "Lignée Royale Saiyan",
		description:
			"L'arsenal destructeur du Prince des Saiyans : du Galick Gun terrestre au Final Flash capable de transpercer la croûte planétaire, en passant par le Big Bang Attack et le Gamma Burst Flash.",
		icon: Flame,
		color: "from-amber-950/40 via-yellow-950/20 to-black border-amber-500/30 text-amber-300",
		badge: "Arsenal du Prince",
		filterRegex: /galick|final flash|big bang|gamma burst|explosion finale|canon garric/i,
	},
	{
		id: "kaio",
		name: "Enseignements Divins de Maître Kaiō",
		school: "Royaume des Morts (Kaiō du Nord)",
		description:
			"Les arts martiaux cosmiques enseignés à Son Goku : le Kaiō-ken (multiplication de ki mettant le corps à rude épreuve) et le Genkidama (concentration de l'énergie vitale de la nature et des êtres vivants).",
		icon: Sparkles,
		color: "from-red-950/40 via-rose-950/20 to-black border-rose-500/30 text-rose-300",
		badge: "Arts Divins du Ki",
		filterRegex: /kaioken|kaiō-ken|genkidama|genki dama|sphère genki/i,
	},
	{
		id: "demon_namek",
		name: "Lignée Démoniaque & Namek (Piccolo / Gohan)",
		school: "Clan Démon & Guerriers Nameks",
		description:
			"Attaques perçantes et concentrées de Piccolo et Gohan : le redoutable Makankōsappō (perceur d'armure), le Masenkō hérité par Gohan enfant, et la Grenade Infernale (Gekiretsu Kōdan).",
		icon: Swords,
		color: "from-purple-950/40 via-indigo-950/20 to-black border-purple-500/30 text-purple-300",
		badge: "Attaques Perçantes",
		filterRegex: /makanko|makankōsappō|masenko|masenkō|grenade infernale|gekiretsu|bakuriki/i,
	},
	{
		id: "crane_school",
		name: "École de la Grue (Tsuru-sen-nin)",
		school: "Dojo de Maître Shen (Tenshinhan & Chaozu)",
		description:
			"Le rival ancestral de l'École Tortue : le Dodonpa létal, la danse de l'air (Bukūjutsu) et le terrible Kikōhō (Canon de l'Esprit) capable de repousser des ennemis infiniment plus puissants au prix de l'énergie vitale.",
		icon: Shield,
		color: "from-emerald-950/40 via-green-950/20 to-black border-emerald-500/30 text-emerald-300",
		badge: "École Rivale",
		filterRegex: /dodonpa|kikoho|kikōhō|shiyoken|shiyōken|bukuujutsu|canon de l'esprit/i,
	},
	{
		id: "freezer_lineage",
		name: "Lignée Impériale de Freezer (Clan Cold)",
		school: "Armée Galactique de Freezer",
		description:
			"Attaques sadiques et impériales d'extermination de planètes : le Rayon de la Mort (Death Beam) tiré du bout du doigt, la Supernova qui réduisit la planète Vegeta en cendres, et la Death Ball.",
		icon: Zap,
		color: "from-fuchsia-950/40 via-purple-950/20 to-black border-fuchsia-500/30 text-fuchsia-300",
		badge: "Extermination Cosmique",
		filterRegex: /death beam|death ball|supernova|rayon de la mort|boule de la mort|cage de la mort/i,
	},
];

export function TechniqueFamiliesView({
	techniques,
}: {
	techniques: TechniqueCard[];
}) {
	const [expandedFamily, setExpandedFamily] = useState<string | null>("kamehameha");

	const grouped = useMemo(() => {
		const map = new Map<string, TechniqueCard[]>();
		for (const fam of FAMILIES) {
			const matches = techniques.filter((t) => fam.filterRegex.test(t.name));
			map.set(fam.id, matches);
		}
		return map;
	}, [techniques]);

	return (
		<div className="space-y-6">
			<div className="rounded-2xl border border-white/10 bg-black/40 p-4 sm:p-5 backdrop-blur-md">
				<h3 className="font-saiyan text-lg text-white flex items-center gap-2">
					<Layers className="h-5 w-5 text-orange-400" />
					<span>HIÉRARCHIE DES FAMILLES D&apos;ATTAQUES &amp; ÉCOLES MARTIALES</span>
				</h3>
				<p className="mt-1 text-xs text-white/70 max-w-2xl">
					Explorez les techniques regroupées par filiation doctrinale : l&apos;évolution du Kaméhaméha à travers les générations, l&apos;arsenal du Prince Vegeta, et les arts martiaux secrets des grandes écoles.
				</p>
			</div>

			<div className="space-y-4">
				{FAMILIES.map((fam) => {
					const Icon = fam.icon;
					const list = grouped.get(fam.id) ?? [];
					const isExpanded = expandedFamily === fam.id;

					return (
						<div
							key={fam.id}
							className={`rounded-2xl border bg-gradient-to-br ${fam.color} p-5 backdrop-blur-xl transition-all shadow-xl`}
						>
							<button
								type="button"
								onClick={() => setExpandedFamily(isExpanded ? null : fam.id)}
								className="flex w-full items-start justify-between gap-4 text-left"
							>
								<div className="space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="rounded-md border border-white/10 bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/60">
											{fam.school}
										</span>
										<span className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
											{fam.badge} ({list.length})
										</span>
									</div>
									<h4 className="font-saiyan text-xl text-white tracking-wide mt-1">
										{fam.name}
									</h4>
									<p className="text-xs text-white/75 leading-relaxed max-w-3xl">
										{fam.description}
									</p>
								</div>
								<div className="flex items-center gap-2 shrink-0 pt-1">
									<span className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/60 hover:text-white transition-colors">
										{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
									</span>
								</div>
							</button>

							{isExpanded && (
								<div className="mt-6 pt-5 border-t border-white/10">
									{list.length === 0 ? (
										<p className="text-xs text-white/50 italic">Aucune technique appariée dans ce filtre.</p>
									) : (
										<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
											{list.map((tech) => (
												<ClientGatedWrap
													key={tech.slug}
													access={undefined}
													href={`/wiki/techniques/${tech.slug}`}
													className="group flex flex-col justify-between rounded-xl border border-white/10 bg-black/50 p-3 hover:border-orange-500/50 hover:bg-black/70 transition-all shadow-md"
												>
													<div>
														<div className="flex items-center justify-between gap-1 text-[10px] text-white/40">
															<span>{tech.type ?? "Technique"}</span>
															{tech.creatorName && (
																<span className="text-orange-300/80 font-medium truncate max-w-[120px]">
																	{tech.creatorName}
																</span>
															)}
														</div>
														<h5 className="font-bold text-sm text-white group-hover:text-orange-300 transition-colors mt-1">
															{tech.name}
														</h5>
														{tech.description && (
															<p className="text-[11px] leading-relaxed text-white/60 line-clamp-2 mt-1.5">
																{tech.description}
															</p>
														)}
													</div>
													<div className="mt-3 text-right text-[10px] font-bold text-orange-400 group-hover:translate-x-0.5 transition-transform">
														Consulter la fiche →
													</div>
												</ClientGatedWrap>
											))}
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

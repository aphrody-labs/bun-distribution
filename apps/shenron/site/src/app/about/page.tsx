import { PageShell } from "@/components/kit";
import React from "react";
import { PageHero } from "@/components/PageHero";
import Link from "next/link";
import { Bouclier, Bulle, Etincelle, Groupe, Livre, Recompense } from "@/components/icones";
import { DISCORD_INVITE } from "@/lib/config";

export const metadata = {
	title: "À propos",
	description:
		"Découvrez DBFR, le hub communautaire français dédié à l'univers de Dragon Ball. Wiki, bot interactif et communauté active.",
	alternates: { canonical: "/about" },
};

export default function AboutPage() {
	return (
		<>
			<PageHero
				eyebrow="Qui sommes-nous ?"
				title="L'alliance DBFR"
				lead="Le sanctuaire francophone de Dragon Ball : une encyclopédie tenue sur le manga et les databooks, un bot Discord, et la communauté qui écrit les deux."
			/>
			<PageShell width="narrow" rhythm="loose" className="space-y-20">
				{/* Les Piliers */}
				<section className="grid gap-6 md:grid-cols-3">
					<div className="dbz-panel p-6 bg-dbz-card/30 border border-white/5 flex flex-col justify-between group hover:border-dbz-orange/30 transition-all duration-300">
						<div className="space-y-4">
							<div className="w-12 h-12 rounded-xl bg-dbz-orange/10 flex items-center justify-center text-dbz-orange">
								<Livre className="w-6 h-6" />
							</div>
							<h2 className="text-xl font-display font-bold text-white group-hover:text-dbz-orange transition-colors">
								Archives de Shenron
							</h2>
							<p className="text-sm text-zinc-400 font-sans leading-relaxed">
								Une base de données exhaustive et rigoureuse sur tous les aspects de la saga :
								personnages, techniques, sagas, films, mangas et jeux vidéo.
							</p>
						</div>
						<Link
							href="/wiki"
							className="text-xs font-bold text-dbz-orange uppercase tracking-wider mt-6 inline-flex items-center gap-1"
						>
							Explorer la base →
						</Link>
					</div>

					<div className="dbz-panel p-6 bg-dbz-card/40 border border-white/10 flex flex-col justify-between group hover:border-dbz-orange/40 transition-all duration-300">
						<div className="space-y-4">
							<div className="w-12 h-12 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-300">
								<Etincelle className="w-6 h-6" />
							</div>
							<h2 className="text-xl font-display font-bold text-white group-hover:text-purple-300 transition-colors">
								Écosystème Thématique
							</h2>
							<p className="text-sm text-white/80 font-sans leading-relaxed">
								Six gardiens virtuels incarnant les figures de l&apos;univers (Beerus, Whis, Shenron, etc.) pour animer et veiller sur la communauté.
							</p>
						</div>
						<Link
							href="/personas"
							className="text-xs font-bold text-purple-300 uppercase tracking-wider mt-6 inline-flex items-center gap-1 hover:underline"
						>
							Consulter les Gardiens →
						</Link>
					</div>

					<div className="dbz-panel p-6 bg-dbz-card/40 border border-white/10 flex flex-col justify-between group hover:border-dbz-orange/40 transition-all duration-300">
						<div className="space-y-4">
							<div className="w-12 h-12 rounded-xl bg-cyan-500/15 flex items-center justify-center text-cyan-300">
								<Groupe className="w-6 h-6" />
							</div>
							<h2 className="text-xl font-display font-bold text-white group-hover:text-cyan-300 transition-colors">
								La Communauté
							</h2>
							<p className="text-sm text-white/80 font-sans leading-relaxed">
								Des passionnés qui échangent chaque jour sur Discord, participent aux quiz, notent les épisodes et enrichissent le wiki.
							</p>
						</div>
						<a
							href={DISCORD_INVITE}
							target="_blank"
							rel="noopener noreferrer"
							className="text-xs font-bold text-cyan-300 uppercase tracking-wider mt-6 inline-flex items-center gap-1 hover:underline"
						>
							Rejoindre le serveur →
						</a>
					</div>
				</section>

				{/* Notre Vision */}
				<section className="dbz-panel p-8 md:p-12 bg-dbz-card/30 border border-white/10 backdrop-blur-md relative overflow-hidden">
					<div className="relative z-10 grid md:grid-cols-2 gap-8 items-center">
						<div className="space-y-6">
							<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-dbz-orange/30 bg-dbz-orange/15 text-dbz-orange text-xs font-display font-semibold uppercase tracking-wider">
								<Recompense className="w-3.5 h-3.5" />
								Notre Philosophie
							</div>
							<h2 className="text-3xl font-display font-bold text-white">
								Unir les générations de passionnés
							</h2>
							<p className="text-sm text-white/80 font-sans leading-relaxed">
								Que vous ayez découvert l&apos;œuvre dans le Club Dorothée des années 90, avec Dragon Ball Z Kai, ou que vous suiviez les publications de Dragon Ball Super et Daima, vous êtes les bienvenus.
							</p>
							<p className="text-sm text-white/80 font-sans leading-relaxed">
								Nous œuvrons pour un espace d&apos;échange respectueux, rigoureux et fidèle à l&apos;œuvre originale d&apos;Akira Toriyama.
							</p>
						</div>

						{/* Valeurs / Liste */}
						<div className="space-y-4">
							<div className="flex gap-4 items-start p-4 rounded-xl bg-black/40 border border-white/10">
								<div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
									<Bouclier className="w-4 h-4" />
								</div>
								<div>
									<h4 className="text-sm font-display font-bold text-white">Rigueur Canonique</h4>
									<p className="text-xs text-white/75 font-sans mt-0.5">
										Toutes nos fiches et informations sont sourcées depuis les 42 tomes du manga et les guides officiels.
									</p>
								</div>
							</div>
							<div className="flex gap-4 items-start p-4 rounded-xl bg-black/40 border border-white/10">
								<div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-300 shrink-0 mt-0.5">
									<Bulle className="w-4 h-4" />
								</div>
								<div>
									<h4 className="text-sm font-display font-bold text-white">Entraide & Partage</h4>
									<p className="text-xs text-white/75 font-sans mt-0.5">
										Une documentation collaborative ouverte aux relectures et aux contributions des membres.
									</p>
								</div>
							</div>
							<div className="flex gap-4 items-start p-4 rounded-xl bg-black/40 border border-white/10">
								<div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5">
									<Recompense className="w-4 h-4" />
								</div>
								<div>
									<h4 className="text-sm font-display font-bold text-white">
										Recherche & Preuves Documentées
									</h4>
									<p className="text-xs text-white/75 font-sans mt-0.5">
										Outils d&apos;indexation et de consultation pour retrouver instantanément les citations et planches originales.
									</p>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* Appel à l'action */}
				<section className="text-center space-y-6 max-w-xl mx-auto py-8">
					<h3 className="text-2xl font-display font-bold text-white">
						Prêt à explorer l&apos;univers ?
					</h3>
					<p className="text-sm text-white/80 font-sans leading-relaxed">
						Rejoignez la communauté sur Discord ou plongez directement dans l&apos;encyclopédie.
					</p>
					<div className="flex justify-center gap-4">
						<a
							href={DISCORD_INVITE}
							target="_blank"
							rel="noopener noreferrer"
							className="px-6 py-2.5 rounded-xl bg-dbz-orange hover:bg-white text-black font-display font-bold text-xs tracking-wider uppercase transition-all hover:scale-105 active:scale-98 shadow-lg shadow-dbz-orange/20"
						>
							Rejoindre le Discord
						</a>
						<Link
							href="/wiki"
							className="px-6 py-2.5 rounded-xl border border-white/15 hover:border-white/30 text-white font-display font-bold text-xs tracking-wider uppercase transition-all hover:scale-105 active:scale-98 bg-white/5"
						>
							Explorer l&apos;Encyclopédie
						</Link>
					</div>
				</section>
			</PageShell>
		</>
	);
}

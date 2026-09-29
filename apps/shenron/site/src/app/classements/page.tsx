import { DomainBar, PageShell } from "@/components/kit";
import type { Metadata } from "next";
import Link from "next/link";
import { GatedLink } from "@/components/GatedLink";
import { PageHeader } from "@/components/PageHeader";
import { CommunityTopsFull } from "@/components/ratings/CommunityTops";
import { getCommunityTops } from "@/lib/community-tops-data";
import { COMMUNITY_TOP_BOARDS } from "@/lib/community-tops";
import { getShenronLeaderboard, type LeaderboardEntry } from "@/lib/shenron";
import { getTopRaters, type ContributorRow } from "@/lib/contributors";
import { TopRatersBoard, TopZeniBoard } from "@/components/contest/ContestBoards";
import { ogMeta } from "@/lib/og";
import { Couronne, Trophee } from "@/components/icones";
import { Avatar } from "@/components/Avatar";
import { formatZeni } from "@/lib/zeni";

export const revalidate = 60;

export const metadata: Metadata = {
	title: "Classements — Top 3 & Panthéon des Guerriers",
	description:
		"Top 3 épisodes DB, DBZ, Super, GT, Daima, Kai, films, jeux et Panthéon des Guerriers du serveur DBFR — classés par les votes et le Ki de la communauté.",
	...ogMeta({
		title: "Classements — Top 3 & Panthéon des Guerriers",
		description: "Les Top 3 œuvres et le Panthéon des combattants de la communauté Dragon Ball FR.",
		type: "website",
		canonical: "/classements",
	}),
};

export default async function ClassementsPage() {
	const [data, warriors, raters, richest] = await Promise.all([
		getCommunityTops(),
		getShenronLeaderboard(3, true, 60, "xp", "general").catch(() => [] as LeaderboardEntry[]),
		// Postgres du site : indépendant de l'API du bot, donc le classement du
		// concours reste affiché même quand le bot est hors ligne.
		getTopRaters(20).catch(() => [] as ContributorRow[]),
		getShenronLeaderboard(20, true, 60, "zeni", "general").catch(() => [] as LeaderboardEntry[]),
	]);

	return (
		<PageShell width="default" rhythm="loose">
			{/* Pont staff → gestion des classements, invisible pour les visiteurs. */}
			<DomainBar
				domain="classements"
				actions={[{ href: "/admin/concours", label: "Arbitrer le concours" }]}
				className="mb-6"
			/>

			<PageHeader
				eyebrow="Hall of Fame DBFR"
				title="Classements & Podiums"
				subtitle="Les Top 3 de la communauté et le Panthéon des combattants"
			/>

			<p className="mb-8 max-w-3xl text-sm leading-relaxed text-white/60">
				Bienvenue dans l&apos;arène de Dragon Ball France. Retrouve ici le{" "}
				<strong className="text-amber-300">Panthéon des Guerriers</strong> du serveur (XP et activité)
				ainsi que les <strong className="text-dbz-orange">Top 3 des œuvres</strong> (épisodes, films,
				jeux et arcs) classés en direct par les notes des membres.
				{data.globalVotes > 0 && (
					<>
						{" "}
						Déjà <strong className="text-white/80">{data.globalVotes}</strong> vote
						{data.globalVotes > 1 ? "s" : ""} communautaires enregistrés.
					</>
				)}
			</p>

			{/* Ancres rapides avec esthétique Toriyama */}
			<nav aria-label="Aller à un classement" className="mb-12 flex flex-wrap items-center gap-2">
				<a
					href="#guerriers"
					className="inline-flex items-center gap-1.5 rounded-lg border-2 border-amber-400 bg-amber-400/15 px-3 py-1.5 text-sm font-bold text-amber-300 shadow-[2px_2px_0px_#000] transition-transform hover:-translate-y-0.5 hover:bg-amber-400/25"
				>
					<span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-black font-saiyan text-[10px] font-bold">
						武
					</span>
					Guerriers DBFR
				</a>

				<a
					href="#noteurs"
					className="inline-flex items-center gap-1.5 rounded-lg border-2 border-dbz-orange bg-dbz-orange/15 px-3 py-1.5 text-sm font-bold text-dbz-orange shadow-[2px_2px_0px_#000] transition-transform hover:-translate-y-0.5"
				>
					<span className="font-saiyan text-xs opacity-80">評</span>
					Top noteurs
				</a>

				<a
					href="#zeni"
					className="inline-flex items-center gap-1.5 rounded-lg border-2 border-amber-400/70 bg-amber-400/10 px-3 py-1.5 text-sm font-bold text-amber-300 shadow-[2px_2px_0px_#000] transition-transform hover:-translate-y-0.5"
				>
					<span className="font-saiyan text-xs opacity-80">銭</span>
					Top Zénis
				</a>

				<span className="text-white/20 px-1 hidden sm:inline">|</span>

				{COMMUNITY_TOP_BOARDS.map((b) => (
					<a
						key={b.id}
						href={`#${b.id}`}
						className="inline-flex items-center gap-1.5 rounded-lg border-2 border-dbz-border/80 bg-black/40 px-3 py-1.5 text-sm font-semibold text-white/70 shadow-[2px_2px_0px_#000] transition-colors hover:border-dbz-orange/60 hover:text-white"
					>
						<span className="font-saiyan text-xs opacity-80 text-amber-300">{b.kanji}</span>
						{b.label}
					</a>
				))}
			</nav>

			{/* ── SECTION 1 : Panthéon des Guerriers (Top Combattants DBFR) ── */}
			<section
				id="guerriers"
				className="toriyama-card mb-16 scroll-mt-24 rounded-2xl border-2 border-black bg-black/40 p-4 sm:p-8 shadow-[6px_6px_0px_#000]"
				style={{
					boxShadow: "inset 0 0 70px rgba(245, 158, 11, 0.12), 6px 6px 0px #000",
				}}
			>
				<div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
					<div>
						<div className="flex items-center gap-2">
							<span className="rounded border border-black bg-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400 shadow-[1px_1px_0px_#000]">
								SERVEUR DISCORD
							</span>
							<span className="text-[11px] font-medium text-white/40">PUISSANCE DE COMBAT</span>
						</div>
						<h3 className="mt-2 font-saiyan text-2xl uppercase leading-none text-white sm:text-3xl tracking-wide flex items-center gap-2.5">
							<span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black bg-amber-400 text-black font-bold text-sm shadow-[2px_2px_0px_#000]">
								武
							</span>
							<span>Panthéon des Guerriers · Top 3 Puissance</span>
						</h3>
						<p className="mt-1.5 max-w-xl text-sm text-white/60">
							Les combattants les plus actifs du serveur Discord DBFR. Gagne de l&apos;XP en discutant
							et grimpe au classement général.
						</p>
					</div>
					<Link
						href="/leaderboard"
						className="inline-flex items-center gap-1.5 rounded-lg border-2 border-amber-400/80 bg-amber-400/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-300 shadow-[3px_3px_0px_#000] transition-all hover:bg-amber-400 hover:text-black"
					>
						Classement complet (Top 100) →
					</Link>
				</div>

				{warriors.length > 0 ? (
					<div className="flex items-end justify-center gap-2 sm:gap-6 pt-6 pb-2">
						{/* Podium : 2e (Guerrier #2) */}
						{warriors[1] && (
							<div className="flex flex-1 flex-col items-center pt-6 sm:pt-8">
								<Link
									href={`/profil/${warriors[1].discordId}`}
									className="group toriyama-card relative flex w-full max-w-[10rem] sm:max-w-[12rem] flex-col items-center overflow-hidden rounded-xl border-2 border-slate-300 bg-gradient-to-b from-slate-900/90 to-black p-3 text-center shadow-[0_0_24px_rgba(148,163,184,0.25),4px_4px_0px_#000] transition-all hover:-translate-y-1"
								>
									{/* Badge Kanji 弐 */}
									<span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-black bg-black font-saiyan text-xs font-bold text-slate-200 shadow-[2px_2px_0px_#000]">
										弐
									</span>
									<span className="absolute right-2 top-2 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-black text-slate-900 shadow-[1px_1px_0px_#000]">
										2e
									</span>

									{/* Avatar */}
									<div className="relative mt-2 h-16 w-16 sm:h-20 sm:w-20 overflow-hidden rounded-full border-2 border-slate-300 shadow-[0_0_15px_rgba(148,163,184,0.4)]">
										<Avatar
											src={warriors[1].avatarUrl}
											userId={warriors[1].discordId}
											alt={warriors[1].username ?? "Guerrier"}
											size={96}
											fluid
											className="rounded-none"
											fallback={
												<div className="flex h-full w-full items-center justify-center bg-slate-800 text-white/20">
													<Trophee className="h-8 w-8" aria-hidden />
												</div>
											}
										/>
									</div>

									<p className="mt-3 line-clamp-1 font-display font-bold text-sm text-white group-hover:text-amber-300">
										{warriors[1].username ?? `Guerrier #${warriors[1].discordId.slice(-4)}`}
									</p>
									<span className="font-saiyan text-xs text-slate-300">
										Niv. {warriors[1].level}
									</span>

									<div className="mt-2 w-full rounded border border-white/10 bg-black/60 py-1 text-center">
										<p className="font-mono text-xs font-bold text-sky-400">
											{warriors[1].xp.toLocaleString("fr-FR")} <span className="text-[10px]">U</span>
										</p>
									</div>
								</Link>
							</div>
						)}

						{/* Podium : 1er (Champion #1) */}
						{warriors[0] && (
							<div className="flex flex-1 flex-col items-center pt-1 sm:pt-0 z-10">
								<Link
									href={`/profil/${warriors[0].discordId}`}
									className="group toriyama-card relative flex w-full max-w-[12rem] sm:max-w-[14rem] scale-[1.03] sm:scale-[1.06] flex-col items-center overflow-hidden rounded-xl border-2 border-amber-400 bg-gradient-to-b from-amber-950/40 via-black to-black p-4 text-center shadow-[0_0_35px_rgba(251,191,36,0.35),5px_5px_0px_#000] transition-all hover:-translate-y-1"
								>
									{/* Badge Kanji 壱 + Champion */}
									<span className="absolute left-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full border border-black bg-amber-400 font-saiyan text-sm font-bold text-black shadow-[2px_2px_0px_#000]">
										壱
									</span>
									<span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded bg-gradient-to-r from-amber-500 to-yellow-400 px-2 py-0.5 text-[9px] font-black text-black shadow-[1px_1px_0px_#000]">
										<Couronne className="h-3 w-3" />
										CHAMPION
									</span>

									{/* Avatar avec halo doré */}
									<div className="relative mt-2 h-20 w-20 sm:h-24 sm:w-24 overflow-hidden rounded-full border-3 border-amber-400 shadow-[0_0_25px_rgba(251,191,36,0.5)]">
										<Avatar
											src={warriors[0].avatarUrl}
											userId={warriors[0].discordId}
											alt={warriors[0].username ?? "Champion"}
											size={96}
											fluid
											className="rounded-none"
											fallback={
												<div className="flex h-full w-full items-center justify-center bg-amber-950 text-amber-200/40">
													<Couronne className="h-10 w-10" aria-hidden />
												</div>
											}
										/>
									</div>

									<p className="mt-3 line-clamp-1 font-display font-bold text-base text-amber-200 group-hover:text-amber-400">
										{warriors[0].username ?? `Champion #${warriors[0].discordId.slice(-4)}`}
									</p>
									<span className="font-saiyan text-sm text-amber-400">
										Niveau {warriors[0].level}
									</span>

									<div className="mt-2 w-full rounded border border-amber-400/30 bg-amber-400/10 py-1.5 text-center">
										<p className="font-mono text-sm font-black text-amber-300">
											{warriors[0].xp.toLocaleString("fr-FR")} <span className="text-[10px]">U (KI)</span>
										</p>
										<p className="text-[10px] font-mono text-amber-400/80">
											{formatZeni(warriors[0].zeni)}
										</p>
									</div>
								</Link>
							</div>
						)}

						{/* Podium : 3e (Guerrier #3) */}
						{warriors[2] && (
							<div className="flex flex-1 flex-col items-center pt-8 sm:pt-12">
								<Link
									href={`/profil/${warriors[2].discordId}`}
									className="group toriyama-card relative flex w-full max-w-[10rem] sm:max-w-[12rem] flex-col items-center overflow-hidden rounded-xl border-2 border-orange-500 bg-gradient-to-b from-orange-950/40 to-black p-3 text-center shadow-[0_0_24px_rgba(249,115,22,0.25),4px_4px_0px_#000] transition-all hover:-translate-y-1"
								>
									{/* Badge Kanji 参 */}
									<span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-black bg-black font-saiyan text-xs font-bold text-orange-400 shadow-[2px_2px_0px_#000]">
										参
									</span>
									<span className="absolute right-2 top-2 rounded bg-orange-500 px-1.5 py-0.5 text-[9px] font-black text-black shadow-[1px_1px_0px_#000]">
										3e
									</span>

									{/* Avatar */}
									<div className="relative mt-2 h-16 w-16 sm:h-20 sm:w-20 overflow-hidden rounded-full border-2 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]">
										<Avatar
											src={warriors[2].avatarUrl}
											userId={warriors[2].discordId}
											alt={warriors[2].username ?? "Guerrier"}
											size={96}
											fluid
											className="rounded-none"
											fallback={
												<div className="flex h-full w-full items-center justify-center bg-orange-950 text-white/20">
													<Trophee className="h-8 w-8" aria-hidden />
												</div>
											}
										/>
									</div>

									<p className="mt-3 line-clamp-1 font-display font-bold text-sm text-white group-hover:text-amber-300">
										{warriors[2].username}
									</p>
									<span className="font-saiyan text-xs text-orange-400">
										Niv. {warriors[2].level}
									</span>

									<div className="mt-2 w-full rounded border border-white/10 bg-black/60 py-1 text-center">
										<p className="font-mono text-xs font-bold text-amber-400">
											{warriors[2].xp.toLocaleString("fr-FR")} <span className="text-[10px]">U</span>
										</p>
									</div>
								</Link>
							</div>
						)}
					</div>
				) : (
					<div className="py-8 text-center">
						<p className="font-saiyan text-xl uppercase text-amber-400">
							Le Scouter scanne le serveur... Rejoins Discord pour faire ton entrée !
						</p>
					</div>
				)}
			</section>

			{/* ── SECTION 2 : Concours communautaire (notes & Zénis) ── */}
			<div className="mb-6">
				<span className="rounded border border-black bg-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-dbz-orange shadow-[1px_1px_0px_#000]">
					CONCOURS MEMBRES
				</span>
				<h2 className="mt-1.5 font-saiyan text-2xl uppercase text-white sm:text-3xl">
					Champions de la communauté
				</h2>
				<p className="mt-1.5 max-w-3xl text-sm text-white/60">
					Deux classements de membres : celui qui <strong className="text-dbz-orange">note et
					commente</strong> le plus de fiches, et celui qui amasse le plus de{" "}
					<strong className="text-amber-300">Zénis</strong> sur Discord. Chaque profil est public :
					ouvre-le pour voir les notes et les avis déposés, fiche par fiche.
				</p>
			</div>

			<div className="mb-16 grid gap-6 lg:grid-cols-2">
				<TopRatersBoard rows={raters} />
				<TopZeniBoard rows={richest} />
			</div>

			{/* ── SECTION 3 : Tops Communautaires par Série / Catégorie ── */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<span className="rounded border border-black bg-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-dbz-orange shadow-[1px_1px_0px_#000]">
						WIKI & MÉDIAS
					</span>
					<h2 className="mt-1.5 font-saiyan text-2xl uppercase text-white sm:text-3xl">
						Podiums des Œuvres Dragon Ball
					</h2>
				</div>
			</div>

			<CommunityTopsFull data={data} />

			{/* Call to action Toriyama */}
			<div className="toriyama-card mt-16 rounded-2xl border-2 border-black bg-gradient-to-r from-dbz-orange/20 via-black to-amber-500/20 p-8 text-center shadow-[6px_6px_0px_#000]">
				<p className="font-saiyan text-2xl uppercase tracking-wider text-amber-300">
					À toi de faire vibrer le podium !
				</p>
				<p className="mx-auto mt-2 max-w-lg text-sm text-white/70">
					Connecte-toi avec Discord, explore les fiches épisodes, films et jeux, et attribue tes
					notes de 1 à 5 étoiles. Chaque vote compte pour propulser tes favoris au sommet.
				</p>
				<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
					<Link
						href="/wiki/episodes"
						className="home-cta home-cta--primary text-sm border-2 border-black shadow-[3px_3px_0px_#000]"
					>
						Noter un épisode
					</Link>
					<Link
						href="/wiki/films"
						className="home-cta home-cta--ghost text-sm border-2 border-black shadow-[3px_3px_0px_#000]"
					>
						Films
					</Link>
					<GatedLink
						href="/wiki/jeux"
						className="home-cta home-cta--ghost text-sm border-2 border-black shadow-[3px_3px_0px_#000]"
					>
						Jeux
					</GatedLink>
					<Link
						href="/leaderboard"
						className="rounded-lg border-2 border-amber-400 bg-amber-400 px-4 py-2 text-sm font-bold uppercase text-black shadow-[3px_3px_0px_#000] hover:bg-amber-300"
					>
						Voir le Leaderboard XP
					</Link>
				</div>
			</div>
		</PageShell>
	);
}

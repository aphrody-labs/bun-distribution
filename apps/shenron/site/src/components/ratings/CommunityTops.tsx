"use client";

/**
 * Podium Top 3 communautaires — onglets par série / type.
 * Encourage les notes : empty state + CTA vers les grilles d'épisodes/films/jeux.
 */
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Couronne, Etoile, Recompense, Trophee } from "@/components/icones";
import { WikiImg } from "@/components/wiki/WikiImg";
import type { CommunityTopBoard, CommunityTopsPayload } from "@/lib/community-tops";
import { onTablistKeyDown } from "@/lib/tablist-keys";

const RANK_META: Record<
	1 | 2 | 3,
	{
		label: string;
		kanji: string;
		titleBadge: string;
		medal: string;
		ring: string;
		height: string;
		Icon: typeof Couronne;
		borderStyle: string;
		badgeBg: string;
		glow: string;
	}
> = {
	1: {
		label: "1er",
		kanji: "壱",
		titleBadge: "CHAMPION",
		medal: "text-amber-300",
		ring: "border-amber-400 shadow-[0_0_35px_rgba(251,191,36,0.35),5px_5px_0px_#000]",
		height: "pt-1 sm:pt-0",
		Icon: Couronne,
		borderStyle: "border-amber-400/90",
		badgeBg: "bg-gradient-to-r from-amber-500 to-yellow-400 text-black",
		glow: "rgba(251, 191, 36, 0.4)",
	},
	2: {
		label: "2e",
		kanji: "弐",
		titleBadge: "CHALLENGER",
		medal: "text-slate-200",
		ring: "border-slate-300 shadow-[0_0_24px_rgba(148,163,184,0.25),4px_4px_0px_#000]",
		height: "pt-6 sm:pt-8",
		Icon: Recompense,
		borderStyle: "border-slate-300/80",
		badgeBg: "bg-gradient-to-r from-slate-400 to-slate-200 text-slate-900",
		glow: "rgba(148, 163, 184, 0.3)",
	},
	3: {
		label: "3e",
		kanji: "参",
		titleBadge: "GUERRIER",
		medal: "text-orange-400",
		ring: "border-orange-500 shadow-[0_0_24px_rgba(249,115,22,0.25),4px_4px_0px_#000]",
		height: "pt-8 sm:pt-12",
		Icon: Recompense,
		borderStyle: "border-orange-500/80",
		badgeBg: "bg-gradient-to-r from-orange-600 to-amber-500 text-black",
		glow: "rgba(249, 115, 22, 0.3)",
	},
};

/** Ordre d'affichage podium : 2e · 1er · 3e */
const PODIUM_ORDER: (1 | 2 | 3)[] = [2, 1, 3];

function EmptySlot({ rank, browseHref }: { rank: 1 | 2 | 3; browseHref: string }) {
	const meta = RANK_META[rank];
	return (
		<div
			className={`flex flex-1 flex-col items-center ${meta.height}`}
			aria-label={`Place ${meta.label} encore libre`}
		>
			<div
				className={`relative flex w-full max-w-[9.5rem] flex-col overflow-hidden rounded-xl border-2 border-dashed border-white/20 bg-black/40 sm:max-w-[11rem] ${meta.ring}`}
			>
				<div className="relative flex aspect-[2/3] flex-col items-center justify-center bg-gradient-to-b from-white/[0.04] to-transparent p-3 text-center">
					{/* Watermark Kanji Toriyama */}
					<span className="pointer-events-none absolute select-none font-saiyan text-6xl opacity-10 text-white">
						{meta.kanji}
					</span>
					<span className={`font-saiyan text-4xl opacity-40 ${meta.medal}`}>{rank}</span>
					<span className="mt-2 rounded bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/60">
						Place libre
					</span>
				</div>
				<div className="space-y-1 border-t border-white/10 p-2.5 text-center bg-black/50">
					<p className="text-[10px] leading-snug text-white/60">Sois le premier à voter !</p>
				</div>
			</div>
			<Link
				href={browseHref}
				className="mt-2.5 inline-flex items-center gap-1 rounded-md border border-dbz-orange/40 bg-dbz-orange/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-dbz-orange transition-all hover:border-dbz-orange hover:bg-dbz-orange hover:text-black"
			>
				Noter →
			</Link>
		</div>
	);
}

function PodiumCard({ board, rank }: { board: CommunityTopBoard; rank: 1 | 2 | 3 }) {
	const entry = board.entries.find((e) => e.rank === rank);
	const meta = RANK_META[rank];
	if (!entry) {
		return <EmptySlot rank={rank} browseHref={board.def.browseHref} />;
	}
	const Icon = meta.Icon;
	const isFirst = rank === 1;

	return (
		<div className={`flex flex-1 flex-col items-center ${meta.height}`}>
			<Link
				href={entry.href}
				className={`group toriyama-card relative flex w-full flex-col overflow-hidden rounded-xl border-2 sm:max-w-[11.5rem] transition-all duration-300 hover:-translate-y-1 ${meta.ring} ${
					isFirst
						? "max-w-[11.5rem] sm:max-w-[13.5rem] scale-[1.03] sm:scale-[1.05] z-10"
						: "max-w-[9.5rem] sm:max-w-[11rem]"
				}`}
				style={{
					borderColor: isFirst
						? "color-mix(in oklch, var(--tops-accent) 65%, #fbbf24)"
						: undefined,
				}}
			>
				{/* Effet d'aura énergétique au survol */}
				<div
					className="pointer-events-none absolute -inset-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100 -z-10 blur-md"
					style={{ background: meta.glow }}
				/>

				<div className="relative aspect-[2/3] overflow-hidden bg-dbz-bg">
					{entry.image ? (
						<WikiImg
							src={entry.image}
							alt={entry.title}
							sizes="(min-width: 1024px) 240px, (min-width: 640px) 32vw, 48vw"
							className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
							loading="lazy"
						/>
					) : (
						<div className="absolute inset-0 flex items-center justify-center text-white/15">
							<Trophee className="h-12 w-12" />
						</div>
					)}
					<div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />

					{/* Badge Kanji & Rang Toriyama (Coin Supérieur Gauche) */}
					<div className="absolute left-2 top-2 z-20 flex items-center gap-1">
						<span className="flex h-6 w-6 items-center justify-center rounded-full border border-black bg-black font-saiyan text-xs font-bold text-white shadow-[2px_2px_0px_#000]">
							{meta.kanji}
						</span>
						<span
							className={`toriyama-badge px-2 py-0.5 text-[10px] font-black tracking-wider border-black shadow-[2px_2px_0px_#000] ${meta.badgeBg}`}
						>
							<span className="inline-flex items-center gap-1">
								<Icon className="h-3 w-3" aria-hidden />
								{meta.label}
							</span>
						</span>
					</div>

					{/* Note Étoile Scouter (Coin Supérieur Droit) */}
					<span className="toriyama-badge absolute right-2 top-2 z-20 px-2 py-0.5 text-[11px] font-bold text-dbz-orange border-black bg-black/90 shadow-[2px_2px_0px_#000]">
						<span className="inline-flex items-center gap-0.5">
							<Etoile className="h-3.5 w-3.5 fill-current text-amber-400" aria-hidden />
							<span className="font-saiyan text-xs">{entry.average.toFixed(1)}</span>
						</span>
					</span>

					{/* Liseré Champion pour le #1 */}
					{isFirst && (
						<div className="absolute bottom-2 left-2 right-2 z-20 text-center">
							<span className="inline-block rounded border border-amber-400/80 bg-black/85 px-2 py-0.5 font-saiyan text-[10px] uppercase tracking-widest text-amber-300 shadow-[2px_2px_0px_#000]">
								★ {meta.titleBadge} ★
							</span>
						</div>
					)}
				</div>

				<div className="space-y-1 p-3 bg-gradient-to-b from-black/90 to-black">
					<p
						className={`line-clamp-2 font-display font-bold leading-tight text-white transition-colors group-hover:text-dbz-orange ${
							isFirst ? "text-sm sm:text-base text-amber-100" : "text-xs sm:text-sm"
						}`}
					>
						{entry.title}
					</p>
					{entry.subtitle && (
						<p className="line-clamp-1 text-[10px] uppercase tracking-wider text-white/50">
							{entry.subtitle}
						</p>
					)}
					<div className="flex items-center justify-between pt-1 text-[10px] text-white/50 border-t border-white/10">
						<span className="font-semibold text-white/70">
							{entry.count} note{entry.count > 1 ? "s" : ""}
						</span>
						<span className="text-dbz-orange font-saiyan text-[11px]">PODIUM</span>
					</div>
				</div>
			</Link>
		</div>
	);
}

function BoardPodium({ board }: { board: CommunityTopBoard }) {
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-end justify-between gap-2 border-b border-white/10 pb-3">
				<div>
					<div className="flex items-center gap-2">
						<span
							className="rounded border border-black bg-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] shadow-[1px_1px_0px_#000]"
							style={{ color: "var(--tops-accent)" }}
						>
							SCAN PODIUM
						</span>
						<span className="text-[11px] font-medium text-white/40">TOP 3 COMMUNAUTÉ</span>
					</div>
					<h3 className="mt-2 flex items-center gap-2.5 font-saiyan text-2xl uppercase leading-none text-white sm:text-3xl tracking-wide">
						<span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black bg-amber-400 text-black font-bold text-sm shadow-[2px_2px_0px_#000]">
							{board.def.kanji}
						</span>
						<span>{board.def.title}</span>
					</h3>
					<p className="mt-1.5 max-w-xl text-sm text-white/60">{board.def.teaser}</p>
				</div>
				<div className="text-right text-[11px] uppercase tracking-wider text-white/50">
					{board.ratedCount > 0 ? (
						<>
							<span className="font-bold text-amber-400">{board.ratedCount}</span> noté
							{board.ratedCount > 1 ? "s" : ""} ·{" "}
							<span className="text-white/80">{board.totalVotes}</span> vote
							{board.totalVotes > 1 ? "s" : ""}
						</>
					) : (
						<span className="text-white/50">Aucun vote encore — sois le premier</span>
					)}
				</div>
			</div>

			<div className="flex items-end justify-center gap-2 sm:gap-5 pt-2">
				{PODIUM_ORDER.map((rank) => (
					<PodiumCard key={rank} board={board} rank={rank} />
				))}
			</div>

			<div className="flex flex-wrap items-center justify-center gap-3 pt-2">
				<Link
					href={board.def.browseHref}
					className="home-cta home-cta--ghost text-sm border-2 border-black shadow-[3px_3px_0px_#000] hover:border-amber-400 hover:text-amber-300"
				>
					Voir tout & noter
				</Link>
				{board.entries.length > 0 && board.entries.length < 3 && (
					<p className="text-[11px] font-medium text-white/50">
						Encore {3 - board.entries.length} place
						{3 - board.entries.length > 1 ? "s" : ""} à prendre sur le podium
					</p>
				)}
			</div>
		</div>
	);
}

export function CommunityTops({
	data,
	compact = false,
	showHeader = true,
}: {
	data: CommunityTopsPayload;
	/** Mode home (moins de padding). */
	compact?: boolean;
	showHeader?: boolean;
}) {
	const boards = data.boards;
	const baseId = useId();
	const firstWithVotes = boards.findIndex((b) => b.entries.length > 0);
	const [active, setActive] = useState(
		firstWithVotes >= 0 ? boards[firstWithVotes]!.def.id : (boards[0]?.def.id ?? "episodes-dbz")
	);

	const board = useMemo(
		() => boards.find((b) => b.def.id === active) ?? boards[0],
		[boards, active]
	);

	if (!board) return null;

	return (
		<div
			className={compact ? "space-y-4" : "space-y-6"}
			style={{ ["--tops-accent" as string]: board.def.accent }}
			data-no-advance
		>
			{showHeader && (
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<p className="text-[10px] font-bold uppercase tracking-[0.22em] text-dbz-orange">
							Notes communautaires
						</p>
						<h2 className="mt-1 font-saiyan text-2xl uppercase text-white sm:text-3xl">
							Les Top 3 de la communauté
						</h2>
						<p className="mt-1 max-w-2xl text-sm text-white/55">
							Épisodes, films et jeux classés par vos notes. Note ton favori pour le faire entrer —
							ou rester — sur le podium.
							{data.globalVotes > 0 && (
								<>
									{" "}
									<span className="text-white/50">
										· {data.globalVotes} vote{data.globalVotes > 1 ? "s" : ""} au total
									</span>
								</>
							)}
						</p>
					</div>
					<Link
						href="/classements"
						className="text-[11px] font-bold uppercase tracking-widest text-dbz-orange/80 hover:text-dbz-orange"
					>
						Tous les classements →
					</Link>
				</div>
			)}

			<div tabIndex={0}
				className="flex flex-wrap gap-2"
				role="tablist"
				aria-label="Choisir un top 3"
				onKeyDown={onTablistKeyDown}
			>
				{boards.map((b) => {
					const selected = b.def.id === board.def.id;
					return (
						<button
							key={b.def.id}
							type="button"
							role="tab"
							id={`${baseId}-tab-${b.def.id}`}
							aria-selected={selected}
							aria-controls={`${baseId}-panneau`}
							tabIndex={selected ? 0 : -1}
							onClick={() => setActive(b.def.id)}
							className={`inline-flex min-h-11 items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-all shadow-[2px_2px_0px_#000] ${
								selected
									? "border-amber-400 bg-gradient-to-r from-dbz-orange/25 to-amber-400/20 text-white ring-1 ring-amber-400/50"
									: "border-dbz-border/80 bg-black/40 text-white/70 hover:border-dbz-orange/50 hover:text-white"
							}`}
						>
							<span
								className={`flex h-5 w-5 items-center justify-center rounded-full border border-black font-saiyan text-xs font-bold ${
									selected ? "bg-amber-400 text-black" : "bg-black/80 text-amber-300"
								}`}
								aria-hidden
							>
								{b.def.kanji}
							</span>
							<span>{b.def.label}</span>
							{b.entries.length > 0 && (
								<span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-mono font-bold tabular-nums text-amber-300 border border-amber-400/30">
									★ {b.entries[0]?.average.toFixed(1)}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{/* Panneau unique partagé par les onglets avec cadre d'encre Toriyama */}
			<div
				role="tabpanel"
				id={`${baseId}-panneau`}
				aria-labelledby={`${baseId}-tab-${board.def.id}`}
				className="toriyama-card rounded-2xl border-2 border-black bg-black/40 p-4 sm:p-7 shadow-[6px_6px_0px_#000]"
				style={{
					boxShadow: `inset 0 0 60px color-mix(in oklch, var(--tops-accent) 15%, transparent), 6px 6px 0px #000`,
				}}
			>
				<BoardPodium board={board} />
			</div>
		</div>
	);
}

/** Variante page complète : tous les boards empilés (sans tabs). */
export function CommunityTopsFull({ data }: { data: CommunityTopsPayload }) {
	return (
		<div className="space-y-12">
			{data.boards.map((board) => (
				<section
					key={board.def.id}
					id={board.def.id}
					className="toriyama-card scroll-mt-24 rounded-2xl border-2 border-black bg-black/35 p-4 sm:p-7 shadow-[6px_6px_0px_#000]"
					style={{
						["--tops-accent" as string]: board.def.accent,
						boxShadow: `inset 0 0 60px color-mix(in oklch, var(--tops-accent) 12%, transparent), 6px 6px 0px #000`,
					}}
				>
					<BoardPodium board={board} />
				</section>
			))}
		</div>
	);
}

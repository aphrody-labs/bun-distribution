"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dragon, Wish } from "@/lib/db-universe";
import { resolveCharacterSlugByName } from "@/lib/wiki-slugs";
import { isPathPublic, type AccessSnapshot } from "@/lib/wiki-launch";
import { useT } from "@/components/T";
import { assetUrl } from "@/lib/assets";

/**
 * `access` : instantané de lancement résolu par la page serveur. Composant client,
 * il ne peut pas lire la configuration lui-même ; sans instantané on laisse les
 * liens (mieux vaut une redirection qu'un registre éteint).
 */
export function WishesLedger({
	dragons,
	wishes,
	access,
	fallbackImage,
}: {
	dragons: Dragon[];
	wishes: Wish[];
	access?: AccessSnapshot | null;
	/** Bannière de catégorie, utilisée uniquement comme décor si une fiche n'a pas d'asset propre. */
	fallbackImage?: string;
}) {
	const ouvert = (href: string) => !access || isPathPublic(href, access);
	const [query, setQuery] = useState("");
	const [selectedDragon, setSelectedDragon] = useState<number | "ALL">("ALL");
	const t = useT();

	const filteredWishes = useMemo(() => {
		const q = query.toLowerCase().trim();
		return wishes.filter((w) => {
			if (selectedDragon !== "ALL" && w.dragon_id !== selectedDragon) return false;
			if (!q) return true;

			const inWhisperer = w.whisperer.toLowerCase().includes(q);
			const inText = w.wish_text.toLowerCase().includes(q);
			const inSaga = w.saga.toLowerCase().includes(q);

			return inWhisperer || inText || inSaga;
		});
	}, [wishes, query, selectedDragon]);

	return (
		<div className="space-y-10">
			{/* Les 5 Dragons Sacrés */}
			<div className="space-y-4">
				<h2 className="text-base font-bold uppercase tracking-wider text-orange-400">
					{t("wikiUi.wishes.dragonsTitle")}
				</h2>
				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					{dragons.map((d) => (
						<div
							key={d.slug}
							id={d.slug}
							className="flex flex-col justify-between rounded-xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md hover:border-orange-500/40 transition-colors"
						>
							<div className="space-y-4">
								{(d.image || fallbackImage) && (
									<div className="flex h-40 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/20">
										{/* Un fallback de catégorie évite une carte vide sans le faire passer pour le dragon. */}
										<img src={assetUrl(d.image ?? fallbackImage)} alt={d.image ? d.name : "Visuel de la catégorie dragons"} loading="lazy" className={d.image ? "h-full w-full object-contain" : "h-full w-full object-cover opacity-70"} />
									</div>
								)}
								<div className="flex items-start justify-between gap-2">
									<div>
										<h3 className="text-lg font-bold text-white">{d.name}</h3>
										{d.name_ja && (
											<p className="text-xs font-mono text-white/40">{d.name_ja}</p>
										)}
									</div>
									<span className="rounded bg-orange-500/20 px-2 py-0.5 text-[11px] font-bold text-orange-300">
										{d.wishes_count} {d.wishes_count > 1 ? t("wikiUi.wishes.wishes") : t("wikiUi.wishes.wish")}
									</span>
								</div>

								{/* Fiche express */}
								<div className="space-y-1.5 text-xs text-white/70">
									<div>
									<strong className="text-white/40">{t("wikiUi.wishes.creator")} :</strong>{" "}
										{(() => {
											const slug = resolveCharacterSlugByName(d.creator);
											return slug && ouvert(`/wiki/personnages/${slug}`) ? (
												<Link href={`/wiki/personnages/${slug}`} className="text-white hover:text-orange-400 font-medium">
													{d.creator}
												</Link>
											) : (
												<span>{d.creator}</span>
											);
										})()}
									</div>
									<div>
										<strong className="text-white/40">{t("wikiUi.wishes.location")} :</strong> {d.planet_realm}
									</div>
									<div>
									<strong className="text-white/40">{t("wikiUi.wishes.balls")} :</strong> {d.balls_count} Dragon Balls ({d.balls_diameter}) •{" "}
										{ouvert("/wiki/objets/dragon-radar") ? (
											<Link href="/wiki/objets/dragon-radar" className="text-amber-400/80 hover:underline">
												Radar
											</Link>
										) : (
											<span className="text-amber-400/80">Radar</span>
										)}
									</div>
									<div>
									<strong className="text-white/40">{t("wikiUi.wishes.cooldown")} :</strong> {d.cooldown}
									</div>
								</div>

								{/* Formule d'invocation */}
								{d.summon_phrase && (
									<div className="rounded-lg bg-black/40 border border-white/5 p-3 space-y-1">
										<div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
											{t("wikiUi.wishes.sacredFormula")}
										</div>
										<p className="text-xs italic text-amber-200/90 font-serif">
											« {d.summon_phrase} »
										</p>
										{d.summon_phrase_ja && (
											<p className="text-[11px] font-mono text-white/40">
												{d.summon_phrase_ja}
											</p>
										)}
									</div>
								)}

								{/* Règles & limites */}
								{d.rules && (
									<p className="text-[11px] leading-relaxed text-white/50">
										<strong>{t("wikiUi.wishes.rules")} :</strong> {d.rules}
									</p>
								)}
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Registre Historique des Vœux Exaucés */}
			<div className="space-y-6 pt-4 border-t border-white/10">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<div>
						<h2 className="text-base font-bold uppercase tracking-wider text-orange-400">
											{t("wikiUi.wishes.ledgerTitle")}
						</h2>
						<p className="text-xs text-white/50 mt-0.5">
											{t("wikiUi.wishes.ledgerIntro")}
						</p>
					</div>

					{/* Sélecteur de Dragon */}
					<div className="flex flex-wrap gap-1.5">
						<button
							type="button"
							onClick={() => setSelectedDragon("ALL")}
							className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
								selectedDragon === "ALL"
									? "bg-orange-600 text-white"
									: "bg-white/5 text-white/70 hover:bg-white/10"
							}`}
						>
							{t("wikiUi.wishes.allDragons")}
						</button>
						{dragons.map((d) => (
							<button
								key={d.id}
								type="button"
								onClick={() => setSelectedDragon(d.id)}
								className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
									selectedDragon === d.id
										? "bg-orange-600 text-white"
										: "bg-white/5 text-white/70 hover:bg-white/10"
								}`}
							>
								{d.name}
							</button>
						))}
					</div>
				</div>

				{/* Recherche */}
				<div className="relative">
					<input
						type="search"
						aria-label={t("wikiUi.wishes.search")}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("wikiUi.wishes.placeholder")}
						className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
					/>
				</div>

				{/* Liste des vœux */}
				<div className="space-y-3">
					{filteredWishes.map((w, index) => (
						<div
							key={w.id ?? index}
							id={w.id != null ? `voeu-${w.id}` : undefined}
							className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors"
						>
							<div className="space-y-1 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="rounded bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-300">
										{w.dragon_name}
									</span>
									<span className="text-xs font-semibold text-white">
										{t("wikiUi.wishes.requestedBy")} {" "}
										{(() => {
											const slug = resolveCharacterSlugByName(w.whisperer);
											return slug && ouvert(`/wiki/personnages/${slug}`) ? (
												<Link
													href={`/wiki/personnages/${slug}`}
													className="text-orange-400 hover:underline"
												>
													{w.whisperer}
												</Link>
											) : (
												<span className="text-orange-400">{w.whisperer}</span>
											);
										})()}
									</span>
									<span className="text-xs text-white/40">• {w.saga}</span>
								</div>
								<p className="text-sm font-medium text-white/90 leading-snug">
									« {w.wish_text} »
								</p>
							</div>

							<div className="flex items-center gap-3 text-xs text-white/50 shrink-0">
								{w.manga_chapter && (
									<span>{t("wikiUi.wishes.chapter")} {w.manga_chapter}</span>
								)}
								{w.episode_number && (
									<Link
										href={`/wiki/episodes/${w.episode_number}`}
										className="hover:text-orange-400 transition-colors hover:underline"
									>
										{t("wikiUi.wishes.episode")} {w.episode_number}
									</Link>
								)}
								<span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
										✓ {t("wikiUi.wishes.granted")}
								</span>
							</div>
						</div>
					))}

					{filteredWishes.length === 0 && (
						<div className="p-8 text-center text-white/50 text-xs">
							{t("wikiUi.wishes.empty")}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

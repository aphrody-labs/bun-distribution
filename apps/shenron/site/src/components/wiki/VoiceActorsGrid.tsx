"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { VoiceActor, VoiceActorRole } from "@/lib/db-universe";
import { useT } from "@/components/T";
import { assetUrl } from "@/lib/assets";
import { ArrowRight, Users } from "lucide-react";

const SERIES = [
	"Toutes",
	"Dragon Ball",
	"Dragon Ball Z",
	"Dragon Ball GT",
	"Dragon Ball Super",
	"Dragon Ball Daima",
	"Films",
];
const SERIES_TOKENS: Record<string, string[]> = {
	"Dragon Ball": ["db", "dragon ball"],
	"Dragon Ball Z": ["dbz", "dragon ball z"],
	"Dragon Ball GT": ["dbgt", "dragon ball gt"],
	"Dragon Ball Super": ["dbs", "dragon ball super"],
	"Dragon Ball Daima": ["daima", "dragon ball daima"],
	Films: ["film", "movie", "broly", "super hero"],
};

export function VoiceActorsGrid({
	voiceActors,
	fallbackImage,
}: {
	voiceActors: VoiceActor[];
	fallbackImage?: string;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [selectedNat, setSelectedNat] = useState<"all" | "ja" | "fr" | "en" | "intl">("all");
	const [selectedSeries, setSelectedSeries] = useState("Toutes");

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		return voiceActors.filter((actor) => {
			if (selectedNat === "ja" && actor.nationality !== "ja") return false;
			if (selectedNat === "fr" && actor.nationality !== "fr") return false;
			if (selectedNat === "en" && actor.nationality !== "en") return false;
			if (selectedNat === "intl" && !["latam", "es", "it"].includes(actor.nationality)) return false;

			if (
				selectedSeries !== "Toutes" &&
				!actor.roles.some((role) =>
					SERIES_TOKENS[selectedSeries]?.some((token) => role.series?.toLowerCase().includes(token))
				)
			)
				return false;

			if (!q) return true;
			return [
				actor.name,
				actor.name_ja,
				actor.biography,
				...actor.roles.flatMap((role) => [role.characterName, role.series, role.notes]),
			]
				.filter(Boolean)
				.some((value) => value!.toLowerCase().includes(q));
		});
	}, [voiceActors, query, selectedNat, selectedSeries]);

	const roleCount = voiceActors.reduce((total, actor) => total + actor.roles.length, 0);
	const vfCount = voiceActors.filter((actor) => actor.nationality === "fr").length;
	const voCount = voiceActors.filter((actor) => actor.nationality === "ja").length;
	const vaCount = voiceActors.filter((actor) => actor.nationality === "en").length;
	const intlCount = voiceActors.filter((actor) => ["latam", "es", "it"].includes(actor.nationality)).length;

	const getNatBadge = (nat: string) => {
		if (nat === "ja") return { label: "🇯🇵 Seiyū · VO", color: "bg-purple-500/15 text-purple-200 border-purple-500/30" };
		if (nat === "fr") return { label: "🇫🇷 Doublage · VF", color: "bg-blue-500/15 text-blue-200 border-blue-500/30" };
		if (nat === "en") return { label: "🇺🇸 Doublage · VA", color: "bg-red-500/15 text-red-200 border-red-500/30" };
		if (nat === "latam") return { label: "🇲🇽 Doublage · LatAm", color: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" };
		if (nat === "es") return { label: "🇪🇸 Doublage · Espagne", color: "bg-amber-500/15 text-amber-200 border-amber-500/30" };
		if (nat === "it") return { label: "🇮🇹 Doublage · Italie", color: "bg-green-500/15 text-green-200 border-green-500/30" };
		return { label: "Doublage", color: "bg-white/10 text-white" };
	};

	return (
		<div className="space-y-6">
			{/* Passerelle unifiée vers /wiki/staff */}
			<div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-orange-500/30 bg-gradient-to-r from-orange-950/40 via-black/60 to-purple-950/40 p-4 sm:p-5 backdrop-blur-xl">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/20 text-orange-400">
						<Users className="h-5 w-5" />
					</div>
					<div>
						<h3 className="text-sm font-bold text-white flex items-center gap-2">
							<span>Espace Unifié « Staff &amp; Casting International »</span>
							<span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] text-orange-300 font-normal">
								6 Niveaux Hiérarchiques
							</span>
						</h3>
						<p className="text-xs text-white/70">
							Explorez la cartographie complète : Akira Toriyama, éditeurs Shueisha, animateurs Toei, compositeurs et voix du monde entier.
						</p>
					</div>
				</div>
				<Link
					href="/wiki/staff"
					className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-orange-500 shadow-md shadow-orange-950/40"
				>
					<span>Voir le Staff &amp; Casting complet</span>
					<ArrowRight className="h-4 w-4" />
				</Link>
			</div>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label={t("wikiUi.voice.stats")}>
				<Stat label="Total Comédiens" value={voiceActors.length} />
				<Stat label="VO (Seiyū)" value={voCount} />
				<Stat label="VF (Français)" value={vfCount} />
				<Stat label="VA (Anglais)" value={vaCount} />
				<Stat label="International" value={intlCount} />
			</div>

			<div className="rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-md space-y-3">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-center">
					<div className="relative min-w-0 flex-1">
						<label htmlFor="voice-search" className="sr-only">
							{t("wikiUi.voice.search")}
						</label>
						<input
							id="voice-search"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Rechercher un comédien, un seiyū ou un rôle..."
							className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/40 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
						/>
						{query && (
							<button
								type="button"
								onClick={() => setQuery("")}
								className="absolute right-3 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white"
							>
								{t("wikiUi.voice.clear")}
							</button>
						)}
					</div>

					<div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("wikiUi.voice.language")}>
						{(
							[
								["all", `Tous (${voiceActors.length})`],
								["ja", `🇯🇵 VO (${voCount})`],
								["fr", `🇫🇷 VF (${vfCount})`],
								["en", `🇺🇸 VA (${vaCount})`],
								["intl", `🌎 Autres (${intlCount})`],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								onClick={() => setSelectedNat(key)}
								aria-pressed={selectedNat === key}
								className={`min-h-11 shrink-0 rounded-xl px-3.5 text-xs font-bold transition ${
									selectedNat === key
										? "bg-orange-600 text-white shadow-lg shadow-orange-950/40"
										: "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
								}`}
							>
								{label}
							</button>
						))}
					</div>
				</div>

				<div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("wikiUi.voice.series")}>
					{SERIES.map((series) => (
						<button
							key={series}
							type="button"
							onClick={() => setSelectedSeries(series)}
							aria-pressed={selectedSeries === series}
							className={`min-h-9 shrink-0 rounded-lg border px-3 text-[11px] font-semibold transition ${
								selectedSeries === series
									? "border-purple-400/60 bg-purple-500/20 text-purple-200"
									: "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"
							}`}
						>
							{series}
						</button>
					))}
				</div>

				<div className="text-xs text-white/45" aria-live="polite">
					{filtered.length} comédiens affichés
				</div>
			</div>

			{filtered.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center text-sm text-white/55">
					{t("wikiUi.voice.empty")}
				</div>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{filtered.map((actor) => {
						const badge = getNatBadge(actor.nationality);
						return (
							<Link
								key={actor.slug}
								href={`/wiki/voix/${actor.slug}`}
								className="group flex min-h-[300px] flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.025] p-5 transition hover:-translate-y-1 hover:border-orange-500/50 hover:shadow-xl hover:shadow-orange-950/20"
							>
								{(actor.image || fallbackImage) && (
									<div className="mb-4 h-36 overflow-hidden rounded-xl border border-white/10 bg-black/30">
										<img
											src={assetUrl(actor.image ?? fallbackImage)}
											alt={actor.image ? `Portrait de ${actor.name}` : "Visuel de la catégorie voix"}
											loading="lazy"
											className={`h-full w-full ${actor.image ? "object-contain" : "object-cover opacity-70"}`}
										/>
									</div>
								)}
								<div className="flex items-start justify-between gap-2">
									<span className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${badge.color}`}>
										{badge.label}
									</span>
									{actor.birth_date && (
										<span className="text-[11px] text-white/40">{actor.birth_date.slice(0, 4)}</span>
									)}
								</div>
								<div className="mt-4">
									<h3 className="text-xl font-bold text-white group-hover:text-orange-300">
										{actor.name}
									</h3>
									{actor.name_ja && <p className="mt-1 text-xs text-white/40">{actor.name_ja}</p>}
								</div>
								<p className="mt-4 line-clamp-3 text-xs leading-relaxed text-white/65">
									{actor.biography}
								</p>
								<div className="mt-auto border-t border-white/10 pt-4">
									<p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/40">
										{t("wikiUi.voice.credited")}
									</p>
									<div className="flex flex-wrap gap-1.5">
										{actor.roles.slice(0, 5).map((role: VoiceActorRole) => (
											<span
												key={`${actor.slug}-${role.characterName}`}
												className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-white/85"
											>
												{role.characterName}
											</span>
										))}
										{actor.roles.length > 5 && (
											<span className="rounded-md bg-orange-500/15 px-2 py-1 text-[10px] font-semibold text-orange-200">
												+{actor.roles.length - 5}
											</span>
										)}
									</div>
									<div className="mt-3 text-right text-xs font-semibold text-orange-400">
										{t("wikiUi.voice.view")}
									</div>
								</div>
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
			<div className="text-2xl font-black text-white">{value}</div>
			<div className="text-[11px] uppercase tracking-wide text-white/45">{label}</div>
		</div>
	);
}

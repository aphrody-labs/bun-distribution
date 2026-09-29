"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Soundtrack } from "@/lib/db-universe";
import { useT } from "@/components/T";
import { assetUrl } from "@/lib/assets";

const OFFICIAL_YOUTUBE: Record<string, { id: string; label: string }> = {
	"genkai-toppa-survivor": { id: "S7QsHpLU1Sw", label: "Clip officiel Toei Animation" },
	"chouzetsu-dynamic": { id: "uO5TYG4BBOk", label: "Clip officiel Nippon Columbia" },
	blizzard: { id: "YqllOJ7ut10", label: "Clip officiel Daichi Miura" },
	"jaka-jaan": { id: "gYlz3GDbf7c", label: "Version officielle Dragon Ball DAIMA" },
};

const TRACK_TYPES = [
	{ key: "all", i18n: "all" },
	{ key: "opening", i18n: "openings" },
	{ key: "ending", i18n: "endings" },
	{ key: "insert_song", i18n: "insertSongs" },
	{ key: "movie_theme", i18n: "films" },
] as const;

export function SoundtracksGrid({ soundtracks, fallbackImage }: { soundtracks: Soundtrack[]; fallbackImage?: string }) {
	const [query, setQuery] = useState("");
	const [selectedType, setSelectedType] = useState("all");
	const [playing, setPlaying] = useState<string | null>(null);
	const t = useT();
	const typeLabel = (type: string) => { const item = TRACK_TYPES.find((entry) => entry.key === type); return item ? t(`wikiUi.soundtracks.types.${item.i18n}`) : type.replaceAll("_", " "); };
	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		return soundtracks.filter((track) => {
			if (selectedType !== "all" && track.track_type !== selectedType) return false;
			if (!q) return true;
			return [track.title, track.title_ja, track.title_romaji, track.artist, track.composer, track.series].filter(Boolean).some((value) => value!.toLowerCase().includes(q));
		});
	}, [soundtracks, query, selectedType]);
	const embeddedCount = soundtracks.filter((track) => OFFICIAL_YOUTUBE[track.slug]).length;

	return <div className="space-y-6">
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t("wikiUi.soundtracks.stats")}>
			{[[t("wikiUi.soundtracks.tracks"), soundtracks.length], [t("wikiUi.soundtracks.series"), new Set(soundtracks.map((track) => track.series)).size], [t("wikiUi.soundtracks.artists"), new Set(soundtracks.map((track) => track.artist)).size], [t("wikiUi.soundtracks.officialPlayers"), embeddedCount]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"><div className="text-2xl font-black text-white">{value}</div><div className="text-[11px] uppercase tracking-wide text-white/45">{label}</div></div>)}
		</div>
		<div className="rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="relative min-w-0 flex-1"><label htmlFor="soundtrack-search" className="sr-only">{t("wikiUi.soundtracks.search")}</label><input id="soundtrack-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("wikiUi.soundtracks.placeholder")} className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/40 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30" />{query && <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white">{t("wikiUi.soundtracks.clear")}</button>}</div>
				<div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("wikiUi.soundtracks.filterType")}>{TRACK_TYPES.map((item) => <button key={item.key} type="button" onClick={() => setSelectedType(item.key)} aria-pressed={selectedType === item.key} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-bold transition ${selectedType === item.key ? "bg-orange-600 text-white shadow-lg shadow-orange-950/30" : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"}`}>{t(`wikiUi.soundtracks.types.${item.i18n}`)}</button>)}</div>
			</div><div className="mt-3 text-xs text-white/45" aria-live="polite">{t("wikiUi.soundtracks.results", { count: filtered.length })}</div>
		</div>
		{filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center text-sm text-white/55">{t("wikiUi.soundtracks.empty")}</div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((track) => {
			const video = OFFICIAL_YOUTUBE[track.slug]; const isOpen = playing === track.slug;
			return <article key={track.slug} id={track.slug} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.025] shadow-xl shadow-black/10">
				{video && isOpen && <div className="aspect-video bg-black"><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1`} title={`${track.title} — ${video.label}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div>}
				<div className="flex flex-1 flex-col gap-4 p-5">{fallbackImage && <div className="h-24 overflow-hidden rounded-lg border border-white/10 bg-black/20"><img src={assetUrl(fallbackImage)} alt="Visuel de la catégorie musiques" loading="lazy" className="h-full w-full object-cover opacity-60" /></div>}<div className="flex items-start justify-between gap-3"><span className="rounded-md bg-rose-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-300">{typeLabel(track.track_type)}</span><span className="text-xs text-white/45">{track.release_year ?? "—"}</span></div><div><h3 className="text-lg font-bold leading-tight text-white">{track.title}</h3>{track.title_ja && <p className="mt-1 text-xs text-white/40">{track.title_ja}{track.title_romaji ? ` — ${track.title_romaji}` : ""}</p>}</div><div className="rounded-xl border border-white/5 bg-black/30 p-3"><p className="text-xs font-semibold text-orange-300">{track.artist}</p>{track.composer && <p className="mt-1 text-[11px] text-white/55">Composition : {track.composer}</p>}{track.lyricist && <p className="mt-1 text-[11px] text-white/45">Paroles : {track.lyricist}</p>}</div><p className="line-clamp-3 text-xs leading-relaxed text-white/65">{track.description}</p>{track.episodes_range && <p className="text-[11px] text-white/40">Diffusion : {track.episodes_range}</p>}<div className="mt-auto flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">{video ? <button type="button" onClick={() => setPlaying(isOpen ? null : track.slug)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600 px-4 text-xs font-bold text-white transition hover:bg-red-500" aria-expanded={isOpen}>{isOpen ? "Masquer le lecteur" : "▶ Lire le clip officiel"}</button> : <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`Dragon Ball ${track.title} ${track.artist}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-600/20 px-4 text-xs font-bold text-red-200 transition hover:bg-red-600/40">▶ Rechercher sur YouTube</a>}<a href={`https://open.spotify.com/search/${encodeURIComponent(`Dragon Ball ${track.title}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-600/15 px-3 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-600/30">♫ Spotify</a><Link href={`/wiki/episodes/serie/${track.series.toLowerCase()}`} className="ml-auto text-xs font-medium text-white/45 hover:text-orange-300">{track.series} ↗</Link></div></div>
			</article>;
		})}</div>}
	</div>;
}

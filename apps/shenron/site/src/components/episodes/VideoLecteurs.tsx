"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type SubtitleTrack, VideoPlayer } from "@/components/episodes/VideoPlayer";
import { track } from "@/lib/telemetry";

export interface Lecteur {
	name: string;
	provider: string;
	embedUrl: string;
	lang?: "vf" | "vostfr";
}

/**
 * Lecture en VO dans le lecteur du site, avec les pistes de sous-titres de la fiche.
 *
 * Les lecteurs externes sont des `<iframe>` d'une autre origine : aucune piste ne
 * peut s'y superposer. Tant que la page n'offrait qu'eux, les sous-titres
 * japonais moissonnés depuis jimaku (~750 épisodes au 2026-09-13) étaient servis
 * par `/api/subtitles` sans jamais s'afficher. Ce mode passe par le proxy HLS du
 * bot sur la variante VOSTFR — audio japonais —, dans notre `<video>`, où les
 * `<track>` fonctionnent.
 */
export interface LecteurVo {
	/** Playlist maître du proxy HLS, variante VOSTFR (`…/master.m3u8?lang=vostfr`). */
	src: string;
	title: string;
	poster?: string;
	subtitles: SubtitleTrack[];
}

const LANG_LABEL: Record<string, string> = {
	vf: "VF",
	vostfr: "VOSTFR",
	ext: "Lecteurs",
	vo: "VO sous-titrée",
};
const LANG_ORDER = ["vf", "vostfr"] as const;

/** Retire le préfixe « VF · » / « VOSTFR · » que l'import ajoute au nom du lecteur
 *  (la langue est désormais portée par le sélecteur dédié). */
function cleanName(name: string): string {
	return name.replace(/^\s*(VF|VOSTFR)\s*·\s*/i, "").trim();
}

/**
 * Sélecteur de « lecteurs » (sources de streaming externes) rendu en `<iframe>`.
 * Notre player hls.js ne peut pas consommer ces embeds (pages-lecteur tierces à
 * token éphémère) → on les affiche en iframe.
 *
 * Quand les lecteurs portent un tag de langue (`lang: "vf" | "vostfr"`, posé par
 * `import-voiranime-players-vf.ts`), on affiche un sélecteur **VF / VOSTFR** :
 * l'utilisateur choisit d'abord la langue, puis « Lecteur 1/2/3 » dans cette
 * langue. VF par défaut (audience FR). Sans tag de langue (data legacy), on
 * retombe sur une liste plate « Lecteur N ».
 *
 * Quand la fiche porte des sous-titres et un flux résoluble, un choix
 * « VO sous-titrée » s'ajoute (cf. `LecteurVo`). Il ne l'est jamais par défaut.
 */
export function VideoLecteurs({
	players,
	entityType,
	entityId,
	vo,
}: {
	players: Lecteur[];
	/** Entité regardée — sans elle, aucun événement de lecture n'est émis. */
	entityType?: "episode" | "movie";
	entityId?: string | number;
	vo?: LecteurVo;
}) {
	// Langues réellement présentes, ordonnées VF puis VOSTFR.
	const langs = useMemo(() => {
		const present = new Set(players.map((p) => p.lang).filter(Boolean) as string[]);
		return LANG_ORDER.filter((l) => present.has(l));
	}, [players]);
	const hasLangs = langs.length > 0;
	// La VO passe par la variante VOSTFR du proxy HLS. Sans lecteur VOSTFR, le
	// résolveur n'en produit aucune : 5 films portent des sous-titres sans source
	// VOSTFR (mesuré le 2026-09-13) et auraient proposé une option morte. Même
	// règle que resolve-streams.ts, qui déduit les langues des tags des lecteurs.
	const aVo = vo != null && players.some((p) => p.lang === "vostfr");

	const [lang, setLang] = useState<string>(() => langs[0] ?? "");
	const [active, setActive] = useState(0);
	const [modeVo, setModeVo] = useState(false);
	const [status, setStatus] = useState<"probing" | "ready" | "failed">("probing");
	// Le flux VO est résolu à la volée par le bot : il peut être mort. On ne le
	// sonde pas à l'affichage — ce serait une résolution de flux par visite de
	// page —, on le charge au clic et l'on bascule sur un message s'il échoue.
	const [voEchec, setVoEchec] = useState(false);

	// Lecteurs de la langue choisie. Les lecteurs SANS tag de langue restent
	// toujours visibles (sinon, en cas de data mixte, ils disparaîtraient).
	const list = useMemo(
		() => (hasLangs && lang ? players.filter((p) => !p.lang || p.lang === lang) : players),
		[players, hasLangs, lang]
	);

	const current = list[active] ?? list[0];
	const enVo = modeVo && aVo;

	// Les embeds tiers ne permettent pas toujours un HEAD/CORS fiable. On sonde
	// donc le lecteur visible : load = source joignable, error ou timeout = on
	// passe automatiquement au suivant. Le délai évite qu'un hébergeur muet
	// bloque la fiche indéfiniment.
	useEffect(() => {
		if (enVo || !current) return;
		setStatus("probing");
		const timeout = window.setTimeout(() => {
			if (active < list.length - 1) setActive((index) => index + 1);
			else setStatus("failed");
		}, 8_000);
		return () => window.clearTimeout(timeout);
	}, [active, current, enVo, list.length]);

	// Choix de version : langues des lecteurs externes (ou « Lecteurs » s'ils ne
	// portent aucun tag), puis la VO quand elle existe.
	const choix = useMemo(() => {
		const externes: string[] = hasLangs ? [...langs] : ["ext"];
		return aVo ? [...externes, "vo"] : externes;
	}, [hasLangs, langs, aVo]);

	/**
	 * Ouverture d'un lecteur. C'est LE signal de valeur du site — savoir ce qui
	 * est réellement regardé, dans quelle langue et sur quel hébergeur — et le
	 * type `play_open` était déclaré depuis le début sans être émis une seule
	 * fois. L'hébergeur compte : c'est ce qui permet de repérer un lecteur mort
	 * autrement qu'en attendant un signalement (7 hébergeurs sur 8 sont déjà
	 * tombés, cf. la purge des lecteurs morts).
	 */
	const dejaEmis = useRef<string | null>(null);
	useEffect(() => {
		if (!entityType || entityId == null) return;
		if (enVo) {
			const cle = `${entityId}:vo`;
			if (dejaEmis.current === cle) return;
			dejaEmis.current = cle;
			track("play_open", { entityType, entityId, lang: "vo", player: "hls-vostfr" });
			return;
		}
		if (!current) return;
		const cle = `${entityId}:${current.embedUrl}`;
		if (dejaEmis.current === cle) return;
		dejaEmis.current = cle;
		track("play_open", {
			entityType,
			entityId,
			lang: current.lang ?? undefined,
			// `provider` (« vidmoly », « mail.ru ») plutôt que le nom d'affichage :
			// c'est l'hébergeur qui tombe, pas le libellé.
			player: current.provider || current.name || undefined,
		});
	}, [entityType, entityId, current, enVo]);
	if (!current) return null;

	const choisir = (c: string) => {
		if (c === "vo") {
			setModeVo(true);
			return;
		}
		setModeVo(false);
		if (c !== "ext") setLang(c);
		setActive(0);
	};
	const estChoisi = (c: string) => (c === "vo" ? enVo : !enVo && (c === "ext" || lang === c));
	const retry = () => {
		setActive(0);
		setStatus("probing");
	};

	return (
		<div className="space-y-3">
			{/* Sélecteur de version — visible dès qu'il y a au moins deux choix. */}
			{choix.length > 1 && (
				<div
					role="group"
					aria-label="Version (VF, VOSTFR, VO sous-titrée)"
					className="inline-flex flex-wrap items-center gap-1 rounded-full bg-white/[0.06] p-1"
				>
					{choix.map((c) => (
						<button
							key={c}
							type="button"
							onClick={() => choisir(c)}
							aria-pressed={estChoisi(c)}
							className={`rounded-full px-4 py-1.5 text-[12px] font-display font-bold tracking-wide transition-colors ${
								estChoisi(c) ? "bg-dbz-orange text-black" : "text-white/70 hover:text-white"
							}`}
						>
							{LANG_LABEL[c]}
						</button>
					))}
				</div>
			)}

			{/* Sélecteur de lecteur dans la langue active. */}
			{!enVo && (
				<div
					role="group"
					aria-label="Choix du lecteur"
					className="flex flex-wrap items-center gap-2"
				>
					{list.map((p, i) => (
						<button
							key={`${p.provider}-${i}`}
							type="button"
							onClick={() => setActive(i)}
							aria-pressed={i === active}
							className={`rounded-full px-3.5 py-1.5 text-[12px] font-display font-semibold tracking-wide transition-colors ${
								i === active
									? "bg-dbz-orange text-black"
									: "bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white"
							}`}
							title={`${cleanName(p.name)} · ${p.provider}`}
						>
							Lecteur {i + 1}
						</button>
					))}
				</div>
			)}

			{enVo && vo ? (
				voEchec ? (
					<div className="dbz-panel flex aspect-video w-full items-center justify-center rounded-lg border border-dbz-border bg-black p-6 text-center text-sm text-white/60">
						Flux VO indisponible pour le moment. Les lecteurs VF et VOSTFR restent accessibles
						ci-dessus.
					</div>
				) : (
					<VideoPlayer
						key={vo.src}
						src={vo.src}
						title={vo.title}
						poster={vo.poster}
						subtitles={vo.subtitles}
						onError={() => setVoEchec(true)}
					/>
				)
			) : status === "failed" ? (
				<div className="dbz-panel flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-dbz-border bg-black p-6 text-center text-sm text-white/60">
					<p>
						Aucun des {list.length} lecteur{list.length > 1 ? "s" : ""} ne répond pour le moment.
					</p>
					<button
						type="button"
						onClick={retry}
						className="min-h-10 rounded-lg bg-dbz-orange px-4 text-xs font-bold text-black hover:bg-dbz-orange-dark"
					>
						Réessayer automatiquement
					</button>
				</div>
			) : (
				<div className="dbz-panel overflow-hidden rounded-lg border border-dbz-border bg-black p-0">
					{/* sandbox : autorise le player tiers (scripts + accès à SA propre
					    origine, requis pour les tokens de flux) mais bloque popups et
					    navigation du top-window → coupe popunders et hijack de l'onglet
					    dragonballfr.com. NE PAS ajouter allow-popups / allow-top-navigation. */}
					<iframe
						key={current.embedUrl}
						src={current.embedUrl}
						title={`Lecteur ${active + 1} — ${cleanName(current.name)}`}
						className="aspect-video w-full rounded-lg bg-black"
						sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
						allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
						allowFullScreen
						referrerPolicy="origin"
						loading="lazy"
						onLoad={() => setStatus("ready")}
						onError={() => {
							if (active < list.length - 1) setActive((index) => index + 1);
							else setStatus("failed");
						}}
					/>
				</div>
			)}
			<p className="text-[11px] text-white/50" aria-live="polite">
				{enVo && vo
					? `Audio japonais · pistes : ${vo.subtitles.map((t) => t.label).join(", ")} — à choisir dans le menu du lecteur.`
					: status === "probing"
						? `${hasLangs && lang ? `${LANG_LABEL[lang]} · ` : ""}Vérification automatique du lecteur « ${cleanName(current.name)} »…`
						: `${hasLangs && lang ? `${LANG_LABEL[lang]} · ` : ""}Lecteur externe « ${cleanName(current.name)} » sélectionné.`}
			</p>
		</div>
	);
}

"use client";

// Home full-page « Codex Shenron » — chaque facette du site/bot est un panneau
// plein écran avec un fond en ken-burns. Tout l'affichage reflète l'état RÉEL et
// LIVE du bot.
//
// DÉFILEMENT NORMAL. La page a longtemps détourné la molette, le tactile, les
// touches de défilement (Espace, ↓, Page suiv., Début/Fin) et le clic pour
// avancer d'un panneau à la fois, avec scroll-snap au niveau du document. C'était
// hostile : plus de défilement au rythme du lecteur, plus de sélection de texte
// sans risque de saut, et surtout un `preventDefault()` sur les touches de
// défilement standard — ce qui casse la navigation clavier et la voix off d'un
// lecteur d'écran. Les points de navigation latéraux restent, en simple ancre.
//
// SANS SFX NI VFX. Les sons (kamehameha à l'appui long, cue d'entrée de panneau),
// l'inclinaison 3D des cartes au pointeur, la parallaxe, l'aura de ki, le canvas
// de combat et le champ de clips flottants ont été retirés : ils coûtaient du JS
// sur la page d'entrée, tournaient en continu, et n'apportaient rien à la lecture.
//
// Contenu ÉDITABLE : sections (ordre / activation / clip de fond / textes),
// pool de clips du héro, nombre de clips flottants et cartes du terrain sont
// pilotés par la config résolue (`HomeConfig`) passée en prop — éditée depuis
// /admin/home. Sans config en DB, `getHomeConfig()` renvoie les défauts et la
// home est strictement identique à la version historique en dur.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { DragonBall } from "@/components/DragonBall";
import {
	MotManga,
	LETTRES_DRAGON_AVANT_BOULE,
	LETTRES_DRAGON_APRES_BOULE,
	LETTRES_BALL,
} from "@/components/MotManga";
import { KintoUnVolant } from "@/components/home/KintoUnVolant";
import Link from "next/link";
import Image from "next/image";
import { assetUrl } from "@/lib/assets";
import dynamic from "next/dynamic";

// Chargé à la demande : `WikiMarkdown` traîne toute la chaîne markdown
// (react-markdown + remark-gfm/breaks + rehype-raw/sanitize/slug/autolink),
// et l'accueil ne s'en sert QUE pour le corps d'une section personnalisée —
// que la plupart des configurations n'ont pas. Statique, il pesait sur chaque
// visite de la page d'entrée pour un rendu presque jamais demandé.
const WikiMarkdown = dynamic(() =>
	import("@/components/wiki/WikiMarkdown").then((m) => m.WikiMarkdown)
);
import { DEFAULT_PLAY_CARDS, type HomeConfig, type HomeSectionConfig } from "@/lib/home-scenes";
import { useT } from "@/components/T";
import type { BestOfSagaView } from "@/lib/home-bestof";
import type { CommunityTopsPayload } from "@/lib/community-tops";
import { CommunityTops } from "@/components/ratings/CommunityTops";
import { SceneBackdrop } from "./SceneBackdrop";
import { SagaBestOf } from "./SagaBestOf";
import type { MediaCatalog } from "@/components/stream/MediaCatalogRails";
import {
	useLiveBotState,
	type BotStats,
	type PersonaLive,
	type TopMember,
	type PresenceState,
} from "./useLiveBotState";
import { DISCORD_INVITE } from "@/lib/config";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import { WikiImg } from "@/components/wiki/WikiImg";
import type { AccessSnapshot } from "@/lib/wiki-launch";

export interface WikiCounts {
	sagas: number;
	episodes: number;
	movies: number;
	characters: number;
	planets: number;
	chapters: number;
	databooks: number;
}
export interface HomePost {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	cover: string | null;
	createdAt: Date | string;
	author: { username: string | null; avatar: string | null };
}
export interface FeaturedCharacter {
	id: number;
	name: string;
	nameJa: string | null;
	race: string | null;
	ki: string | null;
	image: string | null;
}
export interface SagaTeaser {
	id: number;
	slug: string | null;
	name: string;
	series: string | null;
	description: string | null;
}

const DISCORD_URL = DISCORD_INVITE;

const GUARDIAN_ROLES: Record<string, { key: string; kanji: string }> = {
	shenron: { key: "shenron", kanji: "神龍" },
	beerus: { key: "beerus", kanji: "破壊神" },
	whis: { key: "whis", kanji: "天使" },
	"grand prêtre": { key: "grandPretre", kanji: "大神官" },
	enma: { key: "enma", kanji: "閻魔大王" },
	kaïo: { key: "kaio", kanji: "界王" },
	kaio: { key: "kaio", kanji: "界王" },
};
function guardianMeta(name: string) {
	const k = name.toLowerCase();
	for (const key of Object.keys(GUARDIAN_ROLES)) {
		if (k.includes(key)) return GUARDIAN_ROLES[key]!;
	}
	return { key: null, kanji: "守" };
}

function formatBig(n: number): string {
	return n.toLocaleString("fr-FR");
}

// Replis a11y : jamais de libellé de nav ni de titre de section vide (surtout pour
// les sections personnalisées dont les champs sont saisis à la main).
function sectionLabel(s: HomeSectionConfig, fallback: string): string {
	return s.navLabel.trim() || s.title.trim() || fallback;
}
function sectionTitle(s: HomeSectionConfig, fallback: string): string {
	return s.title.trim() || s.navLabel.trim() || fallback;
}

const pad = (n: number): string => String(n).padStart(2, "0");

// Panthéon : pastille de statut Discord + couleur du rang (podium).
const STATUS_DOT: Record<string, string> = {
	online: "bg-emerald-400",
	idle: "bg-amber-400",
	dnd: "bg-rose-500",
};
const RANK_COLOR = ["text-amber-300", "text-slate-200", "text-orange-400"];

// ── Compteur "power level" qui s'anime quand son panneau devient actif ────────
function PowerValue({ value, active }: { value: number; active: boolean }) {
	const [shown, setShown] = useState(value);
	const fromRef = useRef(0);
	const startedRef = useRef(false);
	useEffect(() => {
		if (!active) {
			startedRef.current = false;
			return;
		}
		const reduce =
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduce) {
			setShown(value);
			return;
		}
		const from = startedRef.current ? fromRef.current : 0;
		startedRef.current = true;
		const start = performance.now();
		const dur = 1200;
		let raf = 0;
		const tick = (t: number) => {
			const p = Math.min(1, (t - start) / dur);
			const e = 1 - Math.pow(1 - p, 3);
			const cur = Math.round(from + (value - from) * e);
			setShown(cur);
			fromRef.current = cur;
			if (p < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [active, value]);
	return <>{formatBig(shown)}</>;
}

export function HomeExperience({
	config,
	stats,
	personas,
	wikiCounts,
	characters,
	sagas,
	bestof = [],
	communityTops = null,
	posts,
	topMembers = [],
	presence = { total: 0, online: 0, members: [] },
	access = null,
	catalog = null,
}: {
	config: HomeConfig;
	stats: BotStats;
	personas: PersonaLive[];
	wikiCounts: WikiCounts;
	characters: FeaturedCharacter[];
	sagas: SagaTeaser[];
	bestof?: BestOfSagaView[];
	/** Top 3 notes communautaires (épisodes / films / jeux). */
	communityTops?: CommunityTopsPayload | null;
	posts: HomePost[];
	topMembers?: TopMember[];
	presence?: PresenceState;
	/** Configuration de lancement résolue côté serveur (rubriques ouvertes). */
	access?: AccessSnapshot | null;
	/** Catalogue média complet (épisodes, films, manga, databooks) fusionné aux sagas. */
	catalog?: MediaCatalog | null;
}) {
	const t = useT();
	const live = useLiveBotState({ stats, personas, topMembers, presence });
	const hasNews = posts.length > 0;
	const heroScenes = config.hero.scenes;

	// Sections de contenu affichées = activées en config (news requiert des posts,
	// bestof requiert des sagas assemblées côté serveur).
	// `tops` s'affiche même sans votes (empty state = incitation à noter).
	const contentSections = useMemo(
		() =>
			config.sections.filter(
				(s) =>
					s.enabled &&
					(s.id !== "news" || hasNews) &&
					(s.id !== "bestof" || bestof.length > 0) &&
					(s.id !== "tops" || communityTops != null)
			),
		[config.sections, hasNews, bestof.length, communityTops]
	);

	// Table des panneaux (héro + sections de contenu) pour la nav / le suivi.
	// Repli non vide sur les libellés : une section personnalisée dont le titre ou
	// le libellé n'a pas été rempli ne doit jamais produire un point de nav sans
	// aria-label ni un <h2> vide (a11y). L'éditeur bloque déjà l'enregistrement de
	// ces champs vides ; ceci couvre les données pré-existantes / écritures directes.
	const sections = useMemo(
		() => [
			{ id: "hero", label: t("home.sections.home"), kanji: "序" },
			...contentSections.map((s) => ({
				id: s.id,
				label: sectionLabel(s, t("home.sections.fallback")),
				kanji: s.kanji.trim() || "◆",
			})),
		],
		[contentSections, t]
	);

	const refs = useRef<(HTMLElement | null)[]>([]);
	const deckRef = useRef<HTMLDivElement>(null);
	const scrollFrame = useRef<number | null>(null);
	const [active, setActive] = useState(0);
	// Le rail de navigation ne pilote QUE le deck : passé sa dernière section, il
	// n'a plus de panneau à désigner et se retire (cf. `.home-dots[data-off]`).
	const [deckOut, setDeckOut] = useState(false);
	// Mobile (≤640px) : plafonne le contenu du Panthéon pour tenir dans 100svh (le
	// deck hijacke le scroll → le bas d'un panneau trop haut serait inatteignable).
	const [compact, setCompact] = useState(false);
	const reduceRef = useRef(false);

	useEffect(() => {
		reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}, []);

	useEffect(
		() => () => void (scrollFrame.current && cancelAnimationFrame(scrollFrame.current)),
		[]
	);

	// Suit la largeur (≤640px) pour réduire le contenu du Panthéon sur mobile.
	useEffect(() => {
		const mq = window.matchMedia("(max-width: 640px)");
		const apply = () => setCompact(mq.matches);
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, []);

	// Si le nombre de sections change (édition config), borne l'index actif.
	useEffect(() => {
		setActive((a) => Math.min(a, sections.length - 1));
	}, [sections.length]);

	const goTo = useCallback(
		(i: number) => {
			const idx = Math.max(0, Math.min(sections.length - 1, i));
			const el = refs.current[idx];
			if (!el) return;
			if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
			if (reduceRef.current) {
				el.scrollIntoView({ behavior: "auto", block: "start" });
			} else {
				const depart = window.scrollY;
				const arrivee = Math.max(0, el.getBoundingClientRect().top + window.scrollY);
				const distance = arrivee - depart;
				// Une durée qui suit la distance évite l'effet d'un saut brusque vers
				// le panneau voisin comme celui d'un long glissement vers un panneau
				// éloigné. La décélération laisse le lecteur arriver naturellement.
				const duree = Math.min(820, Math.max(360, Math.abs(distance) * 0.32));
				const debut = performance.now();
				const animer = (maintenant: number) => {
					const progres = Math.min(1, (maintenant - debut) / duree);
					const inertie = 1 - (1 - progres) ** 4;
					window.scrollTo({
						top: depart + distance * inertie,
						behavior: "instant" as ScrollBehavior,
					});
					if (progres < 1) scrollFrame.current = requestAnimationFrame(animer);
					else scrollFrame.current = null;
				};
				scrollFrame.current = requestAnimationFrame(animer);
			}
			setActive(idx);
		},
		[sections.length]
	);

	// Suivi du panneau actif (scroll libre, ancrage, etc.)
	useEffect(() => {
		const obs = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting && e.intersectionRatio > 0.55) {
						const i = refs.current.indexOf(e.target as HTMLElement);
						if (i >= 0) setActive(i);
					}
				}
			},
			{ threshold: [0.55, 0.75] }
		);
		for (const el of refs.current) if (el) obs.observe(el);
		return () => obs.disconnect();
	}, [sections.length]);

	// Sortie du deck : le rail disparaît quand la fin du deck remonte au-dessus du
	// bas de l'écran, et revient si l'on remonte. Écoute du défilement plutôt
	// qu'IntersectionObserver : la sentinelle fait 1 px, et une entrée/sortie de
	// cette taille n'est pas notifiée de façon fiable (mesuré : un seul appel, au
	// montage). Le calcul tient en une lecture de rect, cadencée par rAF.
	useEffect(() => {
		const deck = deckRef.current;
		if (!deck) return;
		let frame: number | null = null;
		const measure = () => {
			frame = null;
			const { bottom } = deck.getBoundingClientRect();
			// 20 % de marge : le rail ne s'efface qu'une fois la dernière section
			// réellement dépassée, pas dès qu'elle finit d'entrer.
			setDeckOut(bottom < window.innerHeight * 0.8);
		};
		const onScroll = () => {
			if (frame == null) frame = requestAnimationFrame(measure);
		};
		measure();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll, { passive: true });
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, []);

	// Raccourcis de lecture — et RIEN qui touche aux touches de défilement.
	//
	// Cet écouteur détournait encore `↓`, `↑`, `Espace`, `Page suiv.`,
	// `Page préc.`, `Début` et `Fin` avec un `preventDefault()` posé sur la
	// fenêtre — exactement ce que l'en-tête de ce fichier annonce comme retiré.
	// Trois conséquences mesurables :
	//   - `Espace` n'activait plus AUCUN bouton de la page (un bouton s'active à
	//     la levée de touche, mais le navigateur annule l'activation si l'appui a
	//     été empêché) : les points de navigation, la flèche du héro et les
	//     flèches du best-of étaient morts au clavier ;
	//   - dans le jeu d'onglets du best-of, `←/→/↑/↓` changeaient d'onglet ET
	//     faisaient sauter la page d'un panneau, l'écouteur de fenêtre recevant
	//     l'événement après celui de React ;
	//   - `Début`/`Fin` et les touches de page ne menaient plus où le lecteur
	//     (et son lecteur d'écran) les attend.
	//
	// Restent `j`/`k`, qui ne sont les touches de défilement de personne, avec la
	// garde qui manquait sur les champs `select` et les zones éditables. Elles
	// bornent au lieu de boucler : arriver au dernier panneau ne doit pas
	// renvoyer le lecteur en haut de la page, il lui reste le catalogue et
	// l'atlas du menu à parcourir dessous.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "j" && e.key !== "k") return;
			if (e.altKey || e.ctrlKey || e.metaKey) return;
			const cible = e.target as HTMLElement | null;
			const tag = cible?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || cible?.isContentEditable)
				return;
			e.preventDefault();
			goTo(e.key === "j" ? active + 1 : active - 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, goTo]);

	// Rotation lente des scènes héro (crossfade)
	const [heroIdx, setHeroIdx] = useState(0);
	useEffect(() => {
		if (active !== 0 || reduceRef.current || heroScenes.length <= 1) return;
		// L'onglet caché ne tourne pas : chaque changement de scène décode une
		// image plein écran et relance une animation de fond. Le faire pour un
		// onglet que personne ne regarde coûte de la batterie et du réseau, et
		// ramène le visiteur sur une scène qu'il n'a pas choisie.
		const id = setInterval(() => {
			if (document.hidden) return;
			setHeroIdx((i) => (i + 1) % heroScenes.length);
		}, 6200);
		return () => clearInterval(id);
	}, [active, heroScenes.length]);
	// Borne l'index héro si le pool a rétréci après édition.
	useEffect(() => {
		setHeroIdx((i) => (i < heroScenes.length ? i : 0));
	}, [heroScenes.length]);

	const activeScene =
		active === 0
			? (heroScenes[heroIdx] ?? heroScenes[0])
			: (contentSections[active - 1]?.scene ?? heroScenes[0]);

	const setRef = (i: number) => (el: HTMLElement | null) => {
		refs.current[i] = el;
	};

	// Contenu propre à chaque section (rendu sous l'en-tête générique).
	const renderBody = (cfg: HomeSectionConfig) => {
		// Section personnalisée : corps riche rendu comme le wiki via WikiMarkdown
		// (sanitizer « contrôle total du design » — média/embeds/HTML/CSS inline
		// autorisés, seul le JS est bloqué ; rédacteur = admin de confiance). L'en-tête
		// (eyebrow/titre/sous-titre) est rendu par la coque générique ; un corps vide
		// affiche donc juste l'en-tête (pas de panneau cassé, pas de crash).
		if (cfg.isCustom) {
			const body = cfg.body?.trim();
			if (!body) return null;
			return (
				<div className="reveal-up home-custom-body mx-auto max-w-2xl text-left leading-relaxed text-white/80">
					<WikiMarkdown body={body} />
				</div>
			);
		}
		switch (cfg.id) {
			case "pantheon":
				return (
					<div className="grid gap-5 reveal-up lg:grid-cols-5">
						{/* Top membres (classement live) */}
						<div className="lg:col-span-3">
							<ol className="flex flex-col gap-1.5">
								{live.topMembers.slice(0, compact ? 6 : 10).map((m) => (
									<li key={m.discordId}>
										<div
											className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
												m.rank <= 3
													? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
													: "border-white/10 bg-black/30"
											}`}
										>
											<span
												className={`w-6 shrink-0 text-center text-sm font-black ${
													m.rank <= 3 ? RANK_COLOR[m.rank - 1] : "text-white/50"
												}`}
											>
												{m.rank}
											</span>
											<Avatar
												src={m.avatarUrl}
												userId={m.discordId}
												size={36}
												className="border border-white/15"
											/>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-[13px] font-bold leading-tight text-white">
													{m.username ?? t("home.pantheon.anonymous")}
												</span>
												<span className="block text-[10px] uppercase tracking-[0.12em] text-white/50">
													{t("home.pantheon.level", { level: m.level })}
												</span>
											</span>
											<span className="shrink-0 text-right text-[12px] font-semibold text-[var(--accent)]">
												{formatBig(m.xp)} XP
											</span>
										</div>
									</li>
								))}
								{live.topMembers.length === 0 && (
									<li className="text-[13px] text-white/50">
										{t("home.pantheon.unavailable")}
									</li>
								)}
							</ol>
							<Link href="/leaderboard" className="home-cta home-cta--ghost mt-3">
								{t("home.pantheon.allRanking")}
							</Link>
						</div>

						{/* Membres connectés maintenant */}
						<aside className="lg:col-span-2">
							<div className="rounded-2xl border border-white/10 bg-black/40 p-4">
								<div className="flex items-baseline justify-between">
									<span className="text-[13px] font-bold text-white">{t("home.pantheon.onlineNow")}</span>
									<span className="text-[12px] tabular-nums text-white/50">
										{live.presence.online}
										{live.presence.total > 0 ? ` / ${formatBig(live.presence.total)}` : ""}
									</span>
								</div>
								{live.presence.members.length > 0 ? (
									<ul className="mt-3 grid grid-cols-5 gap-2.5 sm:grid-cols-6 lg:grid-cols-5">
										{live.presence.members.slice(0, compact ? 10 : 20).map((u) => (
											<li
												key={u.id}
												className="flex flex-col items-center gap-1"
												title={`${u.username} · ${u.status}`}
											>
												<span className="relative">
													<Avatar
														src={u.avatarUrl}
														userId={u.id}
														size={40}
														className="border border-white/15"
													/>
													<span
														className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-black ${
															STATUS_DOT[u.status] ?? "bg-white/40"
														}`}
													/>
												</span>
												<span className="w-full truncate text-center text-[9px] leading-tight text-white/55">
													{u.username}
												</span>
											</li>
										))}
									</ul>
								) : (
									<p className="mt-3 text-[12px] text-white/50">
										{live.presence.online > 0
											? t("home.pantheon.onlineCount", { count: live.presence.online })
											: t("home.pantheon.noneOnline")}
									</p>
								)}
								<a
									href={DISCORD_URL}
									target="_blank"
									rel="noopener noreferrer"
									className="home-cta home-cta--ghost mt-4"
								>
									{t("home.joinServer")}
								</a>
							</div>
						</aside>
					</div>
				);

			case "universe":
				return (
					<div className="home-grid-stats">
						{[
							// Toutes les tuiles mènent à leur rubrique. Les trois premières
							// portaient `href: null` — un reste de la bêta, quand ces routes
							// répondaient 307 : elles affichaient un compteur qu'on ne pouvait
							// pas suivre. Le wiki est ouvert depuis, et `ClientGatedWrap`
							// arbitre au cas où une rubrique serait refermée.
							{ k: "characters", labelKey: "categories.personnages.label", href: "/wiki/personnages" },
							{ k: "planets", labelKey: "categories.cosmologie.label", href: "/wiki/lieux" },
							{ k: "sagas", labelKey: "categories.sagas.label", href: "/wiki/sagas" },
							{ k: "episodes", labelKey: "categories.episodes.label", href: "/wiki/episodes" },
							{ k: "movies", labelKey: "categories.films.label", href: "/wiki/films" },
							{ k: "chapters", labelKey: "home.universe.chapters", href: "/wiki/manga" },
							// Les databooks manquaient à l'appel : 318 ouvrages et 11 778
							// planches transcrites, la matière la plus rare du site.
							{ k: "databooks", labelKey: "categories.databooks.label", href: "/wiki/databooks" },
						].map((tile) => {
							const inner = (
								<>
									<span className="home-stat-tile__num">
										<PowerValue
											value={wikiCounts[tile.k as keyof WikiCounts] ?? 0}
											active={active === sections.findIndex((s) => s.id === cfg.id)}
										/>
									</span>
									<span className="home-stat-tile__label">{t(tile.labelKey)}</span>
								</>
							);
							return tile.href ? (
								<Link key={tile.k} href={tile.href} className="home-stat-tile reveal-up">
									{inner}
								</Link>
							) : (
								<div key={tile.k} className="home-stat-tile home-stat-tile--static reveal-up">
									{inner}
								</div>
							);
						})}
					</div>
				);

			case "personnages":
				return (
					<>
						<div className="grid grid-cols-3 gap-3 reveal-up sm:grid-cols-4 lg:grid-cols-6">
							{characters.map((c) => (
								<ClientGatedWrap
									key={c.id}
									access={access}
									href={`/wiki/personnages/${c.id}`}
									className="group relative block aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-black/30 transition-colors hover:border-[var(--accent)]"
								>
									{/* `WikiImg` plutôt qu'un `<img>` brut, pour les deux raisons
									    qui l'ont fait naître : beaucoup de portraits pointent un
									    fichier jamais mirroré (404 → icône d'image cassée en pleine
									    page d'accueil, ici remplacée par un repère neutre), et le
									    passage par `next/image` sert une vignette redimensionnée en
									    AVIF/WebP au lieu du fichier source pleine résolution. */}
									<WikiImg
										src={c.image}
										alt={c.name}
										sizes="(min-width: 1024px) 190px, (min-width: 640px) 23vw, 31vw"
										className="absolute inset-0 h-full w-full object-cover object-top opacity-85 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100"
									/>
									<span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-2.5 pb-2.5 pt-10">
										<span className="block text-[13px] font-bold leading-tight text-white">
											{c.name}
										</span>
										{c.race && (
											<span className="mt-0.5 block text-[9px] uppercase tracking-[0.14em] text-white/55">
												{c.race}
											</span>
										)}
									</span>
								</ClientGatedWrap>
							))}
						</div>
						<ClientGatedWrap
							access={access}
							href="/wiki/personnages"
							className="home-cta home-cta--ghost"
						>
							{t("home.characters.all")}
						</ClientGatedWrap>
					</>
				);

			case "bestof":
				return (
					<SagaBestOf
						sagas={bestof}
						active={active === sections.findIndex((s) => s.id === cfg.id)}
						compact={compact}
						catalog={catalog}
						access={access}
					/>
				);

			case "tops":
				return communityTops ? (
					<CommunityTops data={communityTops} compact={compact} showHeader={false} />
				) : null;

			case "sagas":
				return (
					<>
						<div className="grid gap-4 reveal-up sm:grid-cols-2 lg:grid-cols-4">
							{sagas.map((s) => (
								<ClientGatedWrap
									key={s.id}
									access={access}
									// La carte annonce UNE saga : elle mène à sa fiche, comme
									// partout ailleurs sur le site (`/wiki/sagas`, `/wiki/arcs`,
									// la palette de commandes). Les huit cartes renvoyaient
									// toutes au sommaire — le `slug` était sélectionné en base,
									// porté par `SagaTeaser` et jamais lu. Repli sur le sommaire
									// pour une saga sans slug, faute de fiche à ouvrir.
									href={s.slug ? `/wiki/sagas/${s.slug}` : "/wiki/sagas"}
									className="group flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/30 p-4 transition-colors hover:border-[var(--accent)]"
								>
									{s.series && (
										<span className="text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
											{s.series}
										</span>
									)}
									<span className="text-[15px] font-bold leading-tight text-white">{s.name}</span>
									{s.description && (
										<span className="line-clamp-3 text-[12px] leading-snug text-white/55">
											{s.description}
										</span>
									)}
								</ClientGatedWrap>
							))}
						</div>
						<ClientGatedWrap
							access={access}
							href="/wiki/sagas"
							className="home-cta home-cta--ghost"
						>
							{t("home.sagas.all")}
						</ClientGatedWrap>
					</>
				);

			case "guardians":
				return (
					<div className="home-guardians">
						{live.personas.map((p) => {
							const m = guardianMeta(p.name);
							const src = assetUrl(p.avatarUrl ?? p.avatar ?? "");
							return (
								<article key={p.id} className="home-guardian reveal-up">
									<span className="home-guardian__kanji" aria-hidden>
										{m.kanji}
									</span>
									<span className="home-guardian__avatar">
										{src ? (
											<Image
												src={src}
												alt={p.name}
												width={72}
												height={72}
												className="object-cover"
											/>
										) : null}
										<span
											className={`home-guardian__status ${p.online ? "is-on" : ""}`}
											title={p.online ? t("home.guardians.online") : t("home.guardians.offline")}
										/>
									</span>
									<span className="home-guardian__name">{p.name}</span>
									<span className="home-guardian__role">
										{t(m.key ? `home.guardians.${m.key}.role` : "home.guardians.defaultRole")}
									</span>
									<span className="home-guardian__line">
										{t(m.key ? `home.guardians.${m.key}.line` : "home.guardians.defaultLine")}
									</span>
								</article>
							);
						})}
					</div>
				);

			case "community":
				return (
					<>
						<div className="home-power-grid">
							{[
								{ v: live.stats.users, label: t("home.community.warriors"), suffix: "" },
								{ v: live.stats.totalXp, label: t("home.community.totalXp"), suffix: "" },
								{ v: live.stats.totalZeni, label: t("home.community.zeni"), suffix: "₽" },
								{
									v: live.stats.achievementsUnlocked,
									label: t("home.community.achievements"),
									suffix: "",
								},
							].map((s) => (
								<div key={s.label} className="home-power reveal-up">
									<span className="home-power__num">
										<PowerValue
											value={s.v}
											active={active === sections.findIndex((x) => x.id === cfg.id)}
										/>
										{s.suffix}
									</span>
									<span className="home-power__label">{s.label}</span>
								</div>
							))}
						</div>
						{live.events.length > 0 && (
							<ul className="home-feed" aria-live="polite">
								{live.events.map((ev) => (
									<li key={ev.key} className="home-feed__item">
										<span className="home-feed__dot" />
										{ev.label}
									</li>
								))}
							</ul>
						)}
					</>
				);

			case "play":
				return (
					<div className="home-cards">
						{(cfg.cards ?? DEFAULT_PLAY_CARDS).map((c) => (
							<Link key={c.href + c.title} href={c.href} className="home-card reveal-up">
								<span className="home-card__kanji" aria-hidden>
									{c.kanji}
								</span>
								<span className="home-card__title">{c.title}</span>
								<span className="home-card__desc">{c.desc}</span>
								<span className="home-card__arrow" aria-hidden>
									→
								</span>
							</Link>
						))}
					</div>
				);

			case "news":
				return (
					<>
						<div className="home-news">
							{posts.slice(0, 3).map((p) => (
								<Link key={p.id} href={`/news/${p.slug}`} className="home-news__item reveal-up">
									{p.cover && (
										<span className="home-news__cover">
											<Image
												src={assetUrl(p.cover)}
												alt=""
												width={420}
												height={236}
												className="object-cover"
											/>
										</span>
									)}
									<span className="home-news__title">{p.title}</span>
									{p.excerpt && <span className="home-news__excerpt">{p.excerpt}</span>}
								</Link>
							))}
						</div>
						<Link href="/news" className="home-cta home-cta--ghost">
							{t("home.news.all")}
						</Link>
					</>
				);

			default:
				return null;
		}
	};

	// Élément dynamique injecté dans le sous-titre de certaines sections (pills live).
	const headerExtra = (id: string) => {
		if (id === "pantheon") {
			return (
				<span className={`home-live-pill ${live.presence.online > 0 ? "is-on" : ""}`}>
					<span className="home-live-dot is-on" />
					{t("home.pantheon.onlinePill", { count: live.presence.online })}
				</span>
			);
		}
		if (id === "guardians") {
			return (
				<>
					{" — "}
					<strong>{live.onlineCount > 0 ? t("home.botOnline") : t("home.botOffline")}</strong>{" "}
					{t("home.guardians.atThisMoment")}
				</>
			);
		}
		if (id === "community") {
			return (
				<span className={`home-live-pill ${live.connected ? "is-on" : ""}`}>
					<span className="home-live-dot is-on" />
					{live.connected ? t("home.community.liveFeed") : t("home.community.synced")}
				</span>
			);
		}
		return null;
	};

	const activeAccent = activeScene?.accent ?? "oklch(0.78 0.17 65)";

	return (
		<div ref={deckRef} className="home-deck" style={{ ["--accent" as string]: activeAccent }}>
			{/* Le nuage vole au-dessus de tout le deck, pas d'une seule section : il
			    suit le défilement et reste cliquable d'un bout à l'autre. */}
			<KintoUnVolant />
			{/* Navigation latérale — points HUD scouter.
			    Le compteur de panneaux vit DANS le rail, en tête. Posé en `fixed` à
			    `calc(50% - 9.5rem)`, il supposait un rail de CINQ points : un point
			    mesure 45,4 px de pas, donc dès SIX sections — et l'ordre des
			    panneaux s'édite depuis /admin/home — la demi-hauteur du rail
			    (45,4 n ÷ 2) dépasse les 124 px qui le séparaient du centre, et le
			    compteur retombait sur le premier point. Dans le flux, il le suit. */}
			<nav className="home-dots" data-off={deckOut} aria-label={t("home.sections.pageSections")}>
				<span className="home-counter" aria-hidden>
					<span className="home-counter__cur">{pad(active + 1)}</span>
					<span className="home-counter__sep">/</span>
					<span>{pad(sections.length)}</span>
				</span>
				{sections.map((s, i) => (
					<button
						key={s.id}
						type="button"
						onClick={() => goTo(i)}
						aria-current={active === i ? "true" : undefined}
						aria-label={s.label}
						className={`home-dot ${active === i ? "home-dot--on" : ""}`}
					>
						<span className="home-dot__kanji">{s.kanji}</span>
						<span className="home-dot__label">{s.label}</span>
					</button>
				))}
			</nav>

			{/* ── HÉRO ─────────────────────────────────────────────────────────── */}
			<section
				ref={setRef(0)}
				id="hero"
				className="home-section home-hero"
				aria-label={t("home.sections.home")}
			>
				<div className="absolute inset-0">
					{heroScenes.map((sc, i) => {
						// Fenêtrage : ne monter que la scène active et ses voisines ±1 (le
						// crossfade n'a besoin que de la précédente et de la suivante).
						const len = heroScenes.length;
						const near =
							i === heroIdx || i === (heroIdx + 1) % len || i === (heroIdx - 1 + len) % len;
						if (!near) return null;
						return (
							<SceneBackdrop
								key={`${sc.id}-${i}`}
								scene={sc}
								active={active === 0 && i === heroIdx}
								visible={i === heroIdx}
								priority={i === 0}
							/>
						);
					})}
				</div>
				{/* Deux marqueurs de planche, purement graphiques et donc masqués aux
				    lecteurs d'écran : l'onomatopée du grondement, et le Kinto-Un qui
				    traverse le champ. Le nuage n'est pas un ornement de plus — c'est
				    l'asset de marque de la barre et des favicons, on le retrouve ici à
				    l'échelle du héros. */}
				<span className="home-onomatopee onomatopee" aria-hidden>
					ゴゴゴ
				</span>
				<div className="home-hero__content reveal-up">
					<p className="home-kicker">
						<span className="home-kicker__live">
							<span className={`home-live-dot ${live.onlineCount > 0 ? "is-on" : ""}`} />
							{live.onlineCount > 0 ? t("home.botOnline") : t("home.botOffline")}
						</span>
					</p>
					{/* Deux mots, deux aplats : c'est la signature du logo de couverture
					    (« DRAGON » jaune, « BALL » rouge), et elle ne survit pas à un
					    span unique — un dégradé à coupure franche se décalerait à
					    chaque changement de largeur. Chaque LETTRE porte son propre
					    `data-texte`, dont les deux cernes sont des copies. */}
					<h1 className="home-wordmark">
						<span className="home-wordmark__ligne">
							{/* Le O de DRAGON porte la boule, exactement comme sur la
							    couverture : la lettre reste dans le flux pour les lecteurs
							    d'écran, elle est seulement masquée à l'œil. */}
							<span className="wordmark-manga">
								<MotManga lettres={LETTRES_DRAGON_AVANT_BOULE} />
								<span className="wordmark-boule" aria-hidden>
									<DragonBall stars={1} size={64} />
								</span>
								<span className="sr-only">o</span>
								<MotManga lettres={LETTRES_DRAGON_APRES_BOULE} />
							</span>
							<span className="wordmark-manga wordmark-manga--rouge">
								<MotManga lettres={LETTRES_BALL} />
							</span>
						</span>
						<em>France</em>
					</h1>
					<p className="home-lede">{config.hero.lede}</p>
					<div className="home-cta-row">
						<Link href={config.hero.ctaHref} className="home-cta home-cta--primary">
							{config.hero.ctaLabel}
						</Link>
						<a
							href={DISCORD_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="home-cta home-cta--ghost"
						>
							{t("home.joinServer")}
						</a>
					</div>
				</div>
				<div className="home-hero__caption" aria-hidden>
					<span className="home-hero__caption-kicker">{activeScene?.kicker}</span>
					<span className="home-hero__caption-title">{activeScene?.title}</span>
				</div>
				<button
					type="button"
					className="home-scroll-hint"
					onClick={() => goTo(1)}
					aria-label={t("home.sections.next")}
				>
					<span className="home-scroll-hint__arrow" />
				</button>
			</section>

			{/* ── SECTIONS DE CONTENU (ordre / activation / fond / textes = config) ── */}
			{contentSections.map((cfg, i) => {
				const navIdx = i + 1;
				const subtitle = cfg.subtitle;
				const extra = headerExtra(cfg.id);
				return (
					<section
						key={cfg.id}
						ref={setRef(navIdx)}
						id={cfg.id}
						className="home-section"
						aria-label={sectionLabel(cfg, t("home.sections.fallback"))}
					>
						<SceneBackdrop scene={cfg.scene} active={active === navIdx} />
						<div className="home-panel">
							<header className="home-panel__head reveal-up">
								<span className="home-eyebrow">
									{pad(navIdx)} — {cfg.eyebrow}
								</span>
								<h2 className="home-title">{sectionTitle(cfg, t("home.sections.fallback"))}</h2>
								{(subtitle || extra) && (
									<p className="home-sub">
										{subtitle}
										{extra}
									</p>
								)}
							</header>
							{renderBody(cfg)}
						</div>
					</section>
				);
			})}
		</div>
	);
}

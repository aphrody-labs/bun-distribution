/**
 * wiki-nav-manifest — Registre typé de la navigation encyclopédique Dragon Ball.
 *
 * Conforme à la Phase 2.2 de docs/architecture-refonte-wiki-dragon-ball.md.
 * Centralise l'arborescence, les icônes, les badges de statut et les ancres canoniques
 * pour éviter les conditions dispersées dans les composants UI (drawer, sidebar, fil d'Ariane).
 */

export interface WikiNavItem {
	id: string;
	label: string;
	labelJa?: string;
	href: string;
	icon?: string;
	badge?: string;
	description: string;
	gated?: boolean;
	targetCanon?: "manga" | "all" | "meta";
}

export interface WikiNavGroup {
	id: string;
	title: string;
	titleJa?: string;
	icon: string;
	summary: string;
	items: WikiNavItem[];
}

export const WIKI_NAVIGATION_MANIFEST: WikiNavGroup[] = [
	{
		id: "manga",
		title: "Manga & Œuvre Originale",
		titleJa: "原作漫画",
		icon: "📖",
		summary:
			"Les 42 tomes du chef-d'œuvre d'Akira Toriyama en éditions N&B Tankōbon et Full Color.",
		items: [
			{
				id: "manga-index",
				label: "Les 42 Tomes Originaux",
				labelJa: "単行本42巻",
				href: "/wiki/manga",
				icon: "📚",
				badge: "Canon absolu",
				description: "Sommaire complet des volumes, couvertures et chapitres d'époque.",
				targetCanon: "manga",
			},
			{
				id: "manga-reader-start",
				label: "Lecteur Manga Unifié",
				labelJa: "統合マンガリーダー",
				href: "/wiki/manga/volume/82",
				icon: "👁️",
				badge: "N&B / Couleur",
				description: "Parcours de lecture fluide avec bascule Tankōbon et Full Color Shueisha.",
				targetCanon: "manga",
			},
		],
	},
	{
		id: "databooks",
		title: "Databooks & Archives Écrites",
		titleJa: "関連書籍・ガイド",
		icon: "📜",
		summary: "Les guides officiels Shueisha, novélisations et transcriptions d'archives Toriyama.",
		items: [
			{
				id: "databooks-all",
				label: "Databooks & Guides Officiels",
				labelJa: "大全集・超全集",
				href: "/wiki/databooks",
				icon: "📔",
				description: "Daizenshuu, Chōzenshū, Super Exciting Guide et Sōshūhen numérisés.",
			},
		],
	},
	{
		id: "animation",
		title: "Anime & Cinéma",
		titleJa: "アニメ・劇場版",
		icon: "🎬",
		summary: "Séries télévisées, longs-métrages cinéma, OAV et épisodes spéciaux Toei Animation.",
		items: [
			{
				id: "episodes",
				label: "Épisodes TV (DB, DBZ, GT, Super, Daima)",
				labelJa: "TVアニメシリーズ",
				href: "/wiki/episodes",
				icon: "📺",
				description: "Guide complet des diffusions, résumés, captures de planches et fillers.",
			},
			{
				id: "films",
				label: "Films & Longs-Métrages Cinéma",
				labelJa: "劇場版映画",
				href: "/wiki/films",
				icon: "🎞️",
				description: "De La Légende de Shenron à DBS: Super Hero, synopses et statuts canoniques.",
			},
		],
	},
	{
		id: "events",
		title: "Événements",
		titleJa: "歴史・決戦",
		icon: "🥋",
		summary: "Combats, tournois et jalons narratifs dans une chronologie unique.",
		items: [
			{
				id: "narrative-events",
				label: "Événements, combats & tournois",
				labelJa: "出来事・戦い・武道会",
				href: "/wiki/evenements",
				icon: "⚔️",
				badge: "Chronologie",
				description: "Affrontements, championnats et tournants du récit, reliés à leurs sagas.",
			},
			{
				id: "chronology",
				label: "Chronologie & Âges Universels",
				labelJa: "世界年表",
				href: "/wiki/chronologie",
				icon: "⏳",
				description: "Frise temporelle diégétique des Âges -5M à 784 d'après le Daizenshuu 7.",
			},
		],
	},
	{
		id: "lore",
		title: "Encyclopédie & Entités",
		titleJa: "事典・設定",
		icon: "🔮",
		summary: "Personnages, transformations, techniques martiales, planètes et artefacts magiques.",
		items: [
			{
				id: "characters",
				label: "Personnages & Guerriers",
				labelJa: "登場人物",
				href: "/wiki/personnages",
				icon: "👥",
				description:
					"Fiches biographiques vérifiées, fusions, affiliations et niveaux de puissance.",
			},
			{
				id: "transformations",
				label: "Transformations & Stades",
				labelJa: "変身・形態",
				href: "/wiki/transformations",
				icon: "⚡",
				description: "Du Super Saiyan à l'Ultra Instinct : multiplicateurs et conditions d'éveil.",
			},
			{
				id: "techniques",
				label: "Techniques & Attaques de Ki",
				labelJa: "技・必殺技",
				href: "/wiki/techniques",
				icon: "💥",
				description: "Kamehameha, Genkidama, Makankosappo : inventeurs, variantes et puissance.",
			},
		],
	},
	{
		id: "meta",
		title: "Autour de Dragon Ball",
		titleJa: "制作陣・スタッフ",
		icon: "🌟",
		summary: "L'équipe de production, Akira Toriyama, les voix légendaires et l'univers musical.",
		items: [
			{
				id: "staff-hub",
				label: "Autour de Dragon Ball (Staff & Toriyama)",
				labelJa: "制作陣・鳥山明",
				href: "/wiki/staff",
				icon: "👑",
				badge: "Hero Spotlight",
				description:
					"La matrice complète des bâtisseurs : éditeurs Jump, scénaristes, seiyū et compositeurs.",
			},
			{
				id: "toriyama",
				label: "Akira Toriyama (1955-2024)",
				labelJa: "鳥山明先生",
				href: "/wiki/toriyama",
				icon: "✍️",
				description: "Hommage, interviews canoniques, chroniques et citations certifiées.",
			},
			{
				id: "music",
				label: "Musiques & Bandes Originales",
				labelJa: "音楽・サントラ",
				href: "/wiki/musiques",
				icon: "🎵",
				gated: true,
				description: "Discographie Shunsuke Kikuchi, Hironobu Kageyama et thèmes cultes.",
			},
		],
	},
];

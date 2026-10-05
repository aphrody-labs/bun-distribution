"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X, Users, Feather, Clapperboard, Mic, Music, BookOpen } from "lucide-react";

type ContributorCategory =
	| "all"
	| "editorial"
	| "screenplay"
	| "animation"
	| "voice"
	| "music";

export interface ContributorItem {
	id: string;
	slug: string;
	nameFr: string;
	nameJa: string;
	nameRomaji: string;
	category: ContributorCategory;
	categoryLabel: string;
	roleTitle: string;
	period: string;
	studioOrCompany: string;
	keyContributions: string[];
	bioSummary: string;
	wikiLink?: string;
}

const CONTRIBUTORS_CATALOG: ContributorItem[] = [
	// Éditeurs
	{
		id: "kazuhiko-torishima",
		slug: "kazuhiko-torishima",
		nameFr: "Kazuhiko Torishima",
		nameJa: "鳥嶋 和彦",
		nameRomaji: "Torishima Kazuhiko",
		category: "editorial",
		categoryLabel: "Éditeur Shueisha",
		roleTitle: "1er Éditeur de Toriyama (Dr. Slump & Genèse Dragon Ball)",
		period: "1978 — 1989",
		studioOrCompany: "Weekly Shōnen Jump / Hakusensha",
		keyContributions: ["Genèse de Dragon Ball", "Inspiration du Roi Piccolo & Dr Mashirito", "Poussé Toriyama aux arts martiaux"],
		bioSummary:
			"L'homme qui a découvert et forgé Akira Toriyama. Réputé pour son exigence légendaire (« Recommence ! »), il a orienté Toriyama vers les mangas de combat et a inspiré directement l'allure et le sadisme du Roi Démon Piccolo.",
		wikiLink: "/wiki/staff#kazuhiko-torishima",
	},
	{
		id: "yu-kondo",
		slug: "yu-kondo",
		nameFr: "Yu Kondo",
		nameJa: "近藤 裕",
		nameRomaji: "Kondō Yū",
		category: "editorial",
		categoryLabel: "Éditeur Shueisha",
		roleTitle: "2e Éditeur (Arc Saiyans & Arc Namek / Freezer)",
		period: "1989 — 1992",
		studioOrCompany: "Weekly Shōnen Jump",
		keyContributions: ["Arc Saiyans", "Guerre de Namek", "Design final et transformations de Freezer"],
		bioSummary:
			"Éditeur de l'apogée dramatique de Dragon Ball. C'est sous son impulsion que les combats ont pris une tournure cosmique et haletante sur Namek, poussant Toriyama à créer les transformations successives de Freezer et le Super Saiyan.",
		wikiLink: "/wiki/staff#yu-kondo",
	},
	{
		id: "fuyuto-takeda",
		slug: "fuyuto-takeda",
		nameFr: "Fuyuto Takeda",
		nameJa: "武田 冬門",
		nameRomaji: "Takeda Fuyuto",
		category: "editorial",
		categoryLabel: "Éditeur Shueisha",
		roleTitle: "3e Éditeur (Arc Cyborgs / Cell & Arc Majin Buu)",
		period: "1992 — 1995",
		studioOrCompany: "Weekly Shōnen Jump",
		keyContributions: ["Arc Cell Game", "Arc Majin Buu", "Clôture des 42 tomes"],
		bioSummary:
			"A accompagné Toriyama jusqu'au 519e et dernier chapitre du manga original. Il a accordé une grande liberté créative à l'auteur pour l'arc Majin Buu, permettant le retour à l'humour absurde et aux fusions extravagantes (Gotenks, Vegetto).",
		wikiLink: "/wiki/staff#fuyuto-takeda",
	},
	{
		id: "akio-iyoku",
		slug: "akio-iyoku",
		nameFr: "Akio Iyoku",
		nameJa: "伊能 昭夫",
		nameRomaji: "Iyoku Akio",
		category: "editorial",
		categoryLabel: "Éditeur & Producteur",
		roleTitle: "Directeur Dragon Ball Room / Capsule Corporation Tokyo",
		period: "2016 — Présent",
		studioOrCompany: "Shueisha / Capsule Corp Tokyo",
		keyContributions: ["Dragon Ball Super : Broly", "Dragon Ball Super : Super Hero", "Dragon Ball Daima"],
		bioSummary:
			"Chef d'orchestre de la franchise moderne. Ancien rédacteur en chef de V-Jump, il a fondé la Dragon Ball Room chez Shueisha puis Capsule Corporation Tokyo pour orchestrer les projets canons avec Akira Toriyama.",
		wikiLink: "/wiki/staff#akio-iyoku",
	},

	// Scénaristes
	{
		id: "takao-koyama",
		slug: "takao-koyama",
		nameFr: "Takao Koyama",
		nameJa: "小山 高生",
		nameRomaji: "Koyama Takao",
		category: "screenplay",
		categoryLabel: "Scénariste Principal",
		roleTitle: "Scénariste en chef de Dragon Ball Z & 13 Films Originaux",
		period: "1989 — 1996",
		studioOrCompany: "Toei Animation",
		keyContributions: ["Scénario Dragon Ball Z (Ép. 1-291)", "Création de Broly, Cooler, Bojack, Janemba", "13 Films originaux DBZ"],
		bioSummary:
			"La plume incontournable de l'anime Dragon Ball Z. Scénariste en chef de la série animée télévisée, il a conçu le scénario de treize films cultes et a créé des antagonistes majeurs de la pop-culture comme Broly et Cooler.",
		wikiLink: "/wiki/staff#takao-koyama",
	},
	{
		id: "katsuyuki-sumisawa",
		slug: "katsuyuki-sumisawa",
		nameFr: "Katsuyuki Sumisawa",
		nameJa: "隅沢 克之",
		nameRomaji: "Sumisawa Katsuyuki",
		category: "screenplay",
		categoryLabel: "Scénariste",
		roleTitle: "Scénariste d'épisodes clés et films",
		period: "1989 — 1993",
		studioOrCompany: "Toei Animation",
		keyContributions: ["La Menace de Namek (Slug)", "Épisodes de transition DBZ", "Développements Krillin & Gohan"],
		bioSummary:
			"Scénariste clé chez Toei Animation, collaborateur régulier de Takao Koyama sur les sagas Saiyans et Namek, réputé pour son écriture nerveuse et ses rebondissements tactiques.",
	},

	// Directeurs d'animation
	{
		id: "minoru-maeda",
		slug: "minoru-maeda",
		nameFr: "Minoru Maeda",
		nameJa: "前田 実",
		nameRomaji: "Maeda Minoru",
		category: "animation",
		categoryLabel: "Directeur d'Animation",
		roleTitle: "Directeur d'Animation en chef (DB & DBZ Âge d'Or)",
		period: "1986 — 1993",
		studioOrCompany: "Studio Junio / Toei Animation",
		keyContributions: ["Dragon Ball (Ép. 1-153)", "Dragon Ball Z (Ép. 1-199)", "Style graphique emblématique des années 80/90"],
		bioSummary:
			"Superviseur général de l'animation de Dragon Ball et de la première moitié de DBZ. Son trait rond, dynamique et expressif reste le plus fidèle au style originel d'Akira Toriyama sur les tomes 1 à 35.",
		wikiLink: "/wiki/staff#minoru-maeda",
	},
	{
		id: "tadayoshi-yamamuro",
		slug: "tadayoshi-yamamuro",
		nameFr: "Tadayoshi Yamamuro",
		nameJa: "山室 直儀",
		nameRomaji: "Yamamuro Tadayoshi",
		category: "animation",
		categoryLabel: "Chara-Designer & Animateur",
		roleTitle: "Character Designer de Dragon Ball Z, GT, Super",
		period: "1989 — 2018",
		studioOrCompany: "Toei Animation",
		keyContributions: ["Design de Vegetto, Janemba, Gohan Ultime", "Films Fusion & L'Attaque du Dragon", "Réalisateur de Battle of Gods & Fukkatsu no F"],
		bioSummary:
			"Le dessinateur le plus prolifique de l'histoire animée de Dragon Ball. Son trait acéré, ses ombres angulaires et ses muscles ciselés ont défini le look iconique des guerriers Z de 1993 à 2018.",
		wikiLink: "/wiki/staff#tadayoshi-yamamuro",
	},
	{
		id: "katsuyoshi-nakatsuru",
		slug: "katsuyoshi-nakatsuru",
		nameFr: "Katsuyoshi Nakatsuru",
		nameJa: "中鶴 勝祥",
		nameRomaji: "Nakatsuru Katsuyoshi",
		category: "animation",
		categoryLabel: "Animateur & Designer",
		roleTitle: "Designer loué par Akira Toriyama",
		period: "1987 — Présent",
		studioOrCompany: "Toei Animation",
		keyContributions: ["Design original de Bardock", "Conception graphique du Super Saiyan 4", "Directeur d'animation téléfilms"],
		bioSummary:
			"Un maître absolu de l'animation, dont Toriyama disait lui-même qu'il imitait son dessin à la perfection au point de ne plus savoir qui avait dessiné quoi. Concepteur graphique du Super Saiyan 4 et du commando de Bardock.",
		wikiLink: "/wiki/staff#katsuyoshi-nakatsuru",
	},
	{
		id: "naohiro-shintani",
		slug: "naohiro-shintani",
		nameFr: "Naohiro Shintani",
		nameJa: "新谷 直大",
		nameRomaji: "Shintani Naohiro",
		category: "animation",
		categoryLabel: "Directeur d'Animation Moderne",
		roleTitle: "Directeur de l'animation de Dragon Ball Super : Broly (2018)",
		period: "2018 — Présent",
		studioOrCompany: "Toei Animation",
		keyContributions: ["Charte graphique Shintani (DB Super Broly)", "Retour au trait épuré et organique de Toriyama"],
		bioSummary:
			"Choisi personnellement sur concours par Akira Toriyama pour renouveler l'animation de Dragon Ball au cinéma. Son style épuré, ses lignes douces et son sens magistral du mouvement ont révolutionné les combats modernes de la franchise.",
		wikiLink: "/wiki/staff#naohiro-shintani",
	},

	// Comédiens de doublage
	{
		id: "masako-nozawa",
		slug: "masako-nozawa",
		nameFr: "Masako Nozawa",
		nameJa: "野沢 雅子",
		nameRomaji: "Nozawa Masako",
		category: "voice",
		categoryLabel: "Seiyū Légendaire",
		roleTitle: "Voix originale japonaise de la lignée Son",
		period: "1986 — Présent",
		studioOrCompany: "Aoni Production",
		keyContributions: ["Son Goku (Enfant, Adulte)", "Son Gohan", "Son Goten", "Bardock", "Goku Black", "Gotenks / Vegetto"],
		bioSummary:
			"L'âme vocale de Dragon Ball. Choisi par Akira Toriyama en personne lors des auditions de 1986, elle incarne Son Goku avec une énergie indomptable depuis plus de 38 ans, détenant deux records Guinness mondiaux.",
		wikiLink: "/wiki/voix/masako-nozawa",
	},
	{
		id: "patrick-borg",
		slug: "patrick-borg",
		nameFr: "Patrick Borg",
		nameJa: "パトリック・ボルグ",
		nameRomaji: "Patorikku Borugu",
		category: "voice",
		categoryLabel: "Comédien de Doublage VF",
		roleTitle: "Voix française légendaire de Son Goku",
		period: "1990 — Présent",
		studioOrCompany: "Doublage Français (AB Productions)",
		keyContributions: ["Son Goku adulte", "Bardock (téléfilm)", "Gogeta / Vegetto (VF)"],
		bioSummary:
			"La voix française héroïque de Son Goku depuis l'arrivée de Raditz sur Terre. Son timbre chaleureux et ses cris de combat d'une intensité prodigieuse ont bercé plusieurs générations de fans francophones.",
		wikiLink: "/wiki/voix/patrick-borg",
	},
	{
		id: "ryo-horikawa",
		slug: "ryo-horikawa",
		nameFr: "Ryō Horikawa",
		nameJa: "堀川 りょう",
		nameRomaji: "Horikawa Ryō",
		category: "voice",
		categoryLabel: "Seiyū",
		roleTitle: "Voix originale japonaise de Vegeta",
		period: "1989 — Présent",
		studioOrCompany: "Asread Company",
		keyContributions: ["Prince Vegeta", "Vegetto", "Gogeta"],
		bioSummary:
			"La fierté princière incarnée. Son rire sardonique, sa diction aristocratique et son cri légendaire « Kakarotto ! » ont fait de Vegeta l'un des rivaux les plus charismatiques de l'histoire de l'animation japonaise.",
		wikiLink: "/wiki/voix/ryo-horikawa",
	},
	{
		id: "brigitte-lecordier",
		slug: "brigitte-lecordier",
		nameFr: "Brigitte Lecordier",
		nameJa: "ブリジット・ルコルディエ",
		nameRomaji: "Burijitto Rukorudie",
		category: "voice",
		categoryLabel: "Comédienne de Doublage VF",
		roleTitle: "Voix française culte de l'enfance",
		period: "1988 — Présent",
		studioOrCompany: "Doublage Français",
		keyContributions: ["Son Goku enfant", "Son Gohan enfant", "Son Goten enfant", "C-18"],
		bioSummary:
			"Comédienne emblématique de l'enfance de Goku et de ses fils en VF. Sa candeur, sa spontanéité et son rire malicieux sont indissociables des débuts de Dragon Ball et de l'entraînement avec Tortue Géniale.",
		wikiLink: "/wiki/voix/brigitte-lecordier",
	},
	{
		id: "toshio-furukawa",
		slug: "toshio-furukawa",
		nameFr: "Toshio Furukawa",
		nameJa: "古川 登志夫",
		nameRomaji: "Furukawa Toshio",
		category: "voice",
		categoryLabel: "Seiyū",
		roleTitle: "Voix originale japonaise de Piccolo",
		period: "1988 — Présent",
		studioOrCompany: "Aoni Production",
		keyContributions: ["Piccolo Jr", "General Blue"],
		bioSummary:
			"A donné à Piccolo toute sa profondeur : du démon vengeur au mentor protecteur et sage de Gohan. Sa voix grave, calme et autoritaire porte le Makankōsappō avec une classe inégalée.",
		wikiLink: "/wiki/voix/toshio-furukawa",
	},
	{
		id: "eric-legrand",
		slug: "eric-legrand",
		nameFr: "Éric Legrand",
		nameJa: "エリック・ルグラン",
		nameRomaji: "Erikku Ruguran",
		category: "voice",
		categoryLabel: "Comédien de Doublage VF",
		roleTitle: "Voix française légendaire de Vegeta & Yamcha",
		period: "1988 — Présent",
		studioOrCompany: "Doublage Français",
		keyContributions: ["Vegeta (voix principale)", "Yamcha", "Vegetto (VF)"],
		bioSummary:
			"Un monument du doublage français. Son interprétation flamboyante, arrogante puis touchante de Vegeta (« Espèce d'insolent ! ») a transcendé l'adaptation française de Dragon Ball Z.",
		wikiLink: "/wiki/voix/eric-legrand",
	},

	// Musique & Bandes Originales
	{
		id: "shunsuke-kikuchi",
		slug: "shunsuke-kikuchi",
		nameFr: "Shunsuke Kikuchi",
		nameJa: "菊池 俊輔",
		nameRomaji: "Kikuchi Shunsuke",
		category: "music",
		categoryLabel: "Compositeur Symphonique",
		roleTitle: "Compositeur de la Bande Originale Mythique (DB & DBZ)",
		period: "1986 — 1996 (1931 - 2021)",
		studioOrCompany: "Columbia Music Entertainment",
		keyContributions: ["Toutes les BGM de Dragon Ball et Dragon Ball Z", "17 Bandes originales de films", "Thème de la mort de Krillin / Éveil SSJ"],
		bioSummary:
			"Le maître de l'ambiance sonore de Dragon Ball. Ses trompettes guerrières, ses cordes angoissantes et ses envolées héroïques ont forgé l'identité émotionnelle inoubliable de Dragon Ball et Dragon Ball Z.",
		wikiLink: "/wiki/musiques",
	},
	{
		id: "hironobu-kageyama",
		slug: "hironobu-kageyama",
		nameFr: "Hironobu Kageyama",
		nameJa: "影山 ヒロノブ",
		nameRomaji: "Kageyama Hironobu",
		category: "music",
		categoryLabel: "Chanteur & Interprète",
		roleTitle: "La Voix Rock de Dragon Ball Z",
		period: "1989 — Présent",
		studioOrCompany: "Lantis / JAM Project",
		keyContributions: ["Cha-La Head-Cha-La", "We Gotta Power", "Unmei no Hi ~Tamashii vs Tamashii~ (Gohan SSJ2)"],
		bioSummary:
			"Le roi des génériques d'anime. Surnommé « M. Dragon Ball », son énergie contagieuse et son timbre puissant ont propulsé Cha-La Head-Cha-La et We Gotta Power au panthéon de la pop-culture planétaire.",
		wikiLink: "/wiki/musiques",
	},
	{
		id: "norihito-sumitomo",
		slug: "norihito-sumitomo",
		nameFr: "Norihito Sumitomo",
		nameJa: "住友 紀人",
		nameRomaji: "Sumitomo Norihito",
		category: "music",
		categoryLabel: "Compositeur",
		roleTitle: "Compositeur moderne de Dragon Ball Super",
		period: "2013 — 2018",
		studioOrCompany: "Toei Animation",
		keyContributions: ["Battle of Gods", "La Résurrection de 'F'", "OST Dragon Ball Super", "Ultimate Battle (Ka Ka Kachi Daze)"],
		bioSummary:
			"Architecte musical de la renaissance Dragon Ball au 21e siècle. Il a composé les thèmes symphoniques et rock épiques de l'arc Trunks du Futur et du Tournoi du Pouvoir.",
		wikiLink: "/wiki/musiques",
	},
	{
		id: "zedd",
		slug: "zedd",
		nameFr: "Zedd",
		nameJa: "ゼッド",
		nameRomaji: "Zeddo",
		category: "music",
		categoryLabel: "Producteur & DJ International",
		roleTitle: "Compositeur du thème officiel de Dragon Ball Daima",
		period: "2024 — Présent",
		studioOrCompany: "Universal Music / Toei Animation",
		keyContributions: ["Thème d'ouverture 'Jaka Jaan' de Dragon Ball Daima (avec C&K)"],
		bioSummary:
			"Producteur électro mondialement acclamé et fan inconditionnel de Dragon Ball depuis l'enfance. Il a composé le thème d'ouverture officiel de Dragon Ball Daima en collaboration étroite avec Akira Toriyama avant sa disparition.",
		wikiLink: "/wiki/musiques",
	},
];

interface StaffMatrixExplorerProps {
	initialCatalog?: ContributorItem[];
}

function StaffMatrixExplorer({ initialCatalog }: StaffMatrixExplorerProps = {}) {
	const catalog = initialCatalog && initialCatalog.length > 0 ? initialCatalog : CONTRIBUTORS_CATALOG;
	const [activeCategory, setActiveCategory] = useState<ContributorCategory>("all");
	const [searchQuery, setSearchQuery] = useState("");

	const filtered = useMemo(() => {
		const q = searchQuery.toLowerCase().trim();
		return catalog.filter((item) => {
			if (activeCategory !== "all" && item.category !== activeCategory) return false;
			if (!q) return true;
			const inName =
				item.nameFr.toLowerCase().includes(q) ||
				item.nameJa.toLowerCase().includes(q) ||
				item.nameRomaji.toLowerCase().includes(q);
			const inRole = item.roleTitle.toLowerCase().includes(q) || item.categoryLabel.toLowerCase().includes(q);
			const inContribs = item.keyContributions.some((k) => k.toLowerCase().includes(q));
			const inBio = item.bioSummary.toLowerCase().includes(q);
			return inName || inRole || inContribs || inBio;
		});
	}, [catalog, activeCategory, searchQuery]);

	const categoryTabs: Array<{ id: ContributorCategory; label: string; icon: any; count: number }> = [
		{ id: "all", label: "Toute l'équipe", icon: Users, count: catalog.length },
		{
			id: "editorial",
			label: "Éditeurs Jump",
			icon: BookOpen,
			count: catalog.filter((c) => c.category === "editorial").length,
		},
		{
			id: "screenplay",
			label: "Scénaristes",
			icon: Feather,
			count: catalog.filter((c) => c.category === "screenplay").length,
		},
		{
			id: "animation",
			label: "Animation & Design",
			icon: Clapperboard,
			count: catalog.filter((c) => c.category === "animation").length,
		},
		{
			id: "voice",
			label: "Comédiens & Seiyū",
			icon: Mic,
			count: catalog.filter((c) => c.category === "voice").length,
		},
		{
			id: "music",
			label: "Musique & OST",
			icon: Music,
			count: catalog.filter((c) => c.category === "music").length,
		},
	];

	return (
		<div className="space-y-6">
			{/* Filtres par corps de métier et Recherche */}
			<div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur-xl shadow-2xl">
				{/* Champ de recherche */}
				<div className="relative">
					<Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
					<input
						type="search"
						aria-label="Rechercher un membre de l'équipe"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Rechercher un éditeur, scénariste, animateur, seiyū, compositeur (ex: Torishima, Maeda, Borg, Kikuchi)..."
						className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-10 py-2.5 text-xs text-white placeholder-white/40 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
						>
							<X className="h-4 w-4" />
						</button>
					)}
				</div>

				{/* Onglets de métiers */}
				<div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 scrollbar-thin sm:flex-wrap sm:overflow-visible sm:pb-0">
					{categoryTabs.map((tab) => {
						const Icon = tab.icon;
						const isSelected = activeCategory === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveCategory(tab.id)}
								className={`inline-flex shrink-0 snap-start items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
									isSelected
										? "border-orange-500 bg-orange-500/20 text-white shadow-md shadow-orange-950/40"
										: "border-white/5 bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
								}`}
							>
								<Icon className={`h-3.5 w-3.5 ${isSelected ? "text-orange-400" : "text-white/40"}`} />
								<span>{tab.label}</span>
								<span className={`rounded-full px-1.5 py-0.2 text-[10px] ${isSelected ? "bg-orange-500/40 text-white" : "bg-white/10 text-white/50"}`}>
									{tab.count}
								</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Grille des fiches contributeurs */}
			<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{filtered.map((item) => (
					<article
						key={item.id}
						id={item.slug}
						className="group flex flex-col justify-between rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-5 backdrop-blur-md transition-all duration-300 hover:border-orange-500/40 hover:shadow-xl hover:shadow-orange-950/20"
					>
						<div>
							{/* Catégorie & Période */}
							<div className="flex items-center justify-between gap-2 text-[10px]">
								<span className="rounded-md border border-orange-500/30 bg-orange-950/60 px-2 py-0.5 font-bold uppercase tracking-wider text-orange-400">
									{item.categoryLabel}
								</span>
								<span className="font-mono text-white/40">{item.period}</span>
							</div>

							{/* Identité */}
							<h3 className="mt-3 text-lg font-bold text-white group-hover:text-orange-400 transition-colors">
								{item.nameFr}
							</h3>
							<div className="flex items-center gap-2 mt-0.5 text-xs text-white/50">
								<span className="font-jp text-white/70">{item.nameJa}</span>
								<span>·</span>
								<span className="italic">{item.nameRomaji}</span>
							</div>

							{/* Titre du Rôle & Studio */}
							<div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs">
								<div className="font-semibold text-orange-300/90">{item.roleTitle}</div>
								<div className="mt-0.5 text-[11px] text-white/40">{item.studioOrCompany}</div>
							</div>

							{/* Biographie & Impact */}
							<p className="mt-3 text-xs leading-relaxed text-white/70">
								{item.bioSummary}
							</p>

							{/* Contributions Majeures */}
							<div className="mt-4 space-y-1.5">
								<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
									Œuvres & Réalisations Clés
								</div>
								<div className="flex flex-wrap gap-1.5">
									{item.keyContributions.map((kc, idx) => (
										<span
											key={idx}
											className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-white/80"
										>
											{kc}
										</span>
									))}
								</div>
							</div>
						</div>

						{/* Passerelle Wiki */}
						<div className="mt-5 border-t border-white/10 pt-3 flex items-center justify-end text-xs">
							{item.wikiLink && (
								<Link
									href={item.wikiLink}
									className="font-semibold text-orange-400 hover:text-white transition-colors"
								>
									Fiche dédiée & œuvres →
								</Link>
							)}
						</div>
					</article>
				))}
			</div>
		</div>
	);
}

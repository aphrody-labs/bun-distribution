"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Scouter } from "@/components/icones";
import { Pagination } from "@/components/ui/Pagination";
import { ViewTransition } from "@/components/ViewTransition";
import { WikiImg } from "@/components/wiki/WikiImg";
import { CharacterFilterModal, type FacetOption } from "@/components/wiki/CharacterFilterModal";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import type { AccessSnapshot } from "@/lib/wiki-launch";
import { comparerRichesse } from "@/lib/character-richesse";

// Grille personnages filtrable (client). Importe `@/lib/assets` (client-safe),
// JAMAIS db-universe/shenron (server-only → `postgres` fuiterait dans le bundle).
export type GridCharacter = {
	id: number;
	slug?: string;
	name: string;
	nameJa: string | null;
	race: string | null;
	image: string | null;
	/** Portrait XV2 — repli d'image quand `image` 404 (cf. WikiImg). */
	portraitXv2?: string | null;
	/**
	 * Note de richesse mesurée (`@/lib/character-richesse`), calculée côté
	 * serveur. Sert au tri par défaut et à la jauge de la carte ; absente, la
	 * grille retombe sur l'ordre alphabétique.
	 */
	richesse?: number;
};

/**
 * Facettes de filtrage servies par `dbUniverse.characterFacets()` (server) :
 * options Techniques/Arcs + mappings perso→techniques/arcs (sparse) pour le
 * filtrage cumulatif client. Optionnel : la grille dégrade en filtre Race seul
 * si la DB n'a pas répondu.
 */
/**
 * Version d'un personnage rattachée à une saga, affichée comme une carte à
 * part entière — « Goku (Saga Namek) ».
 *
 * Ces 451 versions n'existaient que dans l'onglet « Au fil des sagas » d'une
 * fiche : pour les voir il fallait déjà savoir de qui l'on parle. Dans la
 * grille, elles deviennent parcourables et filtrables comme le reste, et
 * chacune peut porter sa propre illustration.
 */
export type GridVariant = {
	id: number;
	characterId: number;
	name: string;
	saga: string;
	sagaId: number;
	/** Illustration propre à la version ; `null` = celle du personnage. */
	image: string | null;
	characterImage: string | null;
	race: string | null;
	form: string | null;
};

export type CharacterFacets = {
	techniqueOptions: FacetOption[];
	arcOptions: FacetOption[];
	charTechniques: Record<string, string[]>;
	charArcs: Record<string, string[]>;
};

// Normalise pour comparer sans accents/casse (recherche tolérante).
function norm(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.trim();
}

export function CharacterGrid({
	characters,
	nbVariants = 0,
	facets,
	access,
}: {
	characters: GridCharacter[];
	/**
	 * Nombre de versions par saga existantes. Sert uniquement à savoir s'il faut
	 * proposer la bascule — les versions elles-mêmes sont chargées à la demande
	 * (`/api/wiki/variants`), parce qu'elles pesaient 110 Ko dans la charge de
	 * chaque visiteur pour une vue que peu ouvrent.
	 */
	nbVariants?: number;
	facets?: CharacterFacets;
	/** Instantané de la configuration de lancement, résolu côté serveur. */
	access?: AccessSnapshot | null;
}) {
	// « fiches » = une carte par personnage (défaut) ; « versions » = une carte
	// par couple personnage × saga. Le choix est dans l'URL (`?vue=versions`)
	// pour qu'une liste de versions se partage.
	const [vue, setVue] = useState<"fiches" | "versions">("fiches");
	/**
	 * État repris de l'URL (`?vue=versions&p=3`), lu au PREMIER RENDU.
	 *
	 * Et non dans un effet, comme c'était le cas pour `?p` : React vide les
	 * effets des ENFANTS avant ceux du parent, et `Pagination` synchronise l'URL
	 * dès son montage — avec `page` encore à 1, elle SUPPRIMAIT `?p` avant que
	 * cette grille ait pu le lire. Un lien partagé retombait donc toujours sur la
	 * page 1, malgré l'effet écrit pour l'éviter.
	 *
	 * On ne lit ici qu'une valeur rangée dans une ref : le rendu, lui, reste
	 * identique à celui du serveur, donc aucun écart d'hydratation.
	 */
	const initial = useRef<{ vue: "fiches" | "versions"; page: number } | null>(null);
	if (initial.current === null) {
		const params =
			typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
		const p = Number(params?.get("p"));
		initial.current = {
			vue: params?.get("vue") === "versions" ? "versions" : "fiches",
			page: Number.isFinite(p) && p > 1 ? Math.floor(p) : 1,
		};
	}
	// Chargées au premier passage en mode « Versions », puis gardées.
	const [variants, setVariants] = useState<GridVariant[]>([]);
	/**
	 * État du chargement des versions, et NON deux booléens dérivés du contenu.
	 *
	 * La condition d'arrêt était « la liste n'est plus vide ». Or
	 * `/api/wiki/variants` rattrape ses propres erreurs et répond `200` avec un
	 * tableau VIDE (cf. la route) : sur une base indisponible, la liste restait
	 * donc vide, le drapeau de chargement retombait à `false`, l'effet se
	 * redéclenchait — et la page rappelait l'API en boucle, sans fin et sans
	 * jamais rien afficher d'autre que « aucune version ne correspond ». Une
	 * réponse vide légitime produisait exactement le même emballement.
	 *
	 * Avec un état explicite, la requête part une fois ; l'échec se dit et se
	 * rejoue à la demande du lecteur.
	 */
	const [etatVersions, setEtatVersions] = useState<"vierge" | "chargement" | "pret" | "erreur">(
		"vierge"
	);
	useEffect(() => {
		if (vue !== "versions" || etatVersions !== "vierge") return;
		setEtatVersions("chargement");
		fetch("/api/wiki/variants")
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d) => {
				setVariants(Array.isArray(d?.variants) ? d.variants : []);
				setEtatVersions("pret");
			})
			.catch(() => setEtatVersions("erreur"));
	}, [vue, etatVersions]);
	useEffect(() => {
		if (initial.current?.vue === "versions") setVue("versions");
	}, []);
	useEffect(() => {
		const url = new URL(window.location.href);
		if (vue === "versions") url.searchParams.set("vue", "versions");
		else url.searchParams.delete("vue");
		window.history.replaceState(null, "", url.toString());
	}, [vue]);

	const [query, setQuery] = useState("");
	const [races, setRaces] = useState<string[]>([]);
	const [techniques, setTechniques] = useState<string[]>([]);
	const [arcs, setArcs] = useState<string[]>([]);
	const [modalOpen, setModalOpen] = useState(false);
	/**
	 * Ordre d'affichage. Par défaut « les mieux documentés », parce que c'est la
	 * seule vue qui a du sens à l'atterrissage : l'alphabétique met Abo, Abra et
	 * Adjudant Black avant Goku, et l'ordre de la base met les fiches vides
	 * devant. Le tri se fait ici (client) sur une note déjà calculée côté serveur
	 * — pas de nouvelle requête au changement.
	 */
	const [tri, setTri] = useState<"richesse" | "alpha">("richesse");

	const techniqueOptions = facets?.techniqueOptions ?? [];
	const arcOptions = facets?.arcOptions ?? [];
	// `?? {}` fabriquait un objet NEUF à chaque rendu quand la base n'avait pas
	// répondu : les deux `useMemo` de filtrage le voyaient changer d'identité et
	// re-filtraient les 1 307 fiches à chaque frappe de touche, à chaque bascule,
	// à chaque changement de page. Le repli est mémoïsé pour rester stable.
	const vide = useMemo<Record<string, string[]>>(() => ({}), []);
	const charTechniques = facets?.charTechniques ?? vide;
	const charArcs = facets?.charArcs ?? vide;

	// Facettes races (avec compte), triées par fréquence puis alpha → options du
	// filtre. Reste dérivé des personnages (colonne `race`, pas de la jointure).
	const raceOptions = useMemo(() => {
		const counts = new Map<string, number>();
		for (const c of characters) {
			if (!c.race) continue;
			counts.set(c.race, (counts.get(c.race) ?? 0) + 1);
		}
		return [...counts.entries()]
			.toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([value, count]) => ({ value, label: value, count }));
	}, [characters]);

	// Filtrage CUMULATIF : ET entre catégories (race ET technique ET arc ET
	// recherche), OU à l'intérieur d'une catégorie.
	const filtered = useMemo(() => {
		const q = norm(query);
		const raceSet = races.length ? new Set(races) : null;
		const techSet = techniques.length ? new Set(techniques) : null;
		const arcSet = arcs.length ? new Set(arcs) : null;
		return characters.filter((c) => {
			if (raceSet && (!c.race || !raceSet.has(c.race))) return false;
			if (techSet) {
				const ct = charTechniques[String(c.id)];
				if (!ct || !ct.some((t) => techSet.has(t))) return false;
			}
			if (arcSet) {
				const ca = charArcs[String(c.id)];
				if (!ca || !ca.some((a) => arcSet.has(a))) return false;
			}
			if (!q) return true;
			return norm(c.name).includes(q) || (c.nameJa ? c.nameJa.includes(query.trim()) : false);
		});
	}, [characters, query, races, techniques, arcs, charTechniques, charArcs]);

	/**
	 * Versions filtrées — mêmes règles que les fiches, appliquées au personnage
	 * PARENT (race, techniques, arcs lui appartiennent), plus la saga dans la
	 * recherche : taper « namek » doit remonter les versions de la saga Namek
	 * autant que les Nameks.
	 */
	const versionsFiltrees = useMemo(() => {
		if (vue !== "versions") return [];
		const q = norm(query);
		const raceSet = races.length ? new Set(races) : null;
		const techSet = techniques.length ? new Set(techniques) : null;
		const arcSet = arcs.length ? new Set(arcs) : null;
		return variants.filter((v) => {
			if (raceSet && (!v.race || !raceSet.has(v.race))) return false;
			if (techSet) {
				const ct = charTechniques[String(v.characterId)];
				if (!ct || !ct.some((t) => techSet.has(t))) return false;
			}
			if (arcSet) {
				const ca = charArcs[String(v.characterId)];
				if (!ca || !ca.some((a) => arcSet.has(a))) return false;
			}
			if (!q) return true;
			return norm(v.name).includes(q) || norm(v.saga).includes(q);
		});
	}, [variants, vue, query, races, techniques, arcs, charTechniques, charArcs]);

	/** Fiches filtrées PUIS classées. */
	const fichesTriees = useMemo(
		() =>
			tri === "alpha"
				? [...filtered].toSorted((a, b) => a.name.localeCompare(b.name, "fr"))
				: [...filtered].toSorted(comparerRichesse),
		[filtered, tri]
	);

	/**
	 * Versions classées par la richesse de leur personnage PARENT, puis par saga.
	 * Une version ne porte pas de note propre : elle n'a ni article ni rubriques,
	 * seulement ce qui change d'une saga à l'autre. La classer par son parent
	 * remonte les versions de Goku avant celles d'un figurant, ce qui est bien la
	 * question posée.
	 */
	const versionsTriees = useMemo(() => {
		if (vue !== "versions") return versionsFiltrees;
		const note = new Map(characters.map((c) => [c.id, c.richesse ?? 0]));
		return [...versionsFiltrees].toSorted((a, b) => {
			if (tri === "alpha") return a.name.localeCompare(b.name, "fr");
			const d = (note.get(b.characterId) ?? 0) - (note.get(a.characterId) ?? 0);
			return d !== 0 ? d : a.name.localeCompare(b.name, "fr");
		});
	}, [versionsFiltrees, characters, tri, vue]);

	/** Liste réellement paginée et rendue, selon la vue choisie. */
	const liste = vue === "versions" ? versionsTriees : fichesTriees;

	// Pagination bornée : 48 cartes à l'écran (multiple élégant de 2, 3, 4, 6, 8 pour
	// remplir parfaitement toutes les grilles sans saut de ligne incomplet).
	const PAGE = 48;
	const [page, setPage] = useState(1);
	// Page reprise de l'URL (cf. `initial`), appliquée une fois montée.
	useEffect(() => {
		const p = initial.current?.page ?? 1;
		if (p > 1) setPage(p);
	}, []);
	/**
	 * Tout changement de filtre ramène à la première page : rester en page 7
	 * d'une liste qui vient d'en perdre 6 affiche un vide inexplicable.
	 *
	 * Deux précautions, pour ne pas défaire la restauration de `?p` :
	 *  - on compare les filtres au lieu de se fier au déclenchement de l'effet,
	 *    qui s'exécute aussi au montage (et deux fois en mode strict) ;
	 *  - tant que `vue` n'a pas rejoint la valeur lue dans l'URL, on est encore
	 *    dans la mise en place de l'état initial, pas devant un choix du lecteur
	 *    — sans quoi `?vue=versions&p=3` perdait sa page au montage.
	 */
	const filtresPrecedents = useRef<string | null>(null);
	const restauration = useRef((initial.current?.page ?? 1) > 1);
	useEffect(() => {
		const cle = JSON.stringify([query, races, techniques, arcs, vue, tri]);
		if (filtresPrecedents.current === cle) return;
		const premier = filtresPrecedents.current === null;
		filtresPrecedents.current = cle;
		if (restauration.current) {
			if (vue === initial.current?.vue) restauration.current = false;
			return;
		}
		if (!premier) setPage(1);
	}, [query, races, techniques, arcs, vue, tri]);
	const pages = Math.max(1, Math.ceil(liste.length / PAGE));
	const pageSure = Math.min(page, pages);
	const visible = useMemo(
		() => fichesTriees.slice((pageSure - 1) * PAGE, pageSure * PAGE),
		[fichesTriees, pageSure]
	);
	const versionsVisibles = useMemo(
		() => versionsTriees.slice((pageSure - 1) * PAGE, pageSure * PAGE),
		[versionsTriees, pageSure]
	);

	const activeCount = races.length + techniques.length + arcs.length;
	const resetFilters = () => {
		setRaces([]);
		setTechniques([]);
		setArcs([]);
	};

	return (
		<div className="space-y-8">
			{/* Toolbar : recherche + bouton « Filtrer » (ouvre la modale Race /
			    Techniques / Arcs, cumulatif) + compteur live. */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<div className="relative flex-1 max-w-md">
					<svg
						className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden
					>
						<circle cx="11" cy="11" r="8" />
						<path d="m21 21-4.3-4.3" />
					</svg>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher un personnage…"
						aria-label="Rechercher un personnage"
						className="w-full h-11 pl-11 pr-4 rounded-full bg-white/[0.05] border border-white/[0.1] text-white text-sm placeholder:text-white/50 focus:outline-none focus:border-dbz-orange/60 focus:bg-white/[0.07] transition-colors"
					/>
				</div>
				<button
					type="button"
					onClick={() => setModalOpen(true)}
					aria-haspopup="dialog"
					className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-display font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange ${
						activeCount > 0
							? "border-dbz-orange/60 bg-dbz-orange/10 text-dbz-orange"
							: "border-white/[0.12] bg-white/[0.05] text-white/80 hover:border-dbz-orange/60 hover:text-white"
					}`}
				>
					<Scouter className="h-4 w-4" />
					Filtrer
					{activeCount > 0 && (
						<span className="grid h-5 min-w-5 place-items-center rounded-full bg-dbz-orange px-1.5 text-[11px] font-bold text-black">
							{activeCount}
						</span>
					)}
				</button>
				{activeCount > 0 && (
					<button
						type="button"
						onClick={resetFilters}
						className="text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-dbz-orange transition-colors"
					>
						Réinitialiser
					</button>
				)}
				{/* Ordre d'affichage. Deux options seulement : le tri par richesse
				    répond à « montre-moi ce que le wiki connaît », l'alphabétique à
				    « je cherche un nom précis ». En ajouter d'autres (par race, par
				    ki) ferait doublon avec les filtres, qui répondent déjà mieux. */}
				<div
					role="group"
					aria-label="Trier les personnages"
					// Sur mobile la bascule prend toute la largeur et 52 px de haut : ses
					// segments atteignent alors les 44 px de cible tactile (ils étaient à
					// 36), et deux bascules côte à côte tiennent sur une seule rangée au
					// lieu d'empiler deux blocs pleine largeur. Au-delà de 640 px, on
					// revient à la pastille compacte d'origine.
					className="inline-flex h-13 w-full items-center rounded-full border border-white/[0.12] bg-white/[0.04] p-1 sm:h-11 sm:w-auto"
				>
					{(
						[
							["richesse", "Les mieux documentés"],
							["alpha", "A → Z"],
						] as const
					).map(([valeur, libelle]) => (
						<button
							key={valeur}
							type="button"
							onClick={() => setTri(valeur)}
							aria-pressed={tri === valeur}
							className={`h-11 flex-1 rounded-full px-3.5 text-[13px] font-display font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange sm:h-9 sm:flex-none ${
								tri === valeur ? "bg-dbz-orange text-black" : "text-white/70 hover:text-white"
							}`}
						>
							{libelle}
						</button>
					))}
				</div>
				{nbVariants > 0 && (
					<div
						role="group"
						aria-label="Affichage"
						// Sur mobile la bascule prend toute la largeur et 52 px de haut : ses
						// segments atteignent alors les 44 px de cible tactile (ils étaient à
						// 36), et deux bascules côte à côte tiennent sur une seule rangée au
						// lieu d'empiler deux blocs pleine largeur. Au-delà de 640 px, on
						// revient à la pastille compacte d'origine.
						className="inline-flex h-13 w-full items-center rounded-full border border-white/[0.12] bg-white/[0.04] p-1 sm:h-11 sm:w-auto"
					>
						{(["fiches", "versions"] as const).map((v) => (
							<button
								key={v}
								type="button"
								onClick={() => setVue(v)}
								aria-pressed={vue === v}
								className={`h-11 flex-1 rounded-full px-3.5 text-[13px] font-display font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange sm:h-9 sm:flex-none ${
									vue === v ? "bg-dbz-orange text-black" : "text-white/65 hover:text-white"
								}`}
							>
								{v === "fiches" ? "Fiches" : "Versions"}
							</button>
						))}
					</div>
				)}
				<p className="scouter-text text-[11px] text-dbz-orange whitespace-nowrap sm:ml-auto">
					{vue === "versions"
						? `${versionsFiltrees.length} / ${nbVariants} versions`
						: `${filtered.length} / ${characters.length} personnages`}
				</p>
			</div>

			{/* Grille */}
			{vue === "versions" && (etatVersions === "vierge" || etatVersions === "chargement") ? (
				<p className="py-20 text-center text-sm text-white/45">Chargement des versions…</p>
			) : vue === "versions" && etatVersions === "erreur" ? (
				// Un échec réseau ne doit pas se déguiser en « aucun résultat » : le
				// lecteur croirait la rubrique vide et n'aurait aucun moyen de réessayer.
				<div className="py-20 text-center">
					<p className="text-sm text-white/55">Les versions n&apos;ont pas pu être chargées.</p>
					<button
						type="button"
						onClick={() => setEtatVersions("vierge")}
						className="mt-3 inline-flex h-11 items-center rounded-full border border-dbz-orange/60 bg-dbz-orange/10 px-5 text-[13px] font-display font-semibold text-dbz-orange transition-colors hover:bg-dbz-orange hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
					>
						Réessayer
					</button>
				</div>
			) : liste.length === 0 ? (
				<p className="py-20 text-center text-white/50 font-sans">
					{vue === "versions" ? "Aucune version ne correspond" : "Aucun personnage ne correspond"}{" "}
					{query ? `à « ${query} »` : "à ces filtres"}.
				</p>
			) : vue === "versions" ? (
				<div className="reveal-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 md:gap-4 lg:grid-cols-6">
					{versionsVisibles.map((v, index) => (
						<ClientGatedWrap
							access={access}
							key={v.id}
							// La version renvoie vers la fiche du personnage, à l'ancre de
							// sa saga : c'est là que vivent son résumé, ses faits marquants
							// et ses preuves. Une page par version dupliquerait la fiche
							// pour n'en changer que quelques champs.
							href={`/wiki/personnages/${v.characterId}#saga-${v.sagaId}`}
							className="group dbz-panel ki-card overflow-hidden transition-all duration-300 hover:scale-105"
						>
							<div className="relative aspect-[3/4] overflow-hidden bg-dbz-bg">
								<div className="absolute inset-0 halftone z-10 opacity-10" />
								<WikiImg
									src={v.image ?? v.characterImage}
									alt={v.name}
									loading={index < 12 ? "eager" : "lazy"}
									sizes="(min-width: 1280px) 200px, (min-width: 768px) 20vw, 45vw"
									className="absolute inset-0 h-full w-full object-cover object-top transition-all duration-700 group-hover:scale-110"
								/>
								<div className="absolute inset-0 z-20 bg-gradient-to-t from-black via-black/20 to-transparent" />
								<span aria-hidden className="ki-card__glow" />
								<div className="absolute inset-x-0 bottom-0 z-30 p-2">
									<p className="truncate font-display text-[11px] font-bold leading-tight text-white transition-colors group-hover:text-dbz-orange">
										{v.name}
									</p>
									{/* La saga entre parenthèses, sur sa propre ligne : accolée
									    au nom elle serait tronquée avant d'être lue. */}
									<p className="truncate text-[10px] leading-tight text-white/55">({v.saga})</p>
									{v.form && (
										<p className="scouter-text truncate text-[8px] text-dbz-orange/80">{v.form}</p>
									)}
								</div>
							</div>
						</ClientGatedWrap>
					))}
				</div>
			) : (
				<div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 md:gap-4 reveal-grid">
					{visible.map((c, index) => (
						<ClientGatedWrap
							access={access}
							key={c.id}
							href={`/wiki/personnages/${c.slug ?? c.id}`}
							// `nav-forward` → slide directionnel à l'arrivée sur la fiche
							// (View Transitions). La fiche tag son "retour" en nav-back.
							transitionTypes={["nav-forward"]}
							className="group dbz-panel overflow-hidden hover:scale-105 transition-all duration-300 ki-card"
						>
							<div className="relative aspect-[3/4] bg-dbz-bg overflow-hidden">
								<div className="absolute inset-0 halftone opacity-10 z-10 pointer-events-none" />
								{/* Morph d'élément partagé : ce thumbnail et l'image héro de la
								    fiche partagent `character-img-${id}` → la grille « se déplie »
								    en grande image au clic. WikiImg gère le repli (portrait XV2)
								    puis un placeholder stylé si l'image 404 (pas de vignette cassée). */}
								<ViewTransition name={`character-img-${c.id}`} share="morph">
									<WikiImg
										src={c.image}
										fallback={c.portraitXv2}
										loading={index < 16 ? "eager" : "lazy"}
										sizes="(min-width: 1280px) 160px, (min-width: 768px) 180px, (min-width: 640px) 160px, 33vw"
										alt={c.name}
										className="absolute inset-0 w-full h-full object-cover object-top opacity-100 group-hover:scale-110 transition-all duration-700"
									/>
								</ViewTransition>
								<div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent z-20" />
								{/* Liseré ki au survol (conic sweep piloté par @property) */}
								<span aria-hidden className="ki-card__glow" />
								<div className="absolute inset-x-0 bottom-0 p-2 z-30">
									{c.race && (
										<p className="scouter-text text-[8px] text-dbz-orange/90 mb-0.5 truncate">
											{c.race}
										</p>
									)}
									<p className="font-display font-bold text-[10px] text-white leading-tight group-hover:text-dbz-orange transition-colors truncate">
										{c.name}
									</p>
								</div>
							</div>
						</ClientGatedWrap>
					))}
				</div>
			)}

			<Pagination
				page={pageSure}
				parPage={PAGE}
				total={liste.length}
				onPageChange={setPage}
				unite={vue === "versions" ? "versions" : "personnages"}
				className="pt-2"
			/>
			<CharacterFilterModal
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				raceOptions={raceOptions}
				techniqueOptions={techniqueOptions}
				arcOptions={arcOptions}
				races={races}
				techniques={techniques}
				arcs={arcs}
				onRaces={setRaces}
				onTechniques={setTechniques}
				onArcs={setArcs}
				onReset={resetFilters}
				// Le pied de la modale compte ce que la vue affiche : en mode
				// « Versions » il annonçait « 12 / 1 307 » alors que la grille
				// derrière listait des versions, pas des fiches.
				resultCount={vue === "versions" ? versionsFiltrees.length : filtered.length}
				totalCount={vue === "versions" ? variants.length : characters.length}
				unite={vue === "versions" ? "versions" : "guerriers"}
			/>
		</div>
	);
}

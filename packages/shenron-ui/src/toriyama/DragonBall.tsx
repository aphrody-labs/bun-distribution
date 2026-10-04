/**
 * DragonBall — la boule de cristal en SVG pur (0 JS, server-safe).
 *
 * Refaite d'après la MESURE d'une vraie boule, et non plus d'après le dessin
 * svgrepo #484265 qui la précédait : celui-ci portait une sphère ambre pâle en
 * aplat (`#F5BF41`), une ombre portée, un glint blanc lustré et une étoile de
 * 0,25 rayon — quatre traits qu'on ne trouve sur aucune impression du support.
 *
 * ## La source
 *
 * `assets/ext/db_manga_volumes/82.jpg` — couverture du **tome 1 original**,
 * 1000 × 1500, où la boule tient la place du O de « DRAGON » et mesure 100 px
 * de diamètre, soit 10 % de la largeur de page. C'est la plus grande boule
 * disponible en propre dans le dépôt, et la seule assez définie pour qu'on y
 * lise un dégradé plutôt qu'un aplat.
 *
 * Le cercle est ajusté par CORDES : pour chaque ligne, le plus long segment qui
 * n'est ni le jaune de la lettre, ni le noir du cerne, ni le blanc du papier.
 * Les milieux de corde tombent à x = 444,5 ± 1 sur 100 lignes, et le modèle
 * `corde = 2·√(R² − dy²)` colle à moins de 3 px avec R = 50.
 *
 * ## Ce qui est mesuré
 *
 * | Grandeur | Mesure | Note |
 * |---|---|---|
 * | Disque | centre (444,5 ; 165,8), Ø 100 px | 10 % de la largeur de page |
 * | Foyer du dégradé | **(−0,30 ; −0,39) R** | en HAUT À GAUCHE, à 0,49 R du centre |
 * | Dégradé | 10 arrêts, `#FDFFEA` au foyer → `#EF9A2B` au bord | ambre chaud, jamais rouge |
 * | Bord | ~`#F29D32` sur les 8 directions | le pourtour est sombre TOUT AUTOUR |
 * | Étoile, rayon externe | **0,412 R** | 360 rayons, moyenne des 40 plus longs |
 * | Étoile, rayon interne | **0,479 Ro** | moyenne des 40 plus courts, même seuil |
 * | Étoile, position | (+0,02 ; +0,015) R | concentrique à 1 px près |
 * | Étoile, orientation | pointes à 54°, 126°, 198°, 270°, 342° | pointe en haut |
 * | Rouge de l'étoile | **`#E81F23`** | médiane sur 758 px (second relevé `#EA1E24`) |
 * | Cerne d'encre | **aucun** sur cette couverture | le disque est posé nu sur le jaune |
 *
 * ## Les deux écarts assumés
 *
 * 1. **Le cerne est conservé**, à 4,5 % du diamètre — valeur mesurée, elle, sur
 *    la boule du logo de `db_manga_volumes/124.jpg` (Dragon Ball Super), qui en
 *    porte un de 4 px pour Ø 89. Sur le papier la boule est posée sur du jaune
 *    et se détache seule ; sur le fond noir du site, sans cerne, elle flotte en
 *    découpe. C'est la même raison qui a fait doubler le cerne des titres.
 * 2. **Le rayon interne de l'étoile est arrondi à 0,45**, la valeur que le
 *    design system porte déjà pour `<Etoile>` et pour la boule de la couverture
 *    DBS. Trois lectures : 0,45, 0,45, 0,479 — l'écart tient dans la bavure
 *    d'encre, et une seule géométrie d'étoile dans le code vaut mieux que trois.
 *
 * Le dégradé est conservé COMME dégradé : c'est, avec la pastille de numéro de
 * tome, le seul endroit du support qui n'est pas un aplat franc
 * (cf. `docs/couverture-analyse-visuelle.md`).
 */

export type DragonBallStars = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** viewBox 512 : le cerne d'encre vaut 4,5 % du diamètre. */
const R_EXT = 256;
const CERNE = Math.round(0.045 * 512); // 23
const R_INT = R_EXT - CERNE; // 233

/**
 * Foyer du dégradé, en unités du viewBox. Relevé à (−0,30 ; −0,39) du rayon,
 * c'est-à-dire en haut à gauche : la boule est éclairée d'en haut, comme toute
 * sphère. Le rendu précédent la faisait luire par en dessous.
 */
const FOYER_X = R_EXT - 0.3 * R_INT; // 186
const FOYER_Y = R_EXT - 0.39 * R_INT; // 165

/**
 * Le profil, échantillonné au paramétrage EXACT d'un `radialGradient` à foyer :
 * pour chaque rayon partant du foyer, la couleur à la fraction `offset` de la
 * distance foyer → bord du disque, médiane sur 180 rayons. C'est la définition
 * même de l'`offset` d'un arrêt SVG, donc les nombres se recopient tels quels.
 */
const DEGRADE: ReadonlyArray<readonly [number, string]> = [
	[0, "#fdffea"],
	[0.1, "#fdfcca"],
	[0.2, "#fef6bb"],
	[0.3, "#fce7a6"],
	[0.4, "#fcdc93"],
	[0.5, "#fdcd7f"],
	[0.6, "#fcc06a"],
	[0.7, "#fcb455"],
	[0.8, "#fba740"],
	[0.9, "#f29d32"],
	[1, "#ef9a2b"],
];

const ROUGE_ETOILE = "#e81f23";

// Positions normalisées des étoiles (0 = centre ; unité = fraction du viewBox 512).
const STAR_LAYOUT: Record<number, ReadonlyArray<readonly [number, number]>> = {
	1: [[0, 0]],
	2: [
		[-0.22, 0],
		[0.22, 0],
	],
	3: [
		[0, -0.24],
		[-0.21, 0.13],
		[0.21, 0.13],
	],
	4: [
		[-0.2, -0.2],
		[0.2, -0.2],
		[-0.2, 0.2],
		[0.2, 0.2],
	],
	5: [
		[-0.22, -0.2],
		[0.22, -0.2],
		[0, 0],
		[-0.22, 0.2],
		[0.22, 0.2],
	],
	6: [
		[-0.22, -0.22],
		[0.22, -0.22],
		[-0.22, 0],
		[0.22, 0],
		[-0.22, 0.22],
		[0.22, 0.22],
	],
	7: [
		[0, -0.26],
		[-0.22, -0.11],
		[0.22, -0.11],
		[0, 0.04],
		[-0.22, 0.2],
		[0.22, 0.2],
		[0, 0.28],
	],
};

/**
 * Rayon d'étoile, en fraction du rayon intérieur du disque. La boule à UNE
 * étoile est la seule qu'on ait pu mesurer — c'est celle du logo — et elle
 * donne 0,412. Les autres décroissent pour tenir dans le disque sans se
 * toucher, en gardant la même graisse d'aplat.
 */
const R_ETOILE: Record<number, number> = {
	1: 0.412,
	2: 0.3,
	3: 0.26,
	4: 0.25,
	5: 0.21,
	6: 0.2,
	7: 0.185,
};

/**
 * Points d'une étoile à 5 branches centrée en (cx,cy), rayon externe `outer`,
 * pointe en haut — l'orientation relevée sur la couverture (sommets à 54°,
 * 126°, 198°, 270° et 342°).
 *
 * Rayon interne à 0,45 : mesuré 0,479 sur la boule du tome 1, 0,45 sur celle de
 * la couverture DBS et 0,45 sur l'étoile de la ligne de titre. Le pentagramme
 * régulier, lui, donnerait 0,382 et une étoile maigre qui se réduit à une tache
 * en puce de liste.
 */
function starPoints(cx: number, cy: number, outer: number): string {
	const inner = outer * 0.45;
	const pts: string[] = [];
	for (let i = 0; i < 10; i++) {
		const rad = i % 2 === 0 ? outer : inner;
		const ang = -Math.PI / 2 + (i * Math.PI) / 5;
		pts.push(`${(cx + rad * Math.cos(ang)).toFixed(1)},${(cy + rad * Math.sin(ang)).toFixed(1)}`);
	}
	return pts.join(" ");
}

export function DragonBall({
	stars = 4,
	size = 64,
	className,
	title,
	decorative = false,
}: {
	stars?: number;
	size?: number;
	className?: string;
	title?: string;
	/**
	 * Décor pur : la boule sort de l'arbre d'accessibilité.
	 *
	 * `KintoUn` et `DragonBallLoader` portaient déjà cet interrupteur, pas elle —
	 * si bien qu'une boule posée pour le décor s'annonçait quand même. Les sept
	 * boules dispersées de la page 404 se lisaient « Dragon Ball à 1 étoile,
	 * Dragon Ball à 2 étoiles… », sept fois, avant le seul texte utile de la
	 * page ; et le loader annonçait « Chargement » PUIS le nom de sa propre
	 * illustration.
	 */
	decorative?: boolean;
}) {
	const n = Math.min(7, Math.max(1, Math.round(stars)));
	const layout = STAR_LAYOUT[n] ?? STAR_LAYOUT[4];
	const starR = (R_ETOILE[n] ?? 0.25) * R_INT;
	const a11y = decorative
		? { "aria-hidden": true as const }
		: { role: "img" as const, "aria-label": title ?? `Dragon Ball à ${n} étoile${n > 1 ? "s" : ""}` };
	// Identifiant DÉTERMINISTE, pas un compteur de module ni un `useId` : le
	// composant est rendu côté serveur sans état, et deux boules de même nombre
	// d'étoiles partagent alors une définition strictement identique — la
	// collision d'id est sans effet, là où un compteur casserait l'hydratation.
	const gid = `db-sphere-${n}`;

	return (
		<svg
			viewBox="0 0 512 512"
			width={size}
			height={size}
			className={className}
			{...a11y}
		>
			<defs>
				{/* `userSpaceOnUse` et non `objectBoundingBox` : le dégradé appartient
				    au disque INTÉRIEUR (r = 233), pas à la boîte englobante, qui
				    contient en plus le cerne. */}
				<radialGradient
					id={gid}
					gradientUnits="userSpaceOnUse"
					cx={R_EXT}
					cy={R_EXT}
					r={R_INT}
					fx={FOYER_X}
					fy={FOYER_Y}
				>
					{DEGRADE.map(([offset, couleur]) => (
						<stop key={offset} offset={offset} stopColor={couleur} />
					))}
				</radialGradient>
			</defs>
			{/* Cerne d'encre : un disque noir plein, le dégradé par-dessus. Un
			    `stroke` centré sur le cercle déborderait du viewBox. */}
			<circle cx={R_EXT} cy={R_EXT} r={R_EXT} fill="#000" />
			<circle cx={R_EXT} cy={R_EXT} r={R_INT} fill={`url(#${gid})`} />
			{/* Étoiles rouges (1 à 7), aplat franc sans contour — la couverture n'en
			    pose aucun autour d'elles. */}
			{layout.map(([nx, ny], i) => (
				<polygon
					key={i}
					points={starPoints(R_EXT + nx * 512, R_EXT + ny * 512, starR)}
					fill={ROUGE_ETOILE}
				/>
			))}
		</svg>
	);
}

/**
 * Loader animé : une Dragon Ball qui tourne (état de chargement).
 *
 * Par défaut c'est une région live (`role="status"` + `aria-label`) : à réserver
 * aux chargements autonomes (page/section). Dans un contrôle déjà nommé (bouton
 * « Chercher », champ de recherche), passer `decorative` → le loader devient
 * `aria-hidden` et n'usurpe plus le nom accessible du contrôle.
 */
export function DragonBallLoader({
	size = 40,
	stars = 4,
	className = "",
	decorative = false,
}: {
	size?: number;
	stars?: DragonBallStars;
	className?: string;
	decorative?: boolean;
}) {
	return (
		<span
			className={`inline-block ${className}`}
			style={{ width: size, height: size, animation: "db-spin 1.1s linear infinite" }}
			{...(decorative ? { "aria-hidden": true } : { "aria-label": "Chargement", role: "status" })}
		>
			{/* `decorative` : l'enveloppe porte déjà « Chargement » (ou est masquée) —
			    sans cela, le lecteur d'écran enchaînait avec le nom de l'illustration.
			    Même parti pris que `KintoUnLoader`. */}
			<DragonBall stars={stars} size={size} decorative />
			<style>{`@keyframes db-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.inline-block[style*="db-spin"]{animation:none!important}}`}</style>
		</span>
	);
}

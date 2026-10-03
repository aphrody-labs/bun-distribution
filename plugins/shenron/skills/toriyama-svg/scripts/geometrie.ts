/**
 * Primitives de tracé pour dessiner « à la Toriyama » sans rien décalquer.
 *
 * L'idée directrice : une forme de manga n'est pas une courbe de Bézier posée
 * au jugé, c'est une SUITE D'ARCS tendus entre des points de rupture. Le
 * dessinateur pose les creux, puis bombe entre eux. Reproduire ce geste donne
 * une silhouette qui « sonne » juste, et surtout qui reste modifiable : on
 * déplace un creux, on change une flèche, la forme suit.
 *
 * Copier ce fichier dans le projet (par exemple `src/lib/<sujet>.ts`) et
 * l'étendre avec la géométrie du sujet. Il ne dépend de rien.
 */
export type Point = readonly [number, number];

export const arrondi = (v: number, n = 1) => {
	const f = 10 ** n;
	return Math.round(v * f) / f;
};

/**
 * Chaîne d'arcs de cercle entre points successifs. `fleches[i]` est la hauteur
 * de l'arc i (sa sagitta) : positive elle bombe vers l'extérieur, négative elle
 * creuse. Une flèche supérieure à la moitié de la corde donne le lobe « pincé »
 * caractéristique des nuages, des cheveux et des explosions.
 *
 * Le rayon vient de la relation sagitta/corde : r = L²/(8h) + h/2.
 */
export function arcs(pts: readonly Point[], fleches: readonly number[], ferme = true): string {
	const n = pts.length;
	const fin = ferme ? n : n - 1;
	let d = `M${arrondi(pts[0][0])} ${arrondi(pts[0][1])}`;
	for (let i = 0; i < fin; i++) {
		const [x1, y1] = pts[i];
		const [x2, y2] = pts[(i + 1) % n];
		const corde = Math.hypot(x2 - x1, y2 - y1);
		const h = fleches[i % fleches.length];
		const a = Math.max(1, Math.abs(h));
		const r = (corde * corde) / 4 / (2 * a) + a / 2;
		d += `A${arrondi(r)} ${arrondi(r)} 0 ${a > corde / 2 ? 1 : 0} ${h < 0 ? 0 : 1} ${arrondi(x2)} ${arrondi(y2)}`;
	}
	return ferme ? `${d}Z` : d;
}

/**
 * Volute : la spirale rentrante qui termine chaque lobe du Kinto-Un et, plus
 * largement, les nuages et les tourbillons de poussière de Toriyama (motif
 * hérité du Xiyouji). Part de `depart`, s'enroule vers `vers`, rayon `r`.
 * Tracée en segments courts : douze par tour suffisent à l'œil même en 1200 px.
 */
export function volute(
	depart: Point,
	vers: Point,
	r: number,
	tours = 1.2,
	sens: 1 | -1 = 1
): string {
	const dx = vers[0] - depart[0];
	const dy = vers[1] - depart[1];
	const l = Math.hypot(dx, dy) || 1;
	const cx = depart[0] + (dx / l) * r;
	const cy = depart[1] + (dy / l) * r;
	const a0 = Math.atan2(depart[1] - cy, depart[0] - cx);
	const pas = Math.ceil(tours * 12);
	let d = `M${arrondi(depart[0])} ${arrondi(depart[1])}`;
	for (let i = 1; i <= pas; i++) {
		const t = i / pas;
		const a = a0 + sens * t * Math.PI * 2 * tours;
		const rr = r * (1 - 0.85 * t);
		d += `L${arrondi(cx + rr * Math.cos(a))} ${arrondi(cy + rr * Math.sin(a))}`;
	}
	return d;
}

/**
 * Mèche : le trait de cheveu de Toriyama, large à la racine et effilé en
 * pointe. Rendu comme une forme pleine (deux arcs qui se rejoignent), jamais
 * comme un trait d'épaisseur constante — c'est ce qui distingue une chevelure
 * dessinée d'une chevelure « vectorisée ».
 */
export function meche(base: Point, pointe: Point, largeur: number, courbure = 0.25): string {
	const [bx, by] = base;
	const [px, py] = pointe;
	const dx = px - bx;
	const dy = py - by;
	const l = Math.hypot(dx, dy) || 1;
	const nx = -dy / l;
	const ny = dx / l;
	const a: Point = [bx + nx * largeur * 0.5, by + ny * largeur * 0.5];
	const b: Point = [bx - nx * largeur * 0.5, by - ny * largeur * 0.5];
	const f = l * courbure;
	return `${arcs([a, pointe], [f], false)}${arcs([pointe, b], [f], false).replace(/^M[^A]*/, "")}Z`;
}

/**
 * Épaisseur de trait exprimée en pourcentage de la largeur du sujet — c'est la
 * seule façon de garder un trait juste quand on change de viewBox. Sur les
 * planches mesurées, l'encre de contour tient entre 0,7 % et 0,9 %.
 */
export const trait = (largeurSujet: number, pct = 0.8) => arrondi((largeurSujet * pct) / 100, 2);

/**
 * Plan d'ombre : reprend le contour, le décale, et laisse le découpage par la
 * silhouette faire le reste. La bande d'ombre épouse alors exactement les lobes
 * au lieu d'être une courbe dessinée à côté — c'est le truc qui fait qu'une
 * ombre d'aplat ne « flotte » pas.
 *
 * `attenuation` réduit le décalage le long de x, pour qu'une extrémité garde sa
 * lumière (une queue, une pointe de mèche).
 */
export function planDombre(
	contour: readonly Point[],
	decalage: readonly [number, number],
	largeur: number,
	attenuation = 0
): Point[] {
	const [dx, dy] = decalage;
	return contour.map(([x, y]) => [x + dx, y + dy + attenuation * (x / largeur)]);
}

/** Symétrie horizontale autour de `axe` — un visage se dessine sur une moitié. */
export const miroir = (pts: readonly Point[], axe: number): Point[] =>
	pts.map(([x, y]) => [2 * axe - x, y]);

/**
 * Assemble un SVG complet. `titre` et `description` ne sont pas décoratifs :
 * sans eux le dessin est muet pour un lecteur d'écran, et `role="img"` sans
 * nom accessible est pire que rien.
 */
export function svg({
	largeur,
	hauteur,
	titre,
	description,
	corps,
	id = "s",
}: {
	largeur: number;
	hauteur: number;
	titre: string;
	description: string;
	corps: string;
	id?: string;
}): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-labelledby="${id}-t">
<title id="${id}-t">${titre}</title>
<desc>${description}</desc>
${corps}
</svg>
`;
}
